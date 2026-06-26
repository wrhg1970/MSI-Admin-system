import { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, orderBy, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
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
import { TrendingUp, Users, DollarSign, Briefcase, Receipt, Calendar, Filter, ShieldCheck, PieChart as PieIcon, ArrowUpRight, ArrowDownRight, Scale } from 'lucide-react';
import TransactionModal from './TransactionModal';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { getDocs } from 'firebase/firestore';

interface DashboardProps {
  profile: UserProfile | null;
}

export default function Dashboard({ profile }: DashboardProps) {
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(17.5);
  const [loading, setLoading] = useState(true);
  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  
  // Filters
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [planFilter, setPlanFilter] = useState('all');
  const [clientTypeFilter, setClientTypeFilter] = useState('all');

  useEffect(() => {
    if (!profile) return;

    const isAdmin = ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role);
    
    // For performance, we could limit the initial query to something reasonable like 1000 items
    // or better yet, query only within the current selected date range in Firestore.
    // However, since we want global stats potentially, we'll keep it for now but optimize the calculations.
    let q;
    if (isAdmin) {
      q = query(collection(db, 'insurances'), orderBy('createdAt', 'desc'));
    } else if (profile.role === 'agent') {
      q = query(collection(db, 'insurances'), where('agentId', '==', profile.uid), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'insurances'), where('email', '==', profile.email), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
      setInsurances(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances');
    });

    const fetchPolicies = async () => {
      try {
        const snap = await getDocs(collection(db, 'policies'));
        setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
      } catch (error) {
        console.error("Error fetching policies:", error);
      }
    };
    fetchPolicies();

    let unsubscribePayments: (() => void) | undefined;
    let unsubscribeRate: (() => void) | undefined;

    if (isAdmin) {
      // Subscribe to active exchange rate
      const qRate = query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(1));
      unsubscribeRate = onSnapshot(qRate, (snap) => {
        if (!snap.empty) {
          const rateVal = snap.docs[0].data().rate;
          if (rateVal) setExchangeRate(rateVal);
        }
      }, (error) => {
        console.error("Error fetching exchangeRate in Dashboard:", error);
      });

      // Subscribe to all payments for global cash flow view
      const qPayments = query(collection(db, 'payments'));
      unsubscribePayments = onSnapshot(qPayments, (snap) => {
        const pData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
        setPayments(pData);
      }, (error) => {
        console.error("Error fetching payments in Dashboard:", error);
      });
    }

    return () => {
      unsubscribe();
      if (unsubscribePayments) unsubscribePayments();
      if (unsubscribeRate) unsubscribeRate();
    };
  }, [profile]);

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
      const date = ins.createdAt?.toDate ? ins.createdAt.toDate() : new Date(ins.createdAt);
      const matchesDate = (!dateRange.start || date >= new Date(dateRange.start)) &&
                          (!dateRange.end || date <= new Date(dateRange.end));
      
      const policy = policies.find(p => p.id === ins.policyId);
      const plan = ins.plan || policy?.plan || ins.policyId.split('-')[0];
      
      const matchesPlan = planFilter === 'all' || plan === planFilter;
      const matchesClientType = clientTypeFilter === 'all' || ins.clientType === clientTypeFilter;
      
      return matchesDate && matchesPlan && matchesClientType;
    });
  }, [insurances, dateRange, planFilter, clientTypeFilter, policies]);

  const stats = useMemo(() => [
    { 
      name: 'Número de Pólizas', 
      value: filteredInsurances.length.toLocaleString(), 
      icon: ShieldCheck, 
      color: 'bg-blue-500' 
    },
    { 
      name: 'Ventas Totales', 
      value: `$${filteredInsurances.reduce((acc, curr) => acc + (curr.totalFinal || curr.totalPrice), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
      icon: DollarSign, 
      color: 'bg-green-500' 
    },
    { 
      name: 'Costos Totales', 
      value: `$${filteredInsurances.reduce((acc, curr) => acc + (curr.totalCost || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
      icon: TrendingUp, 
      color: 'bg-red-500' 
    },
    { 
      name: 'Margen Total', 
      value: `$${filteredInsurances.reduce((acc, curr) => acc + ((curr.totalFinal || curr.totalPrice) - (curr.totalCost || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
      icon: TrendingUp, 
      color: 'bg-amber-500' 
    },
    { 
      name: 'Comisiones', 
      value: `$${filteredInsurances.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
      icon: DollarSign, 
      color: 'bg-indigo-500' 
    }
  ], [filteredInsurances]);

  const chartData = useMemo(() => ['Individual', 'Agent', 'Corporate'].map(type => {
    const typeInsurances = filteredInsurances.filter(i => i.clientType === type);
    return {
      name: type === 'Individual' ? 'B2C (Ind)' : type === 'Agent' ? 'B2B2C (Ag)' : 'B2B (Corp)',
      venta: typeInsurances.reduce((acc, curr) => acc + (curr.totalFinal || curr.totalPrice), 0),
      costo: typeInsurances.reduce((acc, curr) => acc + (curr.totalCost || 0), 0)
    };
  }), [filteredInsurances]);

  const planData = useMemo(() => {
    const plans = Array.from(new Set(filteredInsurances.map(i => (i.plan || i.policyId.split('-')[0]) as string)));
    return plans.map((plan: string) => ({
      name: getPlanLabel(plan),
      value: filteredInsurances.filter(i => (i.plan || i.policyId.split('-')[0]) === plan).length
    })).sort((a, b) => b.value - a.value);
  }, [filteredInsurances]);

  const isAdmin = useMemo(() => {
    return ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile?.role || '');
  }, [profile]);

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
      
      const tc = p.exchangeRate || exchangeRate || 17.5;
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

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Transacciones Recientes</h3>
          <p className="text-xs text-gray-400">Mostrando {filteredInsurances.length} registros filtrados</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4 font-medium">Cliente</th>
                <th className="px-6 py-4 font-medium">Plan / Póliza</th>
                <th className="px-6 py-4 font-medium">Canal</th>
                <th className="px-6 py-4 font-medium">Venta</th>
                <th className="px-6 py-4 font-medium">Costo</th>
                <th className="px-6 py-4 font-medium">Comisión</th>
                <th className="px-6 py-4 font-medium">Estado</th>
                <th className="px-6 py-4 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredInsurances.slice(0, 10).map((i) => (
                <tr key={i.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{i.firstName} {i.lastName}</p>
                    <p className="text-xs text-gray-500">{i.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-indigo-600 uppercase">
                        {getPlanLabel(i.plan || i.policyId.split('-')[0])}
                      </span>
                      <span className="text-xs text-gray-600 font-medium">
                        {getInsuranceTypeLabel(i)}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-mono mt-1">{i.id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                      {i.clientType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                    ${(i.totalFinal || i.totalPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm text-red-500">
                    ${(i.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm text-indigo-600 font-medium">
                    ${(i.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      i.status === 'paid' ? 'bg-green-100 text-green-700' : 
                      i.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 
                      'bg-red-100 text-red-700'
                    }`}>
                      {i.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setSelectedInsuranceForTransactions(i.id || null)}
                      className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Ver Transacciones"
                    >
                      <Receipt className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TransactionModal 
        isOpen={!!selectedInsuranceForTransactions}
        onClose={() => setSelectedInsuranceForTransactions(null)}
        insuranceId={selectedInsuranceForTransactions || undefined}
        title="Transacciones de la Póliza"
      />
    </div>
  );
}
