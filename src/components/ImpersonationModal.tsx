import React, { useState, useMemo } from 'react';
import { Search, Users, X, Eye, ShieldCheck, Check, Sparkles, Building2, ArrowRight } from 'lucide-react';
import { useFirestoreData } from '../context/FirestoreDataContext';

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentImpersonation: {
    uid?: string;
    email: string;
    displayName: string;
    commission?: number;
    clientId?: string;
    canCreatePolicies?: boolean;
    linkedAgents?: any[];
  } | null;
  onSelectAgent: (agent: {
    uid?: string;
    email: string;
    displayName: string;
    commission?: number;
    clientId?: string;
    canCreatePolicies?: boolean;
    linkedAgents?: any[];
  } | null) => void;
}

export default function ImpersonationModal({
  isOpen,
  onClose,
  currentImpersonation,
  onSelectAgent,
}: ImpersonationModalProps) {
  const { clients, users } = useFirestoreData();
  const [searchTerm, setSearchTerm] = useState('');

  // Extract all distinct agents from both clients and users collections
  const availableAgents = useMemo(() => {
    const list: Array<{
      uid?: string;
      clientId?: string;
      email: string;
      displayName: string;
      type: 'Agent' | 'Corporate' | 'User';
      commission: number;
      phone?: string;
      subagentsCount?: number;
      linkedAgents?: any[];
    }> = [];

    const seenEmails = new Set<string>();

    // 1. From clients collection (Agents & Corporates)
    clients.forEach((c) => {
      if ((c.type === 'Agent' || c.type === 'Corporate') && c.email) {
        const emailLower = c.email.trim().toLowerCase();
        if (!seenEmails.has(emailLower)) {
          seenEmails.add(emailLower);
          list.push({
            clientId: c.id,
            uid: c.id,
            email: emailLower,
            displayName: c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email,
            type: c.type,
            commission: Number(c.commission || 0),
            phone: c.phone,
            subagentsCount: c.linkedAgents?.length || 0,
            linkedAgents: c.linkedAgents || [],
          });
        }
      }
    });

    // 2. From users collection (where role === 'agent')
    users.forEach((u) => {
      if (u.role === 'agent' && u.email) {
        const emailLower = u.email.trim().toLowerCase();
        if (!seenEmails.has(emailLower)) {
          seenEmails.add(emailLower);
          list.push({
            uid: u.uid || (u as any).id,
            email: emailLower,
            displayName: u.displayName || u.email,
            type: 'User',
            commission: Number(u.commission || 0),
            subagentsCount: 0,
            linkedAgents: [],
          });
        }
      }
    });

    return list.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
  }, [clients, users]);

  // Filtered agents by search term
  const filteredAgents = useMemo(() => {
    if (!searchTerm.trim()) return availableAgents;
    const q = searchTerm.trim().toLowerCase();
    return availableAgents.filter(
      (a) =>
        a.displayName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.phone && a.phone.includes(q))
    );
  }, [availableAgents, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-gray-100">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-violet-900 via-indigo-900 to-slate-900 text-white p-6 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 text-violet-300 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="p-3 bg-violet-600/40 border border-violet-400/30 rounded-2xl">
              <Eye className="w-6 h-6 text-violet-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black">Vista como Agente</h3>
                <span className="text-[10px] bg-violet-400/20 border border-violet-400/40 text-violet-200 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                  Super_Admin
                </span>
              </div>
              <p className="text-xs text-violet-200/80 mt-1">
                Selecciona cualquier agente del sistema para ver y experimentar la plataforma exactamente como él la ve.
              </p>
            </div>
          </div>

          {/* Currently Impersonating Notice */}
          {currentImpersonation && (
            <div className="mt-4 p-3 bg-white/10 rounded-2xl border border-white/20 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>
                  Actualmente viendo como: <strong>{currentImpersonation.displayName}</strong> ({currentImpersonation.email})
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onSelectAgent(null);
                  onClose();
                }}
                className="px-3 py-1 bg-white text-gray-900 rounded-xl font-bold text-xs hover:bg-gray-100 transition-colors cursor-pointer shrink-0"
              >
                Restablecer a Super_Admin
              </button>
            </div>
          )}
        </div>

        {/* Quick Demo Option & Search Bar */}
        <div className="p-5 border-b border-gray-100 space-y-3 bg-gray-50/60">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-bold text-gray-500 uppercase">Seleccionar Agente</span>
            <button
              type="button"
              onClick={() => {
                onSelectAgent({
                  email: 'agente.demo@miseguro.com',
                  displayName: 'Agente Demo Internacional',
                  uid: 'demo-agent-uid',
                  commission: 15,
                  clientId: 'demo-client-id',
                  canCreatePolicies: true,
                });
                onClose();
              }}
              className="text-xs font-bold text-violet-600 hover:text-violet-800 flex items-center gap-1.5 px-3 py-1 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors cursor-pointer border border-violet-200/60"
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-600" />
              <span>Simular Agente de Prueba</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar agente por nombre, agencia o correo electrónico..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-2xl text-xs font-semibold focus:ring-2 focus:ring-violet-500 outline-none transition-all shadow-xs"
              autoFocus
            />
          </div>
        </div>

        {/* Agents List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 divide-y divide-gray-50">
          {filteredAgents.length > 0 ? (
            filteredAgents.map((ag, idx) => {
              const isSelected = currentImpersonation?.email.toLowerCase() === ag.email.toLowerCase();
              return (
                <div
                  key={ag.clientId ? `ag-${ag.clientId}-${idx}` : `ag-${ag.email}-${idx}`}
                  className={`pt-2.5 flex items-center justify-between gap-4 p-3 rounded-2xl transition-all ${
                    isSelected
                      ? 'bg-violet-50 border border-violet-200'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                        ag.type === 'Corporate'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {ag.type === 'Corporate' ? (
                        <Building2 className="w-5 h-5" />
                      ) : (
                        <Users className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900 truncate">{ag.displayName}</p>
                        <span
                          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            ag.type === 'Corporate'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {ag.type === 'Corporate' ? 'Corporativo' : 'Agente'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{ag.email}</p>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
                        <span className="font-semibold text-purple-700">Comisión: {ag.commission}%</span>
                        {ag.subagentsCount > 0 && (
                          <span>• {ag.subagentsCount} subagentes</span>
                        )}
                        {ag.phone && <span>• Tel: {ag.phone}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isSelected ? (
                      <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        Activo
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAgent({
                            uid: ag.uid || ag.clientId,
                            clientId: ag.clientId,
                            email: ag.email,
                            displayName: ag.displayName,
                            commission: ag.commission,
                            canCreatePolicies: true,
                            linkedAgents: (ag as any).linkedAgents || [],
                          });
                          onClose();
                        }}
                        className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer hover:scale-105 active:scale-95"
                      >
                        <span>Ver como este Agente</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-gray-400 text-xs">
              No se encontraron agentes registrados que coincidan con "{searchTerm}".
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>Esta simulación es temporal y no modifica la base de datos ni los permisos reales de tu cuenta.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
