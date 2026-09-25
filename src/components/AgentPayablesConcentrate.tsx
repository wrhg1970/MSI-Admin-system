import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  DollarSign, 
  ChevronDown, 
  ChevronUp, 
  Search, 
  ExternalLink, 
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  ArrowUpDown,
  Filter,
  FileSpreadsheet
} from 'lucide-react';
import { InsuranceRequest, Client, UserProfile } from '../types';
import { isInsuranceDeudor, getInsurancePaymentBalance } from '../utils/paymentUtils';

interface AgentPayablesConcentrateProps {
  insurances: InsuranceRequest[];
  clients: Client[];
  users: UserProfile[];
  onViewTransactions?: (insuranceId: string) => void;
}

interface AgentPayableRow {
  agentKey: string;
  agentName: string;
  agentEmail?: string;
  agentRole: 'agent' | 'subagent' | 'client_agent' | 'unknown';
  policyCount: number;
  totalVenta: number;
  totalCosto: number;
  totalComision: number;
  comisionPendiente: number;
  saldoDeudorTotal: number;
  policies: InsuranceRequest[];
}

export default function AgentPayablesConcentrate({
  insurances,
  clients,
  users,
  onViewTransactions
}: AgentPayablesConcentrateProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedAgentKey, setExpandedAgentKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'agentName' | 'policyCount' | 'totalVenta' | 'totalCosto' | 'totalComision'>('totalComision');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // Mode: 'commission_pending' (Cuentas por pagar de comisiones) | 'debt_pending' (Cuentas con saldo deudor) | 'all_pending'
  const [filterMode, setFilterMode] = useState<'commission_pending' | 'debt_pending' | 'all_pending'>('commission_pending');

  // Resolve agent info from an insurance
  const resolveAgent = (ins: InsuranceRequest): { key: string; name: string; email?: string; role: 'agent' | 'subagent' | 'client_agent' | 'unknown' } => {
    // 1. Linked sub-agent
    if (ins.linkedAgentId) {
      for (const c of clients) {
        if (c.linkedAgents) {
          const la = c.linkedAgents.find(a => a.id === ins.linkedAgentId || a.email?.toLowerCase() === ins.linkedAgentId?.toLowerCase());
          if (la) {
            const parentName = c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            return {
              key: `subagent_${la.id || la.email}`,
              name: `${la.name || la.email} (${parentName})`,
              email: la.email,
              role: 'subagent'
            };
          }
        }
      }
    }

    // 2. Client of type 'Agent'
    if (ins.clientId) {
      const c = clients.find(cl => cl.id === ins.clientId);
      if (c && c.type === 'Agent') {
        const name = c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
        return {
          key: `client_${c.id}`,
          name: name || 'Agente Registrado',
          email: c.email,
          role: 'client_agent'
        };
      }
    }

    // 3. User with role 'agent' in ins.agentId
    if (ins.agentId) {
      const u = users.find(usr => usr.uid === ins.agentId || usr.email?.toLowerCase() === ins.agentId?.toLowerCase());
      if (u) {
        return {
          key: `user_${u.uid}`,
          name: u.displayName || u.email || 'Asesor / Agente',
          email: u.email,
          role: 'agent'
        };
      }
      const c = clients.find(cl => cl.id === ins.agentId);
      if (c) {
        const name = c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
        return {
          key: `client_${c.id}`,
          name: name || 'Agente Registrado',
          email: c.email,
          role: 'client_agent'
        };
      }
    }

    // 4. Fallback if linkedAgentId is just a string
    if (ins.linkedAgentId) {
      return {
        key: `linked_${ins.linkedAgentId}`,
        name: ins.linkedAgentId,
        role: 'subagent'
      };
    }

    // 5. If clientType is Agent but not mapped to a specific agent document
    if (ins.clientType === 'Agent') {
      if (ins.clientId) {
        const c = clients.find(cl => cl.id === ins.clientId);
        if (c) {
          const name = c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
          return {
            key: `client_${c.id}`,
            name: name || 'Agente Registrado',
            email: c.email,
            role: 'client_agent'
          };
        }
      }
      return {
        key: 'general_agent',
        name: 'Agente / Canal B2B',
        role: 'unknown'
      };
    }

    // 6. Has agent commission assigned
    if (ins.agentCommission && ins.agentCommission > 0) {
      if (ins.clientId) {
        const c = clients.find(cl => cl.id === ins.clientId);
        if (c) {
          return {
            key: `client_${c.id}`,
            name: c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
            email: c.email,
            role: 'client_agent'
          };
        }
      }
      return {
        key: 'general_commission',
        name: 'Comisión de Asesor',
        role: 'unknown'
      };
    }

    return {
      key: 'unassigned_agent',
      name: 'Sin Agente Asignado',
      role: 'unknown'
    };
  };

  // Group insurances by agent based on filterMode
  const agentRows = useMemo(() => {
    const groups: Record<string, AgentPayableRow> = {};

    insurances.forEach(ins => {
      const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
      if (isCan) return;

      const hasPendingCommission = (ins.agentCommission || 0) > 0 && ins.commissionStatus !== 'paid';
      const hasDebt = isInsuranceDeudor(ins);

      // Check if matches the selected filter mode
      if (filterMode === 'commission_pending' && !hasPendingCommission) return;
      if (filterMode === 'debt_pending' && !hasDebt) return;
      if (filterMode === 'all_pending' && (!hasPendingCommission && !hasDebt)) return;

      const { key, name, email, role } = resolveAgent(ins);
      // Skip policies that truly have no agent or commission
      if (key === 'unassigned_agent' && (ins.agentCommission || 0) <= 0) return;

      if (!groups[key]) {
        groups[key] = {
          agentKey: key,
          agentName: name,
          agentEmail: email,
          agentRole: role,
          policyCount: 0,
          totalVenta: 0,
          totalCosto: 0,
          totalComision: 0,
          comisionPendiente: 0,
          saldoDeudorTotal: 0,
          policies: []
        };
      }

      const row = groups[key];
      const venta = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
      const costo = Number(ins.totalCost || 0);
      const comision = Number(ins.agentCommission || 0);
      const saldoDeudor = getInsurancePaymentBalance(ins);

      row.policyCount += 1;
      row.totalVenta += venta;
      row.totalCosto += costo;
      row.totalComision += comision;
      if (hasPendingCommission) {
        row.comisionPendiente += comision;
      }
      if (saldoDeudor > 0) {
        row.saldoDeudorTotal += saldoDeudor;
      }
      row.policies.push(ins);
    });

    let list = Object.values(groups);

    // Apply text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      list = list.filter(r => 
        r.agentName.toLowerCase().includes(term) || 
        (r.agentEmail && r.agentEmail.toLowerCase().includes(term))
      );
    }

    // Sort
    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (typeof valA === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [insurances, clients, users, filterMode, searchTerm, sortField, sortDirection]);

  // Overall totals
  const totals = useMemo(() => {
    return agentRows.reduce((acc, row) => ({
      policyCount: acc.policyCount + row.policyCount,
      totalVenta: acc.totalVenta + row.totalVenta,
      totalCosto: acc.totalCosto + row.totalCosto,
      totalComision: acc.totalComision + row.totalComision,
      comisionPendiente: acc.comisionPendiente + row.comisionPendiente,
      saldoDeudorTotal: acc.saldoDeudorTotal + row.saldoDeudorTotal
    }), {
      policyCount: 0,
      totalVenta: 0,
      totalCosto: 0,
      totalComision: 0,
      comisionPendiente: 0,
      saldoDeudorTotal: 0
    });
  }, [agentRows]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden space-y-0">
      {/* Header and Controls */}
      <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-100">
              Concentrado de Agentes
            </span>
            <span className="text-xs font-bold text-gray-400">
              {agentRows.length} agentes encontrados
            </span>
          </div>
          <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight flex items-center gap-2 mt-1">
            <Users className="w-5 h-5 text-blue-600" />
            Cuentas por Pagar a Agentes
          </h3>
          <p className="text-xs text-gray-500 font-medium">
            Resumen consolidado de pólizas, ventas, costos y comisiones pendientes por agente.
          </p>
        </div>

        {/* Filters and search */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Switcher */}
          <div className="bg-gray-100 p-1 rounded-xl border border-gray-200 inline-flex text-xs font-black">
            <button
              onClick={() => setFilterMode('commission_pending')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer uppercase ${
                filterMode === 'commission_pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
              title="Pólizas con comisión de agente pendiente de pago"
            >
              Comisiones Pendientes
            </button>
            <button
              onClick={() => setFilterMode('debt_pending')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer uppercase ${
                filterMode === 'debt_pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
              title="Pólizas de agentes con saldo deudor pendiente por liquidar"
            >
              Saldo Deudor
            </button>
            <button
              onClick={() => setFilterMode('all_pending')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer uppercase ${
                filterMode === 'all_pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
              title="Todas las pólizas de agentes con alguna cuenta pendiente"
            >
              Todos con Pendientes
            </button>
          </div>

          {/* Search bar */}
          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar agente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs font-bold pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
            />
          </div>

          {/* Quick link to Commissions Manager */}
          <button
            onClick={() => navigate('/commissions')}
            className="flex items-center gap-1.5 bg-[#1A2138] hover:bg-blue-600 text-white font-black text-xs px-3.5 py-2 rounded-xl transition-all cursor-pointer uppercase tracking-wider"
          >
            <span>Ir a Comisiones</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50 text-gray-500 text-[11px] font-black uppercase tracking-wider border-b border-gray-100">
            <tr>
              <th 
                onClick={() => handleSort('agentName')}
                className="px-6 py-4 cursor-pointer hover:text-blue-600 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Nombre de Agente</span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('policyCount')}
                className="px-6 py-4 text-center cursor-pointer hover:text-blue-600 transition-colors select-none"
              >
                <div className="flex items-center justify-center gap-1.5">
                  <span>Número de Pólizas</span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('totalVenta')}
                className="px-6 py-4 text-right cursor-pointer hover:text-blue-600 transition-colors select-none"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Venta</span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('totalCosto')}
                className="px-6 py-4 text-right cursor-pointer hover:text-blue-600 transition-colors select-none"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Costo</span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('totalComision')}
                className="px-6 py-4 text-right cursor-pointer hover:text-blue-600 transition-colors select-none"
              >
                <div className="flex items-center justify-end gap-1.5">
                  <span>Comisión</span>
                  <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                </div>
              </th>
              <th className="px-6 py-4 text-center">
                <span>Detalle</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {agentRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 font-medium text-sm">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500/50" />
                    <p className="font-bold text-gray-600">No hay cuentas por pagar pendientes para los filtros actuales.</p>
                    <p className="text-xs text-gray-400">Todos los agentes se encuentran al día con sus liquidaciones.</p>
                  </div>
                </td>
              </tr>
            ) : (
              agentRows.map((agent) => {
                const isExpanded = expandedAgentKey === agent.agentKey;
                return (
                  <React.Fragment key={agent.agentKey}>
                    <tr 
                      className={`hover:bg-blue-50/40 transition-colors cursor-pointer ${isExpanded ? 'bg-blue-50/20' : ''}`}
                      onClick={() => setExpandedAgentKey(prev => prev === agent.agentKey ? null : agent.agentKey)}
                    >
                      {/* Nombre de Agente */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 font-black flex items-center justify-center shrink-0 uppercase text-xs">
                            {agent.agentName.substring(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-gray-900 truncate">
                              {agent.agentName}
                            </p>
                            {agent.agentEmail && (
                              <p className="text-xs text-gray-400 font-medium truncate">
                                {agent.agentEmail}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Número de Pólizas */}
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-black bg-gray-100 text-gray-800">
                          {agent.policyCount} {agent.policyCount === 1 ? 'póliza' : 'pólizas'}
                        </span>
                      </td>

                      {/* Venta */}
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-black text-gray-900">
                          ${agent.totalVenta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                        </span>
                      </td>

                      {/* Costo */}
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold text-red-600">
                          ${agent.totalCosto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                        </span>
                      </td>

                      {/* Comisión */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-black text-indigo-600">
                            ${agent.totalComision.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                          </span>
                          {agent.comisionPendiente > 0 && (
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full mt-0.5">
                              ${agent.comisionPendiente.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por pagar
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Acciones / Expandir */}
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedAgentKey(prev => prev === agent.agentKey ? null : agent.agentKey);
                          }}
                          className="p-1.5 hover:bg-blue-100 text-gray-500 hover:text-blue-700 rounded-lg transition-colors cursor-pointer"
                          title={isExpanded ? 'Ocultar pólizas' : 'Ver pólizas'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Detail Sub-Table */}
                    {isExpanded && (
                      <tr className="bg-gray-50/70 border-b border-gray-100">
                        <td colSpan={6} className="px-8 py-4">
                          <div className="bg-white rounded-xl border border-gray-200/70 p-4 space-y-3">
                            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                              <h4 className="text-xs font-black uppercase text-gray-700 tracking-wider flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4 text-blue-600" />
                                Pólizas asociadas a {agent.agentName} ({agent.policies.length})
                              </h4>
                              <button
                                onClick={() => navigate(`/commissions?search=${encodeURIComponent(agent.agentName)}`)}
                                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              >
                                <span>Pagar Comisiones</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="overflow-x-auto max-h-60 overflow-y-auto">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                                  <tr>
                                    <th className="p-2">Asegurado</th>
                                    <th className="p-2">Plan / Póliza</th>
                                    <th className="p-2 text-right">Venta USD</th>
                                    <th className="p-2 text-right">Costo USD</th>
                                    <th className="p-2 text-right">Comisión USD</th>
                                    <th className="p-2 text-center">Estado Comisión</th>
                                    <th className="p-2 text-right">Acción</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {agent.policies.map((p) => {
                                    const pVenta = p.totalFinal !== undefined && p.totalFinal !== null ? Number(p.totalFinal) : Number(p.totalPrice || 0);
                                    const pCosto = Number(p.totalCost || 0);
                                    const pCom = Number(p.agentCommission || 0);
                                    return (
                                      <tr key={p.id} className="hover:bg-gray-50">
                                        <td className="p-2 font-bold text-gray-900">
                                          {p.firstName} {p.lastName}
                                          <span className="block text-[10px] text-gray-400 font-normal">{p.id}</span>
                                        </td>
                                        <td className="p-2 text-gray-600 font-medium">
                                          {p.plan || p.policyName || p.policyId}
                                        </td>
                                        <td className="p-2 text-right font-bold text-gray-900">
                                          ${pVenta.toFixed(2)}
                                        </td>
                                        <td className="p-2 text-right text-red-500 font-medium">
                                          ${pCosto.toFixed(2)}
                                        </td>
                                        <td className="p-2 text-right text-indigo-600 font-bold">
                                          ${pCom.toFixed(2)}
                                        </td>
                                        <td className="p-2 text-center">
                                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            p.commissionStatus === 'paid' ? 'bg-emerald-50 text-emerald-700' :
                                            p.commissionStatus === 'confirmed' ? 'bg-blue-50 text-blue-700' :
                                            'bg-amber-50 text-amber-700'
                                          }`}>
                                            {p.commissionStatus === 'paid' ? 'Pagada' : p.commissionStatus === 'confirmed' ? 'Confirmada' : 'Pendiente'}
                                          </span>
                                        </td>
                                        <td className="p-2 text-right">
                                          {onViewTransactions && (
                                            <button
                                              onClick={() => onViewTransactions(p.id!)}
                                              className="p-1 text-gray-400 hover:text-green-600 rounded transition-colors"
                                              title="Ver Transacciones"
                                            >
                                              <FileSpreadsheet className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>

          {/* Summary Totals Footer */}
          {agentRows.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2 border-gray-200 text-xs font-black uppercase text-gray-900">
              <tr>
                <td className="px-6 py-4">
                  <span>TOTAL GENERAL ({agentRows.length} Agentes)</span>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className="px-3 py-1 bg-gray-200/80 rounded-full text-xs">
                    {totals.policyCount} pólizas
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm font-black text-gray-950">
                    ${totals.totalVenta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-sm font-bold text-red-600">
                    ${totals.totalCosto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-black text-indigo-700">
                      ${totals.totalComision.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </span>
                    {totals.comisionPendiente > 0 && (
                      <span className="text-[10px] font-bold text-amber-700">
                        (${totals.comisionPendiente.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por pagar)
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
