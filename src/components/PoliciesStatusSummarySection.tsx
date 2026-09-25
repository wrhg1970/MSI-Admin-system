import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';
import { 
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  DollarSign, 
  FileSpreadsheet, 
  Receipt, 
  ArrowRight, 
  TrendingUp, 
  Layers, 
  CreditCard,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { InsuranceRequest, Policy } from '../types';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { isInsuranceDeudor, getInsurancePaymentBalance } from '../utils/paymentUtils';
import { getNormalizedYYYYMMDD } from '../lib/policyUtils';

interface PoliciesStatusSummarySectionProps {
  insurances: InsuranceRequest[];
  policies?: Policy[];
  loading?: boolean;
  limitToCurrentMonth?: boolean;
  onToggleMonthLimit?: (val: boolean) => void;
}

export default function PoliciesStatusSummarySection({
  insurances,
  policies = [],
  loading = false,
  limitToCurrentMonth,
  onToggleMonthLimit
}: PoliciesStatusSummarySectionProps) {
  const navigate = useNavigate();

  // Local filter scope: 'all' | 'month' | 'last3months'
  const [timeScope, setTimeScope] = useState<'all' | 'month' | 'last3months'>('all');
  // Secondary chart mode: 'plan' | 'monthly' | 'pendingTypes'
  const [chartViewMode, setChartViewMode] = useState<'plan' | 'monthly' | 'pendingTypes'>('plan');
  // Active slice index for donut highlight (optional)
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const today = useMemo(() => new Date(), []);

  // Filter insurances by selected local time scope
  const scopedInsurances = useMemo(() => {
    if (timeScope === 'all') return insurances;

    const now = new Date();
    const startOfCurrentMonthStr = format(startOfMonth(now), 'yyyy-MM-dd');
    const endOfCurrentMonthStr = format(endOfMonth(now), 'yyyy-MM-dd');
    // Start of 90 days ago: 1st of month 2 months ago (covers 3 full months)
    const startOf90DaysStr = format(subMonths(now, 2), 'yyyy-MM-01');

    const startDateStr = timeScope === 'month' ? startOfCurrentMonthStr : startOf90DaysStr;
    const endDateStr = endOfCurrentMonthStr;

    return insurances.filter(ins => {
      const dateStr = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt) || getNormalizedYYYYMMDD(ins.startDate);
      if (!dateStr) return false;
      return dateStr >= startDateStr && dateStr <= endDateStr;
    });
  }, [insurances, timeScope]);

  // Status Metrics & Aggregations
  const metrics = useMemo(() => {
    let activeCount = 0;
    let activeFullyCleared = 0;
    let activeWithPending = 0;
    let expiredCount = 0;
    let cancelledCount = 0;

    let unpaidCount = 0;
    let totalUnpaidBalance = 0;
    let unexportedCount = 0;
    let uninvoicedCount = 0;
    let pendingStatusCount = 0;

    let totalVolumeUSD = 0;
    let activeVolumeUSD = 0;

    scopedInsurances.forEach(ins => {
      const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
      const price = ins.totalFinal !== undefined && ins.totalFinal !== null ? Number(ins.totalFinal) : Number(ins.totalPrice || 0);
      totalVolumeUSD += isCan ? 0 : price;

      if (isCan) {
        cancelledCount++;
        return;
      }

      const hasNotEnded = !ins.endDate || ins.endDate >= todayStr;
      const isDeudor = isInsuranceDeudor(ins);
      const isUnexp = !ins.Caremed;
      const isUninv = !ins.InvoiceCaremed;
      const isPendingStat = ins.status === 'pending';

      if (isDeudor) {
        unpaidCount++;
        const balance = getInsurancePaymentBalance(ins);
        if (balance > 0) totalUnpaidBalance += balance;
      }
      if (isUnexp) unexportedCount++;
      if (isUninv) uninvoicedCount++;
      if (isPendingStat) pendingStatusCount++;

      if (hasNotEnded) {
        activeCount++;
        activeVolumeUSD += price;
        const hasAnyPending = isDeudor || isUnexp || isUninv || isPendingStat;
        if (hasAnyPending) {
          activeWithPending++;
        } else {
          activeFullyCleared++;
        }
      } else {
        expiredCount++;
      }
    });

    const totalValid = activeCount + expiredCount;
    const totalCount = scopedInsurances.length;
    const activeRate = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
    const pendingRate = totalCount > 0 ? Math.round((activeWithPending / Math.max(activeCount, 1)) * 100) : 0;

    return {
      totalCount,
      activeCount,
      activeFullyCleared,
      activeWithPending,
      expiredCount,
      cancelledCount,
      unpaidCount,
      totalUnpaidBalance,
      unexportedCount,
      uninvoicedCount,
      pendingStatusCount,
      totalVolumeUSD,
      activeVolumeUSD,
      activeRate,
      pendingRate
    };
  }, [scopedInsurances, todayStr]);

  // Donut Chart Data: Active vs Breakdown of Pendings
  const donutData = useMemo(() => {
    return [
      {
        name: 'Activas al Día',
        value: metrics.activeFullyCleared,
        color: '#10B981', // Emerald
        description: 'Vigentes sin pagos o trámites pendientes'
      },
      {
        name: 'Activas con Pendientes',
        value: metrics.activeWithPending,
        color: '#F59E0B', // Amber
        description: 'Vigentes que requieren cobro, exportación o factura'
      },
      {
        name: 'Terminadas / Vencidas',
        value: metrics.expiredCount,
        color: '#94A3B8', // Slate
        description: 'Fecha de vigencia concluida'
      },
      {
        name: 'Canceladas',
        value: metrics.cancelledCount,
        color: '#EF4444', // Red
        description: 'Pólizas canceladas'
      }
    ].filter(item => item.value > 0);
  }, [metrics]);

  // Secondary Chart Data: By Plan
  const planData = useMemo(() => {
    const plansMap: Record<string, { name: string; activas: number; pendientes: number; total: number }> = {};

    scopedInsurances.forEach(ins => {
      const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
      if (isCan) return;

      const policy = policies.find(p => p.id === ins.policyId);
      let planKey = (ins.plan || policy?.plan || ins.policyId?.split('-')[0] || 'Otros').toUpperCase().trim();
      if (planKey.includes('TRAVEL')) planKey = 'TRAVELER';
      else if (planKey.includes('STUDENT')) planKey = 'STUDENT';
      else if (planKey.includes('U6')) planKey = 'U6';
      else if (planKey.includes('O70')) planKey = 'O70';
      else if (planKey.includes('XTREME')) planKey = 'XTREME';

      if (!plansMap[planKey]) {
        plansMap[planKey] = { name: planKey, activas: 0, pendientes: 0, total: 0 };
      }

      const hasNotEnded = !ins.endDate || ins.endDate >= todayStr;
      const isPending = isInsuranceDeudor(ins) || !ins.Caremed || !ins.InvoiceCaremed || ins.status === 'pending';

      plansMap[planKey].total++;
      if (hasNotEnded) {
        plansMap[planKey].activas++;
      }
      if (isPending) {
        plansMap[planKey].pendientes++;
      }
    });

    return Object.values(plansMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [scopedInsurances, policies, todayStr]);

  // Secondary Chart Data: Monthly Trend (Last 6 Months)
  const monthlyData = useMemo(() => {
    const monthsMap: Record<string, { monthKey: string; label: string; activas: number; pendientes: number; total: number }> = {};
    const now = new Date();

    // Generate slots for last 6 months in chronological order
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      const key = format(d, 'yyyy-MM');
      const label = format(d, 'MMM yy', { locale: es });
      monthsMap[key] = { monthKey: key, label: label.toUpperCase(), activas: 0, pendientes: 0, total: 0 };
    }

    scopedInsurances.forEach(ins => {
      const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
      if (isCan) return;

      const dateStr = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      if (!dateStr) return;

      const key = dateStr.substring(0, 7);
      if (monthsMap[key]) {
        monthsMap[key].total++;
        const hasNotEnded = !ins.endDate || ins.endDate >= todayStr;
        const isPending = isInsuranceDeudor(ins) || !ins.Caremed || !ins.InvoiceCaremed || ins.status === 'pending';
        if (hasNotEnded) monthsMap[key].activas++;
        if (isPending) monthsMap[key].pendientes++;
      }
    });

    return Object.values(monthsMap);
  }, [scopedInsurances, todayStr]);

  // Secondary Chart Data: Breakdown of Pending Reasons
  const pendingBreakdownData = useMemo(() => {
    return [
      {
        name: 'Sin Pagar (Deudor)',
        cantidad: metrics.unpaidCount,
        fill: '#F43F5E',
        detalle: `$${metrics.totalUnpaidBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD por cobrar`,
        link: '/policies?filter=unpaid'
      },
      {
        name: 'Sin Exportar Caremed',
        cantidad: metrics.unexportedCount,
        fill: '#F59E0B',
        detalle: 'Pendiente de transmisión al proveedor',
        link: '/policies?filter=unexported'
      },
      {
        name: 'Sin Factura / Invoice',
        cantidad: metrics.uninvoicedCount,
        fill: '#6366F1',
        detalle: 'Sin registro contable de invoice asignado',
        link: '/policies?tab=caremed'
      },
      {
        name: 'Estado En Trámite',
        cantidad: metrics.pendingStatusCount,
        fill: '#8B5CF6',
        detalle: 'Status administrativo "pending"',
        link: '/policies?filter=pending'
      }
    ];
  }, [metrics]);

  return (
    <section className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-6 sm:p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-gray-100 pb-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 px-3 py-1 rounded-full border border-blue-100">
              <Sparkles className="w-3 h-3 text-blue-600" />
              Panel de Control Administrativo
            </span>
            {limitToCurrentMonth && (
              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200">
                Filtro Mes Activo
              </span>
            )}
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-[#1A2138] uppercase tracking-tight flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
            Resumen de Pólizas: Activas vs Pendientes
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 font-medium flex flex-wrap items-center gap-2">
            <span>Supervisión integral de vigencia operativa, requerimientos administrativos y cuentas por regularizar.</span>
            <span className="font-bold text-blue-600 bg-blue-50/80 px-2 py-0.5 rounded-lg border border-blue-100 text-xs">
              {timeScope === 'all' ? 'Todo el Histórico' : timeScope === 'month' ? 'Este Mes' : 'Últimos 90 Días'}: {scopedInsurances.length} pólizas
            </span>
          </p>
        </div>

        {/* Action and Scope Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time Scope Toggle */}
          <div className="bg-gray-100 p-1 rounded-2xl border border-gray-200 inline-flex text-xs font-black">
            <button
              onClick={() => {
                setTimeScope('all');
                if (limitToCurrentMonth && onToggleMonthLimit) {
                  onToggleMonthLimit(false);
                }
              }}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer uppercase ${
                timeScope === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Todo
            </button>
            <button
              onClick={() => setTimeScope('month')}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer uppercase ${
                timeScope === 'month' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Este Mes
            </button>
            <button
              onClick={() => {
                setTimeScope('last3months');
                if (limitToCurrentMonth && onToggleMonthLimit) {
                  onToggleMonthLimit(false);
                }
              }}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer uppercase ${
                timeScope === 'last3months' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Últimos 90 Días
            </button>
          </div>

          {/* Quick link to Policies */}
          <button
            onClick={() => navigate('/policies')}
            className="flex items-center gap-2 bg-[#1A2138] hover:bg-blue-600 text-white font-black text-xs px-4 py-2.5 rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer uppercase tracking-wider"
          >
            <span>Gestión Completa</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI Highlight Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: Pólizas Activas */}
        <div 
          onClick={() => navigate('/policies?filter=active')}
          className="bg-emerald-50/60 hover:bg-emerald-50 border border-emerald-100 p-5 rounded-3xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
              Pólizas Activas
            </span>
            <div className="p-2 bg-emerald-500 text-white rounded-xl group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-950">
              {metrics.activeCount}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              ({metrics.activeRate}% del total)
            </span>
          </div>
          <p className="text-[11px] text-emerald-800/80 font-medium mt-1">
            Vigentes hoy ({metrics.activeFullyCleared} completamente al día)
          </p>
        </div>

        {/* Card 2: Con Saldo Pendiente */}
        <div 
          onClick={() => navigate('/policies?filter=unpaid')}
          className="bg-rose-50/60 hover:bg-rose-50 border border-rose-100 p-5 rounded-3xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">
              Pendientes de Pago
            </span>
            <div className="p-2 bg-rose-500 text-white rounded-xl group-hover:scale-110 transition-transform">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-950">
              {metrics.unpaidCount}
            </span>
            <span className="text-xs font-bold text-rose-700">
              ${metrics.totalUnpaidBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
            </span>
          </div>
          <p className="text-[11px] text-rose-800/80 font-medium mt-1">
            Saldo pendiente por liquidar en caja
          </p>
        </div>

        {/* Card 3: Sin Exportar a Caremed */}
        <div 
          onClick={() => navigate('/policies?filter=unexported')}
          className="bg-amber-50/60 hover:bg-amber-50 border border-amber-100 p-5 rounded-3xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">
              Sin Exportar Caremed
            </span>
            <div className="p-2 bg-amber-500 text-white rounded-xl group-hover:scale-110 transition-transform">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-950">
              {metrics.unexportedCount}
            </span>
            <span className="text-xs font-bold text-amber-700">
              pendientes
            </span>
          </div>
          <p className="text-[11px] text-amber-800/80 font-medium mt-1">
            Requieren envío al layout mensual de emisión
          </p>
        </div>

        {/* Card 4: Sin Invoice Asociado */}
        <div 
          onClick={() => navigate('/policies?tab=caremed')}
          className="bg-indigo-50/60 hover:bg-indigo-50 border border-indigo-100 p-5 rounded-3xl transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-800">
              Sin Invoice Asignado
            </span>
            <div className="p-2 bg-indigo-500 text-white rounded-xl group-hover:scale-110 transition-transform">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-indigo-950">
              {metrics.uninvoicedCount}
            </span>
            <span className="text-xs font-bold text-indigo-700">
              por conciliar
            </span>
          </div>
          <p className="text-[11px] text-indigo-800/80 font-medium mt-1">
            Falta vincular número de factura del proveedor
          </p>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Chart 1: Donut Distribution (5 cols) */}
        <div className="lg:col-span-5 bg-gray-50/60 border border-gray-100 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-black text-[#1A2138] uppercase tracking-tight flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                Distribución de Estado Operativo
              </h3>
              <span className="text-xs font-bold text-gray-400">
                {metrics.totalCount} evaluadas
              </span>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-4">
              Proporción de pólizas en vigor vs. pólizas con trámites o adeudos pendientes.
            </p>
          </div>

          <div className="relative h-[260px] w-full flex items-center justify-center my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={105}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={2}
                  stroke="#ffffff"
                >
                  {donutData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.color} 
                      className="transition-opacity duration-200 hover:opacity-85 cursor-pointer outline-none"
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val: any, name: any, item: any) => [
                    `${val} pólizas (${Math.round((Number(val) / Math.max(metrics.totalCount, 1)) * 100)}%)`,
                    item.payload.name
                  ]}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: '1rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                    fontWeight: 700,
                    fontSize: '12px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Donut Center Info */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <span className="text-3xl font-black text-[#1A2138] leading-none">
                {metrics.activeRate}%
              </span>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 mt-1">
                Tasa Activa
              </span>
              <span className="text-[9px] text-gray-400 font-bold">
                {metrics.activeCount} de {metrics.totalCount}
              </span>
            </div>
          </div>

          {/* Interactive Legend List */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200/60">
            {donutData.map((item) => (
              <div 
                key={item.name} 
                className="flex items-center gap-2 p-2 rounded-xl bg-white border border-gray-100 hover:border-gray-300 transition-colors"
              >
                <div 
                  className="w-3 h-3 rounded-full shrink-0" 
                  style={{ backgroundColor: item.color }} 
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-900 leading-none">
                    <span className="truncate">{item.name}</span>
                    <span className="font-black ml-1">{item.value}</span>
                  </div>
                  <span className="text-[9px] text-gray-400 font-medium block truncate">
                    {item.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart 2: Comparative Bar Chart (7 cols) */}
        <div className="lg:col-span-7 bg-gray-50/60 border border-gray-100 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
              <h3 className="text-base font-black text-[#1A2138] uppercase tracking-tight flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                Comparativa: Activas vs Requerimientos
              </h3>

              {/* View Switcher for Bar Chart */}
              <div className="bg-gray-200/80 p-1 rounded-xl inline-flex text-[11px] font-black">
                <button
                  onClick={() => setChartViewMode('plan')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer uppercase ${
                    chartViewMode === 'plan' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Por Plan
                </button>
                <button
                  onClick={() => setChartViewMode('monthly')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer uppercase ${
                    chartViewMode === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Mensual
                </button>
                <button
                  onClick={() => setChartViewMode('pendingTypes')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer uppercase ${
                    chartViewMode === 'pendingTypes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Detalle Pendientes
                </button>
              </div>
            </div>
            
            <p className="text-xs text-gray-500 font-medium mb-4">
              {chartViewMode === 'plan' && 'Distribución de pólizas activas contra pólizas que presentan pendientes según el plan contratado.'}
              {chartViewMode === 'monthly' && 'Evolución cronológica de emisiones vigentes frente a aquellas con tareas operativas pendientes.'}
              {chartViewMode === 'pendingTypes' && 'Desglose específico de tareas operativas pendientes: pagos, layout Caremed y facturas.'}
            </p>
          </div>

          <div className="h-[280px] w-full">
            {chartViewMode === 'plan' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={planData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '1rem',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    align="right" 
                    wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 700 }} 
                  />
                  <Bar name="Activas Vigentes" dataKey="activas" fill="#10B981" radius={[8, 8, 0, 0]} />
                  <Bar name="Con Pendientes" dataKey="pendientes" fill="#F43F5E" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}

            {chartViewMode === 'monthly' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '1rem',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    align="right" 
                    wrapperStyle={{ paddingBottom: '12px', fontSize: '11px', fontWeight: 700 }} 
                  />
                  <Bar name="Activas Vigentes" dataKey="activas" fill="#3B82F6" radius={[8, 8, 0, 0]} />
                  <Bar name="Con Pendientes" dataKey="pendientes" fill="#F59E0B" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}

            {chartViewMode === 'pendingTypes' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  layout="vertical" 
                  data={pendingBreakdownData} 
                  margin={{ top: 10, right: 20, left: 30, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: '#64748b' }} />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    tickLine={false} 
                    axisLine={false} 
                    tick={{ fontSize: 11, fontWeight: 700, fill: '#1e293b' }} 
                    width={140}
                  />
                  <Tooltip
                    formatter={(val: any, name: any, item: any) => [
                      `${val} pólizas`,
                      item.payload.detalle
                    ]}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '1rem',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                      fontWeight: 700,
                      fontSize: '12px'
                    }}
                  />
                  <Bar 
                    dataKey="cantidad" 
                    radius={[0, 8, 8, 0]} 
                    name="Pólizas Pendientes"
                  >
                    {pendingBreakdownData.map((entry, index) => (
                      <Cell key={`bar-cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Quick Action Buttons for Administrators */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-gray-200/60 text-center">
            <button
              onClick={() => navigate('/policies?filter=active')}
              className="px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/30 text-emerald-800 text-[11px] font-black uppercase transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Ver Activas</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigate('/policies?filter=unpaid')}
              className="px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-rose-500 hover:bg-rose-50/30 text-rose-800 text-[11px] font-black uppercase transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Cobrar Deudores</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigate('/policies?filter=unexported')}
              className="px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-amber-500 hover:bg-amber-50/30 text-amber-800 text-[11px] font-black uppercase transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Exportar Layout</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigate('/policies?tab=caremed')}
              className="px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/30 text-indigo-800 text-[11px] font-black uppercase transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>Asignar Invoices</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>
    </section>
  );
}
