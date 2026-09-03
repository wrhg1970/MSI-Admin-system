import React, { useState, useEffect, useMemo } from 'react';
import { Mail, XCircle, Send, Loader2, CheckCircle2, Info, Users, Copy, Languages, Files, FileStack } from 'lucide-react';
import { InsuranceRequest, Policy, PolicyLetter } from '../types';
import { isSpainDestination } from '../lib/policyUtils';

interface BulkEmailConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInsurances: InsuranceRequest[];
  policies: Policy[];
  policyLetters: PolicyLetter[];
  companySettings?: any;
  onConfirm: (config: {
    selectedLanguages: string[];
    ccEmails: string[];
    subjectTemplate: string;
    bodyTemplate: string;
    fallbackToDefault: boolean;
    pdfMergeMode: 'separate' | 'merged';
  }) => void;
}

const AVAILABLE_LANGUAGES = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'Inglés' },
  { id: 'es_spain', label: 'España' },
  { id: 'embajada_spain', label: 'Embajada España' },
  { id: 'policy', label: 'Póliza Principal' },
  { id: 'covid', label: 'Coronavirus / Covid-19' },
  { id: 'fr', label: 'Francés' },
  { id: 'it', label: 'Italiano' },
  { id: 'de', label: 'Alemán' },
];

