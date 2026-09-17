import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Client, Policy, InsuranceRequest } from '../types';
import { Search, Users, ShieldCheck, FileText, X, Loader2, ChevronRight, User, Calendar, Mail, Tag } from 'lucide-react';
import InsuranceDetailModal from './InsuranceDetailModal';
import { getInsuranceDisplayStatus } from '../utils/paymentUtils';

export default function HeaderSearch() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'clients' | 'policies' | 'insurances'>('all');

  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [policyResults, setPolicyResults] = useState<Policy[]>([]);
  const [insuranceResults, setInsuranceResults] = useState<InsuranceRequest[]>([]);

  const [selectedInsurance, setSelectedInsurance] = useState<InsuranceRequest | null>(null);
  const [isInsuranceModalOpen, setIsInsuranceModalOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut (Cmd/Ctrl + K or /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search using Firestore queries across clients, policies, and insurances
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setClientResults([]);
      setPolicyResults([]);
      setInsuranceResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setIsOpen(true);

    const timer = setTimeout(async () => {
      try {
        // Execute Firestore queries across the three collections
        const clientsRef = collection(db, 'clients');
        const policiesRef = collection(db, 'policies');
        const insurancesRef = collection(db, 'insurances');

        let clientsData: Client[] = [];
        let policiesData: Policy[] = [];
        let insurancesData: InsuranceRequest[] = [];

        // 1. Fetch & Query Clients from Firestore
        try {
          const clientSnap = await getDocs(query(clientsRef, limit(100)));
          const allClients = clientSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
          clientsData = allClients.filter(c => {
            const fullName = `${c.firstName || ''} ${c.lastName || ''} ${c.legalName || ''} ${c.commercialName || ''}`.toLowerCase();
            const email = (c.email || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const rfc = (c.rfc || '').toLowerCase();
            const contact = (c.mainContact || '').toLowerCase();
            return fullName.includes(term) || email.includes(term) || phone.includes(term) || rfc.includes(term) || contact.includes(term);
          }).slice(0, 8);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'clients');
        }

        // 2. Fetch & Query Policies from Firestore
        try {
          const policySnap = await getDocs(query(policiesRef, limit(100)));
          const allPolicies = policySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy));
          policiesData = allPolicies.filter(p => {
            const name = (p.name || '').toLowerCase();
            const plan = (p.plan || '').toLowerCase();
            const nomPol = (p.NombrePoliza || '').toLowerCase();
            const codPol = (p.CodigoPoliza || '').toLowerCase();
            const email = (p.E_Mail_Address || '').toLowerCase();
            return name.includes(term) || plan.includes(term) || nomPol.includes(term) || codPol.includes(term) || email.includes(term);
          }).slice(0, 8);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'policies');
        }

        // 3. Fetch & Query Insurances from Firestore
        try {
          // If term looks like a direct IDseg or email, also try targeted query
          const insuranceSnap = await getDocs(query(insurancesRef, limit(150)));
          const allInsurances = insuranceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
          insurancesData = allInsurances.filter(i => {
            const idseg = (i.IDseg || '').toLowerCase();
            const polNum = (i.policyNumber || '').toLowerCase();
            const name = `${i.firstName || ''} ${i.lastName || ''}`.toLowerCase();
            const email = (i.email || '').toLowerCase();
            const caremed = (i.Caremed || '').toLowerCase();
            const invoice = (i.InvoiceCaremed || '').toLowerCase();
            const polName = (i.policyName || '').toLowerCase();
            const plan = (i.plan || '').toLowerCase();
            const phone = (i.phone || '').toLowerCase();
            return idseg.includes(term) || polNum.includes(term) || name.includes(term) || email.includes(term) || caremed.includes(term) || invoice.includes(term) || polName.includes(term) || plan.includes(term) || phone.includes(term);
          }).slice(0, 8);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'insurances');
        }

        setClientResults(clientsData);
        setPolicyResults(policiesData);
        setInsuranceResults(insurancesData);
      } catch (err) {
        console.error('Error during global Firestore search:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const totalResults = clientResults.length + policyResults.length + insuranceResults.length;

  const handleSelectClient = (client: Client) => {
    setIsOpen(false);
    const searchVal = client.firstName ? `${client.firstName} ${client.lastName || ''}` : (client.legalName || client.email || '');
    navigate(`/clients?search=${encodeURIComponent(searchVal.trim())}`);
  };

  const handleSelectPolicy = (policy: Policy) => {
    setIsOpen(false);
    navigate(`/insurance-plans`);
  };

  const handleSelectInsurance = (insurance: InsuranceRequest) => {
    setIsOpen(false);
    setSelectedInsurance(insurance);
    setIsInsuranceModalOpen(true);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      {/* Search Input Box */}
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => {
            if (searchTerm.trim()) setIsOpen(true);
          }}
          placeholder="Buscar clientes, pólizas o certificados en Firestore..."
          className="w-full pl-10 pr-20 py-2.5 bg-gray-100/80 hover:bg-gray-100 focus:bg-white text-gray-900 placeholder-gray-400 text-xs sm:text-sm font-medium rounded-xl border border-transparent focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 outline-none"
        />
        <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none">
          {loading ? (
            <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
          ) : searchTerm ? (
            <button
              onClick={() => {
                setSearchTerm('');
                setIsOpen(false);
              }}
              className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 pointer-events-auto transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-gray-400 bg-gray-200/60 rounded-md border border-gray-300/40">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {/* Results Overlay Popover */}
      {isOpen && searchTerm.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[80vh] flex flex-col">
          {/* Tabs header */}
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-2 overflow-x-auto text-xs font-bold text-gray-600">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  activeTab === 'all' ? 'bg-blue-600 text-white shadow-xs' : 'hover:bg-gray-200/60 text-gray-600'
                }`}
              >
                Todos ({totalResults})
              </button>
              <button
                onClick={() => setActiveTab('clients')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                  activeTab === 'clients' ? 'bg-violet-600 text-white shadow-xs' : 'hover:bg-gray-200/60 text-gray-600'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Clientes ({clientResults.length})
              </button>
              <button
                onClick={() => setActiveTab('policies')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                  activeTab === 'policies' ? 'bg-amber-600 text-white shadow-xs' : 'hover:bg-gray-200/60 text-gray-600'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Pólizas ({policyResults.length})
              </button>
              <button
                onClick={() => setActiveTab('insurances')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                  activeTab === 'insurances' ? 'bg-emerald-600 text-white shadow-xs' : 'hover:bg-gray-200/60 text-gray-600'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Seguros ({insuranceResults.length})
              </button>
            </div>
            <span className="text-[10px] text-gray-400 shrink-0 font-normal">Firestore Live</span>
          </div>

          {/* Results list body */}
          <div className="p-2 overflow-y-auto space-y-4">
            {loading ? (
              <div className="py-12 text-center text-gray-400 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                <p className="text-xs font-medium">Buscando en Firestore...</p>
              </div>
            ) : totalResults === 0 ? (
              <div className="py-10 text-center text-gray-400">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-30 text-gray-400" />
                <p className="text-xs font-bold text-gray-600">No se encontraron resultados</p>
                <p className="text-[11px] text-gray-400 mt-1">Prueba buscando por nombre, email, IDseg o número de póliza</p>
              </div>
            ) : (
              <>
                {/* CLIENTS SECTION */}
                {(activeTab === 'all' || activeTab === 'clients') && clientResults.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-violet-700 bg-violet-50/70 rounded-lg flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" /> Clientes
                      </span>
                      <span className="bg-violet-200 text-violet-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">
                        {clientResults.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {clientResults.map((client) => {
                        const displayName = client.firstName 
                          ? `${client.firstName} ${client.lastName || ''}`
                          : (client.legalName || client.commercialName || client.email || 'Cliente sin nombre');
                        return (
                          <div
                            key={client.id || client.email}
                            onClick={() => handleSelectClient(client)}
                            className="p-2.5 hover:bg-violet-50/60 rounded-xl cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-violet-100"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center font-bold text-xs shrink-0">
                                <User className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-gray-900 truncate group-hover:text-violet-700">{displayName}</p>
                                <div className="flex items-center gap-2 text-[11px] text-gray-500 truncate">
                                  {client.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 text-gray-400 shrink-0" /> {client.email}</span>}
                                  {client.phone && <span>• {client.phone}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 text-gray-600">
                                {client.type || 'Cliente'}
                              </span>
                              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* POLICIES SECTION */}
                {(activeTab === 'all' || activeTab === 'policies') && policyResults.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-700 bg-amber-50/70 rounded-lg flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" /> Pólizas
                      </span>
                      <span className="bg-amber-200 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">
                        {policyResults.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {policyResults.map((policy) => (
                        <div
                          key={policy.id || policy.name}
                          onClick={() => handleSelectPolicy(policy)}
                          className="p-2.5 hover:bg-amber-50/60 rounded-xl cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-amber-100"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
                              <ShieldCheck className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate group-hover:text-amber-700">
                                {policy.name} <span className="text-amber-600 font-medium">({policy.plan})</span>
                              </p>
                              <p className="text-[11px] text-gray-500 truncate">
                                Región {policy.region} • ${policy.pricePerDay}/día {policy.deductible ? '• Con Deducible' : '• Sin Deducible'}
                              </p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-amber-600 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* INSURANCES SECTION */}
                {(activeTab === 'all' || activeTab === 'insurances') && insuranceResults.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50/70 rounded-lg flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" /> Seguros / Certificados
                      </span>
                      <span className="bg-emerald-200 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-extrabold">
                        {insuranceResults.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {insuranceResults.map((ins) => {
                        const passenger = `${ins.firstName || ''} ${ins.lastName || ''}`.trim() || ins.email || 'Pasajero';
                        const dStatus = getInsuranceDisplayStatus(ins);
                        const statusColor = dStatus === 'paid' 
                          ? 'bg-emerald-100 text-emerald-700' 
                          : dStatus === 'partially_paid' 
                            ? 'bg-amber-100 text-amber-700' 
                            : 'bg-rose-100 text-rose-700';
                        const statusText = dStatus === 'paid' ? 'Pagado' : dStatus === 'partially_paid' ? 'Parcial' : 'Pendiente';

                        return (
                          <div
                            key={ins.id || ins.IDseg}
                            onClick={() => handleSelectInsurance(ins)}
                            className="p-2.5 hover:bg-emerald-50/60 rounded-xl cursor-pointer transition-colors flex items-center justify-between group border border-transparent hover:border-emerald-100"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-bold text-gray-900 truncate group-hover:text-emerald-700">{passenger}</p>
                                  {ins.IDseg && (
                                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 font-mono text-[10px] font-bold rounded">
                                      {ins.IDseg}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-gray-500 truncate">
                                  {ins.policyName || ins.plan || 'Seguro'} • {ins.startDate} al {ins.endDate} ({ins.days || 1} días)
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${statusColor}`}>
                                {statusText}
                              </span>
                              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Insurance Detail Modal for full insurance view/edit */}
      {isInsuranceModalOpen && selectedInsurance && (
        <InsuranceDetailModal
          isOpen={isInsuranceModalOpen}
          onClose={() => {
            setIsInsuranceModalOpen(false);
            setSelectedInsurance(null);
          }}
          insurance={selectedInsurance}
        />
      )}
    </div>
  );
}
