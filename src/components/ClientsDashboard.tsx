import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  Building2, 
  User, 
  DollarSign, 
  Receipt, 
  ShieldCheck, 
  CheckCircle2, 
  ArrowUpRight, 
  Award, 
  TrendingUp, 
} from 'lucide-react';
import { Client, InsuranceRequest, Payment, UserProfile, Policy } from '../types';

interface ClientsDashboardProps {
  clients: Client[];
  insurances: InsuranceRequest[];
  payments: Payment[];
  users: UserProfile[];
  policies?: Policy[];
  latestExchangeRate?: number;
  onSelectClientForDetail?: (client: Client) => void;
  onNavigateToTab?: (tab: 'all' | 'agents' | 'individuals' | 'subagents') => void;
}

export default function ClientsDashboard({
  clients,
  insurances,
  payments,
  policies = [],
  latestExchangeRate = 20,
  onSelectClientForDetail,
  onNavigateToTab
}: ClientsDashboardProps) {
  const navigate = useNavigate();

  // 1. Métricas Globales
  const totalClients = clients.length;
  const agentCount = clients.filter(c => c.type === 'Agent').length;
  const corporateCount = clients.filter(c => c.type === 'Corporate').length;
  const individualCount = clients.filter(c => c.type === 'Individual').length;

  // Total de pólizas y ventas
  const totalPoliciesCount = insurances.length;
  const totalSalesUSD = insurances.reduce((sum, ins) => {
    const val = ins.totalFinal !== undefined && ins.totalFinal !== null 
      ? Number(ins.totalFinal) 
      : Number(ins.totalPrice || 0);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const totalSalesMXN = totalSalesUSD * latestExchangeRate;

  // Cobranza total recibida (client_payment)
  const totalCollectedUSD = payments
    .filter(p => p.type === 'client_payment' && p.status === 'completed')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  const totalBalanceDue = Math.max(0, totalSalesUSD - totalCollectedUSD);

  // Comisiones de agentes acumuladas
  const totalAgentCommissionsUSD = insurances.reduce((sum, ins) => {
    return sum + (Number(ins.agentCommission) || 0);
  }, 0);

  const totalAgentCommissionsPaidUSD = insurances
    .filter(ins => ins.commissionStatus === 'paid')
    .reduce((sum, ins) => sum + (Number(ins.agentCommission) || 0), 0);

  const totalAgentCommissionsPendingUSD = insurances
    .filter(ins => ins.commissionStatus === 'confirmed' || ins.commissionStatus === 'invoiced')
    .reduce((sum, ins) => sum + (Number(ins.agentCommission) || 0), 0);

  // Top 5 Clientes con más compras
  const topClientsBySales = useMemo(() => {
    const clientSalesMap = new Map<string, { client: Client; totalSales: number; policiesCount: number }>();
    
    // Mapeo por ID de cliente
    insurances.forEach(ins => {
      if (!ins.clientId) return;
      const c = clients.find(cl => cl.id === ins.clientId);
      if (!c) return;

      const sale = ins.totalFinal !== undefined && ins.totalFinal !== null 
        ? Number(ins.totalFinal) 
        : Number(ins.totalPrice || 0);

      const existing = clientSalesMap.get(ins.clientId) || { client: c, totalSales: 0, policiesCount: 0 };
      existing.totalSales += (isNaN(sale) ? 0 : sale);
      existing.policiesCount += 1;
      clientSalesMap.set(ins.clientId, existing);
    });

    return Array.from(clientSalesMap.values())
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 5);
  }, [insurances, clients]);

  // Top 5 Agentes con más comisiones o ventas
  const topAgents = useMemo(() => {
    const agentMap = new Map<string, { name: string; email?: string; client?: Client; totalSales: number; commission: number; policies: number }>();

    insurances.forEach(ins => {
      if (!ins.agentCommission && !ins.agentId && ins.clientType !== 'Agent') return;

      let key = ins.agentId || ins.linkedAgentId || ins.clientId || 'desconocido';
      let name = ins.agente || ins.linkedAgentId || '';

      const c = clients.find(cl => cl.id === ins.clientId);
      if (c && c.type === 'Agent') {
        name = c.commercialName || c.legalName || name;
      }

      if (!name) name = 'Agente';

      const sale = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
      const comm = Number(ins.agentCommission || 0);

      const existing = agentMap.get(key) || { name, email: ins.linkedAgentId, client: c, totalSales: 0, commission: 0, policies: 0 };
      existing.totalSales += (isNaN(sale) ? 0 : sale);
      existing.commission += (isNaN(comm) ? 0 : comm);
      existing.policies += 1;
      agentMap.set(key, existing);
    });

    return Array.from(agentMap.values())
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 5);
  }, [insurances, clients]);

  const getClientDisplayName = (c: Client): string => {
    return c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Sin Nombre';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* 1. Header con Resumen Ejecutivo */}
      <div className="bg-gradient-to-r from-[#1A2138] via-[#243054] to-[#1e293b] text-white p-7 rounded-3xl shadow-xl border border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-violet-500/20 text-violet-300 border border-violet-500/30 rounded-full text-[10px] font-black uppercase tracking-wider">
              Inteligencia Comercial
            </span>
            <span className="text-xs text-gray-400">Actualizado en tiempo real</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight">Dashboard General de Clientes y Agentes</h2>
          <p className="text-xs text-gray-300 max-w-xl leading-relaxed">
            Monitorea el valor de cartera, volumen de compras, cobranza y comisiones globales.
          </p>
        </div>

        {/* Accesos directos a submenús */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigateToTab?.('agents')}
            className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all border border-white/15 flex items-center gap-2 cursor-pointer"
          >
            <Building2 className="w-4 h-4 text-purple-300" />
            <span>Agentes & Corporativos ({agentCount + corporateCount})</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateToTab?.('individuals')}
            className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all border border-white/15 flex items-center gap-2 cursor-pointer"
          >
            <User className="w-4 h-4 text-blue-300" />
            <span>Individuales ({individualCount})</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/client-access')}
            className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-white" />
            <span>Acceso Clientes 360°</span>
          </button>
        </div>
      </div>

      {/* 2. KPIs Globales de la Cartera */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Cartera Total */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cartera de Clientes</span>
              <div className="p-2.5 bg-violet-50 text-violet-600 rounded-2xl">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <p className="text-3xl font-black text-gray-900">{totalClients}</p>
          </div>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-50 text-[11px] font-bold text-gray-500">
            <span className="text-purple-600 font-black">{agentCount} Agentes</span>
            <span>•</span>
            <span className="text-indigo-600 font-black">{corporateCount} Corp.</span>
            <span>•</span>
            <span className="text-blue-600 font-black">{individualCount} Ind.</span>
          </div>
        </div>

        {/* Ventas Totales */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ventas / Primas Totales</span>
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <p className="text-3xl font-black text-gray-900">${totalSalesUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-bold text-gray-400">USD</span></p>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-50 text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span>{totalPoliciesCount} pólizas contratadas</span>
            <span className="text-gray-400 font-mono">≈ ${(totalSalesMXN / 1000).toFixed(0)}k MXN</span>
          </div>
        </div>

        {/* Cobranza vs Deudor */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cobranza Realizada</span>
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <p className="text-3xl font-black text-emerald-600">${totalCollectedUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-bold text-emerald-400">USD</span></p>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-50 text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span className="text-amber-600 font-bold">${totalBalanceDue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USD pendiente</span>
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px]">
              {totalSalesUSD > 0 ? `${((totalCollectedUSD / totalSalesUSD) * 100).toFixed(0)}% pagado` : '100%'}
            </span>
          </div>
        </div>

        {/* Comisiones de Agentes */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Comisiones de Agentes</span>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
                <Receipt className="w-5 h-5" />
              </div>
            </div>
            <p className="text-3xl font-black text-indigo-900">${totalAgentCommissionsUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-bold text-indigo-400">USD</span></p>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-50 text-[11px] font-bold text-gray-500 flex items-center justify-between">
            <span className="text-emerald-600 font-bold">${totalAgentCommissionsPaidUSD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} pagadas</span>
            <span className="text-amber-600 font-bold">${totalAgentCommissionsPendingUSD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} por liquidar</span>
          </div>
        </div>
      </div>

      {/* 3. Rankings y Tablas Destacadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Clientes con Mayor Volumen de Compra */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <Award className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900">Top 5 Clientes por Compras</h3>
                <p className="text-[11px] text-gray-400">Mayor volumen de primas adquiridas</p>
              </div>
            </div>
            <span className="text-[10px] font-black uppercase text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full">
              Acumulado
            </span>
          </div>

          <div className="space-y-2.5">
            {topClientsBySales.map((item, idx) => {
              const isAgentOrCorp = item.client.type === 'Agent' || item.client.type === 'Corporate';
              return (
                <div
                  key={item.client.id || idx}
                  onClick={() => {
                    if (isAgentOrCorp) {
                      navigate(`/client-access?clientId=${item.client.id}`);
                    } else if (onSelectClientForDetail) {
                      onSelectClientForDetail(item.client);
                    }
                  }}
                  className="p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer border-gray-100 hover:border-gray-200 hover:bg-gray-50/60"
                  title={isAgentOrCorp ? "Abrir expediente en Acceso Clientes" : "Ver ficha del cliente"}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-700 font-black text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{getClientDisplayName(item.client)}</p>
                      <span className="text-[10px] text-gray-400 block truncate">{item.client.email || item.client.phone || 'Sin correo'}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-gray-950">${item.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                    <span className="text-[10px] text-blue-600 font-bold">{item.policiesCount} póliza(s)</span>
                  </div>
                </div>
              );
            })}
            {topClientsBySales.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No hay datos de compras aún.</p>
            )}
          </div>
        </div>

        {/* Top Agentes con Mayor Colocación */}
        <div className="bg-white p-6 rounded-3xl shadow-xs border border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <TrendingUp className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900">Top 5 Agentes & Canales</h3>
                <p className="text-[11px] text-gray-400">Mayor colocación de pólizas y comisiones</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/commissions')}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              <span>Ver Comisiones</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {topAgents.map((ag, idx) => (
              <div
                key={idx}
                onClick={() => {
                  if (ag.client?.id) navigate(`/client-access?clientId=${ag.client.id}`);
                }}
                className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
                  ag.client?.id ? 'cursor-pointer hover:border-purple-300 hover:bg-purple-50/40' : ''
                } border-gray-100`}
                title={ag.client?.id ? "Abrir expediente en Acceso Clientes" : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-purple-50 text-purple-700 font-black text-xs flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{ag.name}</p>
                    <span className="text-[10px] text-gray-400 block truncate">{ag.email || `${ag.policies} pólizas gestionadas`}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-black text-purple-900">${ag.commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  <span className="text-[10px] text-gray-500">Venta: ${(ag.totalSales / 1000).toFixed(1)}k USD</span>
                </div>
              </div>
            ))}
            {topAgents.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No hay agentes con comisiones registradas aún.</p>
            )}
          </div>
        </div>
      </div>

      {/* 4. Banner Destacado a la Nueva Página: Acceso Clientes (Expediente 360° para Agentes y Corporativos) */}
      <div className="bg-gradient-to-r from-violet-900 via-indigo-900 to-slate-900 p-8 rounded-3xl text-white shadow-xl flex flex-col lg:flex-row items-center justify-between gap-6 border border-violet-800/40">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-violet-400/20 text-violet-200 border border-violet-400/30 rounded-full text-[10px] font-black uppercase tracking-wider">
              Nueva Página
            </span>
            <h3 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-violet-400" />
              Acceso Clientes: Expediente 360°
            </h3>
          </div>
          <p className="text-sm text-indigo-100">
            El expediente comercial 360° ahora se encuentra centralizado exclusivamente para <strong>Agentes y Corporativos</strong> en su propia página. Consulta pólizas emitidas, vigencias, folios oficiales, historial de pagos, liquidación de comisiones y emisión de pólizas con asignación automática.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/client-access')}
            className="px-6 py-3.5 bg-white text-indigo-950 hover:bg-indigo-50 font-black text-xs rounded-2xl shadow-lg transition-all flex items-center gap-2 cursor-pointer hover:scale-105 active:scale-95"
          >
            <ShieldCheck className="w-4 h-4 text-violet-600" />
            <span>Ir a Acceso Clientes</span>
            <ArrowUpRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

    </div>
  );
}
