import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, where, doc, updateDoc, orderBy, getDocs, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, UserProfile, Client, CustomRole } from '../types';
import { useSearchParams } from 'react-router-dom';
import { 
  DollarSign, 
  CheckCircle, 
  Clock, 
  Search, 
  Filter, 
  ArrowUpRight, 
  X, 
  Calendar, 
  CreditCard, 
  Upload, 
  FileText,
  Eye,
  Receipt,
  User,
  Mail,
  Info,
  Briefcase,
  Percent,
  CheckSquare,
  Square
} from 'lucide-react';
import TransactionModal from './TransactionModal';
import InsuranceDetailModal from './InsuranceDetailModal';
import { usePermissions } from '../hooks/usePermissions';

export default function CommissionsManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [searchParams] = useSearchParams();
  const [commissions, setCommissions] = useState<InsuranceRequest[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [agents, setAgents] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'paid'>('all');
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedCommission, setSelectedCommission] = useState<InsuranceRequest | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState('Transferencia');
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'MXP'>('USD');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentExchangeRate, setPaymentExchangeRate] = useState<number>(1);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  const [selectedInsuranceForDetail, setSelectedInsuranceForDetail] = useState<InsuranceRequest | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [saving, setSaving] = useState(false);

  // Filter state variables
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');

  // Bulk features state variables
  const [selectedCommissionIds, setSelectedCommissionIds] = useState<string[]>([]);
  const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false);
  const [bulkPaymentDate, setBulkPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkPaymentMethod, setBulkPaymentMethod] = useState('Transferencia');
  const [bulkPaymentCurrency, setBulkPaymentCurrency] = useState<'USD' | 'MXP'>('USD');
  const [bulkPaymentExchangeRate, setBulkPaymentExchangeRate] = useState<number>(1);
  const [bulkReceiptUrl, setBulkReceiptUrl] = useState('');
  const [uploadingBulkReceipt, setUploadingBulkReceipt] = useState(false);
  const [isPayingBulk, setIsPayingBulk] = useState(false);

  useEffect(() => {
    if (!profile || !hasPermission('commissions')) return;

    // Fetch clients for lookup
    const fetchClients = async () => {
      try {
        const snap = await getDocs(collection(db, 'clients'));
        const clientMap: Record<string, Client> = {};
        snap.docs.forEach(doc => {
          clientMap[doc.id] = { id: doc.id, ...doc.data() } as Client;
        });
        setClients(clientMap);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'clients');
      }
    };

    fetchClients();

    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'agent')));
        const agentMap: Record<string, UserProfile> = {};
        snap.docs.forEach(doc => {
          agentMap[doc.id] = { uid: doc.id, ...doc.data() } as UserProfile;
        });
        setAgents(agentMap);
      } catch (error) {
        console.error('Error fetching agents:', error);
      }
    };

    fetchAgents();

    const q = query(
      collection(db, 'insurances'),
      where('commissionStatus', 'in', ['confirmed', 'paid']),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setCommissions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances (commissions)');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (selectedCommission) {
      setPaymentAmount(selectedCommission.agentCommission || 0);
      setPaymentCurrency(selectedCommission.commissionPaymentCurrency || 'USD');
      setPaymentDate(selectedCommission.commissionPaymentDate || new Date().toISOString().split('T')[0]);
      setPaymentMethod(selectedCommission.commissionPaymentMethod || 'Transferencia');
      setPaymentExchangeRate(selectedCommission.commissionPaymentExchangeRate || 1);
      setReceiptUrl(selectedCommission.commissionPaymentReceipt || '');
    }
  }, [selectedCommission]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingReceipt(true);
    try {
      const storageRef = ref(storage, `receipts/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setReceiptUrl(url);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      alert('Error al subir el comprobante');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!selectedCommission) return;
    
    setSaving(true);
    try {
      await updateDoc(doc(db, 'insurances', selectedCommission.id!), {
        commissionStatus: 'paid',
        commissionPaymentDate: paymentDate,
        commissionPaymentMethod: paymentMethod,
        commissionPaymentReceipt: receiptUrl,
        commissionPaymentCurrency: paymentCurrency,
        commissionPaymentAmount: paymentAmount,
        commissionPaymentExchangeRate: paymentCurrency === 'MXP' ? paymentExchangeRate : 1
      });
      setSelectedCommission(null);
      setReceiptUrl('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `insurances/${selectedCommission.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSelectCommission = (id: string) => {
    setSelectedCommissionIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllCommissions = (isChecked: boolean) => {
    if (isChecked) {
      const confirmableIds = filteredCommissions
        .filter(c => c.commissionStatus === 'confirmed' && c.id)
        .map(c => c.id as string);
      setSelectedCommissionIds(confirmableIds);
    } else {
      setSelectedCommissionIds([]);
    }
  };

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingBulkReceipt(true);
    try {
      const storageRef = ref(storage, `receipts/bulk_${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setBulkReceiptUrl(url);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      alert('Error al subir el comprobante');
    } finally {
      setUploadingBulkReceipt(false);
    }
  };

  const handleBulkMarkAsPaid = async () => {
    if (selectedCommissionIds.length === 0) return;
    setIsPayingBulk(true);
    try {
      const batch = writeBatch(db);
      
      for (const id of selectedCommissionIds) {
        const commissionObj = commissions.find(c => c.id === id);
        if (!commissionObj) continue;
        
        const commRef = doc(db, 'insurances', id);
        const paymentAmt = commissionObj.agentCommission || 0;
        
        batch.update(commRef, {
          commissionStatus: 'paid',
          commissionPaymentDate: bulkPaymentDate,
          commissionPaymentMethod: bulkPaymentMethod,
          commissionPaymentReceipt: bulkReceiptUrl,
          commissionPaymentCurrency: bulkPaymentCurrency,
          commissionPaymentAmount: paymentAmt,
          commissionPaymentExchangeRate: bulkPaymentCurrency === 'MXP' ? bulkPaymentExchangeRate : 1
        });

        try {
          const logRef = doc(collection(db, 'insuranceActivities'));
          batch.set(logRef, {
            insuranceId: id,
            type: 'automatic',
            description: `Se pagó comisión por $${paymentAmt.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD de forma masiva en lote (${bulkPaymentMethod}).`,
            date: new Date(),
            createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
          });
        } catch (logErr) {
          console.error("Error creating activity log in batch:", logErr);
        }
      }
      
      await batch.commit();
      alert(`Se han marcado ${selectedCommissionIds.length} comisiones como pagadas con éxito.`);
      setSelectedCommissionIds([]);
      setShowBulkPaymentModal(false);
      setBulkReceiptUrl('');
    } catch (error) {
      console.error('Error pagando comisiones masivas:', error);
      alert('Hubo un error al procesar el pago masivo.');
    } finally {
      setIsPayingBulk(false);
    }
  };

  const getAgentName = (c: InsuranceRequest) => {
    if (c.clientId && clients[c.clientId]) {
      const client = clients[c.clientId];
      if (client.type === 'Agent') {
        return client.commercialName || client.legalName || c.linkedAgentId || 'Agente';
      }
      if (c.linkedAgentId) {
        const agent = client.linkedAgents?.find(a => a.email === c.linkedAgentId);
        if (agent) return agent.name;
      }
    }
    
    if (c.agentId && agents[c.agentId]) {
      return agents[c.agentId].displayName;
    }

    return c.linkedAgentId || 'Directo';
  };

  const uniqueAgentNames = Array.from(
    new Set(commissions.map((c) => getAgentName(c)).filter(Boolean))
  ).sort();

  const filteredCommissions = commissions.filter(c => {
    const matchesFilter = filter === 'all' || c.commissionStatus === filter;
    const agentName = getAgentName(c);
    const matchesSearch = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (c.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          agentName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAgent = filterAgent === 'all' || agentName === filterAgent;
    const matchesPaymentMethod = filterPaymentMethod === 'all' || c.commissionPaymentMethod === filterPaymentMethod;
    
    const matchesStartDate = !filterStartDate || (c.commissionPaymentDate && c.commissionPaymentDate >= filterStartDate);
    const matchesEndDate = !filterEndDate || (c.commissionPaymentDate && c.commissionPaymentDate <= filterEndDate);
    const matchesDate = matchesStartDate && matchesEndDate;

    return matchesFilter && matchesSearch && matchesAgent && matchesPaymentMethod && matchesDate;
  });

  const totalConfirmed = filteredCommissions
    .filter(c => c.commissionStatus === 'confirmed')
    .reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

  const totalPaid = filteredCommissions
    .filter(c => c.commissionStatus === 'paid')
    .reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

  // New KPIs summary requested: "comisiones pagadas, monto en USD, monto en MXP"
  const paidCommissionsCount = filteredCommissions.filter(c => c.commissionStatus === 'paid').length;

  const totalPaidUSD = filteredCommissions
    .filter(c => c.commissionStatus === 'paid' && (c.commissionPaymentCurrency === 'USD' || !c.commissionPaymentCurrency))
    .reduce((acc, curr) => acc + (curr.commissionPaymentAmount || curr.agentCommission || 0), 0);

  const totalPaidMXP = filteredCommissions
    .filter(c => c.commissionStatus === 'paid' && c.commissionPaymentCurrency === 'MXP')
    .reduce((acc, curr) => acc + (curr.commissionPaymentAmount || 0), 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Gestión de Comisiones</h1>
        <p className="text-gray-500">Control de pagos a agentes y corporativos</p>
      </header>

      {/* Dynamic KPI summary cards based on filtered results */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Total por Pagar</span>
            </div>
            <p className="text-2xl font-black text-gray-900">${totalConfirmed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            {filteredCommissions.filter(c => c.commissionStatus === 'confirmed').length} registros pendientes
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-green-50 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Comisiones Pagadas</span>
            </div>
            <p className="text-2xl font-black text-gray-900">{paidCommissionsCount} registros</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            De un total de {filteredCommissions.length} filtrados
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-indigo-50 rounded-lg">
                <DollarSign className="w-5 h-5 text-indigo-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Monto Pagado USD</span>
            </div>
            <p className="text-2xl font-black text-indigo-900">${totalPaidUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            Liquidadas en USD
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="p-2 bg-amber-50 rounded-lg">
                <Percent className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Monto Pagado MXN</span>
            </div>
            <p className="text-2xl font-black text-amber-900">${totalPaidMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN</p>
          </div>
          <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
            Liquidadas en Pesos Mexicanos
          </p>
        </div>
      </div>

      {/* Advanced search and dynamic filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
            <input 
              type="text"
              placeholder="Buscar por cliente, asegurado o email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-600 outline-none text-sm font-medium"
            />
          </div>
          
          <div className="flex self-start lg:self-auto bg-gray-100 p-1 rounded-xl border border-gray-200">
            {(['all', 'confirmed', 'paid'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filter === f ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'all' ? 'Todas' : f === 'confirmed' ? 'Por Pagar' : 'Pagadas'}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-black text-gray-500 uppercase tracking-wider">Filtros Avanzados</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha Pago (Desde)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fecha Pago (Hasta)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input 
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Agente</label>
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer appearance-none"
              >
                <option value="all">Todos los agentes</option>
                {uniqueAgentNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Forma de Pago</label>
              <div className="flex gap-2">
                <select
                  value={filterPaymentMethod}
                  onChange={(e) => setFilterPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50/50 border border-gray-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer appearance-none flex-1"
                >
                  <option value="all">Todas las formas</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Descuento comision">Descuento comisión</option>
                  <option value="Otro">Otro</option>
                </select>

                {(filterStartDate || filterEndDate || filterAgent !== 'all' || filterPaymentMethod !== 'all' || searchTerm) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStartDate('');
                      setFilterEndDate('');
                      setFilterAgent('all');
                      setFilterPaymentMethod('all');
                      setSearchTerm('');
                    }}
                    className="px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-500 hover:text-red-600 transition-all cursor-pointer flex items-center justify-center shrink-0"
                    title="Limpiar filtros"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk operation controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {filteredCommissions.filter(c => c.commissionStatus === 'confirmed').length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const someSelected = selectedCommissionIds.length > 0;
                handleSelectAllCommissions(!someSelected);
              }}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 rounded-xl cursor-pointer"
            >
              {selectedCommissionIds.length > 0 ? (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Deseleccionar Todas ({selectedCommissionIds.length})
                </>
              ) : (
                <>
                  <Square className="w-4 h-4" />
                  Seleccionar Todas ({filteredCommissions.filter(c => c.commissionStatus === 'confirmed').length})
                </>
              )}
            </button>
          </div>
        )}
        <div className="text-xs font-medium text-[#1A2138] uppercase tracking-wider font-bold">
          {filteredCommissions.length} Comisione(s) Encontrada(s)
        </div>
      </div>

      {selectedCommissionIds.length > 0 && (
        <div className="bg-[#1A2138] border border-gray-800 p-5 rounded-[2rem] flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in slide-in-from-top duration-300 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
              <CheckSquare className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-black text-white uppercase tracking-wider">Pago Masivo de Comisiones</p>
              <p className="text-xs text-gray-400">Hay <span className="font-bold text-indigo-400 text-sm">{selectedCommissionIds.length}</span> comisiones seleccionadas por pagar en lote.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedCommissionIds([])}
              className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => setShowBulkPaymentModal(true)}
              className="px-5 py-3 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-indigo-500/20 uppercase tracking-widest flex items-center gap-2 cursor-pointer"
            >
              Pagar Seleccionadas
              <ArrowUpRight className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            Cargando comisiones...
          </div>
        ) : filteredCommissions.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            No se encontraron comisiones.
          </div>
        ) : (
          filteredCommissions.map((c) => (
            <div 
              key={c.id} 
              className={`bg-white rounded-2xl border transition-all p-6 hover:shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6 ${
                selectedCommissionIds.includes(c.id || '') ? 'border-indigo-400 bg-indigo-50/15' : 'border-gray-100'
              }`}
            >
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Agent & Client */}
                <div className="flex items-start gap-3">
                  {c.commissionStatus === 'confirmed' && c.id && (
                    <button
                      type="button"
                      onClick={() => handleToggleSelectCommission(c.id!)}
                      className="mt-2.5 mr-1 text-gray-400 hover:text-indigo-600 transition-colors focus:outline-none cursor-pointer shrink-0"
                    >
                      {selectedCommissionIds.includes(c.id) ? (
                        <CheckSquare className="w-5.5 h-5.5 text-indigo-600 fill-indigo-50" />
                      ) : (
                        <Square className="w-5.5 h-5.5 text-gray-300 hover:border-indigo-400" />
                      )}
                    </button>
                  )}
                  {c.commissionStatus !== 'confirmed' && (
                    <div className="w-5.5 mr-1 shrink-0" />
                  )}
                  
                  <div className="p-3 bg-purple-50 rounded-xl shrink-0">
                    <Briefcase className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase border ${
                        c.clientType === 'Agent' ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                        c.clientType === 'Corporate' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 
                        'bg-gray-50 text-gray-700 border-gray-100'
                      }`}>
                        {c.clientType === 'Agent' ? 'Agencia' : c.clientType === 'Corporate' ? 'Empresa' : 'Individual'}
                      </span>
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {c.clientId && clients[c.clientId] ? (clients[c.clientId].commercialName || clients[c.clientId].legalName || 'S/N') : 'Directo'}
                      </p>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                        <User className="w-3 h-3 text-gray-400" />
                        <span className="font-medium">Agente: <span className="text-gray-900 font-bold">{getAgentName(c)}</span></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                        <FileText className="w-3 h-3 text-gray-400" />
                        <span>Asegurado: <span className="font-medium text-gray-700">{c.firstName} {c.lastName}</span></span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Amount & Status */}
                <div className="flex flex-col justify-center">
                  <div className="mb-3">
                    <p className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Monto Cobrado</p>
                    <p className="text-sm font-bold text-gray-900">${(c.totalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase mb-0.5">Monto Comisión</p>
                    <p className="text-lg font-black text-blue-600">${(c.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                  </div>
                  <div className="mt-1">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                      c.commissionStatus === 'paid' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                    }`}>
                      {c.commissionStatus === 'paid' ? 'Pagada' : 'Por Pagar'}
                    </span>
                  </div>
                </div>

                {/* Payment Info (if paid) */}
                <div className="flex flex-col justify-center">
                  {c.commissionStatus === 'paid' ? (
                    <div className="space-y-1">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Pagado el {c.commissionPaymentDate}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-600 font-medium bg-gray-100 px-2 py-0.5 rounded">{c.commissionPaymentMethod}</span>
                        {c.commissionPaymentReceipt && (
                          <a 
                            href={c.commissionPaymentReceipt} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Ver Comprobante"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600">
                      <Clock className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase">Pendiente de Pago</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                <button 
                  onClick={() => setSelectedInsuranceForDetail(c)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                  title="Ver información del seguro"
                >
                  <Info className="w-5 h-5" />
                </button>
                
                <button 
                  onClick={() => setSelectedInsuranceForTransactions(c.id || null)}
                  className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-xl transition-all"
                  title="Ver todas las transacciones"
                >
                  <Receipt className="w-5 h-5" />
                </button>
                
                {c.commissionStatus === 'confirmed' ? (
                  <button 
                    onClick={() => setSelectedCommission(c)}
                    className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-all flex items-center gap-2 shadow-sm shadow-green-100"
                  >
                    Pagar comisión
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button 
                    onClick={() => setSelectedCommission(c)}
                    className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all flex items-center gap-2"
                  >
                    Ver Detalle
                    <Eye className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <TransactionModal 
        isOpen={!!selectedInsuranceForTransactions}
        onClose={() => setSelectedInsuranceForTransactions(null)}
        insuranceId={selectedInsuranceForTransactions || undefined}
        title="Transacciones de la Póliza"
      />

      <InsuranceDetailModal 
        isOpen={!!selectedInsuranceForDetail}
        onClose={() => setSelectedInsuranceForDetail(null)}
        insurance={selectedInsuranceForDetail}
      />

      {/* Modal de Detalle de Pago */}
      {selectedCommission && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {selectedCommission.commissionStatus === 'paid' ? 'Detalle de Pago de Comisión' : 'Pagar comisión'}
                </h3>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">Comisión para {selectedCommission.firstName} {selectedCommission.lastName}</p>
                    <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono">ID: {selectedCommission.id}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-medium mt-0.5">{selectedCommission.email}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedCommission(null)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-blue-50 p-4 rounded-2xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70">Agente</span>
                  <span className="text-sm font-bold text-blue-900">{getAgentName(selectedCommission)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter opacity-70">Monto Comisión (Base)</span>
                  <span className="text-xl font-black text-blue-700">${(selectedCommission.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                </div>
              </div>

              {selectedCommission.commissionStatus === 'paid' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Fecha de Pago</p>
                      <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentDate}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Forma de Pago</p>
                      <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentMethod}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Monto Pagado</p>
                      <p className="text-sm font-bold text-gray-900">
                        {selectedCommission.commissionPaymentAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedCommission.commissionPaymentCurrency}
                      </p>
                    </div>
                    {selectedCommission.commissionPaymentCurrency === 'MXP' && (
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Tipo de Cambio</p>
                        <p className="text-sm font-bold text-gray-900">{selectedCommission.commissionPaymentExchangeRate?.toFixed(2)}</p>
                      </div>
                    )}
                  </div>
                  
                  {selectedCommission.commissionPaymentReceipt && (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <p className="text-[10px] text-gray-400 font-bold uppercase mb-3">Comprobante de Pago</p>
                      <a 
                        href={selectedCommission.commissionPaymentReceipt}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                      >
                        <div className="p-2 bg-blue-50 group-hover:bg-blue-100 rounded-lg transition-colors">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-bold text-gray-900">Ver Comprobante</p>
                          <p className="text-[10px] text-gray-400">PDF / Imagen</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600" />
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha de Pago</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Moneda</label>
                      <div className="flex bg-gray-100 p-1 rounded-xl">
                        {(['USD', 'MXP'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setPaymentCurrency(m)}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                              paymentCurrency === m ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Monto a Pagar</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          type="number"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(Number(e.target.value))}
                          className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    </div>

                    {paymentCurrency === 'MXP' && (
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Cambio</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={paymentExchangeRate}
                          onChange={(e) => setPaymentExchangeRate(Number(e.target.value))}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Forma de Pago</label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
                      >
                        <option value="Transferencia">Transferencia</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Cheque">Cheque</option>
                        <option value="Descuento comision">Descuento comisión</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Comprobante de Pago</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="file"
                        id="receipt-upload"
                        className="hidden"
                        onChange={handleFileUpload}
                        disabled={uploadingReceipt}
                      />
                      <label 
                        htmlFor="receipt-upload"
                        className={`flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
                          receiptUrl ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-500'
                        }`}
                      >
                        {uploadingReceipt ? (
                          <div className="w-4 h-4 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
                        ) : receiptUrl ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <span className="text-xs font-bold">
                          {uploadingReceipt ? 'Subiendo...' : receiptUrl ? 'Comprobante Cargado' : 'Subir Comprobante'}
                        </span>
                      </label>
                      {receiptUrl && (
                        <button 
                          onClick={() => setReceiptUrl('')}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                onClick={() => setSelectedCommission(null)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-200 transition-all"
              >
                {selectedCommission.commissionStatus === 'paid' ? 'Cerrar' : 'Cancelar'}
              </button>
              {selectedCommission.commissionStatus !== 'paid' && (
                <button 
                  onClick={handleMarkAsPaid}
                  disabled={saving || uploadingReceipt}
                  className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Confirmar Pago
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Pago Masivo */}
      {showBulkPaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-[#1A2138] text-base uppercase tracking-wider">Pago Masivo de Comisiones</h3>
              <button 
                type="button"
                onClick={() => setShowBulkPaymentModal(false)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Resumen del Lote */}
              <div className="bg-indigo-50 p-4 rounded-2xl flex items-center justify-between border border-indigo-100">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Comisiones a liquidar</span>
                  <span className="text-sm font-extrabold text-indigo-900">{selectedCommissionIds.length} registros</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Monto Total Estimado</span>
                  <span className="text-xl font-black text-indigo-700">
                    ${selectedCommissionIds.reduce((sum, id) => sum + (commissions.find(c => c.id === id)?.agentCommission || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha de Pago</label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      <input 
                        type="date"
                        value={bulkPaymentDate}
                        onChange={(e) => setBulkPaymentDate(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Moneda</label>
                    <div className="flex bg-gray-100 p-1 rounded-xl">
                      {(['USD', 'MXP'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setBulkPaymentCurrency(m)}
                          className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                            bulkPaymentCurrency === m ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {bulkPaymentCurrency === 'MXP' && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Cambio</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={bulkPaymentExchangeRate}
                      onChange={(e) => setBulkPaymentExchangeRate(Number(e.target.value))}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Forma de Pago</label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <select
                      value={bulkPaymentMethod}
                      onChange={(e) => setBulkPaymentMethod(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium appearance-none cursor-pointer"
                    >
                      <option value="Transferencia">Transferencia</option>
                      <option value="Efectivo">Efectivo</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Descuento comision">Descuento comisión</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Comprobante de Pago Masivo</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="file"
                      id="bulk-receipt-upload"
                      className="hidden"
                      onChange={handleBulkFileUpload}
                      disabled={uploadingBulkReceipt}
                    />
                    <label 
                      htmlFor="bulk-receipt-upload"
                      className={`flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
                        bulkReceiptUrl ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-500'
                      }`}
                    >
                      {uploadingBulkReceipt ? (
                        <div className="w-4 h-4 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
                      ) : bulkReceiptUrl ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span className="text-xs font-bold">
                        {uploadingBulkReceipt ? 'Subiendo...' : bulkReceiptUrl ? 'Comprobante Cargado' : 'Subir Comprobante Lote'}
                      </span>
                    </label>
                    {bulkReceiptUrl && (
                      <button 
                        type="button"
                        onClick={() => setBulkReceiptUrl('')}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                type="button"
                onClick={() => setShowBulkPaymentModal(false)}
                className="flex-1 py-3 px-4 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-200 transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={handleBulkMarkAsPaid}
                disabled={isPayingBulk || uploadingBulkReceipt}
                className="flex-1 py-3 px-4 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isPayingBulk && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Confirmar Pago Masivo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
