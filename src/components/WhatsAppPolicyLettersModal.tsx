import React, { useState, useEffect, useMemo } from 'react';
import { 
  MessageCircle, 
  FileText, 
  Download, 
  ExternalLink, 
  Copy, 
  Check, 
  X, 
  User, 
  Users, 
  Phone, 
  Globe, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  FileStack,
  Send
} from 'lucide-react';
import { InsuranceRequest, Policy, PolicyLetter } from '../types';
import { differenceInYears, parseISO, format } from 'date-fns';
import { generatePDF, generateMergedLettersPDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';
import { getPolicyNumber, getAvailableLettersForInsurance, findPolicyPrioritized, formatDisplayDate } from '../lib/policyUtils';
import { COUNTRIES } from '../constants';
import { logInsuranceActivity } from '../utils/activityLogger';
import { auth } from '../firebase';
import { getWhatsAppSettings, formatPhoneNumber } from '../services/whatsapp';

export interface PolicyWhatsAppContact {
  phone: string;
  name: string;
  role: 'client' | 'agent' | 'subagent';
  label: string;
}

export interface PolicyWhatsAppContactsResult {
  clientContact: PolicyWhatsAppContact | null;
  agentContact: PolicyWhatsAppContact | null;
  hasAnyPhone: boolean;
  label: string;
}

/**
 * Resolves registered phone numbers for the client and the agent / sub-agent
 * associated with a specific insurance policy.
 */
export function getPolicyWhatsAppContacts(
  insurance: InsuranceRequest,
  clients: any[],
  users?: any[]
): PolicyWhatsAppContactsResult {
  if (!insurance) {
    return { clientContact: null, agentContact: null, hasAnyPhone: false, label: '' };
  }

  // 1. Resolve Client contact
  let clientPhone = (insurance.phone || '').trim();
  let clientName = `${insurance.firstName || ''} ${insurance.lastName || ''}`.trim();

  const clientObj = clients.find(c => c.id === insurance.clientId)
    || clients.find(c => c.email && insurance.email && c.email.toLowerCase() === insurance.email.toLowerCase());

  if (clientObj) {
    if (!clientPhone && clientObj.phone) {
      clientPhone = clientObj.phone.trim();
    }
    const resolvedCompanyOrName = clientObj.commercialName || clientObj.legalName;
    if (resolvedCompanyOrName && !clientName.includes(resolvedCompanyOrName)) {
      clientName = `${clientName} (${resolvedCompanyOrName})`.trim();
    }
  }

  const clientContact: PolicyWhatsAppContact | null = clientPhone ? {
    phone: clientPhone,
    name: clientName || 'Asegurado',
    role: 'client',
    label: `Cliente: ${clientName || 'Asegurado'} (${clientPhone})`
  } : null;

  // 2. Resolve Agent / Sub-agent contact
  let agentPhone = '';
  let agentName = '';
  let agentRole: 'agent' | 'subagent' = 'agent';

  // Check sub-agent (linkedAgentId)
  if (insurance.linkedAgentId && clientObj?.linkedAgents) {
    const subAgent = clientObj.linkedAgents.find(
      (la: any) => la.id === insurance.linkedAgentId || (la.email && la.email.toLowerCase() === insurance.linkedAgentId.toLowerCase())
    );
    if (subAgent) {
      agentPhone = (subAgent.phone || '').trim();
      agentName = subAgent.name || insurance.linkedAgentId;
      agentRole = 'subagent';
    }
  }

  // Check if client document itself is of type 'Agent'
  if (!agentPhone && clientObj?.type === 'Agent') {
    agentPhone = (clientObj.phone || '').trim();
    agentName = clientObj.commercialName || clientObj.legalName || 'Agente';
  }

  // Check if insurance.agentId points to an Agent client
  if (!agentPhone && insurance.agentId) {
    const agentClient = clients.find(
      c => c.id === insurance.agentId || (c.email && c.email.toLowerCase() === insurance.agentId?.toLowerCase())
    );
    if (agentClient) {
      agentPhone = (agentClient.phone || '').trim();
      agentName = agentClient.commercialName || agentClient.legalName || `${agentClient.firstName || ''} ${agentClient.lastName || ''}`.trim() || 'Agente';
    }
  }

  // Check users collection (for team members/agents)
  if (!agentPhone && insurance.agentId && users && users.length > 0) {
    const userAgent = users.find(
      u => u.uid === insurance.agentId || (u.email && u.email.toLowerCase() === insurance.agentId?.toLowerCase())
    );
    if (userAgent && (userAgent as any).phone) {
      agentPhone = ((userAgent as any).phone || '').trim();
      agentName = userAgent.displayName || userAgent.email || 'Agente';
    }
  }

  const agentContact: PolicyWhatsAppContact | null = agentPhone ? {
    phone: agentPhone,
    name: agentName || 'Agente',
    role: agentRole,
    label: `${agentRole === 'subagent' ? 'Subagente' : 'Agente'}: ${agentName} (${agentPhone})`
  } : null;

  const hasAnyPhone = Boolean(clientContact || agentContact);

  let label = '';
  if (clientContact && agentContact) {
    label = `Cliente y ${agentContact.role === 'subagent' ? 'Subagente' : 'Agente'}`;
  } else if (clientContact) {
    label = 'Cliente';
  } else if (agentContact) {
    label = agentContact.role === 'subagent' ? 'Subagente' : 'Agente';
  }

  return { clientContact, agentContact, hasAnyPhone, label };
}

const LANGUAGE_ORDER = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid', 'fr', 'it', 'de'];

const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
  return [...letters].sort((a, b) => {
    let indexA = LANGUAGE_ORDER.indexOf(a.language);
    let indexB = LANGUAGE_ORDER.indexOf(b.language);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    if (indexA !== indexB) return indexA - indexB;
    return a.language.localeCompare(b.language);
  });
};

