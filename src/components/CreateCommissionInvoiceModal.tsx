import React, { useState } from 'react';
import { collection, addDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { InsuranceRequest, UserProfile, CommissionInvoice } from '../types';
import { generateCommissionInvoicePDF, formatUSD, formatMXP } from '../utils/commissionInvoiceUtils';
import { 
  X, 
  FileText, 
  Download, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Building2, 
  CreditCard, 
  DollarSign, 
  ShieldCheck,
  FileCheck,
  Loader2
} from 'lucide-react';

interface CreateCommissionInvoiceModalProps {
  selectedCommissions: InsuranceRequest[];
  currentUserProfile: UserProfile | null;
  exchangeRate: number;
  companySettings?: any;
  onClose: () => void;
  onSuccess: (newInvoice: CommissionInvoice) => void;
}

export default function CreateCommissionInvoiceModal({
  selectedCommissions,
  currentUserProfile,
  exchangeRate,
  companySettings,
  onClose,
  onSuccess
}: CreateCommissionInvoiceModalProps) {
  // Datos del agente (precargados de su perfil)
  const [agentName, setAgentName] = useState(
    currentUserProfile?.displayName || 
    ((selectedCommissions[0] as any)?.agente as string) || 
    currentUserProfile?.email || ''
  );
  const [agentEmail, setAgentEmail] = useState(
    currentUserProfile?.email || 
    selectedCommissions[0]?.linkedAgentId || ''
  );
  const [agentTaxId, setAgentTaxId] = useState(currentUserProfile?.taxId || '');
  const [bankName, setBankName] = useState(currentUserProfile?.bankName || '');
  const [bankAccount, setBankAccount] = useState(currentUserProfile?.bankAccount || '');
  const [clabe, setClabe] = useState(currentUserProfile?.clabe || '');

  // Moneda deseada para liquidación
  const [currency, setCurrency] = useState<'USD' | 'MXP'>('USD');
  const [appliedRate, setAppliedRate] = useState<number>(exchangeRate || 20);

  // Archivos de factura fiscal del agente (Opción B)
  const [agentInvoiceFolio, setAgentInvoiceFolio] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [xmlFile, setXmlFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Totales
  const totalUSD = selectedCommissions.reduce((sum, c) => sum + (c.agentCommission || 0), 0);
  const totalMXP = totalUSD * appliedRate;

  // Generar folio sugerido
  const today = new Date();
  const yearStr = today.getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const defaultFolio = `INV-COM-${yearStr}-${randomSuffix}`;

  // Vista previa / descarga del PDF oficial de la plataforma (Opción A)
  const handlePreviewPlatformPDF = () => {
    const tempInvoice: CommissionInvoice = {
      folio: defaultFolio,
      agentId: currentUserProfile?.uid || selectedCommissions[0]?.agentId || 'agente',
      agentName: agentName.trim() || 'Agente de Seguros',
      agentEmail: agentEmail.trim() || 'agente@correo.com',
      agentTaxId: agentTaxId.trim() || undefined,
      bankInfo: {
        bankName: bankName.trim() || undefined,
        account: bankAccount.trim() || undefined,
        clabe: clabe.trim() || undefined
      },
      policyIds: selectedCommissions.map(c => c.id!),
      policiesSummary: selectedCommissions.map(c => ({
        id: c.id!,
        policyNumber: c.policyNumber || c.id?.substring(0, 8),
        insuredName: `${c.firstName} ${c.lastName}`.trim(),
        startDate: c.startDate || c.requestDate || '',
        totalPrice: c.totalFinal ?? c.totalPrice ?? 0,
        commissionAmount: c.agentCommission || 0,
        currency: 'USD'
      })),
      currency: currency,
      exchangeRate: appliedRate,
      totalCommissionUSD: totalUSD,
      totalCommissionMXP: totalMXP,
      status: 'requested',
      createdAt: new Date(),
      agentInvoiceFolio: agentInvoiceFolio.trim() || undefined,
      agentNotes: agentNotes.trim() || undefined
    };

    generateCommissionInvoicePDF(tempInvoice, companySettings);
  };

  // Guardar solicitud de invoice
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCommissions.length === 0) {
      setErrorMsg('No hay comisiones seleccionadas.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      let agentPdfUrl = '';
      let agentXmlUrl = '';

      // 1. Subir factura PDF del agente si la seleccionó
      if (pdfFile) {
        setUploading(true);
        const pdfRef = ref(storage, `agent_invoices/${Date.now()}_${pdfFile.name}`);
        const snap = await uploadBytes(pdfRef, pdfFile);
        agentPdfUrl = await getDownloadURL(snap.ref);
      }

      // 2. Subir CFDI XML si lo seleccionó
      if (xmlFile) {
        setUploading(true);
        const xmlRef = ref(storage, `agent_invoices/${Date.now()}_${xmlFile.name}`);
        const snap = await uploadBytes(xmlRef, xmlFile);
        agentXmlUrl = await getDownloadURL(snap.ref);
      }

      setUploading(false);

      // 3. Crear documento en la colección `commissionInvoices`
      const invoiceData: Omit<CommissionInvoice, 'id'> = {
        folio: defaultFolio,
        agentId: currentUserProfile?.uid || selectedCommissions[0]?.agentId || 'agente',
        agentName: agentName.trim(),
        agentEmail: agentEmail.trim(),
        agentTaxId: agentTaxId.trim() || undefined,
        bankInfo: {
          bankName: bankName.trim() || undefined,
          account: bankAccount.trim() || undefined,
          clabe: clabe.trim() || undefined
        },
        policyIds: selectedCommissions.map(c => c.id!),
        policiesSummary: selectedCommissions.map(c => ({
          id: c.id!,
          policyNumber: c.policyNumber || c.id?.substring(0, 8),
          insuredName: `${c.firstName} ${c.lastName}`.trim(),
          startDate: c.startDate || c.requestDate || '',
          totalPrice: c.totalFinal ?? c.totalPrice ?? 0,
          commissionAmount: c.agentCommission || 0,
          currency: 'USD'
        })),
        currency,
        exchangeRate: appliedRate,
        totalCommissionUSD: totalUSD,
        totalCommissionMXP: totalMXP,
        status: 'requested',
        createdAt: serverTimestamp(),
        requestedAt: serverTimestamp(),
        agentInvoicePdfUrl: agentPdfUrl || undefined,
        agentInvoiceXmlUrl: agentXmlUrl || undefined,
        agentInvoiceFolio: agentInvoiceFolio.trim() || undefined,
        agentNotes: agentNotes.trim() || undefined
      };

      const docRef = await addDoc(collection(db, 'commissionInvoices'), invoiceData);
      const newInvoiceId = docRef.id;

      // 4. Actualizar en lote las pólizas seleccionadas: poner commissionStatus: 'invoiced'
      const batch = writeBatch(db);
      for (const c of selectedCommissions) {
        if (c.id) {
          const insRef = doc(db, 'insurances', c.id);
          batch.update(insRef, {
            commissionStatus: 'invoiced',
            commissionInvoiceId: newInvoiceId
          });
        }
      }
      await batch.commit();

      const createdInvoice: CommissionInvoice = {
        id: newInvoiceId,
        ...invoiceData,
        createdAt: new Date()
      };

      onSuccess(createdInvoice);
    } catch (err: any) {
      console.error('Error al generar commission invoice:', err);
      setErrorMsg(err.message || 'Error al procesar la solicitud de invoice.');
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">
        
        {/* Cabecera del Modal */}
        <div className="px-6 py-5 bg-[#1A2138] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Generar Invoice y Solicitar Cobro de Comisiones</h2>
              <p className="text-xs text-gray-300 font-medium">
                Folio Provisorio: <span className="font-bold text-emerald-400">{defaultFolio}</span> • {selectedCommissions.length} póliza(s) seleccionada(s)
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

        {/* Cuerpo del Modal con scroll */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-xs font-bold">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Tarjeta de Resumen Financiero */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Total Comisiones (USD)</span>
              <p className="text-2xl font-black text-blue-950 mt-1">{formatUSD(totalUSD)}</p>
              <span className="text-[11px] text-blue-600 font-medium">{selectedCommissions.length} comisiones</span>
            </div>

            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Tipo de Cambio</span>
                <span className="text-[10px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded font-bold">MXN / USD</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-lg font-black text-emerald-950">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={appliedRate}
                  onChange={(e) => setAppliedRate(Number(e.target.value) || 1)}
                  className="w-24 px-2 py-1 bg-white border border-emerald-300 rounded-lg text-sm font-black text-emerald-950 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">Ajustable según acuerdo</span>
            </div>

            <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4">
              <span className="text-[10px] font-black uppercase text-purple-700 tracking-wider">Equivalente en Pesos (MXN)</span>
              <p className="text-2xl font-black text-purple-950 mt-1">{formatMXP(totalMXP)}</p>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <label className="flex items-center gap-1 font-bold text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="currency"
                    checked={currency === 'USD'}
                    onChange={() => setCurrency('USD')}
                  />
                  Cobrar USD
                </label>
                <label className="flex items-center gap-1 font-bold text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="currency"
                    checked={currency === 'MXP'}
                    onChange={() => setCurrency('MXP')}
                  />
                  Cobrar MXN
                </label>
              </div>
            </div>
          </div>

          {/* Opciones requeridas: AMBAS DISPONIBLES */}
          <div className="p-4 bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200/80 rounded-2xl space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-black text-[#1A2138] uppercase tracking-wide flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Doble Modalidad de Facturación Soportada
                </h3>
                <p className="text-xs text-gray-600 font-medium mt-0.5">
                  Puedes <strong>descargar la liquidación oficial emitida por la plataforma</strong> y/o <strong>adjuntar tu propia factura fiscal (CFDI PDF y XML)</strong> para solicitar el pago.
                </p>
              </div>
              <button
                type="button"
                onClick={handlePreviewPlatformPDF}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#1A2138] hover:bg-[#253052] text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer shrink-0"
                title="Generar y descargar el PDF con membrete de la empresa"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                Descargar Liquidación Oficial (PDF)
              </button>
            </div>
          </div>

          {/* Sección 1: Datos Fiscales y Bancarios del Agente */}
          <div className="border border-gray-200 rounded-2xl p-5 space-y-4">
            <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-indigo-600" />
              1. Datos Fiscales y Cuenta para Dispersión
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Nombre o Razón Social</label>
                <input
                  type="text"
                  required
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  value={agentEmail}
                  onChange={(e) => setAgentEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">RFC / Identificación Fiscal</label>
                <input
                  type="text"
                  value={agentTaxId}
                  onChange={(e) => setAgentTaxId(e.target.value.toUpperCase())}
                  placeholder="XAXX010101000"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none uppercase"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Institución Bancaria</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Ej. BBVA, Santander, Banorte"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Número de Cuenta</label>
                <input
                  type="text"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  placeholder="10 dígitos"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">CLABE Interbancaria (18 dígitos)</label>
                <input
                  type="text"
                  value={clabe}
                  onChange={(e) => setClabe(e.target.value)}
                  placeholder="18 dígitos para transferencia"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
                />
              </div>
            </div>
          </div>

          {/* Sección 2: Subir Factura Fiscal / CFDI del Agente */}
          <div className="border border-gray-200 rounded-2xl p-5 space-y-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4 h-4 text-emerald-600" />
                2. Adjuntar tu Factura Fiscal / CFDI (Opcional si usas liquidación directa)
              </h4>
              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full">
                Soporta PDF y XML
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Folio de tu Factura</label>
                <input
                  type="text"
                  value={agentInvoiceFolio}
                  onChange={(e) => setAgentInvoiceFolio(e.target.value)}
                  placeholder="Ej. FAC-1049"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Factura Fiscal (PDF)</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
                {pdfFile && <span className="text-[10px] text-emerald-600 font-bold block mt-1">✓ {pdfFile.name}</span>}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">Archivo CFDI (XML)</label>
                <input
                  type="file"
                  accept=".xml"
                  onChange={(e) => setXmlFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
                {xmlFile && <span className="text-[10px] text-blue-600 font-bold block mt-1">✓ {xmlFile.name}</span>}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-600 mb-1">Notas o Instrucciones para Administración</label>
              <textarea
                rows={2}
                value={agentNotes}
                onChange={(e) => setAgentNotes(e.target.value)}
                placeholder="Instrucciones adicionales, observaciones sobre la factura o datos de cobro..."
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              />
            </div>
          </div>

          {/* Tabla Desglose Rápido de Pólizas */}
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-100/80 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
              <span className="text-xs font-black text-gray-700 uppercase tracking-wider">
                Desglose de Pólizas a Liquidar ({selectedCommissions.length})
              </span>
              <span className="text-xs font-black text-indigo-700">
                Total: {formatUSD(totalUSD)}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 text-xs">
              {selectedCommissions.map((c) => (
                <div key={c.id} className="p-3 flex items-center justify-between hover:bg-gray-50/80">
                  <div>
                    <span className="font-bold text-gray-900">{c.firstName} {c.lastName}</span>
                    <span className="text-gray-400 text-[11px] ml-2 font-mono">
                      {c.policyNumber || c.id?.substring(0, 8)}
                    </span>
                    <span className="block text-[10px] text-gray-500">
                      Fecha: {c.startDate || c.requestDate || 'N/A'} • Venta: {formatUSD(c.totalFinal ?? c.totalPrice ?? 0)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-emerald-600 text-sm">
                      {formatUSD(c.agentCommission || 0)}
                    </span>
                    <span className="block text-[10px] text-gray-400">
                      ≈ {formatMXP((c.agentCommission || 0) * appliedRate)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>

        {/* Footer de Acciones */}
        <div className="p-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2.5 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Cancelar
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreviewPlatformPDF}
              className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4 text-gray-600" />
              Descargar PDF
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || uploading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer uppercase tracking-wider"
            >
              {submitting || uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploading ? 'Subiendo archivos...' : 'Procesando...'}
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Enviar Solicitud de Cobro
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
