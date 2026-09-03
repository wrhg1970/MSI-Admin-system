import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, CheckCircle2, FolderArchive, Info, Users, Download, AlertTriangle } from 'lucide-react';
import { InsuranceRequest, Policy, PolicyLetter } from '../types';
import { getAvailableLettersForInsurance, isSpainDestination } from '../lib/policyUtils';
import { generatePDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';

interface BulkZipDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedInsurances: InsuranceRequest[];
  policies: Policy[];
  policyLetters: PolicyLetter[];
  companySettings?: any;
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

const LANGUAGE_ORDER = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid', 'fr', 'it', 'de'];

const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
  return [...letters].sort((a, b) => {
    const idxA = LANGUAGE_ORDER.indexOf(a.language);
    const idxB = LANGUAGE_ORDER.indexOf(b.language);
    const posA = idxA === -1 ? 999 : idxA;
    const posB = idxB === -1 ? 999 : idxB;
    return posA - posB;
  });
};

export default function BulkZipDownloadModal({
  isOpen,
  onClose,
  selectedInsurances,
  policies,
  policyLetters,
  companySettings
}: BulkZipDownloadModalProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['es']);
  const [fallbackToDefault, setFallbackToDefault] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; statusText: string } | null>(null);
  const [summary, setSummary] = useState<{ successCount: number; pdfCount: number; failures: { name: string; error: string }[] } | null>(null);

  const hasSpainDestination = React.useMemo(() => {
    return selectedInsurances.some(ins => isSpainDestination(ins.destinationCountry));
  }, [selectedInsurances]);

  const availableLanguagesList = React.useMemo(() => {
    return AVAILABLE_LANGUAGES.filter(lang => {
      if (lang.id === 'es_spain' || lang.id === 'embajada_spain') {
        return hasSpainDestination;
      }
      return true;
    });
  }, [hasSpainDestination]);

  useEffect(() => {
    if (isOpen) {
      setSummary(null);
      setProgress(null);
      setIsGenerating(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleLanguage = (langId: string) => {
    if (selectedLanguages.includes(langId)) {
      if (selectedLanguages.length > 1) {
        setSelectedLanguages(selectedLanguages.filter(id => id !== langId));
      }
    } else {
      setSelectedLanguages([...selectedLanguages, langId]);
    }
  };

  const handleDownloadZip = async () => {
    if (selectedInsurances.length === 0) return;
    setIsGenerating(true);
    setSummary(null);
    setProgress({ current: 0, total: selectedInsurances.length, statusText: 'Iniciando compresión y generación de cartas...' });

    const pdfFiles: { filename: string; data: any }[] = [];
    const failuresList: { name: string; error: string }[] = [];
    let successCount = 0;

    for (let i = 0; i < selectedInsurances.length; i++) {
      const ins = selectedInsurances[i];
      const fullName = `${ins.firstName} ${ins.lastName}`.trim();

      setProgress({
        current: i,
        total: selectedInsurances.length,
        statusText: `Generando cartas de ${fullName}...`
      });

      try {
        const relevantLetters = sortLettersByLanguage(
          getAvailableLettersForInsurance(ins, policyLetters, policies)
        );

        const currentSelectedLetters = relevantLetters.filter(l => selectedLanguages.includes(l.language));

        if (currentSelectedLetters.length === 0) {
          if (fallbackToDefault) {
            const docObj: any = await generatePDF(ins, undefined, policies, companySettings?.logoUrl, true);
            const blob = docObj.output('blob');
            pdfFiles.push({
              filename: `${ins.lastName}_${ins.firstName}_Certificado_Default.pdf`.replace(/[\s/\\?%*:|"<>]/g, '_'),
              data: blob
            });
            successCount++;
          } else {
            failuresList.push({
              name: fullName,
              error: 'No tiene cartas personalizadas configuradas en los idiomas seleccionados.'
            });
          }
        } else {
          for (const letter of currentSelectedLetters) {
            const docObj: any = await generatePDF(ins, letter, policies, companySettings?.logoUrl, true);
            const blob = docObj.output('blob');
            const langLabel = AVAILABLE_LANGUAGES.find(l => l.id === letter.language)?.label || letter.language;
            pdfFiles.push({
              filename: `${ins.lastName}_${ins.firstName}_Certificado_${langLabel}.pdf`.replace(/[\s/\\?%*:|"<>]/g, '_'),
              data: blob
            });
          }
          successCount++;
        }
      } catch (err: any) {
        console.error(`Error generating PDF for ${fullName}:`, err);
        failuresList.push({
          name: fullName,
          error: err.message || 'Error al generar el PDF.'
        });
      }
    }

    if (pdfFiles.length > 0) {
      setProgress({
        current: selectedInsurances.length,
        total: selectedInsurances.length,
        statusText: 'Creando archivo .ZIP...'
      });

      try {
        const zipBlob = await createZipFromPdfs(pdfFiles);
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        downloadBlob(zipBlob, `Cartas_Seguros_${dateStr}.zip`);
      } catch (err: any) {
        console.error('Error creating ZIP file:', err);
        failuresList.push({
          name: 'Archivo .ZIP',
          error: `Error al empaquetar en ZIP: ${err.message || err}`
        });
      }
    }

    setIsGenerating(false);
    setProgress(null);
    setSummary({
      successCount,
      pdfCount: pdfFiles.length,
      failures: failuresList
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 my-8"
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/70">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <FolderArchive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-950 leading-tight">Descargar Cartas en ZIP</h3>
                <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-medium">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  Se procesarán <strong>{selectedInsurances.length}</strong> seguros seleccionados.
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-150 rounded-full transition-all text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {!progress && !summary && (
              <>
                {/* Languages checklist */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    Idiomas / Tipos de carta a incluir
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {availableLanguagesList.map((lang) => {
                      const isSelected = selectedLanguages.includes(lang.id);
                      return (
                        <button
                          key={lang.id}
                          type="button"
                          onClick={() => handleToggleLanguage(lang.id)}
                          className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50/50 text-blue-950 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50/30'
                          }`}
                        >
                          <span className="text-sm font-semibold">{lang.label}</span>
                          <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                            isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'
                          }`}>
                            {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Info and options */}
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col gap-3">
                  <div className="flex gap-3">
                    <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-600 font-medium leading-relaxed">
                      El sistema buscará las cartas correspondientes para cada uno de los idiomas seleccionados en cada póliza. Si una póliza tiene múltiples cartas configuradas para los idiomas elegidos, se agregarán todas ellas al .ZIP.
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 mt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={fallbackToDefault}
                      onChange={(e) => setFallbackToDefault(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-800">Descargar certificado por defecto si no tiene cartas configuradas</span>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Si la póliza no tiene cartas personalizadas en el idioma seleccionado, generará el Certificado de Seguro estándar en PDF.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 px-4 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl shadow-blue-100 hover:shadow-blue-200"
                  >
                    <Download className="w-4 h-4" />
                    Generar y Descargar .ZIP
                  </button>
                </div>
              </>
            )}

            {/* Generation Progress state */}
            {progress && (
              <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in duration-200">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-gray-900">Generando Cartas...</h4>
                  <p className="text-xs text-gray-500 font-medium">{progress.statusText}</p>
                </div>
                <div className="w-full max-w-xs bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-400">
                  {progress.current} de {progress.total} completados
                </span>
              </div>
            )}

            {/* Finished/Summary state */}
            {summary && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="flex flex-col items-center text-center space-y-2 pb-2">
                  <div className="p-3 bg-green-50 text-green-600 rounded-2xl">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <h4 className="text-lg font-black text-gray-950">¡Descarga Lista!</h4>
                  <p className="text-xs text-gray-500 font-medium">
                    Se generaron con éxito <strong>{summary.pdfCount} archivos PDF</strong> para {summary.successCount} seguros.
                  </p>
                </div>

                {summary.failures.length > 0 && (
                  <div className="border border-amber-100 bg-amber-50/50 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-amber-800">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-black uppercase tracking-wider">Detalles de exclusión ({summary.failures.length})</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-2">
                      {summary.failures.map((f, index) => (
                        <div key={index} className="text-xs flex justify-between font-medium">
                          <span className="text-gray-700 font-bold">{f.name}</span>
                          <span className="text-amber-700">{f.error}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors shadow-lg"
                >
                  Entendido
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
