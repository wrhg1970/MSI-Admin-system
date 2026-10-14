import { useState, useMemo } from 'react';
import { InsuranceRequest, UserProfile, Policy, Payment } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { TrendingUp, Users, DollarSign, Briefcase, Receipt, Calendar, Filter, ShieldCheck, PieChart as PieIcon, ArrowUpRight, ArrowDownRight, Scale, Eye } from 'lucide-react';
import TransactionModal from './TransactionModal';
import InsuranceDetailModal from './InsuranceDetailModal';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useFirestoreData } from '../context/FirestoreDataContext';
import { getNormalizedYYYYMMDD, resolvePolicyFolioAndType } from '../lib/policyUtils';
import PoliciesStatusSummarySection from './PoliciesStatusSummarySection';
import AgentPayablesConcentrate from './AgentPayablesConcentrate';

interface DashboardProps {
  profile: UserProfile | null;
}

export default function Dashboard({ profile }: DashboardProps) {
  const { 
    insurances: contextInsurances, 
    policies, 
    payments: contextPayments, 
    clients,
    users,
    latestExchangeRate: exchangeRate,
    loading: contextLoading,
    limitToCurrentMonth,
    setLimitToCurrentMonth
  } = useFirestoreData();

  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  const [selectedInsuranceForDetail, setSelectedInsuranceForDetail] = useState<InsuranceRequest | null>(null);
  
  // Filters
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [planFilter, setPlanFilter] = useState('all');
  const [clientTypeFilter, setClientTypeFilter] = useState('all');

  const isAdmin = profile ? ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role) : false;

  const insurances = useMemo(() => {
    if (!profile) return [];
    if (isAdmin) {
      return contextInsurances;
    } else if (profile.role === 'agent') {
      return contextInsurances.filter(i => {
        const isOwnerByUid = i.agentId === profile.uid;
        const isOwnerByEmail = !!(profile.email && i.linkedAgentId?.toLowerCase() === profile.email.toLowerCase());
        const isOwnerByEmailInAgentId = !!(profile.email && i.agentId?.toLowerCase() === profile.email.toLowerCase());
        return isOwnerByUid || isOwnerByEmail || isOwnerByEmailInAgentId;
      });
    } else {
      return contextInsurances.filter(i => i.email === profile.email);
    }
  }, [contextInsurances, profile, isAdmin]);

  const payments = useMemo(() => {
    if (!profile) return [];
    if (isAdmin) {
      return contextPayments;
    }
    // Non-admins don't see payments or can have filtered view. If there are payments associated with their insurances:
    const insuranceIds = new Set(insurances.map(i => i.id));
    return contextPayments.filter(p => insuranceIds.has(p.insuranceId));
  }, [contextPayments, insurances, isAdmin, profile]);

  const loading = useMemo(() => {
    if (!profile) return true;
    return contextLoading.insurances || contextLoading.policies || (isAdmin && contextLoading.payments);
  }, [contextLoading, profile, isAdmin]);

  const getPlanLabel = (plan: string) => {
    const mapping: Record<string, string> = {
      'U6': 'U6',
      'O70': 'O70',
      'Traveler': 'Traveller',
      'Student': 'Student'
    };
    return mapping[plan] || plan;
  };

  const getInsuranceTypeLabel = (ins: InsuranceRequest) => {
    if (ins.policyName) return ins.policyName;
    const policy = policies.find(p => p.id === ins.policyId);
    if (policy) return policy.name;

    let label = '';
    if (ins.policyId.includes('Oro')) label = 'Oro';
    else if (ins.policyId.includes('Plata')) label = 'Plata';
    else if (ins.policyId.includes('Bronce')) label = 'Bronce';
    else return '-';

    if (ins.policyId.toLowerCase().includes('sin')) label += ' sin deducible';
    else label += ' con deducible';
    
    return label;
  };

  const filteredInsurances = useMemo(() => {
    return insurances.filter(ins => {
      const actualRequestDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      const matchesDate = (!dateRange.start || actualRequestDate >= dateRange.start) &&
                          (!dateRange.end || actualRequestDate <= dateRange.end);
      
      const policy = policies.find(p => p.id === ins.policyId);
      const plan = ins.plan || policy?.plan || ins.policyId.split('-')[0];
      
      const matchesPlan = planFilter === 'all' || plan === planFilter;
      const matchesClientType = clientTypeFilter === 'all' || ins.clientType === clientTypeFilter;
      
      return matchesDate && matchesPlan && matchesClientType;
    });
  }, [insurances, dateRange, planFilter, clientTypeFilter, policies]);

  const stats = useMemo(() => {
    let count = 0;
    let ventas = 0;
    let costo = 0;
    let comisiones = 0;

    filteredInsurances.forEach(curr => {
      count++;
      const isCan = curr.actionType?.toUpperCase() === 'CAN';
      const p = curr.totalFinal || curr.totalPrice || 0;
      const c = curr.totalCost || 0;
      const com = curr.agentCommission || 0;

      ventas += isCan ? -Math.abs(p) : Math.abs(p);
      costo += isCan ? -Math.abs(c) : Math.abs(c);
      comisiones += isCan ? -Math.abs(com) : Math.abs(com);
    });

    const margen = ventas - costo;

    return [
      { 
        name: 'Número de Pólizas', 
        value: count.toLocaleString(), 
        icon: ShieldCheck, 
        color: 'bg-blue-500' 
      },
      { 
        name: 'Ventas Totales', 
        value: `$${ventas.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
        icon: DollarSign, 
        color: 'bg-green-500' 
      },
      { 
        name: 'Costos Totales', 
        value: `$${costo.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
        icon: TrendingUp, 
        color: 'bg-red-500' 
      },
      { 
        name: 'Margen Total', 
        value: `$${margen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
        icon: TrendingUp, 
        color: 'bg-amber-500' 
      },
      { 
        name: 'Comisiones', 
        value: `$${comisiones.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
        icon: DollarSign, 
        color: 'bg-indigo-500' 
      }
    ];
  }, [filteredInsurances]);

  const chartData = useMemo(() => ['Individual', 'Agent', 'Corporate'].map(type => {
    const typeInsurances = filteredInsurances.filter(i => i.clientType === type);
    return {
      name: type === 'Individual' ? 'B2C (Ind)' : type === 'Agent' ? 'B2B2C (Ag)' : 'B2B (Corp)',
      venta: typeInsurances.reduce((acc, curr) => {
        const isCan = curr.actionType?.toUpperCase() === 'CAN';
        const val = curr.totalFinal || curr.totalPrice || 0;
        return acc + (isCan ? -Math.abs(val) : Math.abs(val));
      }, 0),
      costo: typeInsurances.reduce((acc, curr) => {
        const isCan = curr.actionType?.toUpperCase() === 'CAN';
        const val = curr.totalCost || 0;
        return acc + (isCan ? -Math.abs(val) : Math.abs(val));
      }, 0)
    };
  }), [filteredInsurances]);

  const planData = useMemo(() => {
    const plans = Array.from(new Set(filteredInsurances.map(i => (i.plan || i.policyId.split('-')[0]) as string)));
    return plans.map((plan: string) => ({
      name: getPlanLabel(plan),
      value: filteredInsurances.filter(i => (i.plan || i.policyId.split('-')[0]) === plan).length
    })).sort((a, b) => b.value - a.value);
  }, [filteredInsurances]);

  const filteredPayments = useMemo(() => {
    if (!isAdmin) return [];
    return payments.filter(p => {
      if (!p.date || p.status !== 'completed') return false;
      let dateObj: Date;
      try {
        if (typeof p.date === 'string') {
          dateObj = new Date(p.date);
        } else if (p.date && typeof p.date.toDate === 'function') {
          dateObj = p.date.toDate();
        } else {
          dateObj = new Date(p.date);
        }
      } catch (err) {
        return false;
      }
      
      const formattedPDate = format(dateObj, 'yyyy-MM-dd');
      const matchesStart = !dateRange.start || formattedPDate >= dateRange.start;
      const matchesEnd = !dateRange.end || formattedPDate <= dateRange.end;
      return matchesStart && matchesEnd;
    });
  }, [payments, dateRange, isAdmin]);

  const monthlyFlowData = useMemo(() => {
    if (!isAdmin || filteredPayments.length === 0) return [];

    const monthlyFlows: Record<string, { month: string; ingresos: number; egresos: number; neto: number }> = {};
    
    filteredPayments.forEach(p => {
      if (!p.date) return;
      let dateStr = '';
      try {
        if (typeof p.date === 'string') {
          dateStr = p.date;
        } else if (p.date && typeof p.date.toDate === 'function') {
          dateStr = p.date.toDate().toISOString();
        } else {
          dateStr = new Date(p.date).toISOString();
        }
      } catch (err) {
        console.error('Error parsing payment date:', err);
        return;
      }

      if (!dateStr || dateStr.length < 7) return;
      const monthKey = dateStr.substring(0, 7); // 'yyyy-MM'
      
      if (!monthlyFlows[monthKey]) {
        monthlyFlows[monthKey] = { month: monthKey, ingresos: 0, egresos: 0, neto: 0 };
      }
      
      const tc = p.exchangeRate || exchangeRate || 17.55;
      const amount = p.currency === 'USD' ? p.amount : (p.amountMXP || 0) / tc;
      
      if (p.type === 'client_payment') {
        monthlyFlows[monthKey].ingresos += amount;
      } else if (p.type === 'provider_payment' || p.type === 'agent_commission') {
        monthlyFlows[monthKey].egresos += amount;
      }
    });

    // Sort chronologically and format
    return Object.keys(monthlyFlows)
      .sort()
      .map(key => {
        const item = monthlyFlows[key];
        item.neto = item.ingresos - item.egresos;
        
        let label = key;
        try {
          const [year, month] = key.split('-');
          const dateObj = new Date(parseInt(year), parseInt(month) - 1, 1);
          const rawLabel = dateObj.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
          label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
        } catch (e) {
          // Fallback to key
        }
        
        return {
          ...item,
          monthLabel: label,
          ingresos: Math.round(item.ingresos * 100) / 100,
          egresos: Math.round(item.egresos * 100) / 100,
          neto: Math.round(item.neto * 100) / 100
        };
      });
  }, [filteredPayments, exchangeRate, isAdmin]);

  const monthlyFlowTotals = useMemo(() => {
    let totIngresos = 0;
    let totEgresos = 0;
    monthlyFlowData.forEach(item => {
      totIngresos += item.ingresos;
      totEgresos += item.egresos;
    });
    return {
      ingresos: totIngresos,
      egresos: totEgresos,
      neto: totIngresos - totEgresos
    };
  }, [monthlyFlowData]);

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B'];

  if (loading) return <div className="animate-pulse">Cargando dashboard...</div>;

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard de Control</h1>
          <p className="text-gray-500">Bienvenido de nuevo, {profile?.displayName}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input 
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="text-xs border-none bg-gray-50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-300">-</span>
            <input 
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="text-xs border-none bg-gray-50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-400" />
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="text-xs border-none bg-gray-50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Todos los Planes</option>
              <option value="U6">U6</option>
              <option value="Student">Student</option>
              <option value="Traveler">Traveller</option>
              <option value="O70">O70</option>
            </select>
          </div>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={clientTypeFilter}
              onChange={(e) => setClientTypeFilter(e.target.value)}
              className="text-xs border-none bg-gray-50 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Todos los Canales</option>
              <option value="Individual">B2C (Individual)</option>
              <option value="University">B2B (University)</option>
              <option value="Agent">B2B2C (Agent)</option>
            </select>
          </div>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className={`${stat.color} p-3 rounded-lg text-white`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">{stat.name}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Policy Status Overview Section (Active vs Pending) - ADMIN ONLY */}
      {isAdmin && (
        <PoliciesStatusSummarySection
          insurances={insurances}
          policies={policies}
          loading={loading}
          limitToCurrentMonth={limitToCurrentMonth}
          onToggleMonthLimit={setLimitToCurrentMonth}
        />
      )}

      {/* Financial Overview (Incomes vs Expenses) - ADMIN ONLY */}
      {isAdmin && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
            <div>
              <h3 className="text-lg font-bold text-gray-950 flex items-center gap-2">
                <Scale className="w-5 h-5 text-indigo-600" />
                Flujo Financiero Mensual (Ingresos vs Egresos)
              </h3>
              <p className="text-gray-500 text-xs">
                Visualización consolidada de cobros a clientes contra egresos, comisiones y pagos a proveedores en dólares (USD).
              </p>
            </div>
            
            {/* Period KPIs */}
            <div className="flex flex-wrap items-center gap-4 text-xs font-sans">
              <div className="bg-emerald-50 text-emerald-800 px-3 py-2 rounded-xl border border-emerald-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Cobros: <strong className="font-bold">${monthlyFlowTotals.ingresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></span>
              </div>
              <div className="bg-rose-50 text-rose-800 px-3 py-2 rounded-xl border border-rose-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>Salidas: <strong className="font-bold">${monthlyFlowTotals.egresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></span>
              </div>
              <div className={`${monthlyFlowTotals.neto >= 0 ? 'bg-blue-50 text-blue-800 border-blue-100' : 'bg-amber-50 text-amber-800 border-amber-100'} px-3 py-2 rounded-xl border flex items-center gap-2`}>
                {monthlyFlowTotals.neto >= 0 ? <ArrowUpRight className="w-4 h-4 text-blue-600" /> : <ArrowDownRight className="w-4 h-4 text-amber-600" />}
                <span>Flujo Neto: <strong className="font-bold">${monthlyFlowTotals.neto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></span>
              </div>
            </div>
          </div>

          <div className="h-80">
            {monthlyFlowData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-gray-400 font-medium text-sm">No hay datos de pagos para el período seleccionado o filtros aplicados.</p>
                <p className="text-gray-400 text-xs mt-1">Sube archivos bancarios o registra transacciones para ver la actividad financiera.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyFlowData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} className="text-xs font-medium text-gray-500" />
                  <YAxis tickLine={false} axisLine={false} className="text-xs font-medium text-gray-500" tickFormatter={(val) => `$${val}`} />
                  <Tooltip
                    contentStyle={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)' }}
                    formatter={(val: any) => [`$${parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD`]}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <Bar name="Ingresos (Cobros)" dataKey="ingresos" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar name="Egresos (Pagos/Comisiones)" dataKey="egresos" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-6">Ventas vs Costos por Canal</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar name="Venta" dataKey="venta" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar name="Costo" dataKey="costo" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-6">Distribución por Plan</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={planData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={80} />
                <Tooltip />
                <Bar dataKey="value" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Concentrado de Agentes con Cuentas por Pagar (Solo para administradores) */}
      {isAdmin && (
        <AgentPayablesConcentrate
          insurances={insurances}
          clients={clients}
          users={users}
          onViewTransactions={(id) => setSelectedInsuranceForTransactions(id)}
        />
      )}

      {/* Sección de Pólizas Gestionadas por el Agente para Revisión Directa */}
      {profile?.role === 'agent' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                Mis Pólizas Gestionadas ({filteredInsurances.length})
              </h3>
              <p className="text-xs text-gray-500">
                Consulta y revisa el expediente, montos, coberturas y comisiones de cada una de tus pólizas.
              </p>
            </div>
            <span className="text-xs font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200 self-start sm:self-auto">
              {filteredInsurances.filter(i => i.commissionStatus === 'paid').length} Pagadas • {filteredInsurances.filter(i => i.commissionStatus !== 'paid').length} Por liquidar
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Póliza / Folio</th>
                  <th className="p-3">Asegurado</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3">Tipo de Póliza</th>
                  <th className="p-3">Vigencia</th>
                  <th className="p-3 text-right">Prima USD</th>
                  <th className="p-3 text-right">Comisión USD</th>
                  <th className="p-3 text-center">Estado Pago</th>
                  <th className="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredInsurances.map(ins => {
                  const sale = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
                  const comm = Number(ins.agentCommission || 0);
                  const polInfo = resolvePolicyFolioAndType(ins, policies);

                  return (
                    <tr key={ins.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="p-3 font-mono font-bold text-gray-900">
                        <span className="bg-gray-100 border border-gray-200/90 px-2 py-0.5 rounded text-[11px] tracking-tight">
                          {polInfo.folio}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-gray-800 block">{ins.firstName} {ins.lastName}</span>
                        <span className="text-[10px] text-gray-400 block">{ins.email}</span>
                      </td>
                      <td className="p-3 font-semibold text-gray-700">
                        <span className="inline-block px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-800 text-[11px]">
                          {polInfo.plan}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold ${
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
                      <td className="p-3 text-gray-600">
                        {ins.startDate} → {ins.endDate}
                      </td>
                      <td className="p-3 text-right font-black text-gray-900">
                        ${sale.toFixed(2)} USD
                      </td>
                      <td className="p-3 text-right font-black text-purple-700">
                        ${comm.toFixed(2)} USD
                      </td>
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
                        <button
                          type="button"
                          onClick={() => setSelectedInsuranceForDetail(ins)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                          title="Revisar expediente completo de la póliza"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Revisar Póliza</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredInsurances.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-gray-400">
                      No tienes pólizas registradas en este período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TransactionModal 
        isOpen={!!selectedInsuranceForTransactions}
        onClose={() => setSelectedInsuranceForTransactions(null)}
        insuranceId={selectedInsuranceForTransactions || undefined}
        title="Transacciones de la Póliza"
      />

      {/* Modal para Revisar Póliza */}
      <InsuranceDetailModal
        isOpen={!!selectedInsuranceForDetail}
        onClose={() => setSelectedInsuranceForDetail(null)}
        insurance={selectedInsuranceForDetail}
      />
    </div>
  );
}
