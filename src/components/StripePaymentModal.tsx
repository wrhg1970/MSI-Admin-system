import React, { useState, useEffect } from 'react';
import { 
  X, 
  CreditCard, 
  Send, 
  Mail, 
  Copy, 
  Check, 
  CheckCircle, 
  ExternalLink, 
  RefreshCw, 
  DollarSign, 
  User, 
  FileText, 
  Phone, 
  AlertCircle,
  MessageSquare,
  Sparkles
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { InsuranceRequest } from '../types';
import { logInsuranceActivity } from '../utils/activityLogger';

interface StripePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurance: InsuranceRequest | null;
  initialAmount?: number;
  initialCurrency?: 'USD' | 'MXP';
  defaultExchangeRate?: number;
  onLinkGenerated?: (url: string) => void;
}

export default function StripePaymentModal({
  isOpen,
  onClose,
  insurance,
  initialAmount,
  initialCurrency = 'USD',
  defaultExchangeRate = 20.00,
  onLinkGenerated
}: StripePaymentModalProps) {
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<'USD' | 'MXP'>('USD');
  const [exchangeRate, setExchangeRate] = useState<number>(20.00);
  const [description, setDescription] = useState<string>('');
  const [recipientEmail, setRecipientEmail] = useState<string>('');
  const [recipientPhone, setRecipientPhone] = useState<string>('');

  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [emailSending, setEmailSending] = useState<boolean>(false);
  const [emailSent, setEmailSent] = useState<boolean>(false);
  const [whatsAppShared, setWhatsAppShared] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Calculate pending balance
  const calculatePendingBalance = (ins: InsuranceRequest | null): number => {
    if (!ins) return 0;
    const isCancellation = ins.actionType === 'CAN';
    const multiplier = isCancellation ? -1 : 1;
    const basePrice = ins.totalPrice || 0;
    const discountVal = ins.discount || 0;
    const adjustmentVal = ins.adjustment || 0;
    const totalExpected = isCancellation
      ? (ins.totalPrice !== undefined && ins.totalPrice !== 0 ? ins.totalPrice : (ins.totalFinal || 0))
      : (basePrice - discountVal - adjustmentVal);
    const balance = (totalExpected * multiplier) - ((ins.totalPaid || 0) * multiplier);
    return balance > 0 ? balance : totalExpected;
  };

  useEffect(() => {
    if (isOpen && insurance) {
      const pending = initialAmount !== undefined ? initialAmount : calculatePendingBalance(insurance);
      const chosenCurrency = initialCurrency || 'USD';
      const rate = defaultExchangeRate || insurance.exchangeRate || 20.00;

      setCurrency(chosenCurrency);
      setExchangeRate(rate);

      if (chosenCurrency === 'MXP') {
        setAmount((pending * rate).toFixed(2));
      } else {
        setAmount(pending.toFixed(2));
      }

      const policyNum = insurance.policyNumber || insurance.IDseg || insurance.id?.substring(0, 6) || 'S/N';
      setDescription(`Abono Póliza #${policyNum} - ${insurance.firstName || ''} ${insurance.lastName || ''}`.trim());
      setRecipientEmail(insurance.email || '');
      setRecipientPhone(insurance.phone || '');

      // If insurance already has a valid stripe link stored, pre-populate it
      if (insurance.stripePaymentLink) {
        setPaymentUrl(insurance.stripePaymentLink);
      } else {
        setPaymentUrl(null);
      }

      setCopied(false);
      setEmailSent(false);
      setWhatsAppShared(false);
      setErrorMsg(null);
    }
  }, [isOpen, insurance, initialAmount, initialCurrency, defaultExchangeRate]);

  if (!isOpen || !insurance) return null;

  const handleCurrencyChange = (newCurr: 'USD' | 'MXP') => {
    if (newCurr === currency) return;
    const num = parseFloat(amount) || 0;
    if (newCurr === 'MXP') {
      setAmount((num * exchangeRate).toFixed(2));
    } else {
      setAmount((num / (exchangeRate || 1)).toFixed(2));
    }
    setCurrency(newCurr);
    setPaymentUrl(null);
    setEmailSent(false);
  };

  const handleCreatePaymentLink = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('Por favor introduce un monto válido mayor a 0.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setEmailSent(false);

    try {
      const response = await fetch('/api/stripe/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numAmount,
          currency: currency,
          description: description || `Pago de Póliza - ${insurance.firstName} ${insurance.lastName}`,
          clientEmail: recipientEmail || insurance.email || '',
          insuranceId: insurance.id,
          origin: window.location.origin
        })
      });

      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Error al generar la liga de pago con Stripe.');
      }

      setPaymentUrl(data.url);
      if (onLinkGenerated) {
        onLinkGenerated(data.url);
      }

      // Save generated link in Firestore insurance document
      if (insurance.id) {
        await updateDoc(doc(db, 'insurances', insurance.id), {
          stripePaymentLink: data.url
        });

        // Log in activity history
        try {
          await logInsuranceActivity({
            insuranceId: insurance.id,
            type: 'automatic',
            description: `Se generó liga de pago segura de Stripe por $${numAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}. Enlace: ${data.url}`,
            date: new Date(),
            createdBy: auth.currentUser?.email || 'Sistema'
          });
        } catch (logErr) {
          console.error('Error logging stripe activity:', logErr);
        }
      }
    } catch (err: any) {
      console.error('Error creating stripe payment link:', err);
      setErrorMsg(err.message || 'Error al generar la liga de pago.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!paymentUrl) return;
    navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSendEmail = async () => {
    if (!paymentUrl) return;
    const targetEmail = recipientEmail.trim();
    if (!targetEmail) {
      setErrorMsg('Por favor especifica un correo electrónico válido para enviar la liga.');
      return;
    }

    setEmailSending(true);
    setErrorMsg(null);

    try {
      const numAmount = parseFloat(amount) || 0;
      const response = await fetch('/api/stripe/send-payment-link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: targetEmail,
          clientName: `${insurance.firstName || ''} ${insurance.lastName || ''}`.trim() || 'Estimado Cliente',
          paymentUrl: paymentUrl,
          amount: numAmount,
          currency: currency,
          description: description || `Abono de Póliza #${insurance.policyNumber || insurance.id?.substring(0, 6)}`
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Fallo al enviar correo');
      }

      setEmailSent(true);

      // Log in activity history
      if (insurance.id) {
        try {
          await logInsuranceActivity({
            insuranceId: insurance.id,
            type: 'automatic',
            description: `Se envió liga de pago de Stripe por correo a "${targetEmail}" por un monto de $${numAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}.`,
            date: new Date(),
            createdBy: auth.currentUser?.email || 'Sistema'
          });
        } catch (lErr) {
          console.error('Error logging email activity:', lErr);
        }
      }
    } catch (err: any) {
      console.error('Error sending email:', err);
      setErrorMsg('Error al enviar correo: ' + err.message);
    } finally {
      setEmailSending(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!paymentUrl) return;
    const rawDigits = recipientPhone.replace(/[^0-9]/g, '');
    const cleanPhone = rawDigits.length === 10 ? `52${rawDigits}` : rawDigits;
    const numAmount = parseFloat(amount) || 0;
    const formattedAmount = `$${numAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    const policyIdStr = insurance.policyNumber || insurance.IDseg || insurance.id?.substring(0, 6) || 'de seguro';

    const messageText = 
`Hola ${insurance.firstName || 'estimado asegurado'},

Te compartimos la liga de pago seguro con tarjeta para cubrir tu póliza #${policyIdStr}:

*Monto a pagar:* ${formattedAmount}
*Liga de Pago Stripe:* 
${paymentUrl}

Tu pago se acreditará y conciliará de forma 100% automática e inmediata.
¡Quedamos a tus órdenes!`;

    const encodedText = encodeURIComponent(messageText);
    const waUrl = cleanPhone 
      ? `https://wa.me/${cleanPhone}?text=${encodedText}` 
      : `https://api.whatsapp.com/send?text=${encodedText}`;

    // Safely trigger link click without iframe popup blocker issues
    const linkEl = document.createElement('a');
    linkEl.href = waUrl;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    document.body.appendChild(linkEl);
    linkEl.click();
    document.body.removeChild(linkEl);

    setWhatsAppShared(true);
    setTimeout(() => setWhatsAppShared(false), 4000);

    // Log activity
    if (insurance.id) {
      try {
        logInsuranceActivity({
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Se compartió liga de pago de Stripe por WhatsApp al teléfono "${recipientPhone || 'contacto'}" por un valor de ${formattedAmount}.`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Sistema'
        });
      } catch (lErr) {
        console.error('Error logging WhatsApp activity:', lErr);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#1A2138] to-indigo-950 text-white flex justify-between items-center relative overflow-hidden">
          <div className="flex items-center gap-3 relative z-10">
            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md border border-white/15">
              <CreditCard className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base uppercase tracking-wider">Liga de Cobro Stripe</h3>
                <span className="px-2 py-0.5 bg-indigo-500/30 text-indigo-200 text-[10px] font-black rounded-full border border-indigo-400/30">
                  En Línea
                </span>
              </div>
              <p className="text-xs text-indigo-200/80 mt-0.5">Envía un enlace de pago seguro con tarjeta por Email o WhatsApp</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer relative z-10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Policy Information Summary Banner */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 font-medium">Asegurado:</span>
              <span className="font-bold text-gray-900">{insurance.firstName} {insurance.lastName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500 font-medium">Póliza / IDseg:</span>
              <span className="font-bold text-gray-800">{insurance.policyNumber || insurance.IDseg || insurance.id?.substring(0, 8)}</span>
            </div>
            {insurance.plan && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-medium">Plan:</span>
                <span className="font-semibold text-gray-700">{insurance.plan}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-slate-200 pt-2 mt-2">
              <span className="text-gray-600 font-bold uppercase text-[10px]">Saldo Pendiente Actual:</span>
              <span className="font-black text-indigo-700 text-sm">
                ${calculatePendingBalance(insurance).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </span>
            </div>
          </div>

          {/* Form to configure amount and description */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Moneda de Cobro</label>
                <div className="flex bg-gray-100 p-1 rounded-xl">
                  {(['USD', 'MXP'] as const).map((curr) => (
                    <button
                      key={curr}
                      type="button"
                      onClick={() => handleCurrencyChange(curr)}
                      className={`flex-1 py-2 text-xs font-black rounded-lg transition-all cursor-pointer ${
                        currency === curr ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {curr}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Monto a Cobrar ({currency})
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setPaymentUrl(null);
                      setEmailSent(false);
                    }}
                    placeholder="0.00"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-black text-gray-900"
                  />
                </div>
              </div>
            </div>

            {currency === 'MXP' && (
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
                <span className="font-medium">Tipo de Cambio:</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={exchangeRate}
                    onChange={(e) => {
                      const newRate = Number(e.target.value) || 1;
                      setExchangeRate(newRate);
                    }}
                    className="w-20 px-2 py-1 bg-white border border-amber-300 rounded-lg text-right font-bold text-xs"
                  />
                  <span className="font-bold text-[10px]">MXN / USD</span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Concepto en Stripe</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej. Abono de póliza"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-medium text-gray-800"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Action button to generate Stripe Link */}
          {!paymentUrl ? (
            <button
              type="button"
              onClick={handleCreatePaymentLink}
              disabled={loading || !amount || parseFloat(amount) <= 0}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-100 hover:shadow-indigo-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generando Checkout en Stripe...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generar Liga de Pago Stripe
                </>
              )}
            </button>
          ) : (
            /* Link Actions Card (When Generated) */
            <div className="space-y-4 pt-1 animate-in fade-in duration-300">
              <div className="bg-gradient-to-br from-indigo-50/70 via-blue-50/50 to-slate-50 p-4.5 rounded-2xl border border-indigo-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span className="text-[10px] font-black text-indigo-900 uppercase tracking-widest">Liga de Pago Activa</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentUrl(null);
                      setEmailSent(false);
                      setWhatsAppShared(false);
                    }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                  >
                    Generar con otro monto
                  </button>
                </div>

                <div className="flex items-center gap-2 bg-white px-3.5 py-2.5 rounded-xl border border-indigo-200 font-mono text-xs text-indigo-800 select-all overflow-hidden relative shadow-xs">
                  <span className="truncate flex-1 font-semibold">{paymentUrl}</span>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="p-1.5 hover:bg-indigo-50 rounded-lg text-gray-500 hover:text-indigo-600 transition-colors shrink-0 cursor-pointer"
                    title="Copiar liga"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-indigo-50 rounded-lg text-gray-500 hover:text-blue-600 transition-colors shrink-0"
                    title="Abrir en nueva pestaña"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                {copied && (
                  <p className="text-[11px] font-bold text-emerald-600 text-center animate-in fade-in">
                    ✓ ¡Liga copiada al portapapeles!
                  </p>
                )}
              </div>

              {/* Sending Channels (Email & WhatsApp) */}
              <div className="space-y-3 pt-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Canales de Envío Directo</p>

                {/* WhatsApp Channel */}
                <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-[#25D366]" />
                      Enviar por WhatsApp
                    </span>
                    {whatsAppShared && (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Mensaje Preparado
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        value={recipientPhone}
                        onChange={(e) => setRecipientPhone(e.target.value)}
                        placeholder="Ej. +52 81 8185 0121"
                        className="w-full pl-8 pr-3 py-2 bg-white border border-emerald-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-[#25D366] outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleShareWhatsApp}
                      className="px-4 py-2 bg-[#25D366] hover:bg-[#20ba56] text-white text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-600/20 hover:scale-[1.02] flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      WhatsApp
                    </button>
                  </div>
                </div>

                {/* Email Channel */}
                <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-indigo-600" />
                      Enviar por Correo Electrónico
                    </span>
                    {emailSent && (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        ¡Correo Enviado!
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="correo@ejemplo.com"
                        className="w-full pl-8 pr-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSendEmail}
                      disabled={emailSending || !recipientEmail}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-indigo-600/20 hover:scale-[1.02] flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {emailSending ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          Enviar Correo
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-6 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
