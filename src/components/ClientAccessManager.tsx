import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Building2, Users, Search, Mail, Phone, MapPin, ExternalLink, 
  CreditCard, Receipt, FileText, ArrowRight, X, ShieldCheck, 
  Eye, Layers, Plus, Briefcase, CheckCircle2, Clock, Filter,
  ArrowUpRight, Award, UserCheck, ChevronRight, Printer, MessageCircle
} from 'lucide-react';
import { Client, ClientType, UserProfile, CustomRole, InsuranceRequest, PolicyLetter } from '../types';
import { useFirestoreData } from '../context/FirestoreDataContext';
import { resolvePolicyFolioAndType, formatDisplayDate, getAvailableLettersForInsurance } from '../lib/policyUtils';
import { generatePDF } from '../lib/pdfGenerator';
import { useCompany } from '../App';
import InsuranceDetailModal from './InsuranceDetailModal';
import ClientDetailModal from './ClientDetailModal';
import EmailModal from './EmailModal';
import WhatsAppPolicyLettersModal from './WhatsAppPolicyLettersModal';
import { useImpersonation } from '../context/ImpersonationContext';

interface ClientAccessManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function ClientAccessManager({ profile, rolePermissions }: ClientAccessManagerProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { clients, insurances, payments, users, policies, policyLetters, latestExchangeRate } = useFirestoreData();
  const { settings } = useCompany();
  const { impersonatedAgent, setImpersonatedAgent, openModal, exitImpersonation, isRealSuperAdmin } = useImpersonation();

  // URL query parameter for pre-selected client
  const urlClientId = searchParams.get('clientId');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(urlClientId);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Agent' | 'Corporate'>('All');
  const [activeTab, setActiveTab] = useState<'purchases' | 'payments' | 'commissions' | 'agents'>('purchases');

  // Agent filtering state within an Agency
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [agentSearchTerm, setAgentSearchTerm] = useState('');

  // Modals state
  const [selectedInsuranceForDetail, setSelectedInsuranceForDetail] = useState<InsuranceRequest | null>(null);
  const [selectedInsuranceForEmail, setSelectedInsuranceForEmail] = useState<InsuranceRequest | null>(null);
  const [selectedInsuranceForWhatsApp, setSelectedInsuranceForWhatsApp] = useState<InsuranceRequest | null>(null);
  const [isClientDetailOpen, setIsClientDetailOpen] = useState(false);
  const [reprintModal, setReprintModal] = useState<{
    isOpen: boolean;
    insurance: InsuranceRequest | null;
    availableLetters: PolicyLetter[];
    selectedLanguages: string[];
  }>({
    isOpen: false,
    insurance: null,
    availableLetters: [],
    selectedLanguages: []
  });

  // Identify if current session is an Agent
  const isAgent = profile?.role === 'agent';
  const currentAgentEmail = (profile?.email || '').trim().toLowerCase();
  const currentAgentName = (profile?.displayName || '').trim().toLowerCase();

  // Filter ONLY Agents and Corporates (No individual clients on this page as requested)
  const agentAndCorporateClients = useMemo(() => {
    return clients.filter(c => c.type === 'Agent' || c.type === 'Corporate');
  }, [clients]);

  // Find this agent or agency's client record in Firestore
  const currentAgentClient = useMemo(() => {
    if (!profile) return null;
    return agentAndCorporateClients.find(c => 
      c.email && c.email.trim().toLowerCase() === currentAgentEmail
    ) || agentAndCorporateClients.find(c => 
      c.mainContact && c.mainContact.trim().toLowerCase() === currentAgentEmail
    ) || agentAndCorporateClients.find(c => 
      currentAgentName && c.mainContact && c.mainContact.trim().toLowerCase() === currentAgentName
    ) || agentAndCorporateClients.find(c => 
      c.id === (profile as any).clientId || c.id === profile.uid
    ) || agentAndCorporateClients.find(c =>
      c.linkedAgents && c.linkedAgents.some(sa => sa.email && sa.email.trim().toLowerCase() === currentAgentEmail)
    ) || clients.find(c => 
      c.email && c.email.trim().toLowerCase() === currentAgentEmail
    ) || clients.find(c => 
      c.mainContact && c.mainContact.trim().toLowerCase() === currentAgentEmail
    ) || clients.find(c => 
      c.id === (profile as any).clientId || c.id === profile.uid
    ) || null;
  }, [agentAndCorporateClients, clients, currentAgentEmail, currentAgentName, profile]);

  // Sync selectedClientId (For Agents, strictly lock/default to their own record)
  useEffect(() => {
    if (isAgent) {
      if (currentAgentClient?.id) {
        setSelectedClientId(currentAgentClient.id);
      } else if (profile?.uid) {
        setSelectedClientId(profile.uid);
      }
    } else if (urlClientId) {
      setSelectedClientId(urlClientId);
    } else if (!selectedClientId && agentAndCorporateClients.length > 0) {
      // Auto-select first entity if none is selected
      setSelectedClientId(agentAndCorporateClients[0].id!);
    }
  }, [isAgent, currentAgentClient, profile, urlClientId, agentAndCorporateClients, selectedClientId]);

  // Filtered list based on search and type filter
  const filteredEntities = useMemo(() => {
    return agentAndCorporateClients.filter(c => {
      // Type filter
      if (typeFilter !== 'All' && c.type !== typeFilter) return false;

      // Search term
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase().trim();
      const name = (c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase();
      const rfc = (c.rfc || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const code = ((c as any).clientCode || '').toLowerCase();
      return name.includes(term) || rfc.includes(term) || email.includes(term) || phone.includes(term) || code.includes(term);
    });
  }, [agentAndCorporateClients, typeFilter, searchTerm]);

  // Selected client entity
  const selectedClient = useMemo(() => {
    if (isAgent) {
      if (currentAgentClient) return currentAgentClient;
      // Synthetic fallback client from agent profile so they always see their full data
      return {
        id: profile?.uid || 'agent-uid',
        type: 'Agent' as ClientType,
        commercialName: profile?.displayName || profile?.email || 'Mi Cuenta de Agente',
        legalName: profile?.displayName || profile?.email || 'Mi Cuenta de Agente',
        email: profile?.email || '',
        commission: profile?.commission || 0,
        phone: (profile as any)?.phone || '',
        city: (profile as any)?.city || '',
        country: (profile as any)?.country || 'MX',
        rfc: (profile as any)?.rfc || '',
        linkedAgents: (profile as any)?.linkedAgents || [],
        createdAt: new Date()
      } as Client;
    }
    if (!selectedClientId) return null;
    return agentAndCorporateClients.find(c => c.id === selectedClientId) || clients.find(c => c.id === selectedClientId) || null;
  }, [isAgent, currentAgentClient, profile, agentAndCorporateClients, clients, selectedClientId]);

  // Insurances associated with the selected Agent or Corporate
  const entityInsurances = useMemo(() => {
    if (!selectedClient) return [];
    const clientEmail = (selectedClient.email || profile?.email || '').toLowerCase().trim();
    const clientId = selectedClient.id;
    const profileUid = profile?.uid;

    return insurances.filter(ins => {
      // 1. Direct match by clientId
      if (ins.clientId && (ins.clientId === clientId || (profileUid && ins.clientId === profileUid))) return true;

      // 2. Match by email (for agents or corporates)
      if (clientEmail) {
        if (ins.email && ins.email.toLowerCase().trim() === clientEmail) return true;
        if (ins.agentId && ins.agentId.toLowerCase().trim() === clientEmail) return true;
        if (ins.linkedAgentId && ins.linkedAgentId.toLowerCase().trim() === clientEmail) return true;
      }

      // 3. For Agent: match by subagents / linked agents or agentId
      if (selectedClient.type === 'Agent') {
        if (clientId && (ins.agentId === clientId || ins.linkedAgentId === clientId)) return true;
        if (profileUid && (ins.agentId === profileUid || ins.linkedAgentId === profileUid)) return true;
        if (selectedClient.linkedAgents && selectedClient.linkedAgents.length > 0) {
          const matchSub = selectedClient.linkedAgents.some(sa => 
            sa.id === ins.linkedAgentId || 
            (sa.email && ins.linkedAgentId && sa.email.toLowerCase() === ins.linkedAgentId.toLowerCase())
          );
          if (matchSub) return true;
        }
      }

      // 4. For Corporate: match by corporateId or legal/commercial name
      if (selectedClient.type === 'Corporate') {
        if ((ins as any).corporateId && (ins as any).corporateId === clientId) return true;
        const compName = (selectedClient.commercialName || selectedClient.legalName || '').toLowerCase();
        if (compName && ins.agente && ins.agente.toLowerCase() === compName) return true;
      }

      return false;
    });
  }, [insurances, selectedClient, profile]);

  // Payments associated with the entity's insurances
  const entityPayments = useMemo(() => {
    if (!selectedClient) return [];
    const entityInsuranceIds = new Set(entityInsurances.map(i => i.id));
    return payments.filter(p => {
      if (p.clientId && p.clientId === selectedClient.id) return true;
      if (p.insuranceId && entityInsuranceIds.has(p.insuranceId)) return true;
      return false;
    });
  }, [payments, entityInsurances, selectedClient]);

  // Financial and policy metrics for the selected entity
  const entityMetrics = useMemo(() => {
    if (!selectedClient) return null;

    let totalSales = 0;
    let totalCommissions = 0;
    let totalPaid = 0;

    entityInsurances.forEach(ins => {
      const sale = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
      totalSales += sale;

      const comm = Number(ins.agentCommission || 0);
      totalCommissions += comm;
    });

    entityPayments.forEach(p => {
      const amountUSD = p.currency === 'MXP' && p.exchangeRate 
        ? (p.amount / p.exchangeRate) 
        : (p.amount || 0);
      totalPaid += Number(amountUSD);
    });

    const balanceDue = Math.max(0, totalSales - totalPaid);

    return {
      policiesCount: entityInsurances.length,
      totalSales,
      totalCommissions,
      totalPaid,
      balanceDue
    };
  }, [selectedClient, entityInsurances, entityPayments]);

  // Agency linked agents (all subagents belonging to this Agency)
  const agencyLinkedAgents = useMemo(() => {
    if (!selectedClient) return [];
    if (selectedClient.linkedAgents && selectedClient.linkedAgents.length > 0) {
      return selectedClient.linkedAgents;
    }
    if ((profile as any)?.linkedAgents && (profile as any).linkedAgents.length > 0) {
      return (profile as any).linkedAgents;
    }
    return [];
  }, [selectedClient, profile]);

  // Determine if the current viewer is the Main Contact ("Contacto Principal") of this Agency
  const isMainContact = useMemo(() => {
    if (isRealSuperAdmin) return true;
    if (!selectedClient) return false;
    const clientEmail = (selectedClient.email || '').trim().toLowerCase();
    const mainContact = (selectedClient.mainContact || '').trim().toLowerCase();
    if (clientEmail && clientEmail === currentAgentEmail) return true;
    if (mainContact && (mainContact === currentAgentEmail || (currentAgentName && mainContact.includes(currentAgentName)))) return true;
    const isSubagent = agencyLinkedAgents.some(sa => sa.email && sa.email.trim().toLowerCase() === currentAgentEmail);
    return !isSubagent;
  }, [isRealSuperAdmin, selectedClient, currentAgentEmail, currentAgentName, agencyLinkedAgents]);

  // Per-agent detailed performance metrics for the Agency's team
  const agentsMetrics = useMemo(() => {
    return agencyLinkedAgents.map(agent => {
      const agentIdentifierEmail = (agent.email || '').trim().toLowerCase();
      const agentIdentifierId = agent.id;
      
      const agentPolicies = entityInsurances.filter(ins => {
        if (agentIdentifierId && (ins.linkedAgentId === agentIdentifierId || ins.agentId === agentIdentifierId)) return true;
        if (agentIdentifierEmail && (
          (ins.linkedAgentId && ins.linkedAgentId.trim().toLowerCase() === agentIdentifierEmail) ||
          (ins.email && ins.email.trim().toLowerCase() === agentIdentifierEmail)
        )) return true;
        return false;
      });

      const totalSales = agentPolicies.reduce((acc, ins) => {
        const sale = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
        return acc + sale;
      }, 0);

      const totalCommissions = agentPolicies.reduce((acc, ins) => acc + Number(ins.agentCommission || 0), 0);
      const paidCommissions = agentPolicies.filter(ins => ins.commissionStatus === 'paid').reduce((acc, ins) => acc + Number(ins.agentCommission || 0), 0);
      const pendingCommissions = Math.max(0, totalCommissions - paidCommissions);

      return {
        ...agent,
        policiesCount: agentPolicies.length,
        totalSales,
        totalCommissions,
        paidCommissions,
        pendingCommissions,
      };
    });
  }, [agencyLinkedAgents, entityInsurances]);

  // Aggregated team stats
  const teamMetrics = useMemo(() => {
    const totalPolicies = agentsMetrics.reduce((acc, a) => acc + a.policiesCount, 0);
    const totalSales = agentsMetrics.reduce((acc, a) => acc + a.totalSales, 0);
    const totalCommissions = agentsMetrics.reduce((acc, a) => acc + a.totalCommissions, 0);
    return { totalPolicies, totalSales, totalCommissions };
  }, [agentsMetrics]);

  // Filtered agents by agentSearchTerm
  const filteredAgents = useMemo(() => {
    if (!agentSearchTerm.trim()) return agentsMetrics;
    const term = agentSearchTerm.toLowerCase().trim();
    return agentsMetrics.filter(a => 
      (a.name || '').toLowerCase().includes(term) ||
      (a.email || '').toLowerCase().includes(term) ||
      (a.phone || '').toLowerCase().includes(term)
    );
  }, [agentsMetrics, agentSearchTerm]);

  // Filtered insurances when an Agent filter is applied in the purchases tab
  const displayedInsurances = useMemo(() => {
    if (selectedAgentFilter === 'all') return entityInsurances;
    const target = selectedAgentFilter.trim().toLowerCase();
    return entityInsurances.filter(ins => {
      return (
        (ins.linkedAgentId && ins.linkedAgentId.trim().toLowerCase() === target) ||
        (ins.agentId && ins.agentId.trim().toLowerCase() === target) ||
        (ins.email && ins.email.trim().toLowerCase() === target)
      );
    });
  }, [entityInsurances, selectedAgentFilter]);

  const getClientDisplayName = (client: Client) => {
    return client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim() || client.email || 'Sin nombre';
  };

  // Handler to navigate to Nueva Póliza with automatic assignment
  const handleCreateNewPolicyForEntity = () => {
    if (!selectedClient) return;
    navigate(`/request?clientId=${selectedClient.id}&clientType=${selectedClient.type}`, {
      state: {
        preselectedClient: selectedClient,
        clientId: selectedClient.id,
        clientType: selectedClient.type,
      }
    });
  };

  // Handler to reprint policy certificate
  const handleReprintPolicy = async (insurance: InsuranceRequest) => {
    try {
      const available = getAvailableLettersForInsurance(insurance, policyLetters, policies);
      if (available.length === 0) {
        await generatePDF(insurance, undefined, policies, settings?.logoUrl);
        return;
      }
      if (available.length === 1) {
        await generatePDF(insurance, available[0], policies, settings?.logoUrl);
        return;
      }
      // If multiple languages available, show selection modal
      const preselected = available.map(l => l.language);
      setReprintModal({
        isOpen: true,
        insurance,
        availableLetters: available,
        selectedLanguages: preselected.slice(0, 1)
      });
    } catch (err) {
      console.error("Error al reimprimir póliza:", err);
      alert("Hubo un error al generar la póliza para impresión. Por favor intente nuevamente.");
    }
  };

  const handleConfirmReprint = async () => {
    if (!reprintModal.insurance) return;
    try {
      for (const lang of reprintModal.selectedLanguages) {
        const template = reprintModal.availableLetters.find(l => l.language === lang);
        await generatePDF(reprintModal.insurance, template, policies, settings?.logoUrl);
      }
    } catch (err) {
      console.error("Error al generar PDF de póliza:", err);
      alert("Hubo un error al generar el PDF de la póliza.");
    } finally {
      setReprintModal(prev => ({ ...prev, isOpen: false }));
    }
  };

  const agentCount = agentAndCorporateClients.filter(c => c.type === 'Agent').length;
  const corporateCount = agentAndCorporateClients.filter(c => c.type === 'Corporate').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-violet-100 text-violet-700 rounded-2xl">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Acceso Clientes</h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-violet-50 text-violet-700 border border-violet-200">
                  Expediente 360° Agentes & Corporativos
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Portal de consulta integral, pólizas emitidas, historial de pagos, balance de cartera y emisión automática de pólizas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">
            {agentCount} Agentes • {corporateCount} Corporativos
          </span>
          {isRealSuperAdmin && !isAgent && (
            <button
              type="button"
              onClick={openModal}
              className="px-3.5 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-xs"
              title="Abrir selector para simular el portal como cualquier agente"
            >
              <Eye className="w-4 h-4 text-violet-600" />
              <span>Simular Vista de Agente</span>
            </button>
          )}
          {selectedClient && (
            <>
              {isRealSuperAdmin && !isAgent && (selectedClient.type === 'Agent' || selectedClient.type === 'Corporate') && (
                <button
                  type="button"
                  onClick={() => {
                    setImpersonatedAgent({
                      uid: selectedClient.id,
                      clientId: selectedClient.id,
                      email: selectedClient.email || '',
                      displayName: getClientDisplayName(selectedClient),
                      commission: Number(selectedClient.commission || 0),
                      canCreatePolicies: true,
                      linkedAgents: selectedClient.linkedAgents || [],
                    });
                  }}
                  className="px-3.5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-2 transition-all cursor-pointer hover:scale-105 active:scale-95"
                  title="Ver y experimentar este portal exactamente como este agente"
                >
                  <Eye className="w-4 h-4" />
                  <span>Ver como este Agente</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCreateNewPolicyForEntity}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-2 transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva Póliza para {selectedClient.type === 'Agent' ? 'Agente' : 'Corporativo'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Container: Selector & 360 View */}
      <div className="bg-white p-7 rounded-3xl shadow-sm border border-gray-200 space-y-6">
        {/* Agent Profile Welcome Banner (Only for Agents) vs Admin Selector */}
        {isAgent ? (
          <div className="bg-gradient-to-r from-violet-900 via-indigo-900 to-slate-900 text-white p-6 rounded-3xl shadow-lg border border-violet-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white font-black text-xl shadow-xs">
                <Users className="w-6 h-6 text-violet-300" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-violet-500/30 text-violet-200 border border-violet-400/30 px-2.5 py-0.5 rounded-full">
                    {agencyLinkedAgents.length > 0 ? 'Portal de Agencia' : 'Portal del Agente'}
                  </span>
                  <h3 className="text-xl font-black text-white">
                    {selectedClient ? getClientDisplayName(selectedClient) : (profile?.displayName || 'Mi Expediente Comercial')}
                  </h3>
                  {selectedClient?.mainContact && (
                    <span className="text-[10px] bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-indigo-300" />
                      Contacto Principal: {selectedClient.mainContact}
                    </span>
                  )}
                  {agencyLinkedAgents.length > 0 && (
                    <span className="text-[10px] bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                      <Users className="w-3 h-3 text-emerald-300" />
                      {agencyLinkedAgents.length} Agentes Vinculados
                    </span>
                  )}
                  {impersonatedAgent && (
                    <span className="text-[10px] bg-amber-400 text-amber-950 font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-xs">
                      <Eye className="w-3 h-3" />
                      Vista simulada activa
                    </span>
                  )}
                </div>
                <p className="text-xs text-violet-200/80 mt-1 max-w-2xl">
                  {agencyLinkedAgents.length > 0 
                    ? `Bienvenido al panel integral de la agencia. Como contacto principal, tienes acceso completo para revisar la cartera total, liquidación de comisiones y consultar la producción de tus ${agencyLinkedAgents.length} agentes vinculados.`
                    : 'Bienvenido a tu panel de control. Aquí puedes consultar tus datos, crear pólizas asignadas automáticamente y revisar tu historial de compras, pagos y comisiones.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 flex-wrap">
              {agencyLinkedAgents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('agents')}
                  className={`px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'agents'
                      ? 'bg-white text-violet-900 shadow-md'
                      : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                  }`}
                >
                  <Users className="w-4 h-4 text-violet-300" />
                  <span>Ver Mis Agentes ({agencyLinkedAgents.length})</span>
                </button>
              )}
              {impersonatedAgent && (
                <button
                  type="button"
                  onClick={exitImpersonation}
                  className="px-3.5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <X className="w-4 h-4 text-red-300" />
                  <span>Salir de Vista Agente</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCreateNewPolicyForEntity}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl text-xs flex items-center gap-2 shadow-lg shadow-blue-900/40 transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Nueva Póliza</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Selector Header & Controls for Admin */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                  <Search className="w-5 h-5 text-violet-600" />
                  Seleccionar Agente o Corporativo
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Haz clic en cualquier agente o socio corporativo para abrir su expediente comercial y gestionar sus pólizas.
                </p>
              </div>

              {selectedClient && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedClientId(null)}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Deseleccionar
                  </button>
                </div>
              )}
            </div>

            {/* Search bar and Subtype filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por nombre comercial, razón social, RFC, email o teléfono..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50/70 border border-gray-200 rounded-2xl text-xs font-semibold focus:ring-2 focus:ring-violet-500 focus:bg-white outline-none transition-all"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-2xl border border-gray-200 overflow-x-auto shrink-0">
                {(['All', 'Agent', 'Corporate'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeFilter(type)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      typeFilter === type
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {type === 'All' ? `Todos (${agentAndCorporateClients.length})` :
                     type === 'Agent' ? `Agentes (${agentCount})` : `Corporativos (${corporateCount})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Selector Badges / Chips */}
            <div className="flex flex-wrap items-center gap-2 max-h-48 overflow-y-auto p-1 border border-gray-100 rounded-2xl bg-gray-50/40 p-2">
              {filteredEntities.map((c, idx) => {
                const isSelected = selectedClientId === c.id;
                return (
                  <button
                    key={c.id ? `ent-${c.id}-${idx}` : `ent-${idx}`}
                    type="button"
                    onClick={() => {
                      setSelectedClientId(c.id!);
                      setSearchParams({ clientId: c.id! });
                    }}
                    className={`px-3 py-2 rounded-2xl text-xs font-bold border transition-all flex items-center gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-200 ring-2 ring-violet-200'
                        : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${
                      c.type === 'Agent' ? 'bg-purple-400' : 'bg-indigo-400'
                    }`} />
                    <span className="truncate max-w-[220px]">{getClientDisplayName(c)}</span>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full uppercase font-black ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.type === 'Agent' ? 'Agente' : 'Corp'}
                    </span>
                  </button>
                );
              })}
              {filteredEntities.length === 0 && (
                <p className="text-xs text-gray-400 py-2 px-3">No se encontraron agentes o corporativos con ese criterio.</p>
              )}
            </div>
          </>
        )}

        {/* 360° DETAILED VIEW */}
        {selectedClient && entityMetrics ? (
          <div className="mt-6 pt-6 border-t border-gray-200 space-y-6 animate-in slide-in-from-top-4 duration-300">
            {/* Identity Card */}
            <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-3xl p-6 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                {/* Avatar and Main Info */}
                <div className="flex items-start gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 shadow-sm ${
                    selectedClient.type === 'Agent' ? 'bg-purple-600 text-white shadow-purple-200' :
                    'bg-indigo-600 text-white shadow-indigo-200'
                  }`}>
                    {selectedClient.type === 'Agent' ? <Users className="w-7 h-7" /> : <Building2 className="w-7 h-7" />}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h4 className="text-lg font-black text-gray-900">{getClientDisplayName(selectedClient)}</h4>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                        selectedClient.type === 'Agent' 
                          ? 'bg-purple-50 text-purple-700 border-purple-200' 
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      }`}>
                        {selectedClient.type === 'Agent' ? 'Agente Comercial' : 'Empresa Corporativa'}
                      </span>
                      {selectedClient.rfc && (
                        <span className="font-mono text-[11px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-bold">
                          RFC: {selectedClient.rfc}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1">
                      {selectedClient.email && (
                        <a href={`mailto:${selectedClient.email}`} className="flex items-center gap-1.5 hover:text-blue-600 font-medium">
                          <Mail className="w-3.5 h-3.5 text-gray-400" />
                          <span>{selectedClient.email}</span>
                        </a>
                      )}
                      {selectedClient.phone && (
                        <a href={`tel:${selectedClient.phone}`} className="flex items-center gap-1.5 hover:text-green-600 font-medium">
                          <Phone className="w-3.5 h-3.5 text-gray-400" />
                          <span>{selectedClient.phone}</span>
                        </a>
                      )}
                      {(selectedClient.city || selectedClient.country) && (
                        <span className="flex items-center gap-1.5 text-gray-500">
                          <MapPin className="w-3.5 h-3.5 text-gray-400" />
                          <span>{[selectedClient.city, selectedClient.state, selectedClient.country].filter(Boolean).join(', ')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIsClientDetailOpen(true)}
                    className="px-3.5 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ficha Completa
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateNewPolicyForEntity}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    title="Emitir nueva póliza asignada automáticamente a este agente o corporativo"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Nueva Póliza</span>
                  </button>
                </div>
              </div>

              {/* Commercial Parameters */}
              <div className="mt-4 pt-4 border-t border-gray-200/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="bg-white p-3 rounded-2xl border border-gray-200">
                  <span className="text-[10px] font-bold text-gray-400 uppercase block">Comisión Base</span>
                  <span className="text-sm font-black text-purple-700">{selectedClient.commission || 0}%</span>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-gray-200">
                  <span className="text-[10px] font-bold text-gray-400 uppercase block">Descuento Base</span>
                  <span className="text-sm font-black text-indigo-700">{selectedClient.discountPercentage || 0}%</span>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-gray-200">
                  <span className="text-[10px] font-bold text-gray-400 uppercase block">Agentes del Equipo</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('agents')}
                    className="text-sm font-black text-violet-700 hover:text-violet-900 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>{agencyLinkedAgents.length} agentes</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                {selectedClient.mainContact && (
                  <div className="bg-white p-3 rounded-2xl border border-gray-200">
                    <span className="text-[10px] font-bold text-gray-400 uppercase block">Contacto Principal</span>
                    <span className="text-sm font-black text-gray-900 truncate block">{selectedClient.mainContact}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Micro-KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4">
                <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Pólizas Totales</span>
                <p className="text-2xl font-black text-blue-950 mt-1">{entityMetrics.policiesCount}</p>
                <span className="text-[11px] text-blue-600">En histórico</span>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4">
                <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Volumen USD</span>
                <p className="text-2xl font-black text-emerald-950 mt-1">${entityMetrics.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs">USD</span></p>
                <span className="text-[11px] text-emerald-600 font-medium">Colocación total</span>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Saldo Pagado</span>
                <p className="text-2xl font-black text-gray-900 mt-1">${entityMetrics.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs">USD</span></p>
                <span className="text-[11px] text-gray-500">Cobrado</span>
              </div>

              <div className={`border rounded-2xl p-4 ${
                entityMetrics.balanceDue > 0 ? 'bg-amber-50/70 border-amber-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Saldo Pendiente</span>
                <p className={`text-2xl font-black mt-1 ${entityMetrics.balanceDue > 0 ? 'text-amber-800' : 'text-gray-900'}`}>
                  ${entityMetrics.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs">USD</span>
                </p>
                <span className={`text-[11px] ${entityMetrics.balanceDue > 0 ? 'text-amber-700 font-bold' : 'text-gray-500'}`}>
                  {entityMetrics.balanceDue > 0 ? 'Requiere liquidación' : 'Al corriente'}
                </span>
              </div>
            </div>

            {/* Sub-Tabs: Compras/Pólizas, Pagos, Comisiones, Agentes */}
            <div className="border border-gray-200 rounded-3xl overflow-hidden bg-white shadow-xs">
              <div className="flex border-b border-gray-200 bg-gray-50/80 px-4 pt-2 gap-4 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('purchases')}
                  className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'purchases'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-700'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Compras / Pólizas ({entityInsurances.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('payments')}
                  className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'payments'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-gray-400 hover:text-gray-700'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  Historial de Pagos ({entityPayments.length})
                </button>

                {(selectedClient.type === 'Agent' || entityMetrics.totalCommissions > 0) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('commissions')}
                    className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                      activeTab === 'commissions'
                        ? 'border-purple-600 text-purple-600'
                        : 'border-transparent text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    <Receipt className="w-4 h-4" />
                    Comisiones (${entityMetrics.totalCommissions.toFixed(2)} USD)
                  </button>
                )}

                {(selectedClient.type === 'Agent' || agencyLinkedAgents.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('agents')}
                    className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                      activeTab === 'agents'
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    Agentes del Equipo ({agencyLinkedAgents.length})
                  </button>
                )}
              </div>

              {/* Sub-tabla 1: Compras / Pólizas */}
              {activeTab === 'purchases' && (
                <div className="p-4 space-y-4">
                  {/* Agency Agent Filter Toolbar */}
                  {agencyLinkedAgents.length > 0 && (
                    <div className="p-3 bg-violet-50/60 border border-violet-100 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-black text-violet-950 flex items-center gap-1.5">
                          <Filter className="w-3.5 h-3.5 text-violet-600" />
                          Filtrar cartera por Agente de la Agencia:
                        </span>
                        {selectedAgentFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => setSelectedAgentFilter('all')}
                            className="text-xs text-violet-600 hover:text-violet-800 font-bold underline cursor-pointer"
                          >
                            Mostrar todos ({entityInsurances.length})
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setSelectedAgentFilter('all')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            selectedAgentFilter === 'all'
                              ? 'bg-violet-600 text-white shadow-xs'
                              : 'bg-white hover:bg-gray-100 text-gray-700 border border-violet-200'
                          }`}
                        >
                          Todos los Agentes ({entityInsurances.length})
                        </button>
                        {agencyLinkedAgents.map((ag: any, idx: number) => {
                          const agEmail = (ag.email || '').toLowerCase();
                          const agCount = entityInsurances.filter(ins => 
                            (agEmail && ins.linkedAgentId?.toLowerCase() === agEmail) || 
                            ins.linkedAgentId === ag.id
                          ).length;
                          const isSelected = selectedAgentFilter.toLowerCase() === (ag.email || ag.id || '').toLowerCase();
                          return (
                            <button
                              key={ag.id ? `ag-filter-${ag.id}-${idx}` : `ag-filter-${ag.email || idx}-${idx}`}
                              type="button"
                              onClick={() => setSelectedAgentFilter(ag.email || ag.id)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                                isSelected
                                  ? 'bg-violet-600 text-white shadow-xs'
                                  : 'bg-white hover:bg-gray-100 text-gray-700 border border-violet-200'
                              }`}
                            >
                              <span>{ag.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                                isSelected ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-800'
                              }`}>
                                {agCount}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Póliza / Folio</th>
                          {agencyLinkedAgents.length > 0 && (
                            <th className="p-3">Agente Asignado</th>
                          )}
                          <th className="p-3">Asegurado</th>
                          <th className="p-3">Fechas & Vigencia</th>
                          <th className="p-3">Plan</th>
                          <th className="p-3">Tipo de Póliza</th>
                          <th className="p-3 text-right">Precio USD</th>
                          {selectedClient.type === 'Agent' && (
                            <th className="p-3 text-right">Comisión Agente</th>
                          )}
                          <th className="p-3 text-center">Estado Pago</th>
                          <th className="p-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {displayedInsurances.map((ins, idx) => {
                          const sale = ins.totalFinal !== undefined && ins.totalFinal !== null 
                            ? Number(ins.totalFinal) 
                            : Number(ins.totalPrice || 0);
                          const polInfo = resolvePolicyFolioAndType(ins, policies);
                          const subAgent = agencyLinkedAgents.find(la => 
                            la.id === ins.linkedAgentId || (la.email && ins.linkedAgentId && la.email.toLowerCase() === ins.linkedAgentId.toLowerCase())
                          );

                          return (
                            <tr key={ins.id ? `ins-${ins.id}-${idx}` : `ins-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                              <td className="p-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono font-bold text-gray-900 bg-gray-100 border border-gray-200/90 px-2 py-0.5 rounded text-[11px] tracking-tight">
                                    {polInfo.folio}
                                  </span>
                                  {ins.actionType && (
                                    <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 px-1 py-0.2 rounded">
                                      {ins.actionType}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {agencyLinkedAgents.length > 0 && (
                                <td className="p-3">
                                  {subAgent ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-violet-50 text-violet-700 border border-violet-200">
                                      <Users className="w-3 h-3 text-violet-500" />
                                      <span className="truncate max-w-[120px]">{subAgent.name}</span>
                                    </span>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-gray-500">
                                      Venta Directa
                                    </span>
                                  )}
                                </td>
                              )}
                              <td className="p-3">
                                <span className="font-bold text-gray-800 block">{ins.firstName} {ins.lastName}</span>
                                <span className="block text-[10px] text-gray-400 truncate max-w-[180px]">{ins.email}</span>
                              </td>
                              <td className="p-3 text-gray-600">
                                <div className="font-medium">
                                  {formatDisplayDate(ins.startDate)} → {formatDisplayDate(ins.endDate)}
                                </div>
                                <span className="block text-[10px] text-gray-400 font-bold">{ins.days || 0} días de cobertura</span>
                              </td>
                              <td className="p-3 text-gray-700 font-medium">
                                <span className="inline-block px-2.5 py-0.5 rounded-md bg-slate-100 font-bold text-slate-800 text-[11px]">
                                  {polInfo.plan}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                                  polInfo.tipoPoliza.toLowerCase().includes('oro') 
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                    : polInfo.tipoPoliza.toLowerCase().includes('plata')
                                    ? 'bg-slate-100 text-slate-700 border border-slate-300/80'
                                    : polInfo.tipoPoliza.toLowerCase().includes('platino') || polInfo.tipoPoliza.toLowerCase().includes('platinum')
                                    ? 'bg-purple-50 text-purple-800 border border-purple-200/80'
                                    : 'bg-orange-50 text-orange-800 border border-orange-200/80'
                                }`}>
                                  <ShieldCheck className="w-3 h-3 shrink-0" />
                                  <span>{polInfo.tipoPoliza}</span>
                                </span>
                              </td>
                              <td className="p-3 text-right font-black text-gray-900">
                                ${sale.toFixed(2)} USD
                              </td>
                              {selectedClient.type === 'Agent' && (
                                <td className="p-3 text-right font-black text-purple-700">
                                  ${Number(ins.agentCommission || 0).toFixed(2)} USD
                                </td>
                              )}
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  ins.status === 'paid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                  ins.status === 'partially_paid' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                  ins.status === 'cancelled' ? 'bg-red-50 text-red-700 border border-red-200' :
                                  'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {ins.status === 'paid' ? 'Pagado' :
                                   ins.status === 'partially_paid' ? 'Parcial' :
                                   ins.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedInsuranceForDetail(ins)}
                                    className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl border border-blue-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                    title="Ver Detalle de la Póliza (Solo Lectura)"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Detalle</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReprintPolicy(ins)}
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl border border-indigo-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                    title="Reimprimir Póliza / Generar PDF"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                    <span>Reimprimir</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedInsuranceForEmail(ins)}
                                    className="p-1.5 bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-xl border border-slate-200 transition-colors inline-flex items-center justify-center cursor-pointer"
                                    title="Enviar por Correo Electrónico"
                                  >
                                    <Mail className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedInsuranceForWhatsApp(ins)}
                                    className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200 transition-colors inline-flex items-center justify-center cursor-pointer"
                                    title="Enviar por WhatsApp"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {displayedInsurances.length === 0 && (
                          <tr>
                            <td colSpan={selectedClient.type === 'Agent' ? (agencyLinkedAgents.length > 0 ? 10 : 9) : (agencyLinkedAgents.length > 0 ? 9 : 8)} className="text-center py-8 text-gray-400">
                              {selectedAgentFilter !== 'all' 
                                ? 'No se encontraron pólizas registradas para este agente específico.'
                                : `Este ${selectedClient.type === 'Agent' ? 'agente' : 'corporativo'} no tiene pólizas registradas aún.`}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-tabla 2: Historial de Pagos */}
              {activeTab === 'payments' && (
                <div className="p-4 space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Póliza / Folio</th>
                          <th className="p-3">Fecha de Pago</th>
                          <th className="p-3 text-right">Monto USD</th>
                          <th className="p-3 text-right">Monto MXN</th>
                          <th className="p-3">Método de Pago</th>
                          <th className="p-3">Referencia / Comprobante</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {entityPayments.map((p, idx) => {
                          const linkedIns = insurances.find(i => i.id === p.insuranceId);
                          const polInfo = linkedIns ? resolvePolicyFolioAndType(linkedIns, policies) : null;
                          const folioDisplay = polInfo?.folio || p.insuranceId?.substring(0, 8) || 'N/A';

                          return (
                            <tr key={p.id ? `pmt-${p.id}-${idx}` : `pmt-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                              <td className="p-3 font-mono font-bold text-gray-800">
                                <span className="bg-gray-100 border border-gray-200/90 px-2 py-0.5 rounded text-[11px] tracking-tight">
                                  {folioDisplay}
                                </span>
                              </td>
                              <td className="p-3 text-gray-600">
                                {formatDisplayDate(p.date || p.createdAt)}
                              </td>
                              <td className="p-3 text-right font-black text-emerald-700">
                                ${Number(p.amount || 0).toFixed(2)} USD
                              </td>
                              <td className="p-3 text-right font-medium text-gray-600">
                                {p.amountMXP ? `$${Number(p.amountMXP).toLocaleString(undefined, { minimumFractionDigits: 2 })} MXN` : '-'}
                              </td>
                              <td className="p-3 text-gray-700">
                                <span className="px-2 py-0.5 rounded bg-gray-100 font-bold uppercase text-[10px]">
                                  {p.paymentMethod || 'Stripe'}
                                </span>
                              </td>
                              <td className="p-3 text-gray-500 font-mono text-[11px]">
                                {p.receiptNumber || p.receiptUrl || p.notes || 'Comprobante interno'}
                              </td>
                            </tr>
                          );
                        })}
                        {entityPayments.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-gray-400">
                              No hay pagos registrados para este {selectedClient.type === 'Agent' ? 'agente' : 'corporativo'}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sub-tabla 3: Comisiones */}
              {activeTab === 'commissions' && (
                <div className="p-4 space-y-4">
                  <div className="p-3 bg-purple-50/60 rounded-2xl border border-purple-100 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="text-xs font-black text-purple-900 uppercase">Resumen de Comisiones</span>
                      <p className="text-[11px] text-purple-700">Liquidación y corte de comisiones acumuladas por emisión de pólizas.</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-purple-600 font-bold">Total Generado:</span>
                      <span className="ml-2 text-base font-black text-purple-900">${entityMetrics.totalCommissions.toFixed(2)} USD</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-3">Póliza / Folio</th>
                          <th className="p-3">Asegurado</th>
                          <th className="p-3">Plan & Tipo de Póliza</th>
                          <th className="p-3 text-right">Prima USD</th>
                          <th className="p-3 text-right">% Com.</th>
                          <th className="p-3 text-right">Comisión USD</th>
                          <th className="p-3 text-center">Estado Comisión</th>
                          <th className="p-3 text-center">Comprobante</th>
                          <th className="p-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {entityInsurances.map((ins, idx) => {
                          const sale = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
                          const comm = Number(ins.agentCommission || 0);
                          const rate = sale > 0 ? ((comm / sale) * 100).toFixed(1) : (selectedClient.commission || 0);
                          const polInfo = resolvePolicyFolioAndType(ins, policies);

                          return (
                            <tr key={ins.id ? `comm-${ins.id}-${idx}` : `comm-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                              <td className="p-3 font-mono font-bold text-gray-900">
                                <span className="bg-gray-100 border border-gray-200/90 px-2 py-0.5 rounded text-[11px] tracking-tight">
                                  {polInfo.folio}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className="font-bold text-gray-800 block">{ins.firstName} {ins.lastName}</span>
                                <span className="text-[10px] text-gray-400 block">{ins.email}</span>
                              </td>
                              <td className="p-3">
                                <span className="font-bold text-gray-800">{polInfo.plan}</span>
                                <span className="block text-[10px] text-gray-500 font-medium">{polInfo.tipoPoliza}</span>
                              </td>
                              <td className="p-3 text-right font-medium text-gray-700">
                                ${sale.toFixed(2)} USD
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-purple-700">
                                {rate}%
                              </td>
                              <td className="p-3 text-right font-black text-purple-900">
                                ${comm.toFixed(2)} USD
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  ins.commissionStatus === 'paid'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {ins.commissionStatus === 'paid' ? 'Pagada' : 'Por Pagar'}
                                </span>
                              </td>
                              <td className="p-3 text-center">
                                {ins.commissionPaymentReceipt ? (
                                  <a 
                                    href={ins.commissionPaymentReceipt} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 hover:text-purple-800 hover:underline"
                                  >
                                    <FileText className="w-3 h-3" />
                                    <span>Comprobante</span>
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-gray-400">
                                    {ins.commissionPaymentDate ? formatDisplayDate(ins.commissionPaymentDate) : 'Pendiente'}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedInsuranceForDetail(ins)}
                                  className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                  Revisar póliza
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {entityInsurances.length === 0 && (
                          <tr>
                            <td colSpan={9} className="text-center py-8 text-gray-400">
                              No hay comisiones registradas para este agente.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Agency Subagents Commission Summary Breakdown */}
                  {agencyLinkedAgents.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h5 className="text-xs font-black text-gray-900 uppercase flex items-center gap-1.5">
                            <Award className="w-4 h-4 text-purple-600" />
                            Desglose de Comisiones por Agente de la Agencia
                          </h5>
                          <p className="text-[11px] text-gray-500">Resumen consolidado de comisiones generadas por cada agente vinculado.</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-purple-50/60 text-purple-900 font-bold uppercase text-[10px]">
                            <tr>
                              <th className="p-3">Agente</th>
                              <th className="p-3">Email</th>
                              <th className="p-3 text-right">% Comisión</th>
                              <th className="p-3 text-center">Pólizas</th>
                              <th className="p-3 text-right">Volumen USD</th>
                              <th className="p-3 text-right">Comisión Total</th>
                              <th className="p-3 text-right">Pagada</th>
                              <th className="p-3 text-right">Pendiente</th>
                              <th className="p-3 text-right">Acción</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {agentsMetrics.map((ag: any, idx: number) => (
                              <tr key={ag.id ? `comm-ag-${ag.id}-${idx}` : `comm-ag-${ag.email}-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                                <td className="p-3 font-bold text-gray-900">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center shrink-0">
                                      {ag.name ? ag.name.charAt(0).toUpperCase() : 'A'}
                                    </div>
                                    <span>{ag.name}</span>
                                  </div>
                                </td>
                                <td className="p-3 text-gray-500 font-mono text-[11px]">
                                  {ag.email}
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-purple-700">
                                  {ag.commission}%
                                </td>
                                <td className="p-3 text-center">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                    {ag.policiesCount}
                                  </span>
                                </td>
                                <td className="p-3 text-right font-black text-gray-900">
                                  ${ag.totalSales.toFixed(2)} USD
                                </td>
                                <td className="p-3 text-right font-black text-purple-900">
                                  ${ag.totalCommissions.toFixed(2)} USD
                                </td>
                                <td className="p-3 text-right font-bold text-emerald-700">
                                  ${ag.paidCommissions.toFixed(2)} USD
                                </td>
                                <td className="p-3 text-right font-bold text-amber-700">
                                  ${ag.pendingCommissions.toFixed(2)} USD
                                </td>
                                <td className="p-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedAgentFilter(ag.email || ag.id);
                                      setActiveTab('purchases');
                                    }}
                                    className="px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                  >
                                    Ver Pólizas
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tabla 4: Agentes del Equipo (Exclusivo para la Agencia y su Contacto Principal) */}
              {activeTab === 'agents' && (
                <div className="p-4 space-y-5">
                  {/* Agency Header Banner */}
                  <div className="p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-violet-950 text-white rounded-3xl border border-indigo-900/50 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white font-black text-xl shrink-0">
                        <Users className="w-6 h-6 text-indigo-300" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-black uppercase tracking-wider bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 px-2.5 py-0.5 rounded-full">
                            Equipo Comercial de la Agencia
                          </span>
                          <h4 className="text-lg font-black text-white">
                            {selectedClient.commercialName || selectedClient.legalName}
                          </h4>
                          {isMainContact && (
                            <span className="text-[10px] bg-amber-400 text-amber-950 font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-xs">
                              <Award className="w-3 h-3" />
                              Vista Contacto Principal
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-indigo-200/80 mt-1 max-w-2xl">
                          Contacto Principal: <span className="font-bold text-white">{selectedClient.mainContact || selectedClient.email || 'Director de Agencia'}</span>
                          {selectedClient.email && <span className="text-indigo-300/80 ml-2">({selectedClient.email})</span>}
                          {selectedClient.phone && <span className="text-indigo-300/80 ml-2">• Tel: {selectedClient.phone}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-200 bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
                        {agencyLinkedAgents.length} Agentes Vinculados
                      </span>
                    </div>
                  </div>

                  {/* Team Micro KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-3.5">
                      <span className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">Agentes Activos</span>
                      <p className="text-xl font-black text-indigo-950 mt-1">{agencyLinkedAgents.length}</p>
                      <span className="text-[11px] text-indigo-600 font-medium">En plantilla</span>
                    </div>
                    <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-3.5">
                      <span className="text-[10px] font-black uppercase text-blue-700 tracking-wider">Pólizas del Equipo</span>
                      <p className="text-xl font-black text-blue-950 mt-1">{teamMetrics.totalPolicies}</p>
                      <span className="text-[11px] text-blue-600 font-medium">Colocadas por agentes</span>
                    </div>
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5">
                      <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Ventas del Equipo</span>
                      <p className="text-xl font-black text-emerald-950 mt-1">${teamMetrics.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs">USD</span></p>
                      <span className="text-[11px] text-emerald-600 font-medium">Prima total</span>
                    </div>
                    <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-3.5">
                      <span className="text-[10px] font-black uppercase text-purple-700 tracking-wider">Comisiones del Equipo</span>
                      <p className="text-xl font-black text-purple-950 mt-1">${teamMetrics.totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs">USD</span></p>
                      <span className="text-[11px] text-purple-600 font-medium">Generadas por agentes</span>
                    </div>
                  </div>

                  {/* Search and Filter */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Buscar agente por nombre, email o teléfono..."
                        value={agentSearchTerm}
                        onChange={(e) => setAgentSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-500 shrink-0 self-center">
                      Mostrando {filteredAgents.length} de {agencyLinkedAgents.length} agentes
                    </span>
                  </div>

                  {/* Agents List Table */}
                  <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-600 font-bold uppercase text-[10px] border-b border-gray-200">
                        <tr>
                          <th className="p-3">Agente</th>
                          <th className="p-3">Contacto</th>
                          <th className="p-3 text-right">Comisión %</th>
                          <th className="p-3 text-right">Descuento %</th>
                          <th className="p-3 text-center">Pólizas Vendidas</th>
                          <th className="p-3 text-right">Volumen USD</th>
                          <th className="p-3 text-right">Comisión USD</th>
                          <th className="p-3 text-center">Estado</th>
                          <th className="p-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredAgents.map((ag: any, idx: number) => (
                          <tr key={ag.id ? `agent-row-${ag.id}-${idx}` : `agent-row-${ag.email}-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                                  {ag.name ? ag.name.charAt(0).toUpperCase() : 'A'}
                                </div>
                                <div>
                                  <span className="font-bold text-gray-900 block text-xs">{ag.name}</span>
                                  <span className="text-[10px] text-gray-400 font-mono">ID: {ag.id ? ag.id.substring(0, 10) : `AG-${idx + 1}`}</span>
                                </div>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="space-y-0.5">
                                {ag.email && (
                                  <a href={`mailto:${ag.email}`} className="text-gray-700 hover:text-blue-600 flex items-center gap-1 font-medium truncate max-w-[200px]">
                                    <Mail className="w-3 h-3 text-gray-400 shrink-0" />
                                    <span>{ag.email}</span>
                                  </a>
                                )}
                                {ag.phone && (
                                  <a href={`tel:${ag.phone}`} className="text-gray-500 hover:text-green-600 flex items-center gap-1 text-[11px]">
                                    <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                                    <span>{ag.phone}</span>
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono font-black text-purple-700">
                              {ag.commission}%
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-indigo-700">
                              {ag.discountPercentage || 0}%
                            </td>
                            <td className="p-3 text-center">
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                {ag.policiesCount} pólizas
                              </span>
                            </td>
                            <td className="p-3 text-right font-black text-gray-900">
                              ${ag.totalSales.toFixed(2)} USD
                            </td>
                            <td className="p-3 text-right font-black text-purple-900">
                              ${ag.totalCommissions.toFixed(2)} USD
                            </td>
                            <td className="p-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Activo
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedAgentFilter(ag.email || ag.id);
                                    setActiveTab('purchases');
                                  }}
                                  className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                  title="Ver pólizas emitidas por este agente"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Pólizas</span>
                                </button>
                                {isRealSuperAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setImpersonatedAgent({
                                        uid: ag.id || ag.email,
                                        clientId: selectedClient.id,
                                        email: ag.email || '',
                                        displayName: ag.name || 'Agente',
                                        commission: Number(ag.commission || 0),
                                        canCreatePolicies: true,
                                        linkedAgents: [],
                                      });
                                    }}
                                    className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                                    title="Simular vista de este subagente"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Simular</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredAgents.length === 0 && (
                          <tr>
                            <td colSpan={9} className="text-center py-10 text-gray-400">
                              {agencyLinkedAgents.length === 0
                                ? 'Esta agencia aún no cuenta con subagentes vinculados registrados en su expediente.'
                                : 'No se encontraron agentes con ese criterio de búsqueda.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-gray-400 space-y-2">
            <Users className="w-12 h-12 text-gray-300 mx-auto" />
            <p className="text-sm font-semibold">Selecciona un agente o socio corporativo arriba para ver su expediente 360°</p>
          </div>
        )}
      </div>

      {/* Modal para Revisar la Póliza (Solo Lectura) */}
      <InsuranceDetailModal 
        isOpen={!!selectedInsuranceForDetail}
        onClose={() => setSelectedInsuranceForDetail(null)}
        insurance={selectedInsuranceForDetail}
        readOnly={true}
      />

      {/* Modal para Ver Ficha Completa del Cliente */}
      <ClientDetailModal
        isOpen={isClientDetailOpen}
        onClose={() => setIsClientDetailOpen(false)}
        client={selectedClient}
      />

      {/* Modal para Enviar Póliza por Correo */}
      <EmailModal
        isOpen={!!selectedInsuranceForEmail}
        onClose={() => setSelectedInsuranceForEmail(null)}
        insurance={selectedInsuranceForEmail}
        policies={policies}
        policyLetters={policyLetters}
        companySettings={settings}
      />

      {/* Modal para Enviar Póliza por WhatsApp */}
      {selectedInsuranceForWhatsApp && (
        <WhatsAppPolicyLettersModal
          isOpen={!!selectedInsuranceForWhatsApp}
          onClose={() => setSelectedInsuranceForWhatsApp(null)}
          insurance={selectedInsuranceForWhatsApp}
          policies={policies}
          policyLetters={policyLetters}
          clients={clients}
          users={users}
          companySettings={settings}
        />
      )}

      {/* Modal para Selección de Idioma al Reimprimir Póliza */}
      {reprintModal.isOpen && reprintModal.insurance && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-gray-900">Reimprimir Póliza</h3>
              </div>
              <button 
                type="button"
                onClick={() => setReprintModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3">
              <p className="text-xs text-gray-500 font-medium">
                Selecciona el idioma de la carta/póliza a reimprimir para <strong>{reprintModal.insurance.firstName} {reprintModal.insurance.lastName}</strong>:
              </p>
              <div className="space-y-2">
                {reprintModal.availableLetters.map(letter => {
                  const isChecked = reprintModal.selectedLanguages.includes(letter.language);
                  const label = letter.language === 'es' ? 'Español' :
                    letter.language === 'en' ? 'Inglés' :
                    letter.language === 'es_spain' ? 'España' :
                    letter.language === 'embajada_spain' ? 'Embajada España' :
                    letter.language === 'covid' ? 'Coronavirus' :
                    letter.language === 'policy' ? 'Policy (Póliza)' :
                    letter.language.toUpperCase();
                  return (
                    <label 
                      key={letter.id || letter.language}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                        isChecked ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span>{label}</span>
                      <input 
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setReprintModal(prev => ({
                            ...prev,
                            selectedLanguages: isChecked 
                              ? prev.selectedLanguages.filter(l => l !== letter.language)
                              : [...prev.selectedLanguages, letter.language]
                          }));
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReprintModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reprintModal.selectedLanguages.length === 0}
                onClick={handleConfirmReprint}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Generar e Imprimir</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
