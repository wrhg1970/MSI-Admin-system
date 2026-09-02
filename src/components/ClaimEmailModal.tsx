import React, { useState, useEffect } from 'react';
import { Mail, XCircle, Send, Loader2, Paperclip, CheckCircle2, Download, FileText, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Claim, InsuranceRequest, Policy, UserProfile } from '../types';
import { getPolicyNumber, formatDisplayDate } from '../lib/policyUtils';
import { createZipFromClaimDocuments, downloadBlob } from '../lib/zipUtils';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';

interface ClaimEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  claim: Claim | null;
  insurance: InsuranceRequest | null;
  policy: Policy | null;
  companySettings?: any;
  profile?: UserProfile | null;
  onSuccess?: (updatedData?: Partial<Claim>) => void;
}

export default function ClaimEmailModal({
  isOpen,
  onClose,
  claim,
  insurance,
  policy,
  companySettings,
  profile,
  onSuccess
}: ClaimEmailModalProps) {
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [zipData, setZipData] = useState<{ base64Zip: string; blob: Blob; filename: string } | null>(null);
  const [generatingZip, setGeneratingZip] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logoUrl = companySettings?.logoUrl || 'https://misegurointernacional.com/wp-content/uploads/2023/05/msi-logo.png';

  useEffect(() => {
    if (isOpen && claim) {
      setError(null);
      setSent(false);

      // Default recipient to insured email or empty
      const defaultTo = insurance?.email || '';
      setToInput(defaultTo);
      setCcInput('');

      // Reference & Details
      const refText = claim.reference?.trim() || 'Claim Checked luggage delay';
      const insuredName = insurance ? `${insurance.firstName} ${insurance.lastName}` : 'N/A';
      const birthDate = insurance ? formatDisplayDate(insurance.birthDate) : 'N/A';
      const policyCode = getPolicyNumber(policy, insurance?.age) || insurance?.policyNumber || insurance?.policyId || 'N/A';
      const effectiveDates = insurance ? `${formatDisplayDate(insurance.startDate)} al ${formatDisplayDate(insurance.endDate)}` : 'N/A';
      const todayDate = formatDisplayDate(new Date());
      const expensesAmount = claim.claimAmount !== undefined && claim.claimAmount !== null 
        ? `$ ${Number(claim.claimAmount).toFixed(2)} Dlls`
        : '$ 0.00 Dlls';

      setSubject(`Claim Documents - ${insuredName} - Policy ${policyCode}`);

      // Template requested by user
      const defaultBody = `[Logo Principal]

${todayDate}

Claims Manager
CISI
Dear Department Claim.
Ref: ${refText}

I’m sending you the documents of the claim Insurer ${insuredName}, DOB ${birthDate} under the policy ${policyCode} , effective dates ${effectiveDates} 

Attached you'll find the statement account and Documents.

The Total Amount is Expenses ${expensesAmount} and the policy covers $ 500.00 Dlls.

PLEASE SEND THE WIRE TRANSFER TO

NAME – International Career Start USA LLC
US$ ACCOUNT –1978045225
BANK – Wells Fargo Bank NA
ADDREESS – 420 Montgomery, San Francisco CA, 94104
BRANCH ‐ 01280 South McAllen
ABA No. 121000248
SWIFT. – WFBIUS6S
BENEFICIARY ADDRESS.‐ 701N International Blvd. 123 PMB 5735
Hidalgo TX 78557

Thank you
Sincerely,
Maria Teresa Niño
SETMEX
Mi Seguro Internacional / ICS`;

      setBody(defaultBody);

      // Prepare ZIP file of documents
      setGeneratingZip(true);
      const cleanRef = (claim.reference || claim.id || 'documentos').replace(/[^a-zA-Z0-9_-]/g, '_');
      const zipFileName = `Expediente_Siniestro_${cleanRef}.zip`;

      createZipFromClaimDocuments(claim.documents || [])
        .then(({ base64Zip, blob }) => {
          setZipData({ base64Zip, blob, filename: zipFileName });
        })
        .catch(err => {
          console.error("Error generating ZIP for claim:", err);
          setError("No se pudo generar el archivo ZIP de los documentos adjuntos.");
        })
        .finally(() => {
          setGeneratingZip(false);
        });
    }
  }, [isOpen, claim, insurance, policy]);

  if (!isOpen || !claim) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipData) {
      setError("El archivo ZIP de los documentos aún se está preparando.");
      return;
    }

    const toArray = toInput.split(',').map(e => e.trim()).filter(e => e.length > 0 && e.includes('@'));
    if (toArray.length === 0) {
      setError("Por favor ingrese al menos un correo de destinatario válido.");
      return;
    }

    const ccArray = ccInput.split(',').map(e => e.trim()).filter(e => e.length > 0 && e.includes('@'));

    setSending(true);
    setError(null);

    // Build HTML body replacing [Logo Principal] with <img src="..." />
    const bodyTextClean = body.replace(/\[Logo Principal\]/gi, '').trim();
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 650px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        ${logoUrl ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${logoUrl}" alt="Mi Seguro Internacional" style="max-height: 65px; width: auto;" /></div>` : ''}
        <div style="font-size: 14px; line-height: 1.7; white-space: pre-line; color: #334155;">
          ${bodyTextClean}
        </div>
        <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center;">
          <p style="margin: 0;"><strong>Mi Seguro Internacional / ICS / SETMEX</strong></p>
          <p style="margin: 2px 0;">Este correo incluye en archivo adjunto ZIP la documentación completa del siniestro.</p>
        </div>
      </div>
    `;

    try {
      const response = await fetch('/api/send-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toArray,
          cc: ccArray,
          subject: subject || `Claim Documents - Ref: ${claim.reference || 'Claim'}`,
          body: bodyTextClean,
          html: htmlContent,
          attachments: [
            {
              filename: zipData.filename,
              data: zipData.base64Zip
            }
          ]
        })
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || "Error al enviar el correo con el archivo ZIP.");
      }

      // Update claim fields: automatic sentToInsurerDate, sentToInsurer, and status Abierto (isClosed = false)
      const todayIso = format(new Date(), 'yyyy-MM-dd');
      const nowFormatted = format(new Date(), 'yyyy-MM-dd HH:mm');
      const updatedFields: Partial<Claim> = {
        sentToInsurerDate: todayIso,
        sentToInsurer: true,
        sentToInsurerDateChecked: nowFormatted,
        isClosed: false,
      };

      if (claim.id) {
        await updateDoc(doc(db, 'claims', claim.id), {
          ...updatedFields,
          updatedAt: serverTimestamp()
        }).catch(console.error);

        // Log activity
        await addDoc(collection(db, 'claimActivities'), {
          claimId: claim.id,
          type: 'email',
          description: `Expediente enviado por correo con archivo ZIP (${zipData.filename}) a: ${toArray.join(', ')}${ccArray.length > 0 ? ` (CC: ${ccArray.join(', ')})` : ''}`,
          date: serverTimestamp(),
          userName: profile?.displayName || auth.currentUser?.email || 'Usuario',
          userRole: profile?.role || 'admin',
        }).catch(console.error);
      }

      setSent(true);
      if (onSuccess) onSuccess(updatedFields);
      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (err: any) {
      console.error("Error sending claim email:", err);
      setError(err.message || "Error al enviar el correo. Verifique la conexión o configuración SMTP.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-gray-100">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-rose-600 via-rose-700 to-indigo-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-2xl backdrop-blur-md">
              <Mail className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-wide">Enviar Correo de Expediente Siniestro</h2>
              <p className="text-xs text-rose-100/80 font-medium">Adjunta todos los documentos en un solo archivo ZIP</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {sent ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">¡Correo Enviado Exitosamente!</h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                El expediente con el archivo ZIP adjunto ha sido enviado correctamente a los destinatarios especificados.
              </p>
            </div>
          ) : (
            <form id="claimEmailForm" onSubmit={handleSend} className="space-y-4">
              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-700 text-xs font-semibold">
                  <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              {/* Recipients */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                    Para (Destinatario *):
                  </label>
                  <input 
                    type="text"
                    required
                    value={toInput}
                    onChange={(e) => setToInput(e.target.value)}
                    placeholder="ejemplo@aseguradora.com, departamento@claim.com"
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                  />
                  <p className="text-[9px] text-gray-400 mt-1">Puedes separar múltiples correos con coma</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                    Copia a otros (CC):
                  </label>
                  <input 
                    type="text"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    placeholder="copia1@empresa.com, copia2@empresa.com"
                    className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                  />
                  <p className="text-[9px] text-gray-400 mt-1">Opcional. Separa correos con coma</p>
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                  Asunto del Correo:
                </label>
                <input 
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                />
              </div>

              {/* ZIP Attachment Banner */}
              <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-sm">
                    <Paperclip className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-2">
                      <span>Archivo Adjunto Único (ZIP)</span>
                      {generatingZip && <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin" />}
                    </h4>
                    <p className="text-[11px] text-indigo-700 font-medium mt-0.5">
                      {zipData ? `${zipData.filename} (${(zipData.blob.size / 1024).toFixed(1)} KB - ${claim.documents?.length || 0} archivos)` : 'Comprimiendo expediente...'}
                    </p>
                  </div>
                </div>

                {zipData && (
                  <button
                    type="button"
                    onClick={() => downloadBlob(zipData.blob, zipData.filename)}
                    className="px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                    title="Descargar copia del ZIP"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar ZIP</span>
                  </button>
                )}
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    Cuerpo del Correo (Plantilla Oficial):
                  </label>
                  <span className="text-[10px] text-rose-600 font-semibold">Incluye el Logo Principal al enviarse</span>
                </div>
                <textarea 
                  rows={14}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500 outline-none font-mono text-xs text-gray-800 leading-relaxed"
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        {!sent && (
          <div className="p-5 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-bold text-xs rounded-xl hover:bg-gray-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="claimEmailForm"
              disabled={sending || generatingZip}
              className="px-6 py-2.5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Enviando Correo con ZIP...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar Correo</span>
                </>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