export default function BulkEmailConfigModal({
  isOpen,
  onClose,
  selectedInsurances,
  policies,
  policyLetters,
  companySettings,
  onConfirm
}: BulkEmailConfigModalProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['es']);
  const [ccInput, setCcInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);

  const hasSpainDestination = useMemo(() => {
    return selectedInsurances.some(ins => isSpainDestination(ins.destinationCountry));
  }, [selectedInsurances]);

  const availableLanguagesList = useMemo(() => {
    return AVAILABLE_LANGUAGES.filter(lang => {
      if (lang.id === 'es_spain' || lang.id === 'embajada_spain') {
        return hasSpainDestination;
      }
      return true;
    });
  }, [hasSpainDestination]);
  const [subjectTemplate, setSubjectTemplate] = useState('Póliza de Seguro - {nombre}');
  const [bodyTemplate, setBodyTemplate] = useState(
    `Hola {nombre}

Te comunicamos que tu Seguro Internacional para tu viaje ya ha sido registrado.

Los datos registrados son :

Nombre: {nombre}
Fecha de Nacimiento:  {fecha_nacimiento}
Poliza: Codigo de la Poliza  -  Nombre Póliza (Admin)
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

El equipo Mi Seguro Internacional /SETMEX S.A. de C.V.`
  );
  const [fallbackToDefault, setFallbackToDefault] = useState(true);
  const [pdfMergeMode, setPdfMergeMode] = useState<'separate' | 'merged'>('separate');
  const [ccError, setCcError] = useState<string | null>(null);

  useEffect(() => {
    // Attempt to parse CC emails whenever ccInput changes
    const emails = ccInput
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(e => !emailRegex.test(e));

    if (invalidEmails.length > 0) {
      setCcError(`Correos no válidos: ${invalidEmails.join(', ')}`);
    } else {
      setCcError(null);
    }
    setCcEmails(emails);
  }, [ccInput]);

  if (!isOpen) return null;

  const handleSendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ccError) return;
    
    onConfirm({
      selectedLanguages,
      ccEmails,
      subjectTemplate,
      bodyTemplate,
      fallbackToDefault,
      pdfMergeMode
    });
  };

  const handleToggleLanguage = (langId: string) => {
    if (selectedLanguages.includes(langId)) {
      setSelectedLanguages(selectedLanguages.filter(id => id !== langId));
    } else {
      setSelectedLanguages([...selectedLanguages, langId]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 rounded-xl">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 leading-tight">Configurar Envío de Correos Masivos</h3>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                Se enviará un correo personalizado a <strong>{selectedInsurances.length}</strong> pasajeros seleccionados.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSendSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Left Column: Email Template Configuration */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Diseño del Correo</h4>
              
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Asunto del Correo</label>
                <input
                  type="text"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                  className="w-full px-4 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                  placeholder="Ej. Póliza de Seguro - {nombre}"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Mensaje del Correo</label>
                <textarea
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  className="w-full px-4 py-3 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all h-60 resize-none font-medium leading-relaxed"
                  placeholder="Escribe el mensaje aquí..."
                  required
                />
              </div>

              {/* Helper tags badge */}
              <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100/50">
                <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" /> Variables Dinámicas Soportadas:
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{nombre}'}</span>
                    <span className="text-gray-500">Nombre del viajero</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{fecha_nacimiento}'}</span>
                    <span className="text-gray-500">Fecha de nacimiento</span>
                  </div>
                  <div className="flex flex-col col-span-2">
                    <span className="font-mono font-bold text-blue-600">{"Codigo de la Poliza  -  Nombre Póliza (Admin)"}</span>
                    <span className="text-gray-500">Información de la póliza asignada</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{Pais Origen}'}</span>
                    <span className="text-gray-500">País de Origen</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{Pais Destino}'}</span>
                    <span className="text-gray-500">País de Destino</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{Fecha_inicio}'}</span>
                    <span className="text-gray-500">Fecha de inicio de vigencia</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-blue-600">{'{Fecha_Final}'}</span>
                    <span className="text-gray-500">Fecha final de vigencia</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Letters & Copies Configuration */}
            <div className="space-y-6">
              
              {/* Selected Letters section */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Languages className="w-4 h-4 text-gray-500" />
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Cartas a Adjuntar</h4>
                </div>
                
                <p className="text-xs text-gray-500">
                  Selecciona qué formatos/idiomas de carta de seguro se adjuntarán por correo a cada viajero:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[180px] overflow-y-auto pr-1">
                  {availableLanguagesList.map(lang => {
                    const isChecked = selectedLanguages.includes(lang.id);
                    return (
                      <label
                        key={lang.id}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer text-xs font-bold ${
                          isChecked
                            ? 'bg-blue-50/55 border-blue-200 text-blue-900'
                            : 'bg-white border-gray-100 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleLanguage(lang.id)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span>{lang.label}</span>
                      </label>
                    );
                  })}
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50/40 border border-amber-100 text-xs text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fallbackToDefault}
                    onChange={(e) => setFallbackToDefault(e.target.checked)}
                    className="w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="font-bold block">Generar certificado por defecto</span>
                    <span className="text-amber-700 text-[11px] font-normal leading-relaxed mt-0.5 block">
                      Si el pasajero no cuenta con plantillas de cartas registradas para su póliza, se le generará y enviará el Certificado de Seguro PDF por defecto del sistema.
                    </span>
                  </div>
                </label>

                {/* PDF Merge Mode Option */}
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider">
                    Formato de Archivos Adjuntos
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPdfMergeMode('separate')}
                      className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                        pdfMergeMode === 'separate'
                          ? 'bg-blue-50/80 border-blue-500 ring-2 ring-blue-500/20 text-blue-900 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Files className="w-3.5 h-3.5 text-blue-600" />
                          Archivos Separados
                        </span>
                        {pdfMergeMode === 'separate' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Adjuntar cada carta seleccionada en un PDF individual independiente
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPdfMergeMode('merged')}
                      className={`p-3 rounded-xl border text-left transition-all flex flex-col gap-1 cursor-pointer ${
                        pdfMergeMode === 'merged'
                          ? 'bg-blue-50/80 border-blue-500 ring-2 ring-blue-500/20 text-blue-900 shadow-sm'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <FileStack className="w-3.5 h-3.5 text-blue-600" />
                          Un Solo PDF Integrado
                        </span>
                        {pdfMergeMode === 'merged' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Integrar todas las cartas de cada viajero en 1 solo archivo PDF
                      </p>
                    </button>
                  </div>
                </div>
              </div>

              {/* CC Emails configuration */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Copy className="w-4 h-4 text-gray-500" />
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Enviar Copia (CC)</h4>
                </div>

                <p className="text-xs text-gray-500">
                  ¿Deseas enviar una copia de todos estos correos masivos a otras direcciones? (ej. agencias, directores o archivos internos):
                </p>

                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Correos electrónicos en copia (CC)</label>
                  <input
                    type="text"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    className={`w-full px-4 py-2.5 text-xs bg-gray-50 border rounded-xl focus:ring-2 outline-none transition-all ${
                      ccError ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-blue-500'
                    }`}
                    placeholder="ejemplo1@correo.com, ejemplo2@correo.com"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Separa múltiples direcciones de correo utilizando comas (,).
                  </p>
                </div>

                {ccError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
                    {ccError}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 rounded-xl transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={selectedLanguages.length === 0 && !fallbackToDefault}
              className="flex-[2] py-3 text-sm font-black bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl shadow-blue-100 hover:shadow-blue-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Iniciar Envío Masivo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
