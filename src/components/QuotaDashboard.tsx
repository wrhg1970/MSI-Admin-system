import React, { useState, useEffect } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  PieChart, 
  Pie, 
  Cell, 
  AreaChart, 
  Area,
  CartesianGrid
} from 'recharts';
import { 
  Activity, 
  Database, 
  Layers, 
  Cpu, 
  RefreshCw, 
  Trash2, 
  Clock, 
  TrendingUp, 
  AlertTriangle,
  FileText,
  Play,
  CheckCircle,
  HelpCircle,
  TrendingDown
} from 'lucide-react';

interface TelemetryEntry {
  timestamp: number;
  operation: 'read' | 'write' | 'delete';
  collection: string;
  docId: string;
  source: string;
}

interface HourlyAgg {
  reads: number;
  writes: number;
  deletes: number;
  collections: { [col: string]: { reads: number; writes: number; deletes: number } };
  sources: { [src: string]: { reads: number; writes: number; deletes: number } };
}

export default function QuotaDashboard() {
  const [recentLogs, setRecentLogs] = useState<TelemetryEntry[]>([]);
  const [aggregated, setAggregated] = useState<{ [hourKey: string]: HourlyAgg }>({});
  const [activeTab, setActiveTab] = useState<'overview' | 'collections' | 'processes' | 'logs'>('overview');
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | '6h'>('all');
  const [showSimulateInfo, setShowSimulateInfo] = useState(false);

  // Firestore free-tier daily quotas
  const READ_LIMIT = 50000;
  const WRITE_LIMIT = 20000;
  const DELETE_LIMIT = 20000;

  useEffect(() => {
    loadData();

    // Listen to custom event dispatched by firebase.ts
    const handleUpdate = () => {
      loadData();
    };

    window.addEventListener('firestore_telemetry_updated', handleUpdate);
    return () => {
      window.removeEventListener('firestore_telemetry_updated', handleUpdate);
    };
  }, []);

  const loadData = () => {
    try {
      const storedLogs = localStorage.getItem('firestore_telemetry_recent_v1');
      const storedAgg = localStorage.getItem('firestore_telemetry_aggregated_v1');

      if (storedLogs) {
        setRecentLogs(JSON.parse(storedLogs));
      } else {
        setRecentLogs([]);
      }

      if (storedAgg) {
        setAggregated(JSON.parse(storedAgg));
      } else {
        setAggregated({});
      }
    } catch (e) {
      console.error('Error loading telemetry data:', e);
    }
  };

  const handleClearTelemetry = () => {
    if (confirm('¿Estás seguro de que deseas restablecer todo el historial de métricas locales de cuota?')) {
      localStorage.removeItem('firestore_telemetry_recent_v1');
      localStorage.removeItem('firestore_telemetry_aggregated_v1');
      setRecentLogs([]);
      setAggregated({});
    }
  };

  // Pre-seed some default simulation logs if empty to show beautiful chart previews
  const handleSeedDemoData = () => {
    const demoLogs: TelemetryEntry[] = [];
    const demoAgg: { [key: string]: HourlyAgg } = {};
    const now = Date.now();

    const collections = ['policies', 'countries', 'insurances', 'users', 'logs', 'commissions'];
    const sources = ['PoliciesManager', 'Dashboard', 'ConfigPanel', 'CommissionsManager', 'Auth', 'CatalogsManager'];
    const ops: ('read' | 'write' | 'delete')[] = ['read', 'read', 'read', 'write', 'read', 'delete'];

    // Create logs for the last 6 hours
    for (let h = 5; h >= 0; h--) {
      const hourTime = now - h * 3600000;
      const date = new Date(hourTime);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const hourKey = `${year}-${month}-${day} ${hour}:00`;

      const hourlyData: HourlyAgg = {
        reads: 0,
        writes: 0,
        deletes: 0,
        collections: {},
        sources: {}
      };

      // Seed 10-25 operations per hour
      const numOps = Math.floor(Math.random() * 15) + 10;
      for (let i = 0; i < numOps; i++) {
        const col = collections[Math.floor(Math.random() * collections.length)];
        const src = sources[Math.floor(Math.random() * sources.length)];
        const op = ops[Math.floor(Math.random() * ops.length)];
        const timestamp = hourTime - Math.floor(Math.random() * 1800000);

        if (op === 'read') hourlyData.reads += Math.floor(Math.random() * 8) + 1;
        else if (op === 'write') hourlyData.writes++;
        else if (op === 'delete') hourlyData.deletes++;

        // Collection aggregate
        if (!hourlyData.collections[col]) hourlyData.collections[col] = { reads: 0, writes: 0, deletes: 0 };
        if (op === 'read') hourlyData.collections[col].reads += 5;
        else if (op === 'write') hourlyData.collections[col].writes++;
        else if (op === 'delete') hourlyData.collections[col].deletes++;

        // Source aggregate
        if (!hourlyData.sources[src]) hourlyData.sources[src] = { reads: 0, writes: 0, deletes: 0 };
        if (op === 'read') hourlyData.sources[src].reads += 5;
        else if (op === 'write') hourlyData.sources[src].writes++;
        else if (op === 'delete') hourlyData.sources[src].deletes++;

        demoLogs.push({
          timestamp,
          operation: op,
          collection: col,
          docId: 'demo_' + Math.random().toString(36).substr(2, 6),
          source: src
        });
      }

      demoAgg[hourKey] = hourlyData;
    }

    localStorage.setItem('firestore_telemetry_recent_v1', JSON.stringify(demoLogs.slice(0, 300)));
    localStorage.setItem('firestore_telemetry_aggregated_v1', JSON.stringify(demoAgg));
    loadData();
  };

  // Process data for overview chart (Reads, Writes, Deletes over time)
  const getTimelineData = () => {
    const keys = Object.keys(aggregated).sort();
    const filteredKeys = keys.filter(key => {
      if (timeFilter === '6h') {
        const hourTime = new Date(key).getTime();
        return Date.now() - hourTime <= 6 * 3600000;
      }
      if (timeFilter === '24h') {
        const hourTime = new Date(key).getTime();
        return Date.now() - hourTime <= 24 * 3600000;
      }
      return true;
    });

    return filteredKeys.map(key => {
      const data = aggregated[key];
      // Format hour key for readability "HH:00"
      const timeStr = key.split(' ')[1] || key;
      return {
        name: timeStr,
        Lecturas: data.reads || 0,
        Escrituras: data.writes || 0,
        Eliminaciones: data.deletes || 0,
        Total: (data.reads || 0) + (data.writes || 0) + (data.deletes || 0)
      };
    });
  };

  // Process data for Collections chart
  const getCollectionsData = () => {
    const totals: { [col: string]: { name: string; Lecturas: number; Escrituras: number; Eliminaciones: number; Total: number } } = {};

    Object.keys(aggregated).forEach(hourKey => {
      const hourData = aggregated[hourKey];
      if (hourData.collections) {
        Object.keys(hourData.collections).forEach(col => {
          if (!totals[col]) {
            totals[col] = { name: col, Lecturas: 0, Escrituras: 0, Eliminaciones: 0, Total: 0 };
          }
          const stats = hourData.collections[col];
          totals[col].Lecturas += stats.reads || 0;
          totals[col].Escrituras += stats.writes || 0;
          totals[col].Eliminaciones += stats.deletes || 0;
          totals[col].Total += (stats.reads || 0) + (stats.writes || 0) + (stats.deletes || 0);
        });
      }
    });

    return Object.values(totals).sort((a, b) => b.Total - a.Total);
  };

  // Process data for Components/Processes chart
  const getSourcesData = () => {
    const totals: { [src: string]: { name: string; Lecturas: number; Escrituras: number; Eliminaciones: number; Total: number } } = {};

    Object.keys(aggregated).forEach(hourKey => {
      const hourData = aggregated[hourKey];
      if (hourData.sources) {
        Object.keys(hourData.sources).forEach(src => {
          if (!totals[src]) {
            totals[src] = { name: src, Lecturas: 0, Escrituras: 0, Eliminaciones: 0, Total: 0 };
          }
          const stats = hourData.sources[src];
          totals[src].Lecturas += stats.reads || 0;
          totals[src].Escrituras += stats.writes || 0;
          totals[src].Eliminaciones += stats.deletes || 0;
          totals[src].Total += (stats.reads || 0) + (stats.writes || 0) + (stats.deletes || 0);
        });
      }
    });

    return Object.values(totals).sort((a, b) => b.Total - a.Total);
  };

  // Calculate overall totals
  const getOverallTotals = () => {
    let reads = 0;
    let writes = 0;
    let deletes = 0;

    Object.values(aggregated).forEach(hourData => {
      reads += hourData.reads || 0;
      writes += hourData.writes || 0;
      deletes += hourData.deletes || 0;
    });

    return { reads, writes, deletes, total: reads + writes + deletes };
  };

  const totals = getOverallTotals();
  const timelineData = getTimelineData();
  const collectionsData = getCollectionsData();
  const sourcesData = getSourcesData();

  // Pie chart colors
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280'];

  // Identify the most expensive collection & component
  const mostExpensiveCollection = collectionsData[0] || { name: 'Ninguna', Total: 0 };
  const mostExpensiveSource = sourcesData[0] || { name: 'Ninguno', Total: 0 };

  return (
    <div id="quota-dashboard-container" className="bg-white border border-gray-100 rounded-3xl shadow-sm overflow-hidden animate-in fade-in duration-500">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-gray-900 via-slate-900 to-zinc-900 p-6 md:p-8 text-white relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-48 h-48 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border border-emerald-500/30">
                Monitoreo en Vivo
              </span>
              <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border border-blue-500/30">
                Local No-Quota
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Activity className="w-8 h-8 text-blue-400 animate-pulse shrink-0" />
              Monitor de Cuota Firestore
            </h2>
            <p className="text-sm text-slate-300 mt-1.5 max-w-xl leading-relaxed">
              Analiza en tiempo real las operaciones de lectura, escritura y eliminación para identificar bucles infinitos, componentes ineficientes y evitar sorpresas de consumo de cuota.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold px-4 py-2.5 rounded-xl transition-all border border-slate-700/50"
              title="Recargar Métricas"
            >
              <RefreshCw className="w-4 h-4" />
              Actualizar
            </button>

            {recentLogs.length === 0 && (
              <button
                onClick={handleSeedDemoData}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-blue-500/20"
              >
                <Play className="w-4 h-4 fill-current" />
                Cargar Demo
              </button>
            )}

            <button
              onClick={handleClearTelemetry}
              className="flex items-center gap-1.5 bg-red-950/40 hover:bg-red-950/70 text-red-300 hover:text-red-100 text-xs font-bold px-4 py-2.5 rounded-xl transition-all border border-red-500/20"
              title="Borrar Datos"
            >
              <Trash2 className="w-4 h-4" />
              Limpiar Monitor
            </button>
          </div>
        </div>
      </div>

      {/* Main Stats Cards Grid */}
      <div className="p-6 md:p-8 border-b border-gray-100 bg-gray-50/50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Read Quota progress */}
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Lecturas de Docs</span>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Database className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-gray-900">{totals.reads.toLocaleString()}</div>
              <p className="text-[11px] text-gray-500 mt-0.5">Límite Diario Gratuito: {READ_LIMIT.toLocaleString()}</p>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[10px] font-bold text-gray-600 mb-1">
                <span>Consumo Estimado</span>
                <span>{((totals.reads / READ_LIMIT) * 100).toFixed(2)}%</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    (totals.reads / READ_LIMIT) > 0.8 ? 'bg-red-500' : (totals.reads / READ_LIMIT) > 0.5 ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, (totals.reads / READ_LIMIT) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Write Quota progress */}
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Escrituras de Docs</span>
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <TrendingUp className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-gray-900">{totals.writes.toLocaleString()}</div>
              <p className="text-[11px] text-gray-500 mt-0.5">Límite Diario Gratuito: {WRITE_LIMIT.toLocaleString()}</p>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[10px] font-bold text-gray-600 mb-1">
                <span>Consumo Estimado</span>
                <span>{((totals.writes / WRITE_LIMIT) * 100).toFixed(2)}%</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    (totals.writes / WRITE_LIMIT) > 0.8 ? 'bg-red-500' : (totals.writes / WRITE_LIMIT) > 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (totals.writes / WRITE_LIMIT) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Eliminaciones Quota progress */}
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Eliminaciones</span>
                <span className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-gray-900">{totals.deletes.toLocaleString()}</div>
              <p className="text-[11px] text-gray-500 mt-0.5">Límite Diario Gratuito: {DELETE_LIMIT.toLocaleString()}</p>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[10px] font-bold text-gray-600 mb-1">
                <span>Consumo Estimado</span>
                <span>{((totals.deletes / DELETE_LIMIT) * 100).toFixed(2)}%</span>
              </div>
              <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    (totals.deletes / DELETE_LIMIT) > 0.8 ? 'bg-red-500' : (totals.deletes / DELETE_LIMIT) > 0.5 ? 'bg-amber-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, (totals.deletes / DELETE_LIMIT) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Quota Alarms & Diagnósticos */}
          <div className="p-5 rounded-2xl border border-blue-100 bg-blue-50/40 shadow-sm flex flex-col justify-between">
            <div>
              <h4 className="text-xs font-black text-blue-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-blue-600 shrink-0" />
                Diagnóstico de Salud
              </h4>
              
              {totals.total === 0 ? (
                <p className="text-xs text-blue-800 leading-relaxed">
                  No se han registrado operaciones en esta sesión todavía. Prueba a navegar por la app o presiona <strong>"Cargar Demo"</strong>.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="font-bold text-gray-700">Colección crítica: </span>
                    <span className="font-extrabold text-blue-900 bg-blue-100/50 px-1.5 py-0.5 rounded capitalize">{mostExpensiveCollection.name}</span>
                    <span className="text-gray-500 text-[10px] ml-1">({mostExpensiveCollection.Total} ops)</span>
                  </div>
                  <div>
                    <span className="font-bold text-gray-700">Módulo más costoso: </span>
                    <span className="font-extrabold text-indigo-900 bg-indigo-100/50 px-1.5 py-0.5 rounded">{mostExpensiveSource.name}</span>
                    <span className="text-gray-500 text-[10px] ml-1">({mostExpensiveSource.Total} ops)</span>
                  </div>
                  {mostExpensiveCollection.name === 'logs' && (
                    <div className="text-[11px] text-amber-700 font-medium leading-tight">
                      ⚠️ Atención: La colección 'logs' genera muchas escrituras. Considera reducir la frecuencia de registro de eventos redundantes.
                    </div>
                  )}
                </div>
              )}
            </div>

            <button 
              onClick={() => setShowSimulateInfo(!showSimulateInfo)}
              className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline text-left mt-3"
            >
              {showSimulateInfo ? 'Ocultar sugerencias' : '¿Cómo se evitan cargos de cuota?'}
            </button>
          </div>
        </div>

        {/* Suggestion alert */}
        {showSimulateInfo && (
          <div className="mt-5 p-4 bg-emerald-50 text-emerald-900 rounded-2xl border border-emerald-100 text-xs animate-in slide-in-from-top-2 duration-300">
            <h5 className="font-bold mb-1 flex items-center gap-1">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              Estrategias Clave de Optimización de Firestore:
            </h5>
            <ul className="list-disc pl-5 space-y-1 mt-1 text-emerald-800">
              <li><strong>Habilitar persistencia sin conexión (Offline Cache):</strong> Esta aplicación ya tiene el caché local persistente habilitado. Las lecturas subsiguientes se sirven desde el almacenamiento local del navegador en lugar de consultar Firestore, lo que reduce las llamadas de red a 0.</li>
              <li><strong>Evitar onSnapshot redundantes:</strong> Asegúrate de desuscribir los listeners de tiempo real (`return unsubscribe;` en `useEffect`). Un listener abierto de manera indefinida consumirá lecturas cada vez que un registro de esa colección cambie.</li>
              <li><strong>Escribir en Lotes (Batches):</strong> Al importar muchos registros (como en restauraciones), se recomienda usar `writeBatch` para agrupar hasta 500 operaciones en un solo paquete de red en lugar de hacer solicitudes individuales.</li>
              <li><strong>Límites en Consultas (Limit):</strong> Aplica siempre `.limit(20)` o `.limit(50)` en tus listados para evitar descargar miles de documentos innecesariamente.</li>
            </ul>
          </div>
        )}
      </div>

      {recentLogs.length === 0 ? (
        /* Empty State */
        <div className="p-12 text-center flex flex-col items-center justify-center">
          <Database className="w-16 h-16 text-gray-300 mb-4 animate-bounce" />
          <h3 className="text-lg font-black text-gray-900 mb-1">Sin Operaciones Registradas</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed mb-6">
            Aún no se han capturado lecturas o escrituras de Firestore. Navega por las secciones de pólizas, comisiones o clientes de la plataforma para ver la telemetría en tiempo real, o haz clic en "Cargar Demo" para previsualizar los gráficos de rendimiento.
          </p>
          <button
            onClick={handleSeedDemoData}
            className="bg-gray-900 hover:bg-gray-800 text-white font-bold text-xs px-6 py-3 rounded-2xl transition-all shadow-lg shadow-gray-900/10"
          >
            Cargar Datos de Demostración
          </button>
        </div>
      ) : (
        /* Charts & Live Logs Tabs */
        <div className="p-6 md:p-8">
          {/* Tabs header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-6">
            <div className="flex gap-2 bg-gray-100/80 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'overview' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  Tendencia Temporal
                </div>
              </button>

              <button
                onClick={() => setActiveTab('collections')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'collections' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Por Colección
                </div>
              </button>

              <button
                onClick={() => setActiveTab('processes')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'processes' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  Por Proceso/Módulo
                </div>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeTab === 'logs' 
                    ? 'bg-white text-gray-900 shadow-sm' 
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Registro en Vivo
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-1.5 py-0.5 rounded-full ml-1">
                    {recentLogs.length}
                  </span>
                </div>
              </button>
            </div>

            {/* Time Filter for Timeline Tab */}
            {activeTab === 'overview' && (
              <div className="flex gap-1.5 bg-gray-50 border border-gray-100 p-1 rounded-xl">
                {(['all', '24h', '6h'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setTimeFilter(f)}
                    className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${
                      timeFilter === f 
                        ? 'bg-gray-900 text-white shadow-sm' 
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {f === 'all' ? 'Todo' : f === '24h' ? 'Últimas 24h' : 'Últimas 6h'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* TAB CONTENTS */}
          
          {/* 1. OVERVIEW TREND TIMELINE */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="h-[300px] w-full bg-white rounded-2xl border border-gray-50 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorReads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorWrites" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorDeletes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                      labelStyle={{ fontWeight: 'bold', color: '#94a3b8' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                    <Area type="monotone" dataKey="Lecturas" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorReads)" />
                    <Area type="monotone" dataKey="Escrituras" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorWrites)" />
                    <Area type="monotone" dataKey="Eliminaciones" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorDeletes)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Quick Summary Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center gap-3">
                  <div className="p-3 bg-blue-100/60 text-blue-700 rounded-xl">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Carga de Operaciones</h5>
                    <p className="text-sm font-black text-slate-900">
                      {timelineData.length > 0 
                        ? `${(totals.total / timelineData.length).toFixed(1)} ops / hora`
                        : '0 ops / hora'
                      }
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center gap-3">
                  <div className="p-3 bg-emerald-100/60 text-emerald-700 rounded-xl">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tasa de Escritura/Lectura</h5>
                    <p className="text-sm font-black text-slate-900">
                      {totals.reads > 0 
                        ? `1 : ${(totals.reads / (totals.writes || 1)).toFixed(1)} (E:L)`
                        : '1 : 0 (E:L)'
                      }
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center gap-3">
                  <div className="p-3 bg-amber-100/60 text-amber-700 rounded-xl">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Última Operación</h5>
                    <p className="text-sm font-black text-slate-900">
                      {recentLogs.length > 0 
                        ? new Date(recentLogs[0].timestamp).toLocaleTimeString()
                        : 'No registrado'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. COLLECTIONS BAR CHART & TABLE */}
          {activeTab === 'collections' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Bar Chart */}
              <div className="bg-white p-4 border border-gray-100 rounded-2xl">
                <h4 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-4">Distribución por Colección</h4>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={collectionsData.slice(0, 8)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="Lecturas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Escrituras" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Eliminaciones" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Data Table */}
              <div className="border border-gray-100 rounded-2xl overflow-hidden flex flex-col justify-between">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      <th className="p-3.5 pl-5">Colección</th>
                      <th className="p-3.5">Lecturas</th>
                      <th className="p-3.5">Escrituras</th>
                      <th className="p-3.5">Eliminaciones</th>
                      <th className="p-3.5 text-right pr-5">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {collectionsData.map((col, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-3.5 pl-5 font-bold text-gray-900 capitalize flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          {col.name}
                        </td>
                        <td className="p-3.5 text-gray-600 font-mono">{col.Lecturas.toLocaleString()}</td>
                        <td className="p-3.5 text-gray-600 font-mono">{col.Escrituras.toLocaleString()}</td>
                        <td className="p-3.5 text-gray-600 font-mono">{col.Eliminaciones.toLocaleString()}</td>
                        <td className="p-3.5 text-right font-black text-gray-950 pr-5 font-mono">{col.Total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {collectionsData.length === 0 && (
                  <div className="p-8 text-center text-gray-500 text-xs">Ninguna colección registrada todavía.</div>
                )}
              </div>
            </div>
          )}

          {/* 3. PROCESSES / COMPONENT TELEMETRY */}
          {activeTab === 'processes' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Bar Chart */}
              <div className="bg-white p-4 border border-gray-100 rounded-2xl">
                <h4 className="text-xs font-black text-gray-500 uppercase tracking-wider mb-4">Consumo por Componente React</h4>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourcesData.slice(0, 8)} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={9} tickLine={false} />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={9} tickLine={false} width={100} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="Lecturas" fill="#3b82f6" stackId="a" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Escrituras" fill="#10b981" stackId="a" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Eliminaciones" fill="#f59e0b" stackId="a" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Data List */}
              <div className="border border-gray-100 rounded-2xl overflow-hidden">
                <div className="bg-gray-50 p-3.5 border-b border-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-wider pl-5">
                  Análisis de Procesos Activos
                </div>
                <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                  {sourcesData.map((src, idx) => (
                    <div key={idx} className="p-4 pl-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                      <div>
                        <div className="font-extrabold text-xs text-gray-900">{src.name}</div>
                        <div className="flex gap-3 text-[10px] text-gray-500 mt-1">
                          <span>Lecturas: <strong className="font-bold text-gray-700">{src.Lecturas}</strong></span>
                          <span>Escrituras: <strong className="font-bold text-gray-700">{src.Escrituras}</strong></span>
                          <span>Eliminados: <strong className="font-bold text-gray-700">{src.Eliminaciones}</strong></span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-mono font-black text-gray-950">{src.Total} ops</div>
                        <div className="text-[9px] text-gray-400 font-bold uppercase mt-0.5">
                          {((src.Total / totals.total) * 100).toFixed(1)}% del total
                        </div>
                      </div>
                    </div>
                  ))}
                  {sourcesData.length === 0 && (
                    <div className="p-8 text-center text-gray-500 text-xs">Ningún proceso registrado todavía.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. RECENT LEDGER TRANSACTION LIST */}
          {activeTab === 'logs' && (
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Historial Detallado de Consultas (Últimos 300)</span>
                <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full uppercase">Tiempo Real</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto font-mono text-[11px]">
                {recentLogs.map((log, idx) => (
                  <div key={idx} className="p-3.5 hover:bg-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-2.5 transition-colors">
                    <div className="flex items-start md:items-center gap-3">
                      {/* Operation Badge */}
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded shrink-0 ${
                        log.operation === 'read' 
                          ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                          : log.operation === 'write' 
                          ? 'bg-green-50 text-green-700 border border-green-200' 
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {log.operation === 'read' ? 'Lectura' : log.operation === 'write' ? 'Escritura' : 'Eliminar'}
                      </span>

                      <div>
                        <span className="text-gray-400">colección:</span>{' '}
                        <strong className="text-gray-900 font-bold capitalize">{log.collection}</strong>
                        <span className="text-gray-300 mx-2">|</span>
                        <span className="text-gray-400">id:</span>{' '}
                        <span className="text-gray-700 font-medium truncate max-w-[120px] inline-block align-bottom" title={log.docId}>
                          {log.docId}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right justify-between md:justify-end">
                      <div className="flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">
                        <Cpu className="w-3 h-3 text-slate-500" />
                        <span>{log.source}</span>
                      </div>
                      <span className="text-gray-400 text-[10px] shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
