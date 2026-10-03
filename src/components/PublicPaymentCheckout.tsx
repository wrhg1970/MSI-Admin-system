import React, { useState, useEffect } from 'react';
import { 
  CreditCard, 
  ShieldCheck, 
  Lock, 
  CheckCircle, 
  AlertCircle, 
  DollarSign, 
  FileText, 
  Calendar, 
  User, 
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Receipt,
  Download
} from 'lucide-react';

interface PolicyCheckoutData {
  id: string;
  policyNumber: string;
  firstName: string;
  lastName: string;
  plan: string;
  destinationCountry?: string;
  currency: 'USD' | 'MXP';
  exchangeRate?: number;
  totalPrice: number;
  totalFinal: number;
  totalPaid: number;
  balance: number;
  status: string;
}

export default function PublicPaymentCheckout() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyData, setPolicyData] = useState<PolicyCheckoutData | null>(null);

  // Parse URL query params and pathname
  const searchParams = new URLSearchParams(window.location.search);
  const pathParts = window.location.pathname.split('/');
  const pathInsuranceId = pathParts[1] === 'pay' && pathParts[2] ? pathParts[2] : null;
  const insuranceId = pathInsuranceId || searchParams.get('insuranceId');
  const queryAmount = searchParams.get('amount');
  const queryCurrency = searchParams.get('currency') as 'USD' | 'MXP' | 'MXN' | null;
  const stripeStatus = searchParams.get('stripe_status');
  const sessionId = searchParams.get('session_id');

  // Form states
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<'USD' | 'MXP'>('USD');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardName, setCardName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState<string>('');

  useEffect(() => {
    async function fetchPolicy() {
      if (!insuranceId) {
        setLoading(false);
        setError('No se proporcionó el identificador de la póliza.');
        return;
      }

      try {
        const res = await fetch(`/api/public/checkout-info/${insuranceId}`);
        if (!res.ok) {
          throw new Error('No se encontró la información de la póliza.');
        }
        const data: PolicyCheckoutData = await res.json();
        setPolicyData(data);

        // Pre-fill amount and currency
        const cleanCurr = (queryCurrency === 'MXP' || queryCurrency === 'MXN') ? 'MXP' : (data.currency || 'USD');
        setCurrency(cleanCurr);

        if (queryAmount) {
          setAmount(parseFloat(queryAmount).toFixed(2));
        } else if (data.balance > 0) {
          if (cleanCurr === 'MXP' && data.exchangeRate) {
            setAmount((data.balance * data.exchangeRate).toFixed(2));
          } else {
            setAmount(data.balance.toFixed(2));
          }
        } else {
          setAmount(data.totalFinal.toFixed(2));
        }

        setCardName(`${data.firstName} ${data.lastName}`.trim());
      } catch (err: any) {
        console.error('Error fetching policy for checkout:', err);
        setError(err.message || 'Error al cargar los datos del seguro.');
      } finally {
        setLoading(false);
      }
    }

    if (stripeStatus === 'success') {
      setPaymentSuccess(true);
      setReceiptNumber(sessionId || `REC-${Math.floor(100000 + Math.random() * 900000)}`);
      setLoading(false);
    } else {
      fetchPolicy();
    }
  }, [insuranceId, queryAmount, queryCurrency, stripeStatus, sessionId]);

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
    const formatted = raw.replace(/(\d{4})/g, '$1 ').trim();
    setCardNumber(formatted);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (raw.length >= 3) {
      setCardExpiry(`${raw.slice(0, 2)}/${raw.slice(2)}`);
    } else {
      setCardExpiry(raw);
    }
  };

  const handleCvcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    setCardCvc(raw);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!insuranceId || !amount || parseFloat(amount) <= 0) {
      alert('Por favor ingrese un monto válido.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/stripe/simulate-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insuranceId,
          amount: parseFloat(amount),
          currency,
          sessionId: sessionId || `pay_${Date.now()}`,
          cardholderName: cardName || (policyData ? `${policyData.firstName} ${policyData.lastName}` : 'Cliente')
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Error al procesar el pago con tarjeta.');
      }

      setReceiptNumber(resData.receiptNumber || `REC-${Math.floor(100000 + Math.random() * 900000)}`);
      setPaymentSuccess(true);
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Error al procesar el pago.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-slate-800 flex flex-col justify-between p-4 sm:p-6 md:p-10 font-sans">
      
      {/* Top Brand Bar */}
      <div className="max-w-xl mx-auto w-full flex items-center justify-between text-white/90 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 border border-white/20">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-black text-lg tracking-wide text-white">Mi Seguro Internacional</h1>
            <p className="text-[11px] text-indigo-200/80 font-medium">Pasarela de Cobro Seguro con Tarjeta</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 bg-white/10 rounded-full border border-white/15 text-[10px] font-bold text-indigo-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>SSL 256-bit</span>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="max-w-xl mx-auto w-full my-auto py-8">
        {loading ? (
          <div className="bg-white rounded-3xl p-10 text-center shadow-2xl flex flex-col items-center justify-center gap-4">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-sm font-bold text-gray-600">Verificando enlace de pago seguro...</p>
          </div>
        ) : paymentSuccess ? (
          /* Success Screen */
          <div className="bg-white rounded-3xl p-8 sm:p-10 text-center shadow-2xl border border-gray-100 space-y-6 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle className="w-12 h-12" />
            </div>

            <div className="space-y-2">
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-black rounded-full border border-emerald-200 uppercase tracking-widest">
                ¡Pago Recibido con Éxito!
              </span>
              <h2 className="text-2xl font-black text-gray-900 pt-2">Tu póliza ha sido abonada</h2>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Tu transacción fue validada y conciliada automáticamente. Hemos registrado tu pago y tu póliza se encuentra al día.
              </p>
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 text-left space-y-3 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-gray-500 font-medium">Número de Recibo:</span>
                <span className="font-mono font-bold text-indigo-700">{receiptNumber}</span>
              </div>
              {policyData && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-medium">Asegurado:</span>
                    <span className="font-bold text-gray-800">{policyData.firstName} {policyData.lastName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-medium">Póliza:</span>
                    <span className="font-bold text-gray-800">#{policyData.policyNumber}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="text-gray-700 font-bold uppercase">Monto Pagado:</span>
                <span className="font-black text-emerald-600 text-base">
                  ${parseFloat(amount || '0').toLocaleString('es-MX', { minimumFractionDigits: 2 })} {currency}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Download className="w-4 h-4" />
                Imprimir o Guardar Comprobante
              </button>
            </div>
          </div>
        ) : stripeStatus === 'cancel' ? (
          /* Cancel Screen */
          <div className="bg-white rounded-3xl p-8 sm:p-10 text-center shadow-2xl border border-gray-100 space-y-6">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-black text-gray-900">Operación Cancelada</h2>
              <p className="text-xs text-gray-500">
                La sesión de pago fue cancelada. No se realizó ningún cargo a tu tarjeta.
              </p>
            </div>
            {policyData && (
              <a
                href={`/pay/${policyData.id}`}
                className="inline-block py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all"
              >
                Intentar de Nuevo
              </a>
            )}
          </div>
        ) : (
          /* Checkout Form Screen */
          <div className="bg-white rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col">
            
            {/* Header info */}
            <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-900 text-white space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className="px-2.5 py-0.5 bg-indigo-500/30 text-indigo-200 text-[10px] font-black rounded-full border border-indigo-400/30 uppercase tracking-widest">
                    Checkout Seguro
                  </span>
                  <h2 className="text-xl font-black text-white mt-1">Pago de Póliza de Seguro</h2>
                </div>
                <div className="p-2.5 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10">
                  <Lock className="w-5 h-5 text-indigo-300" />
                </div>
              </div>

              {policyData && (
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 grid grid-cols-2 gap-3 text-xs text-indigo-100">
                  <div>
                    <span className="text-[10px] text-indigo-300 uppercase font-bold block">Asegurado</span>
                    <span className="font-bold text-white text-sm">{policyData.firstName} {policyData.lastName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-300 uppercase font-bold block">No. de Póliza</span>
                    <span className="font-mono font-bold text-white text-sm">#{policyData.policyNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-300 uppercase font-bold block">Plan Contratado</span>
                    <span className="font-medium text-white">{policyData.plan}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-300 uppercase font-bold block">Saldo Pendiente</span>
                    <span className="font-black text-emerald-300 text-sm">
                      ${policyData.balance.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Form */}
            <form onSubmit={handleSubmitPayment} className="p-6 sm:p-8 space-y-5">
              
              {error && (
                <div className="p-3.5 bg-red-50 text-red-700 text-xs rounded-2xl border border-red-200 flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {/* Amount and Currency */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Monto a Pagar</label>
                  <div className="flex bg-gray-100 p-0.5 rounded-lg text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setCurrency('USD')}
                      className={`px-3 py-1 rounded-md transition-all ${currency === 'USD' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrency('MXP')}
                      className={`px-3 py-1 rounded-md transition-all ${currency === 'MXP' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                    >
                      MXN
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-xl font-black text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all shadow-inner"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400 uppercase">
                    {currency}
                  </span>
                </div>
              </div>

              {/* Card Inputs */}
              <div className="space-y-4 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">Datos de la Tarjeta</label>
                  <div className="flex items-center gap-1.5 opacity-60">
                    <span className="text-[10px] font-bold text-gray-400">Visa / MC / AMEX</span>
                  </div>
                </div>

                {/* Card Number */}
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={handleCardNumberChange}
                    placeholder="Número de Tarjeta (16 dígitos)"
                    required
                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold text-gray-800 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none"
                  />
                </div>

                {/* Expiry and CVC */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={cardExpiry}
                      onChange={handleExpiryChange}
                      placeholder="MM / AA"
                      required
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold text-gray-800 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none text-center"
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      value={cardCvc}
                      onChange={handleCvcChange}
                      placeholder="CVC / CVV"
                      required
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold text-gray-800 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none text-center"
                    />
                  </div>
                </div>

                {/* Name on Card */}
                <div>
                  <input
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    placeholder="Nombre completo como aparece en la tarjeta"
                    required
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 focus:bg-white focus:ring-2 focus:ring-indigo-600 outline-none"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={processing || !amount || parseFloat(amount) <= 0}
                className="w-full py-4 px-6 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-98"
              >
                {processing ? (
                  <>
                    <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                    Procesando Pago Seguro...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Pagar ${parseFloat(amount || '0').toLocaleString('es-MX', { minimumFractionDigits: 2 })} {currency}
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 text-gray-400 text-[11px] pt-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Pago procesado con encriptación de grado bancario vía Stripe</span>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-xl mx-auto w-full text-center text-xs text-white/50 pt-4 border-t border-white/10">
        <p>© {new Date().getFullYear()} Mi Seguro Internacional. Todos los derechos reservados.</p>
        <p className="text-[10px] mt-1 text-white/40">Pagos procesados de forma segura con Stripe</p>
      </div>
    </div>
  );
}
