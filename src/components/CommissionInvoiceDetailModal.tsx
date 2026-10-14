import React, { useState } from 'react';
import { doc, updateDoc, writeBatch, serverTimestamp, getDocs, query, collection, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from '../firebase';
import { CommissionInvoice, UserProfile } from '../types';
import { generateCommissionInvoicePDF, formatUSD, formatMXP } from '../utils/commissionInvoiceUtils';
import { 
  X, 
  Download, 
  Upload, 
  CheckCircle2, 
  Clock, 
  CreditCard, 
  FileText, 
  ExternalLink, 
  AlertCircle, 
  FileCheck, 
  XCircle, 
  ArrowUpRight,
  Loader2,
  DollarSign
} from 'lucide-react';

interface CommissionInvoiceDetailModalProps {
  invoice: CommissionInvoice;
  currentUserProfile: UserProfile | null;
  companySettings?: any;
  isAdminUser: boolean;
  onClose: () => void;
  onInvoiceUpdated: (updatedInvoice: CommissionInvoice) => void;
}

export default function CommissionInvoiceDetailModal({
  invoice,
  currentUserProfile,
  companySettings,
  isAdminUser,
  onClose,
  onInvoiceUpdated
}: CommissionInvoiceDetailModalProps) {
  // Estados para acciones administrativas
  const [showPayModal, setShowPayModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Formulario de liquidación / pago (Admin)
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMethod, setPayMethod] = useState(invoice.paymentMethod || 'Transferencia');
  const [payReference, setPayReference] = useState('');
  const [payReceiptFile, setPayReceiptFile] = useState<File | null>(null);
  const [payNotes, setPayNotes] = useState('');
  const [isProcessingPay, setIsProcessingPay] = useState(false);

  // Formulario para adjuntar factura fiscal tardía (Agente o Admin)
  const [attachPdfFile, setAttachPdfFile] = useState<File | null>(null);
  const [attachXmlFile, setAttachXmlFile] = useState<File | null>(null);
  const [attachFolio, setAttachFolio] = useState(invoice.agentInvoiceFolio || '');
  const [isUploadingFiscal, setIsUploadingFiscal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isOwnerAgent = currentUserProfile?.uid === invoice.agentId || 
    currentUserProfile?.email?.toLowerCase() === invoice.agentEmail?.toLowerCase();

  // 1. Descargar el PDF oficial emitido por la plataforma
  const handleDownloadPlatformPDF = () => {
    generateCommissionInvoicePDF(invoice, companySettings);
  };

  // 2. Adjuntar factura fiscal posterior si no se subió al inicio
  const handleAttachFiscalInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attachPdfFile && !attachXmlFile && !attachFolio) {
      setErrorMsg('Selecciona al menos un archivo o indica el folio de tu factura.');
      return;
    }

    setIsUploadingFiscal(true);
    setErrorMsg('');
    try {
      let pdfUrl = invoice.agentInvoicePdfUrl || '';
      let xmlUrl = invoice.agentInvoiceXmlUrl || '';

      if (attachPdfFile) {
        const pRef = ref(storage, `agent_invoices/${Date.now()}_${attachPdfFile.name}`);
        const snap = await uploadBytes(pRef, attachPdfFile);
        pdfUrl = await getDownloadURL(snap.ref);
      }

      if (attachXmlFile) {
        const xRef = ref(storage, `agent_invoices/${Date.now()}_${attachXmlFile.name}`);
        const snap = await uploadBytes(xRef, attachXmlFile);
        xmlUrl = await getDownloadURL(snap.ref);
      }

      const invoiceRef = doc(db, 'commissionInvoices', invoice.id!);
      const updateData: any = {
        agentInvoicePdfUrl: pdfUrl,
        agentInvoiceXmlUrl: xmlUrl,
        agentInvoiceFolio: attachFolio.trim() || invoice.agentInvoiceFolio || ''
      };

      await updateDoc(invoiceRef, updateData);

      const updated = { ...invoice, ...updateData };
      onInvoiceUpdated(updated);
      setAttachPdfFile(null);
      setAttachXmlFile(null);
      alert('Factura fiscal adjuntada exitosamente.');
    } catch (err: any) {
      console.error('Error al adjuntar factura fiscal:', err);
      setErrorMsg(err.message || 'Error al adjuntar archivos.');
    } finally {
      setIsUploadingFiscal(false);
    }
  };

  // 3. Aprobar solicitud (Admin)
  const handleApprove = async () => {
    if (!invoice.id) return;
    setSaving(true);
    try {
      const invoiceRef = doc(db, 'commissionInvoices', invoice.id);
      await updateDoc(invoiceRef, {
        status: 'approved',
        adminNotes: 'Aprobado para pago por administración'
      });
      onInvoiceUpdated({ ...invoice, status: 'approved' });
    } catch (err: any) {
      console.error('Error al aprobar invoice:', err);
      alert('Error al aprobar el invoice: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // 4. Rechazar solicitud (Admin)
  const handleReject = async () => {
    if (!invoice.id) return;
    if (!rejectReason.trim()) {
      alert('Por favor indica un motivo para el rechazo.');
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const invoiceRef = doc(db, 'commissionInvoices', invoice.id);
      batch.update(invoiceRef, {
        status: 'rejected',
        adminNotes: rejectReason.trim()
      });

      // Revertir el estado de las pólizas a 'confirmed' para que el agente pueda corregir
      for (const polId of invoice.policyIds) {
        const polRef = doc(db, 'insurances', polId);
        batch.update(polRef, {
          commissionStatus: 'confirmed',
          commissionInvoiceId: ''
        });
      }

      await batch.commit();
      onInvoiceUpdated({ ...invoice, status: 'rejected', adminNotes: rejectReason });
      setShowRejectModal(false);
    } catch (err: any) {
      console.error('Error al rechazar invoice:', err);
      alert('Error al procesar el rechazo: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // 5. Registrar Pago y Liquidar (Admin)
  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice.id) return;
    setIsProcessingPay(true);
    setErrorMsg('');

    try {
      let receiptUrl = '';
      if (payReceiptFile) {
        const rRef = ref(storage, `commission_receipts/${Date.now()}_${payReceiptFile.name}`);
        const snap = await uploadBytes(rRef, payReceiptFile);
        receiptUrl = await getDownloadURL(snap.ref);
      }

      const todayDate = new Date();
      const amountUSD = invoice.totalCommissionUSD;
      const rate = invoice.exchangeRate || 1;
      const isMXP = invoice.currency === 'MXP';
      const amountMXP = invoice.totalCommissionMXP || (amountUSD * rate);

      const batch = writeBatch(db);

      // Actualizar invoice de comisiones
      const invoiceRef = doc(db, 'commissionInvoices', invoice.id);
      const updateData: any = {
        status: 'paid',
        paidAt: serverTimestamp(),
        paymentDate: payDate,
        paymentMethod: payMethod,
        paymentReference: payReference.trim() || undefined,
        paymentReceiptUrl: receiptUrl || undefined,
        adminNotes: payNotes.trim() || invoice.adminNotes || undefined
      };
      batch.update(invoiceRef, updateData);

      // Actualizar pólizas vinculadas
      for (const polId of invoice.policyIds) {
        const polRef = doc(db, 'insurances', polId);
        batch.update(polRef, {
          commissionStatus: 'paid',
          commissionPaymentDate: payDate,
          commissionPaymentMethod: payMethod,
          commissionPaymentReceipt: receiptUrl || '',
          commissionPaymentCurrency: invoice.currency,
          commissionPaymentExchangeRate: rate,
          commissionPaymentAmount: isMXP ? amountMXP : amountUSD
        });

        // Registrar / actualizar entrada en payments para contabilidad general
        const paymentData: any = {
          insuranceId: polId,
          type: 'agent_commission',
          status: 'completed',
          date: todayDate,
          amount: amountUSD,
          currency: invoice.currency,
          paymentMethod: payMethod,
          receiptUrl: receiptUrl || '',
          exchangeRate: rate,
          invoiceNumber: invoice.folio,
          notes: `Liquidación de comisión mediante ${invoice.folio}. Agente: ${invoice.agentName}`,
          createdBy: auth.currentUser?.email || currentUserProfile?.email || 'Sistema'
        };
        if (isMXP) {
          paymentData.amountMXP = amountMXP;
        }

        const newPayRef = doc(collection(db, 'payments'));
        batch.set(newPayRef, {
          ...paymentData,
          createdAt: serverTimestamp()
        });
      }

      await batch.commit();

      const updated = {
        ...invoice,
        ...updateData,
        status: 'paid' as const
      };
      onInvoiceUpdated(updated);
      setShowPayModal(false);
      alert('Comisiones liquidadas y marcadas como pagadas con éxito.');
    } catch (err: any) {
      console.error('Error al registrar pago de comisiones:', err);
      setErrorMsg(err.message || 'Error al registrar pago.');
    } finally {
      setIsProcessingPay(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">
        
        {/* Cabecera */}
        <div className="px-6 py-5 bg-[#1A2138] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/30">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-black tracking-wide">{invoice.folio}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  invoice.status === 'paid' ? 'bg-emerald-500 text-white' :
                  invoice.status === 'approved' ? 'bg-blue-500 text-white' :
                  invoice.status === 'rejected' ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                }`}>
                  {invoice.status === 'paid' ? 'Pagado' :
                   invoice.status === 'approved' ? 'Aprobado para Pago' :
                   invoice.status === 'rejected' ? 'Rechazado' : 'Solicitado / Pendiente'}
                </span>
              </div>
              <p className="text-xs text-gray-300 font-medium">
                Agente: <span className="font-bold text-white">{invoice.agentName}</span> ({invoice.agentEmail})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido con Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-xs font-bold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Tarjetas KPI */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Total Comisiones USD</span>
              <p className="text-xl font-black text-gray-900 mt-1">{formatUSD(invoice.totalCommissionUSD)}</p>
              <span className="text-[11px] text-gray-500">{invoice.policiesSummary?.length || 0} pólizas</span>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Tipo de Cambio</span>
              <p className="text-xl font-black text-gray-900 mt-1">${(invoice.exchangeRate || 1).toFixed(2)} MXN</p>
              <span className="text-[11px] text-gray-500">Por cada USD</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Total a Liquidar MXN</span>
              <p className="text-xl font-black text-emerald-950 mt-1">{formatMXP(invoice.totalCommissionMXP || (invoice.totalCommissionUSD * (invoice.exchangeRate || 1)))}</p>
              <span className="text-[11px] text-emerald-600 font-bold">Moneda: {invoice.currency || 'USD'}</span>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Liquidación Oficial</span>
                <p className="text-xs text-blue-900 font-bold mt-1">Formato Institucional PDF</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadPlatformPDF}
                className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-blue-300"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar PDF
              </button>
            </div>
          </div>

          {/* Datos Fiscales y Bancarios */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-2xl p-4 space-y-2 bg-gray-50/50">
              <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                Datos para Pago por Transferencia
              </h4>
              <div className="text-xs space-y-1 text-gray-700">
                <p><span className="text-gray-400 font-bold">Banco:</span> <span className="font-bold">{invoice.bankInfo?.bankName || 'No registrado'}</span></p>
                <p><span className="text-gray-400 font-bold">Cuenta:</span> <span className="font-bold">{invoice.bankInfo?.account || 'No registrada'}</span></p>
                <p><span className="text-gray-400 font-bold">CLABE:</span> <span className="font-bold font-mono text-indigo-600">{invoice.bankInfo?.clabe || 'No registrada'}</span></p>
                <p><span className="text-gray-400 font-bold">RFC:</span> <span className="font-bold font-mono">{invoice.agentTaxId || 'No registrado'}</span></p>
              </div>
            </div>

            {/* Factura Fiscal del Agente (Opción B) */}
            <div className="border border-gray-200 rounded-2xl p-4 space-y-2 bg-emerald-50/30">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-600" />
                  Factura Fiscal del Agente (CFDI)
                </h4>
                {invoice.agentInvoiceFolio && (
                  <span className="text-[11px] font-mono font-bold bg-white px-2 py-0.5 border border-emerald-300 rounded text-emerald-800">
                    Folio: {invoice.agentInvoiceFolio}
                  </span>
                )}
              </div>

              {invoice.agentInvoicePdfUrl || invoice.agentInvoiceXmlUrl ? (
                <div className="flex items-center gap-3 pt-2">
                  {invoice.agentInvoicePdfUrl && (
                    <a
                      href={invoice.agentInvoicePdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Ver Factura (PDF)
                    </a>
                  )}
                  {invoice.agentInvoiceXmlUrl && (
                    <a
                      href={invoice.agentInvoiceXmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar CFDI (XML)
                    </a>
                  )}
                </div>
              ) : (
                <div className="text-xs text-gray-500 pt-1">
                  <p>No se adjuntó factura fiscal externa (se liquida vía estado oficial).</p>
                  {(isOwnerAgent || isAdminUser) && invoice.status !== 'paid' && (
                    <form onSubmit={handleAttachFiscalInvoice} className="mt-3 space-y-2 p-3 bg-white border border-emerald-200 rounded-xl">
                      <span className="text-[11px] font-bold text-emerald-800 block">¿Deseas adjuntar tu factura fiscal ahora?</span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="text"
                          placeholder="Folio factura"
                          value={attachFolio}
                          onChange={(e) => setAttachFolio(e.target.value)}
                          className="px-2 py-1 text-xs border rounded-lg outline-none"
                        />
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => setAttachPdfFile(e.target.files?.[0] || null)}
                          className="text-[10px] text-gray-500"
                        />
                        <input
                          type="file"
                          accept=".xml"
                          onChange={(e) => setAttachXmlFile(e.target.files?.[0] || null)}
                          className="text-[10px] text-gray-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isUploadingFiscal}
                        className="px-3 py-1 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        {isUploadingFiscal ? 'Subiendo...' : 'Adjuntar Archivos'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {invoice.agentNotes && (
                <p className="text-[11px] text-gray-600 bg-white p-2 rounded-lg border border-gray-100 mt-2">
                  <span className="font-bold">Nota del agente:</span> {invoice.agentNotes}
                </p>
              )}
            </div>
          </div>

          {/* Información de Pago si ya fue pagado */}
          {invoice.status === 'paid' && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-bold text-emerald-900 block">Liquidación Pagada Exitosamente</span>
                  <span className="text-emerald-700">
                    Método: {invoice.paymentMethod || 'Transferencia'} • Fecha: {invoice.paidAt ? 'Completado' : 'Pagado'}
                    {invoice.paymentReference && ` • Ref: ${invoice.paymentReference}`}
                  </span>
                </div>
              </div>
              {invoice.paymentReceiptUrl && (
                <a
                  href={invoice.paymentReceiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver Comprobante Bancario
                </a>
              )}
            </div>
          )}

          {/* Tabla de Pólizas del Invoice */}
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-100/80 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
              <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider">
                Pólizas Incluidas en esta Liquidación ({invoice.policiesSummary?.length || 0})
              </h4>
              <span className="text-xs font-black text-indigo-700">
                Total: {formatUSD(invoice.totalCommissionUSD)}
              </span>
            </div>
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-3">Póliza / Folio</th>
                    <th className="p-3">Asegurado</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3 text-right">Prima USD</th>
                    <th className="p-3 text-right">Comisión USD</th>
                    <th className="p-3 text-right">Comisión MXN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(invoice.policiesSummary || []).map((p, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="p-3 font-mono font-bold text-gray-900">{p.policyNumber || p.id?.substring(0, 8)}</td>
                      <td className="p-3 font-semibold text-gray-800">{p.insuredName}</td>
                      <td className="p-3 text-gray-500">{p.startDate || '-'}</td>
                      <td className="p-3 text-right font-medium text-gray-700">{formatUSD(p.totalPrice || 0)}</td>
                      <td className="p-3 text-right font-black text-emerald-600">{formatUSD(p.commissionAmount || 0)}</td>
                      <td className="p-3 text-right font-bold text-gray-900">
                        {formatMXP((p.commissionAmount || 0) * (invoice.exchangeRate || 1))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal de Confirmar Pago / Liquidar (Admin) */}
        {showPayModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-gray-100 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                  Registrar Pago y Liquidar Comisiones
                </h3>
                <button type="button" onClick={() => setShowPayModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleConfirmPayment} className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Fecha de Pago</label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Método de Pago</label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 border rounded-xl"
                    >
                      <option value="Transferencia">Transferencia SPEI</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Efectivo">Efectivo</option>
                      <option value="Descuento comision">Descuento de comisión</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Referencia / Rastreo</label>
                    <input
                      type="text"
                      placeholder="Ej. SPEI 928374"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      className="w-full px-3 py-2 border rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">Comprobante Bancario (PDF / Imagen)</label>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(e) => setPayReceiptFile(e.target.files?.[0] || null)}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">Notas Administrativas</label>
                  <textarea
                    rows={2}
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Observaciones de la dispersión..."
                    className="w-full px-3 py-2 border rounded-xl resize-none"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t">
                  <button
                    type="button"
                    onClick={() => setShowPayModal(false)}
                    className="px-4 py-2 border rounded-xl font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessingPay}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black flex items-center gap-2"
                  >
                    {isProcessingPay ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Confirmar Pago
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Rechazar (Admin) */}
        {showRejectModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-gray-100 space-y-4">
              <h3 className="text-base font-black text-red-600 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Rechazar Solicitud de Invoice
              </h3>
              <p className="text-xs text-gray-600">
                Las pólizas regresarán a estado 'Por Pagar' para que el agente pueda generar una nueva solicitud con las correcciones necesarias.
              </p>
              <div>
                <label className="block font-bold text-gray-700 mb-1 text-xs">Motivo del Rechazo</label>
                <textarea
                  rows={3}
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Explica qué debe corregir el agente..."
                  className="w-full px-3 py-2 border rounded-xl text-xs resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="px-4 py-2 border rounded-xl font-bold text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={saving}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs"
                >
                  {saving ? 'Procesando...' : 'Confirmar Rechazo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer con Acciones */}
        <div className="p-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0 flex-wrap gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Cerrar
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadPlatformPDF}
              className="px-4 py-2.5 bg-[#1A2138] hover:bg-[#253052] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              Descargar Liquidación Oficial PDF
            </button>

            {/* Acciones de Administración */}
            {isAdminUser && invoice.status !== 'paid' && (
              <>
                {invoice.status === 'requested' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowRejectModal(true)}
                      className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all"
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={saving}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-200"
                    >
                      Aprobar Solicitud
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setShowPayModal(true)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 uppercase tracking-wider"
                >
                  <CreditCard className="w-4 h-4" />
                  Registrar Pago / Liquidar
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
