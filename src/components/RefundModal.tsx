import React, { useState, useEffect } from 'react';
import { 
  X, 
  DollarSign, 
  Calendar, 
  CreditCard, 
  RotateCcw, 
  AlertCircle, 
  CheckCircle2, 
  Receipt, 
  FileText,
  ShieldAlert,
  ArrowDownLeft
} from 'lucide-react';
import { format } from 'date-fns';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { InsuranceRequest } from '../types';
import { useFirestoreData } from '../context/FirestoreDataContext';
import { logInsuranceActivity } from '../utils/activityLogger';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurance: InsuranceRequest | null;
  overpaymentAmount?: number;
  onSuccess?: () => void;
}

export default function RefundModal({
  isOpen,
  onClose,
  insurance,
  overpaymentAmount,
  onSuccess
}: RefundModalProps) {
  const { paymentMethods, categories, latestExchangeRate } = useFirestoreData();

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'MXP'>('USD');
  const [exchangeRate, setExchangeRate] = useState<number>(20.0);
  const [paymentMethod, setPaymentMethod] = useState('Transferencia Bancaria');
  const [refundDate, setRefundDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [receiptNumber, setReceiptNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate policy financials
  const expectedTotal = insurance?.totalFinal !== undefined && insurance?.totalFinal !== null 
    ? insurance.totalFinal 
    : (insurance?.totalPrice || 0);
  const totalPaid = insurance?.totalPaid || 0;
  const calculatedOverpayment = Math.max(0, totalPaid - expectedTotal);
  const effectiveOverpayment = overpaymentAmount !== undefined ? overpaymentAmount : calculatedOverpayment;

  // Initialize form when opened or insurance changes
  useEffect(() => {
    if (isOpen && insurance) {
      const rate = latestExchangeRate || 20.0;
      setExchangeRate(rate);
      setCurrency('USD');
      setAmount(effectiveOverpayment > 0 ? effectiveOverpayment.toFixed(2) : '0.00');
      
      const defaultMethod = insurance.paymentMethod || 'Transferencia Bancaria';
      setPaymentMethod(defaultMethod);
      
      setRefundDate(format(new Date(), 'yyyy-MM-dd'));
      setReceiptNumber('');
      setNotes(`Reembolso por saldo de sobrepago en póliza ${insurance.policyId || insurance.IDseg || ''}`.trim());
      setError(null);
    }
  }, [isOpen, insurance, effectiveOverpayment, latestExchangeRate]);

  if (!isOpen || !insurance) return null;

  const handleAmountChange = (val: string) => {
    setAmount(val);
    setError(null);
  };

  const handleCurrencyChange = (newCurr: 'USD' | 'MXP') => {
    if (newCurr === currency) return;
    const currentVal = parseFloat(amount) || 0;
    if (newCurr === 'MXP') {
      const mxpVal = currentVal * exchangeRate;
      setAmount(mxpVal.toFixed(2));
    } else {
      const usdVal = currentVal / exchangeRate;
      setAmount(usdVal.toFixed(2));
    }
    setCurrency(newCurr);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Por favor ingrese un monto válido mayor a $0.00.');
      return;
    }

    const amountUSD = currency === 'USD' ? parsedAmount : (parsedAmount / exchangeRate);
    const amountMXP = currency === 'MXP' ? parsedAmount : (parsedAmount * exchangeRate);

    setIsSubmitting(true);
    setError(null);

    try {
      // Find or match 'Reembolsos' category if exists
      const reimbCategory = categories.find(c => 
        String(c.name || '').toLowerCase().includes('reembolso')
      );

      // 1. Create client_payment with negative amount to discount from totals
      const refundPaymentDoc = {
        insuranceId: insurance.id,
        clientId: insurance.clientId || '',
        amount: -Math.abs(amountUSD),
        currency: currency,
        amountMXP: -Math.abs(amountMXP),
        exchangeRate: exchangeRate,
        type: 'client_payment' as const,
        paymentMethod: paymentMethod,
        receiptNumber: receiptNumber.trim() || undefined,
        status: 'completed' as const,
        date: new Date(`${refundDate}T12:00:00`),
        notes: notes.trim() || 'Reembolso por saldo de sobrepago',
        categoryId: reimbCategory?.id || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || 'Sistema'
      };

      await addDoc(collection(db, 'payments'), refundPaymentDoc);

      // 2. Update insurance document: deduct from totalPaid and update payment status
      const currentPaid = insurance.totalPaid || 0;
      const newTotalPaid = Math.max(0, Math.round((currentPaid - amountUSD) * 100) / 100);
      const targetPrice = insurance.totalFinal !== undefined && insurance.totalFinal !== null 
        ? insurance.totalFinal 
        : (insurance.totalPrice || 0);

      let newStatus = insurance.status;
      if (Math.abs(targetPrice - newTotalPaid) <= 5) {
        newStatus = 'paid';
      } else if (newTotalPaid > 0) {
        newStatus = 'partially_paid';
      } else {
        newStatus = 'pending';
      }

      await updateDoc(doc(db, 'insurances', insurance.id), {
        totalPaid: newTotalPaid,
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      // 3. Log insurance activity
      try {
        await logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Se registró un reembolso por sobrepago de $${amountUSD.toFixed(2)} USD (${currency === 'MXP' ? `$${parsedAmount.toFixed(2)} MXP` : `$${parsedAmount.toFixed(2)} USD`}) vía ${paymentMethod}${receiptNumber ? ` (Recibo/Ref: ${receiptNumber.trim()})` : ''}. Saldo pagado actualizado a $${newTotalPaid.toFixed(2)} USD (Estado: ${newStatus === 'paid' ? 'Pagada' : newStatus === 'partially_paid' ? 'Parcialmente Pagada' : 'Pendiente'}).`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (logErr) {
        console.warn('Could not log insurance refund activity:', logErr);
      }

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: any) {
      console.error('Error saving refund payment:', err);
      setError(err?.message || 'Ocurrió un error al registrar el reembolso. Inténtelo nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[80] p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-6 py-5 text-white flex justify-between items-center shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-2xl backdrop-blur-xs">
              <RotateCcw className="w-6 h-6 text-blue-100" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight">Dar de Alta Reembolso por Sobrepago</h3>
              <p className="text-blue-100 text-xs mt-0.5">
                Póliza: <span className="font-semibold text-white">{insurance.policyId || insurance.IDseg || insurance.id}</span>
                {insurance.firstName ? ` • ${insurance.firstName} ${insurance.lastName || ''}` : ''}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={isSubmitting}
            className="p-2 hover:bg-white/20 rounded-full transition-colors text-blue-100 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Financial Summary Card */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4.5 space-y-3">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Estado Financiero de la Póliza</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Venta Total</p>
                <p className="text-base font-extrabold text-slate-800 mt-0.5">${expectedTotal.toFixed(2)} USD</p>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Cobrado</p>
                <p className="text-base font-extrabold text-emerald-700 mt-0.5">${totalPaid.toFixed(2)} USD</p>
              </div>
              <div className="bg-blue-50/80 p-3 rounded-xl border border-blue-200 shadow-2xs">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Sobrepago a Favor</p>
                <p className="text-base font-black text-blue-800 mt-0.5">
                  +${effectiveOverpayment.toFixed(2)} USD
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-100/50 p-2.5 rounded-xl border border-blue-200/60">
              <AlertCircle className="w-4 h-4 shrink-0 text-blue-600" />
              <span>
                Se registrará un reembolso por el excedente pagado por el cliente, cuadrando el balance de la póliza.
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Monto y Moneda */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Monto a Reembolsar *
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (currency === 'USD') {
                      setAmount(effectiveOverpayment.toFixed(2));
                    } else {
                      setAmount((effectiveOverpayment * exchangeRate).toFixed(2));
                    }
                  }}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                >
                  Usar Sobrepago ({effectiveOverpayment.toFixed(2)} USD)
                </button>
              </div>
              <div className="relative flex rounded-xl shadow-2xs">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-2.5 bg-white border border-slate-300 rounded-l-xl text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="inline-flex rounded-r-xl border border-l-0 border-slate-300 bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange('USD')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                      currency === 'USD'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    USD
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange('MXP')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                      currency === 'MXP'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    MXP
                  </button>
                </div>
              </div>
              {currency === 'MXP' && (
                <p className="text-[11px] text-slate-500 mt-1 font-medium">
                  Equivalente: ~${((parseFloat(amount) || 0) / exchangeRate).toFixed(2)} USD (T.C. {exchangeRate.toFixed(2)})
                </p>
              )}
            </div>

            {/* Fecha de Devolución */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Fecha del Reembolso *
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={refundDate}
                  onChange={(e) => setRefundDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs"
                />
              </div>
            </div>

            {/* Método de Pago/Devolución */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Método de Devolución *
              </label>
              <select
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs"
              >
                <option value="Transferencia Bancaria">Transferencia Bancaria</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Tarjeta de Crédito">Tarjeta de Crédito</option>
                <option value="Tarjeta de Débito">Tarjeta de Débito</option>
                <option value="Stripe">Stripe</option>
                <option value="Cheque">Cheque</option>
                {paymentMethods?.filter(pm => 
                  !['Transferencia Bancaria', 'Efectivo', 'Tarjeta de Crédito', 'Tarjeta de Débito', 'Stripe', 'Cheque'].includes(pm.name)
                ).map((pm: any) => (
                  <option key={pm.id} value={pm.name}>{pm.name}</option>
                ))}
              </select>
            </div>

            {/* Folio / Recibo / Ref de Devolución */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                No. Recibo / Referencia (Opcional)
              </label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                placeholder="Ej. SPEI 192847, Folio Dev-01"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs placeholder-slate-400"
              />
            </div>

            {/* Tipo de Cambio (si aplica) */}
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Notas / Concepto de Devolución
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalle o motivo del reembolso..."
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs placeholder-slate-400"
              />
            </div>
          </div>

          {/* Modal Footer / Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-all shadow-md shadow-blue-200 flex items-center gap-2 disabled:opacity-50 cursor-pointer hover:scale-[1.01] active:scale-95"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  <span>Confirmar Reembolso</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