const getLanguageLabel = (lang: string): string => {
  switch (lang) {
    case 'es': return 'Español';
    case 'en': return 'Inglés';
    case 'es_spain': return 'España';
    case 'embajada_spain': return 'Embajada España';
    case 'covid': return 'Coronavirus';
    case 'policy': return 'Policy (Póliza)';
    case 'fr': return 'Francés';
    case 'it': return 'Italiano';
    case 'de': return 'Alemán';
    default: return lang.toUpperCase();
  }
};

interface WhatsAppPolicyLettersModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurance: InsuranceRequest | null;
  policies: Policy[];
  policyLetters: PolicyLetter[];
  clients: any[];
  users?: any[];
  companySettings?: any;
}

export default function WhatsAppPolicyLettersModal({
  isOpen,
  onClose,
  insurance,
  policies,
  policyLetters,
  clients,
  users = [],
  companySettings
}: WhatsAppPolicyLettersModalProps) {
  const contacts = useMemo(() => {
    if (!insurance) return { clientContact: null, agentContact: null, hasAnyPhone: false, label: '' };
    return getPolicyWhatsAppContacts(insurance, clients, users);
  }, [insurance, clients, users]);

  // Recipient selection: 'client' | 'agent'
  const [recipientRole, setRecipientRole] = useState<'client' | 'agent'>('client');

  useEffect(() => {
    if (contacts.clientContact) {
      setRecipientRole('client');
    } else if (contacts.agentContact) {
      setRecipientRole('agent');
    }
  }, [contacts.clientContact, contacts.agentContact]);

  const [phoneInput, setPhoneInput] = useState<string>('');
  const [availableLetters, setAvailableLetters] = useState<PolicyLetter[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [pdfMergeMode, setPdfMergeMode] = useState<'separate' | 'merged'>('merged');
  const [message, setMessage] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingApi, setIsSendingApi] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasApiConfig, setHasApiConfig] = useState(false);

  // Sync phone input whenever recipient changes
  useEffect(() => {
    const selected = recipientRole === 'client' ? contacts.clientContact : contacts.agentContact;
    if (selected) {
      setPhoneInput(selected.phone);
    } else {
      setPhoneInput('');
    }
  }, [recipientRole, contacts]);

  // Check if Meta Cloud API is set up
  useEffect(() => {
    getWhatsAppSettings().then(cfg => {
      if (cfg && cfg.phoneId && cfg.accessToken) {
        setHasApiConfig(true);
      }
    }).catch(() => {});
  }, []);

  // Compute available policy letters
  useEffect(() => {
    if (!insurance) {
      setAvailableLetters([]);
      setSelectedLanguages([]);
      return;
    }

    const available = getAvailableLettersForInsurance(insurance, policyLetters, policies);
    const sorted = sortLettersByLanguage(available);
    setAvailableLetters(sorted);

    // Default preselected languages
    const preferredLangs = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid'];
    const preselected = sorted
      .map(l => l.language)
      .filter(lang => preferredLangs.includes(lang));

    setSelectedLanguages(preselected.length > 0 ? preselected : sorted.map(l => l.language));
  }, [insurance, policyLetters, policies]);

  // Policy & Country Helpers
  const policy = useMemo(() => {
    if (!insurance) return null;
    return findPolicyPrioritized(insurance.policyId, policies);
  }, [insurance, policies]);

  const countryName = useMemo(() => {
    if (!insurance) return '';
    const destCode = insurance.destinationCountry;
    if (!destCode) return '';
    const found = COUNTRIES.find(c => c.code === destCode);
    return found ? found.name : destCode;
  }, [insurance]);

  // Strictly determine CareMed policy code: 26 CC015653-UNDER25 (< 25) or 26 CC015653-OVER25 (>= 25)
  const policyCode = useMemo(() => {
    if (!insurance) return '26 CC015653-OVER25';

    let effectiveAge: number | undefined = undefined;
    if (insurance.age !== undefined && insurance.age !== null && !isNaN(Number(insurance.age))) {
      effectiveAge = Number(insurance.age);
    } else if (insurance.birthDate) {
      try {
        const refDateStr = insurance.startDate || format(new Date(), 'yyyy-MM-dd');
        const refDate = parseISO(refDateStr);
        const bDate = parseISO(insurance.birthDate);
        effectiveAge = Math.max(0, differenceInYears(refDate, bDate));
      } catch {
        // fallback
      }
    }

    const isUnder25 = (effectiveAge !== undefined && !isNaN(effectiveAge) && effectiveAge < 25) ||
      (insurance.policyNumber && insurance.policyNumber.toUpperCase().includes('UNDER25')) ||
      (insurance.plan && insurance.plan.toUpperCase().includes('UNDER25')) ||
      (insurance.policyId && insurance.policyId.toUpperCase().includes('UNDER25')) ||
      (policy?.name && (policy.name.toLowerCase().includes('u6') || policy.name.toLowerCase().includes('student') || policy.name.toLowerCase().includes('estudiante'))) ||
      (policy?.plan && (policy.plan.toLowerCase().includes('u6') || policy.plan.toLowerCase().includes('student') || policy.plan.toLowerCase().includes('estudiante')));

    return isUnder25 ? '26 CC015653-UNDER25' : '26 CC015653-OVER25';
  }, [insurance, policy]);

  // Construct standard formatted message when selections change
  useEffect(() => {
    if (!insurance) return;

    const recipientName = recipientRole === 'client' 
      ? `${insurance.firstName || ''} ${insurance.lastName || ''}`.trim() || insurance.firstName || 'Asegurado'
      : (contacts.agentContact?.name || 'Estimado Asesor');

    const planName = insurance.plan || policy?.name || policy?.NombrePoliza || insurance.policyName || 'Póliza';
    const startDate = formatDisplayDate(insurance.startDate) !== '-' 
      ? formatDisplayDate(insurance.startDate) 
      : (insurance.startDate || 'N/A');
    const endDate = formatDisplayDate(insurance.endDate) !== '-' 
      ? formatDisplayDate(insurance.endDate) 
      : (insurance.endDate || 'N/A');

    const constructed = `Hola ${recipientName}, te enviamos tu poliza ${planName} de Mi Seguro Internacional en un solo documento PDF.\n\n` +
      `Vigencia: ${startDate} al ${endDate}. Conserva este archivo; es tu comprobante de cobertura.\n\n` +
      `Si tienes dudas, responde este mensaje o llamanos.`;

    setMessage(constructed);
  }, [insurance, recipientRole, contacts, policy]);

  // Clean phone number for WhatsApp link
  const getCleanPhone = (phone: string): string => {
    let cleaned = phone.replace(/\D/g, '');
    if (!cleaned) return '';
    // Standard Mexico 10-digit number prefix if missing
    if (cleaned.length === 10) {
      cleaned = '52' + cleaned;
    }
    return cleaned;
  };

  // Generate and download PDFs
  const handleDownloadLetters = async (): Promise<boolean> => {
    if (!insurance) return false;
    setIsDownloading(true);
    setSendFeedback(null);
    try {
      if (selectedLanguages.length === 0) {
        // Fallback default
        await generatePDF(insurance, undefined, policies, companySettings?.logoUrl);
      } else if (pdfMergeMode === 'merged' && selectedLanguages.length > 1) {
        // Merge into a single PDF
        const templatesToMerge = selectedLanguages
          .map(lang => availableLetters.find(l => l.language === lang))
          .filter(Boolean) as PolicyLetter[];
        
        await generateMergedLettersPDF(insurance, templatesToMerge, policies, companySettings?.logoUrl);
      } else if (selectedLanguages.length === 1) {
        // Single letter
        const template = availableLetters.find(l => l.language === selectedLanguages[0]);
        await generatePDF(insurance, template, policies, companySettings?.logoUrl);
      } else {
        // Multiple separate letters in a ZIP
        const pdfsForZip: { filename: string; data: any }[] = [];
        for (const lang of selectedLanguages) {
          const template = availableLetters.find(l => l.language === lang);
          const docObj: any = await generatePDF(insurance, template, policies, companySettings?.logoUrl, true);
          const filename = `Carta_Seguro_${insurance.firstName}_${insurance.lastName}_${lang}.pdf`;
          pdfsForZip.push({ filename, data: docObj.output('blob') });
        }
        const zipBlob = await createZipFromPdfs(pdfsForZip);
        downloadBlob(zipBlob, `Cartas_Seguro_${insurance.firstName}_${insurance.lastName}.zip`);
      }
      return true;
    } catch (err: any) {
      console.error('Error generating PDF letters for WhatsApp:', err);
      setSendFeedback({ type: 'error', text: 'Error al generar los PDFs: ' + (err?.message || 'Revisa los datos.') });
      return false;
    } finally {
      setIsDownloading(false);
    }
  };

  // Open WhatsApp Web or App with prefilled message
  const handleOpenWhatsApp = async () => {
    const cleanPhone = getCleanPhone(phoneInput);
    if (!cleanPhone) {
      alert('Por favor ingresa un número de teléfono válido con código de país (ej. 521234567890).');
      return;
    }

    // Auto-generate/download the PDF so user has it ready in downloads to drag & drop
    await handleDownloadLetters();

    // Log the activity
    try {
      await logInsuranceActivity({
        insuranceId: insurance.id || '',
        type: 'whatsapp_sent',
        description: `Abrió WhatsApp para enviar cartas a ${recipientRole === 'client' ? 'Cliente' : 'Agente'} (${cleanPhone}).`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Usuario'
      });
    } catch (e) {
      console.error('Error logging WhatsApp activity:', e);
    }

    const encodedText = encodeURIComponent(message);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  // Copy text to clipboard
  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Send via Cloud API if configured
  const handleSendViaApi = async () => {
    const cleanPhone = getCleanPhone(phoneInput);
    if (!cleanPhone) {
      setSendFeedback({ type: 'error', text: 'Número de teléfono inválido.' });
      return;
    }

    setIsSendingApi(true);
    setSendFeedback(null);
    try {
      const cfg = await getWhatsAppSettings();
      if (!cfg.phoneId || !cfg.accessToken) {
        throw new Error('La integración de la API de WhatsApp de Meta no está configurada en Configuración.');
      }

      const url = `https://graph.facebook.com/v17.0/${cfg.phoneId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: { body: message }
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData?.error?.message || 'Error al comunicarse con WhatsApp API');
      }

      await logInsuranceActivity({
        insuranceId: insurance.id || '',
        type: 'whatsapp_api_sent',
        description: `Mensaje de cartas enviado exitosamente vía WhatsApp API a ${cleanPhone}.`,
        date: new Date(),
        createdBy: auth.currentUser?.email || 'Usuario'
      });

      setSendFeedback({ type: 'success', text: '¡Mensaje enviado con éxito vía API de WhatsApp!' });
    } catch (err: any) {
      console.error('Error sending via WhatsApp API:', err);
      setSendFeedback({ type: 'error', text: err?.message || 'Error al enviar por API.' });
    } finally {
      setIsSendingApi(false);
    }
  };

  const recipientHasPhone = recipientRole === 'client' 
    ? Boolean(contacts.clientContact) 
    : Boolean(contacts.agentContact);

  if (!isOpen || !insurance) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[250] p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-gray-100 my-8">
        
        {/* Header with WhatsApp Brand Identity */}
        <div className="px-6 py-5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white flex justify-between items-center shadow-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-2xl backdrop-blur-md border border-white/20">
              <MessageCircle className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold">Enviar Cartas por WhatsApp</h3>
                <span className="px-2 py-0.5 bg-emerald-500/50 text-[10px] font-bold rounded-full border border-emerald-400/40">
                  {policyCode}
                </span>
              </div>
              <p className="text-xs text-emerald-100 mt-0.5">
                {insurance.firstName} {insurance.lastName} · {insurance.plan || insurance.policyName || 'Póliza'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          
          {/* Notifications / Alerts */}
          {sendFeedback && (
            <div className={`p-4 rounded-xl flex items-center gap-3 text-xs font-semibold ${
              sendFeedback.type === 'success' 
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {sendFeedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              )}
              <span>{sendFeedback.text}</span>
            </div>
          )}

          {/* Recipient Selector (Client vs Agent) */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Destinatario
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              
              {/* Option 1: Client */}
              <div
                onClick={() => setRecipientRole('client')}
                className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                  recipientRole === 'client'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`p-2 rounded-xl shrink-0 ${
                  recipientRole === 'client' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <User className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-900">Cliente (Pasajero)</span>
                    {contacts.clientContact ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Registrado
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        Sin teléfono
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 font-medium truncate mt-0.5">
                    {insurance.firstName} {insurance.lastName}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5 truncate">
                    {contacts.clientContact?.phone || 'Sin número en expediente'}
                  </p>
                </div>
              </div>

              {/* Option 2: Agent / Sub-agent */}
              <div
                onClick={() => setRecipientRole('agent')}
                className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                  recipientRole === 'agent'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className={`p-2 rounded-xl shrink-0 ${
                  recipientRole === 'agent' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  <Users className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-900">
                      {contacts.agentContact?.role === 'subagent' ? 'Subagente' : 'Agente / Agencia'}
                    </span>
                    {contacts.agentContact ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Registrado
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        Sin teléfono
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 font-medium truncate mt-0.5">
                    {contacts.agentContact?.name || 'Agente asignado'}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono mt-0.5 truncate">
                    {contacts.agentContact?.phone || 'Sin número en catálogo'}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Phone Number Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="whatsapp-phone-input" className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                Número de WhatsApp (con clave de país)
              </label>
              <span className="text-[11px] text-gray-400 font-mono">
                Limpio: {getCleanPhone(phoneInput) || 'vacío'}
              </span>
            </div>
            <div className="relative">
              <input
                id="whatsapp-phone-input"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+52 55 1234 5678 o 525512345678"
                className="w-full px-4 py-2.5 text-sm font-mono border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50/40"
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              💡 Para números de México de 10 dígitos, el sistema añadirá automáticamente el prefijo internacional <span className="font-mono font-bold">52</span>.
            </p>
          </div>

          {/* Letter Selection */}
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                Cartas de la Póliza Disponibles ({availableLetters.length})
              </label>

              {/* Merge PDF switch */}
              {selectedLanguages.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPdfMergeMode(pdfMergeMode === 'separate' ? 'merged' : 'separate')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium border text-[11px] transition-all ${
                      pdfMergeMode === 'merged' 
                        ? 'bg-indigo-600 text-white border-indigo-600' 
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <FileStack className="w-3 h-3" />
                    {pdfMergeMode === 'merged' ? 'Unir en 1 sólo PDF' : 'Archivos Separados (ZIP)'}
                  </button>
                </div>
              )}
            </div>

            {availableLetters.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableLetters.map(letter => {
                  const isChecked = selectedLanguages.includes(letter.language);
                  return (
                    <label
                      key={letter.id}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-white border-indigo-400 shadow-sm text-indigo-950 font-medium'
                          : 'bg-white/60 border-gray-200 text-gray-600 hover:bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLanguages([...selectedLanguages, letter.language]);
                          } else {
                            setSelectedLanguages(selectedLanguages.filter(l => l !== letter.language));
                          }
                        }}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <Globe className="w-3.5 h-3.5 text-gray-400" />
                      <div className="flex-1 truncate">
                        <span className="font-bold">{getLanguageLabel(letter.language)}</span>
                        <span className="text-[10px] text-gray-400 block truncate">{letter.title}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-gray-500 italic p-2 bg-white rounded-lg border border-gray-200">
                Se utilizará la plantilla de carta por defecto en Español para esta póliza.
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-gray-500">
                {selectedLanguages.length} idioma(s) seleccionado(s)
              </span>
              <button
                type="button"
                onClick={handleDownloadLetters}
                disabled={isDownloading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando PDF...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Descargar Cartas en PDF
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Message Text Preview & Editor */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="whatsapp-message-input" className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Mensaje de WhatsApp a Enviar
              </label>
              <button
                type="button"
                onClick={handleCopyMessage}
                className="text-xs flex items-center gap-1 text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-lg font-medium transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '¡Copiado!' : 'Copiar Texto'}
              </button>
            </div>
            <textarea
              id="whatsapp-message-input"
              rows={7}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-3.5 font-sans text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-emerald-50/20 leading-relaxed"
            />
          </div>

          {/* Quick Tip Box */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
            <span className="text-base">💡</span>
            <p className="leading-snug">
              Al hacer clic en <strong>Abrir WhatsApp</strong>, el sistema descargará de inmediato las cartas en PDF a tu equipo y abrirá la conversación con el mensaje listo. Sólo arrastra el PDF al chat para adjuntarlo.
            </p>
          </div>

        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-all"
          >
            Cerrar
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Optional Cloud API Button if configured */}
            {hasApiConfig && (
              <button
                type="button"
                onClick={handleSendViaApi}
                disabled={isSendingApi || !getCleanPhone(phoneInput)}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-xl transition-all disabled:opacity-50"
                title="Enviar directamente por la API de Meta Cloud"
              >
                {isSendingApi ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Enviar vía API
              </button>
            )}

            {/* Main Action: Open WhatsApp */}
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              disabled={!getCleanPhone(phoneInput) || isDownloading}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-lg shadow-emerald-200 transition-all disabled:opacity-50"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Descargando Cartas...
                </>
              ) : (
                <>
                  <MessageCircle className="w-4 h-4" />
                  Abrir WhatsApp y Descargar PDF
                  <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
