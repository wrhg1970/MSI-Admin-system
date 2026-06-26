import React, { useState, useEffect } from 'react';
import { Mail, XCircle, Send, Loader2, Paperclip, CheckCircle2 } from 'lucide-react';
import { InsuranceRequest, Policy, PolicyLetter } from '../types';
import { generatePDF } from '../lib/pdfGenerator';
import { format, parseISO, isValid } from 'date-fns';

const LANGUAGE_ORDER = ['es', 'en', 'policy', 'covid', 'fr', 'it', 'de'];

const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
  return [...letters].sort((a, b) => {
    let indexA = LANGUAGE_ORDER.indexOf(a.language);
    let indexB = LANGUAGE_ORDER.indexOf(b.language);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    return a.language.localeCompare(b.language);
  });
};

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurance: InsuranceRequest | null;
  policies: Policy[];
  policyLetters: PolicyLetter[];
  companySettings?: any;
}

export default function EmailModal({ isOpen, onClose, insurance, policies, policyLetters, companySettings }: EmailModalProps) {
  const [to, setTo] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLetters, setSelectedLetters] = useState<PolicyLetter[]>([]);

  useEffect(() => {
    const emails = ccInput
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0 && e.includes('@'));
    setCcEmails(emails);
  }, [ccInput]);

  useEffect(() => {
    if (insurance && isOpen) {
      setTo(insurance.email);
      setCcInput('');
      setCcEmails([]);
      
      const fullName = `${insurance.firstName} ${insurance.lastName}`;
      setSubject(`Póliza de Seguro - ${fullName}`);
      
      const policy = policies.find(p => p.id === insurance.policyId || (p.CodigoPoliza && p.CodigoPoliza === insurance.policyId) || p.name === insurance.policyId);
      const policyCode = policy?.CodigoPoliza || policy?.id || insurance.policyId || '';
      const policyName = policy?.name || policy?.NombrePoliza || insurance.policyName || '';
      const policyInfo = policyCode && policyName ? `${policyCode} - ${policyName}` : (policyCode || policyName || '');

      const formatToShow = (dateVal: any) => {
        if (!dateVal) return '';
        try {
          const parsed = parseISO(dateVal);
          if (isValid(parsed)) return format(parsed, 'dd/MM/yyyy');
          const d = new Date(dateVal);
          if (isValid(d)) return format(d, 'dd/MM/yyyy');
        } catch (e) {}
        return String(dateVal);
      };

      const defaultTemplate = `Hola {nombre}

Te comunicamos que tu Seguro Internacional para tu viaje ya ha sido registrado.

Los datos registrados son :

Nombre: {nombre}
Fecha de Nacimiento:  {fecha_nacimiento}
Poliza: {poliza_info}
Origen: {Pais Origen}
Destino:  {Pais Destino}
Del : {Fecha_inicio} al {Fecha_Final}

Muchas gracias por elegir a Setmex y MSI como la empresa que te dará la protección internacional durante tu experiencia en el extranjero. 

Estamos convencidos, que será la mejor experiencia de tu vida y que pondrás el nombre de México en alto durante tu viaje.

Mi Seguro Internacional estará todo el tiempo contigo para si surge  cualquier evento médico o de enfermedad no tengas ningún problema. 

Cuenta con nosotros para que te podamos orientar y ayudar en cualquier momento.

Aquí te compartimos teléfonos de emergencia  y correo electrónico.

PROVIDER: ROBIN ASSIST
Calling toll-free from within the US
Phone: (888) 505 2474

Calling from outside the US, collect calls accepted
Phone: +1 (743) 244 2474

Email: cisiassist@robinassist.com

Te anexamos tu póliza en pdf la cual podrás tenerla en tu correo electrónico e imprimir. Estas cartas que enviamos sirven para que las puedas presentar en la embajada o directamente en tu universidad como comprobante de tu seguro. Si requieres algún otro documento con todo gusto lo podemos ver. Así mismo te recuerdo que puedes consultar las condiciones de la póliza general (la cual se anexa también) y en la página de internet puedes consultar mas teléfonos e información que se te pueda solicitar, así que lo puedes ver en: www.misegurointernacional.com o nos puedes enviar un correo electrónico a info@misegurointernacional.com Te deseamos la mejor de las suertes en tu viaje.

Buen viaje y gracias por tu confianza.

El equipo Mi Seguro Internacional /SETMEX S.A. de C.V.`;

      const parsedBody = defaultTemplate
        .replace(/{nombre}/g, fullName)
        .replace(/{Nombre}/g, fullName)
        .replace(/{fecha_nacimiento}/g, formatToShow(insurance.birthDate))
        .replace(/{Fecha_nacimiento}/g, formatToShow(insurance.birthDate))
        .replace(/{poliza_info}/g, policyInfo)
        .replace(/{poliza}/g, policyInfo)
        .replace(/{Poliza}/g, policyInfo)
        .replace(/{Pais Origen}/g, insurance.originCountry || 'México')
        .replace(/{origen}/g, insurance.originCountry || 'México')
        .replace(/{Pais Destino}/g, insurance.destinationCountry || '')
        .replace(/{destino}/g, insurance.destinationCountry || '')
        .replace(/{Fecha_inicio}/g, formatToShow(insurance.startDate))
        .replace(/{fecha_inicio}/g, formatToShow(insurance.startDate))
        .replace(/{Fecha_Final}/g, formatToShow(insurance.endDate))
        .replace(/{fecha_final}/g, formatToShow(insurance.endDate));

      setBody(parsedBody);
      
      // Auto-select relevant letters
      const relevant = sortLettersByLanguage(
        policyLetters.filter(l => l.policyId === (policy?.id || insurance.policyId))
      );
      if (relevant.length > 0) {
        setSelectedLetters([relevant[0]]); // Select first one by default
      }
    }
  }, [insurance, isOpen, policies, policyLetters]);

  const handleSend = async () => {
    if (!insurance) return;
    setSending(true);
    setError(null);

    try {
      const pdfs: { filename: string, data: string }[] = [];
      
      if (selectedLetters.length === 0) {
        // Fallback to default PDF
        const doc: any = await generatePDF(insurance, undefined, policies, companySettings?.logoUrl, true);
        const base64 = doc.output('datauristring').split(',')[1];
        pdfs.push({
          filename: `Certificado_Seguro_${insurance.lastName}.pdf`,
          data: base64
        });
      } else {
        for (const letter of selectedLetters) {
          const doc: any = await generatePDF(insurance, letter, policies, companySettings?.logoUrl, true);
          const base64 = doc.output('datauristring').split(',')[1];
          pdfs.push({
            filename: `Certificado_${insurance.lastName}_${letter.language}.pdf`,
            data: base64
          });
        }
      }

      const response = await fetch('/api/send-certificate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: [to],
          cc: ccEmails,
          subject,
          body,
          pdfs
        }),
      });

      let data: any = {};
      let errMessage = 'Error al enviar el correo';
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
          errMessage = data.error || errMessage;
          if (data.details) {
            errMessage += ` (Detalles: ${data.details})`;
          }
        } else {
          const text = await response.text();
          if (text && text.length < 250) {
            errMessage = text;
          }
        }
      } catch (e) {}

      if (!response.ok) {
        throw new Error(errMessage);
      }

      setSent(true);
      setTimeout(() => {
        onClose();
        setSent(false);
      }, 2000);
    } catch (err: any) {
      console.error('Error sending email:', err);
      setError(err.message || 'Error al enviar el correo');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen || !insurance) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Enviar Póliza por Correo</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {sent ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="p-4 bg-green-50 rounded-full">
                <CheckCircle2 className="w-16 h-16 text-green-500" />
              </div>
              <h4 className="text-xl font-bold text-gray-900">¡Correo Enviado!</h4>
              <p className="text-gray-500">La póliza ha sido enviada correctamente a {to}.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Para</label>
                    <input
                      type="email"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
                      placeholder="email@cliente.com"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Copia (CC)</label>
                    <input
                      type="text"
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
                      placeholder="ejemplo@correo.com, otro@correo.com"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Asunto</label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-semibold"
                      placeholder="Asunto del correo"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Cuerpo del Mensaje</label>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all h-64 resize-none"
                      placeholder="Escribe el mensaje aquí..."
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Adjuntos (Seleccionar Cartas)</label>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-2">
                      {policyLetters.filter(l => l.policyId === (policies.find(p => p.id === insurance.policyId)?.id || insurance.policyId)).length === 0 ? (
                        <div className="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center">
                          <p className="text-[10px] text-gray-400 italic">No hay cartas específicas. Se adjuntará el formato por defecto.</p>
                        </div>
                      ) : (
                        sortLettersByLanguage(
                          policyLetters.filter(l => l.policyId === (policies.find(p => p.id === insurance.policyId)?.id || insurance.policyId))
                        ).map(letter => (
                            <label key={letter.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-all">
                              <input
                                type="checkbox"
                                checked={selectedLetters.some(l => l.id === letter.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLetters([...selectedLetters, letter]);
                                  } else {
                                    setSelectedLetters(selectedLetters.filter(l => l.id !== letter.id));
                                  }
                                }}
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-900 truncate">{letter.title}</p>
                                <p className="text-[10px] text-gray-400 uppercase font-black tracking-wider text-blue-600">
                                  {letter.language === 'es' ? 'Español' : 
                                   letter.language === 'en' ? 'Inglés' : 
                                   letter.language === 'policy' ? 'Policy' : 
                                   letter.language === 'covid' ? 'Coronavirus' : 
                                   letter.language === 'fr' ? 'Francés' : 
                                   letter.language === 'it' ? 'Italiano' : 
                                   letter.language === 'de' ? 'Alemán' : 
                                   letter.language === 'es_spain' ? 'España' : 
                                   letter.language.toUpperCase()}
                                </p>
                              </div>
                              <Paperclip className="w-3.5 h-3.5 text-gray-300" />
                            </label>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                  <div className="bg-red-100 p-1.5 rounded-lg">
                    <XCircle className="w-4 h-4 text-red-600" />
                  </div>
                  <p className="text-xs text-red-600 font-medium">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
                  disabled={sending}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending || !to || !subject || !body}
                  className="flex-[2] py-3 text-sm font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Enviar Correo Ahora
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
