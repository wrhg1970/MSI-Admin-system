import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, orderBy, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Policy, UserProfile, PlanType, CustomRole } from '../types';
import { INITIAL_POLICIES } from '../constants';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  ShieldCheck, 
  LayoutGrid, 
  List, 
  Calendar, 
  Search, 
  Filter,
  History,
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download
} from 'lucide-react';
import { format, isAfter, isBefore, parseISO } from 'date-fns';
import { usePermissions } from '../hooks/usePermissions';
import ConfirmModal from './ConfirmModal';
import Papa from 'papaparse';

export default function InsurancePlansManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const isSuperAdmin = profile?.role === 'super_admin';
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [insuranceTypes, setInsuranceTypes] = useState<{name: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [showHistory, setShowHistory] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Import modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [pastedCSV, setPastedCSV] = useState('');
  const [importedFileRows, setImportedFileRows] = useState<any[]>([]);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    success?: string;
    error?: string;
    warning?: string;
  }>({});
  
  // Filters
  const [filters, setFilters] = useState({
    plan: 'all',
    region: 'all',
    search: '',
    status: 'active',
    sortBy: 'newest'
  });

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  // Editing/Creating states
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [formData, setFormData] = useState<Partial<Policy>>({
    plan: '',
    name: '',
    deductible: false,
    region: 1,
    costPerDay: 0,
    pricePerDay: 0,
    pricePerMonth: 0,
    discountPercentage: 0,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'),
    status: 'active',
    NombrePoliza: '',
    CodigoPoliza: '',
    CantidadDeducible: 0,
    Insurance_Type: '',
    E_Mail_Address: '',
    CodigoExportacion: '',
    SponsorCode: ''
  });

  useEffect(() => {
    const q = query(collection(db, 'policies'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'policies');
      setLoading(false);
    });

    const unsubTypes = onSnapshot(collection(db, 'insuranceTypes'), (snap) => {
      setInsuranceTypes(snap.docs.map(doc => ({ name: doc.data().name })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insuranceTypes');
    });

    return () => {
      unsubscribe();
      unsubTypes();
    };
  }, []);

  useEffect(() => {
    if (insuranceTypes.length > 0 && !formData.plan) {
      setFormData(prev => ({ ...prev, plan: insuranceTypes[0].name }));
    }
  }, [insuranceTypes]);

  const handleSeedPolicies = async () => {
    try {
      let addedCount = 0;
      for (const p of INITIAL_POLICIES) {
        const alreadyExists = policies.some(existing => 
          existing.name?.toLowerCase() === p.name?.toLowerCase() &&
          existing.plan?.toLowerCase() === p.plan?.toLowerCase() &&
          Number(existing.region) === Number(p.region) &&
          !!existing.deductible === !!p.deductible
        );
        if (!alreadyExists) {
          await addDoc(collection(db, 'policies'), {
            ...p,
            status: 'active',
            startDate: format(new Date(), 'yyyy-MM-dd'),
            endDate: format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'),
            createdAt: serverTimestamp()
          });
          addedCount++;
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'policies');
    }
  };

  const executeSavePolicy = async (policyToSave: any, isNew: boolean) => {
    try {
      if (!isNew) {
        const { id, ...data } = policyToSave;
        await updateDoc(doc(db, 'policies', id), data);
        setEditingPolicy(null);
      } else {
        await addDoc(collection(db, 'policies'), {
          ...policyToSave,
          createdAt: serverTimestamp()
        });
        setIsCreating(false);
        setFormData({
          plan: insuranceTypes[0]?.name || 'U6',
          name: '',
          deductible: false,
          region: 1,
          costPerDay: 0,
          pricePerDay: 0,
          pricePerMonth: 0,
          discountPercentage: 0,
          startDate: format(new Date(), 'yyyy-MM-dd'),
          endDate: format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'),
          status: 'active',
          NombrePoliza: '',
          CodigoPoliza: '',
          CantidadDeducible: 0,
          Insurance_Type: '',
          E_Mail_Address: '',
          CodigoExportacion: '',
          SponsorCode: ''
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'policies');
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPolicy?.id) {
      const originalPolicy = policies.find(p => p.id === editingPolicy.id);
      const isPriceChanged = originalPolicy && (
        editingPolicy.pricePerDay !== originalPolicy.pricePerDay ||
        editingPolicy.costPerDay !== originalPolicy.costPerDay ||
        (editingPolicy.pricePerMonth || 0) !== (originalPolicy.pricePerMonth || 0)
      );

      if (isPriceChanged) {
        if (!isSuperAdmin) {
          alert('Solo el Super Administrador puede editar los precios.');
          return;
        }

        setConfirmModal({
          isOpen: true,
          title: 'Confirmar Cambio de Precios',
          message: `¿Estás seguro de que deseas cambiar los precios de este plan?\n\nAnterior:\n- Precio Día: $${originalPolicy.pricePerDay} USD\n- Costo Día: $${originalPolicy.costPerDay} USD\n- Precio Mes: $${originalPolicy.pricePerMonth || 0} USD\n\nNuevo:\n- Precio Día: $${editingPolicy.pricePerDay} USD\n- Costo Día: $${editingPolicy.costPerDay} USD\n- Precio Mes: $${editingPolicy.pricePerMonth || 0} USD\n\nEste cambio afectará la cotización de todas las nuevas pólizas de este plan.`,
          onConfirm: () => {
            executeSavePolicy(editingPolicy, false);
          }
        });
      } else {
        await executeSavePolicy(editingPolicy, false);
      }
    } else {
      // New policy creation
      if (!isSuperAdmin && (
        (formData.pricePerDay || 0) !== 0 || 
        (formData.costPerDay || 0) !== 0 || 
        (formData.pricePerMonth || 0) !== 0
      )) {
        alert('Solo el Super Administrador puede registrar o asignar precios para planes de seguro.');
        return;
      }
      await executeSavePolicy(formData, true);
    }
  };

  const handleArchivePolicy = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Archivar Plan',
      message: '¿Estás seguro de que deseas archivar este plan?',
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'policies', id), { status: 'archived' });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `policies/${id}`);
        }
      }
    });
  };

  const handleDeletePolicy = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Plan',
      message: '¿Estás seguro de que deseas ELIMINAR PERMANENTEMENTE este plan? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'policies', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `policies/${id}`);
        }
      }
    });
  };

  const handleDuplicatePolicy = (policy: Policy) => {
    const { id, createdAt, ...data } = policy;
    setFormData({
      ...data,
      name: `${data.name} (Copia)`,
      status: 'active'
    });
    setIsCreating(true);
  };

  const handleCleanDuplicates = async () => {
    setConfirmModal({
      isOpen: true,
      title: 'Limpiar Duplicados',
      message: '¿Deseas eliminar los planes duplicados? Se mantendrá solo la versión más reciente de cada plan único.',
      onConfirm: async () => {
        const seen = new Map<string, string>();
        const toDelete: string[] = [];

        // Sort by createdAt desc to keep the newest
        const sortedPolicies = [...policies].sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return dateB.getTime() - dateA.getTime();
        });

        sortedPolicies.forEach(p => {
          const key = `${p.name}-${p.plan}-${p.region}-${p.deductible}-${p.pricePerDay}`;
          if (seen.has(key)) {
            if (p.id) toDelete.push(p.id);
          } else {
            seen.set(key, p.id!);
          }
        });

        if (toDelete.length === 0) {
          alert('No se encontraron planes duplicados.');
          return;
        }

        try {
          for (const id of toDelete) {
            await deleteDoc(doc(db, 'policies', id));
          }
          alert(`Se eliminaron ${toDelete.length} planes duplicados.`);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'policies');
        }
      }
    });
  };

  const handleExportCSV = () => {
    try {
      const dataToExport = policies.map(p => ({
        id: p.id || '',
        plan: p.plan || '',
        name: p.name || '',
        deductible: p.deductible ? 'true' : 'false',
        region: p.region || 1,
        costPerDay: p.costPerDay || 0,
        pricePerDay: p.pricePerDay || 0,
        pricePerMonth: p.pricePerMonth || 0,
        discountPercentage: p.discountPercentage || 0,
        startDate: p.startDate || '',
        endDate: p.endDate || '',
        status: p.status || 'active',
        NombrePoliza: p.NombrePoliza || '',
        CodigoPoliza: p.CodigoPoliza || '',
        CantidadDeducible: p.CantidadDeducible || 0,
        Insurance_Type: p.Insurance_Type || '',
        E_Mail_Address: p.E_Mail_Address || '',
        CodigoExportacion: p.CodigoExportacion || '',
        SponsorCode: p.SponsorCode || ''
      }));

      const csv = Papa.unparse(dataToExport);
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `planes_seguro_exportado_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      alert('Error al exportar: ' + error);
    }
  };

  const handleDownloadTemplateCSV = () => {
    const headers = [
      'plan',
      'name',
      'deductible',
      'region',
      'costPerDay',
      'pricePerDay',
      'pricePerMonth',
      'discountPercentage',
      'startDate',
      'endDate',
      'status',
      'NombrePoliza',
      'CodigoPoliza',
      'CantidadDeducible',
      'Insurance_Type',
      'E_Mail_Address',
      'CodigoExportacion',
      'SponsorCode'
    ];
    const sampleRow = [
      'U6',
      'Oro con deducible',
      'true',
      '1',
      '2.50',
      '5.00',
      '140',
      '10',
      format(new Date(), 'yyyy-MM-dd'),
      format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd'),
      'active',
      'Oro con deducible Región 1',
      'U6-ORO-R1',
      '100',
      'Oro',
      'wrhg1970@gmail.com',
      'U6OROR1',
      'SPONSOR1'
    ];
    
    const csvContent = headers.join(',') + '\n' + sampleRow.join(',');
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'plantilla_planes_de_seguro.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus({});
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          setImportStatus({ error: 'El archivo CSV está vacío.' });
          return;
        }
        setImportedFileRows(results.data);
        setImportStatus({ success: `Se cargaron ${results.data.length} filas del archivo. Listo para procesar.` });
      },
      error: (error) => {
        setImportStatus({ error: 'Error al procesar el archivo CSV: ' + error.message });
      }
    });
  };

  const handleProcessImport = async () => {
    let rowsToProcess = importedFileRows;
    
    // Fall back to pasted CSV if no file uploaded
    if (rowsToProcess.length === 0 && pastedCSV.trim()) {
      try {
        const parsed = Papa.parse(pastedCSV, { header: true, skipEmptyLines: true });
        if (parsed.errors && parsed.errors.length > 0) {
          setImportStatus({ error: 'Error al analizar el texto pegado: ' + parsed.errors[0].message });
          return;
        }
        rowsToProcess = parsed.data;
      } catch (err: any) {
        setImportStatus({ error: 'Error al interpretar el CSV pegado: ' + err.message });
        return;
      }
    }

    if (rowsToProcess.length === 0) {
      setImportStatus({ error: 'Por favor, sube un archivo CSV o pega texto en formato CSV.' });
      return;
    }

    setIsProcessingImport(true);
    setImportStatus({});

    try {
      let createdCount = 0;
      let updatedCount = 0;

      for (const row of rowsToProcess) {
        // Clean and process fields
        const plan = (row.plan || row.Plan || '').trim();
        const name = (row.name || row.Name || row.Nombre || '').trim();
        
        if (!plan || !name) {
          continue; // Skip invalid rows
        }

        const deductible = String(row.deductible || row.Deductible || 'false').toLowerCase() === 'true';
        const region = parseInt(row.region || row.Region || '1') === 2 ? 2 : 1;
        const costPerDay = parseFloat(row.costPerDay || row.CostoPerDia || '0') || 0;
        const pricePerDay = parseFloat(row.pricePerDay || row.PrecioPerDia || '0') || 0;
        const pricePerMonth = parseFloat(row.pricePerMonth || row.PrecioPerMes || '0') || 0;
        const discountPercentage = parseFloat(row.discountPercentage || '0') || 0;
        const startDate = row.startDate || row.FechaInicio || format(new Date(), 'yyyy-MM-dd');
        const endDate = row.endDate || row.FechaFin || format(new Date(new Date().setFullYear(new Date().getFullYear() + 1)), 'yyyy-MM-dd');
        const status = (row.status || 'active').trim().toLowerCase() === 'archived' ? 'archived' : 'active';
        
        const NombrePoliza = row.NombrePoliza || row.NombreInterno || '';
        const CodigoPoliza = row.CodigoPoliza || row.CodigoId || '';
        const CantidadDeducible = parseFloat(row.CantidadDeducible || '0') || 0;
        const Insurance_Type = row.Insurance_Type || row.TipoSeguro || '';
        const E_Mail_Address = row.E_Mail_Address || row.Email || '';
        const CodigoExportacion = row.CodigoExportacion || '';
        const SponsorCode = row.SponsorCode || row.Sponsor || '';

        // Build policy payload
        const policyPayload: Partial<Policy> = {
          plan,
          name,
          deductible,
          region,
          costPerDay,
          pricePerDay,
          pricePerMonth,
          discountPercentage,
          startDate,
          endDate,
          status,
          NombrePoliza,
          CodigoPoliza,
          CantidadDeducible,
          Insurance_Type,
          E_Mail_Address,
          CodigoExportacion,
          SponsorCode
        };

        // Check matching to prevent duplication
        let matchedId: string | null = null;
        if (row.id && row.id.trim()) {
          const existsLocal = policies.some(p => p.id === row.id.trim());
          if (existsLocal) {
            matchedId = row.id.trim();
          }
        }

        if (!matchedId) {
          const matched = policies.find(p => 
            p.plan?.toLowerCase() === plan.toLowerCase() &&
            p.name?.toLowerCase() === name.toLowerCase() &&
            p.region === region &&
            !!p.deductible === !!deductible
          );
          if (matched) {
            matchedId = matched.id!;
          }
        }

        if (matchedId) {
          await updateDoc(doc(db, 'policies', matchedId), policyPayload);
          updatedCount++;
        } else {
          await addDoc(collection(db, 'policies'), {
            ...policyPayload,
            createdAt: serverTimestamp()
          });
          createdCount++;
        }
      }

      setImportStatus({
        success: `Importación finalizada con éxito. Se crearon ${createdCount} nuevos planes y se actualizaron ${updatedCount} planes existentes.`
      });
      setImportedFileRows([]);
      setPastedCSV('');
    } catch (err: any) {
      setImportStatus({ error: 'Ocurrió un error al guardar en la base de datos: ' + err.message });
    } finally {
      setIsProcessingImport(false);
    }
  };

  const filteredPolicies = React.useMemo(() => {
    return policies.filter(p => {
      const matchesPlan = filters.plan === 'all' || p.plan === filters.plan;
      const matchesRegion = filters.region === 'all' || p.region === parseInt(filters.region);
      const matchesSearch = (p.name || '').toLowerCase().includes(filters.search.toLowerCase());
      const matchesStatus = filters.status === 'all' ? true : p.status === filters.status;
      return matchesPlan && matchesRegion && matchesSearch && matchesStatus;
    });
  }, [policies, filters]);

  const sortedPolicies = React.useMemo(() => {
    return [...filteredPolicies].sort((a, b) => {
      switch (filters.sortBy) {
        case 'name': return (a.name || '').localeCompare(b.name || '');
        case 'price-asc': return (a.pricePerDay || 0) - (b.pricePerDay || 0);
        case 'price-desc': return (b.pricePerDay || 0) - (a.pricePerDay || 0);
        case 'oldest': {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return dateA.getTime() - dateB.getTime();
        }
        case 'newest':
        default: {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return dateB.getTime() - dateA.getTime();
        }
      }
    });
  }, [filteredPolicies, filters.sortBy]);

  const paginatedPolicies = React.useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedPolicies.slice(startIndex, startIndex + pageSize);
  }, [sortedPolicies, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedPolicies.length / pageSize);

  const getStatusBadge = (policy: Policy) => {
    const now = new Date();
    const start = policy.startDate ? parseISO(policy.startDate) : null;
    const end = policy.endDate ? parseISO(policy.endDate) : null;

    if (policy.status === 'archived') {
      return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded uppercase border border-gray-200">Archivado</span>;
    }

    if (start && isAfter(start, now)) {
      return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded uppercase border border-blue-200">Próximo</span>;
    }

    if (end && isBefore(end, now)) {
      return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded uppercase border border-red-200">Vencido</span>;
    }

    return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase border border-green-200">Activo</span>;
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planes de Seguro</h1>
          <p className="text-gray-500">Configuración y vigencia de productos de seguros</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-100 transition-all cursor-pointer"
            title="Exportar todos los planes a CSV con todos los campos"
          >
            <Download className="w-4 h-4" />
            <span>Exportar CSV</span>
          </button>
          <button
            onClick={() => {
              if (!isSuperAdmin) {
                alert('Solo el Super Administrador puede importar planes de seguro.');
                return;
              }
              setImportStatus({});
              setImportedFileRows([]);
              setPastedCSV('');
              setShowImportModal(true);
            }}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-bold transition-all cursor-pointer ${
              isSuperAdmin 
                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' 
                : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
            }`}
            title={isSuperAdmin ? "Importar planes de seguro desde CSV" : "Solo el Super Administrador puede importar planes de seguro"}
          >
            <Upload className="w-4 h-4" />
            <span>Importar CSV</span>
          </button>
          <button
            onClick={handleCleanDuplicates}
            className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm font-bold hover:bg-amber-100 transition-all"
            title="Eliminar planes con el mismo nombre, tipo y precio"
          >
            <Sparkles className="w-4 h-4" />
            Limpiar Duplicados
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
          >
            <Plus className="w-4 h-4" />
            Nuevo Plan
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[250px]">
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Buscar Plan</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Nombre del plan..."
              value={filters.search}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Tipo de Plan</label>
          <select
            value={filters.plan}
            onChange={e => setFilters({ ...filters, plan: e.target.value })}
            className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
          >
            <option value="all">Todos</option>
            {insuranceTypes.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Región</label>
          <select
            value={filters.region}
            onChange={e => setFilters({ ...filters, region: e.target.value })}
            className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
          >
            <option value="all">Todas</option>
            <option value="1">Región 1</option>
            <option value="2">Región 2</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Estado</label>
          <select
            value={filters.status}
            onChange={e => setFilters({ ...filters, status: e.target.value })}
            className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
          >
            <option value="active">Activos</option>
            <option value="archived">Archivados</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Ordenar por</label>
          <select
            value={filters.sortBy}
            onChange={e => setFilters({ ...filters, sortBy: e.target.value })}
            className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
          >
            <option value="newest">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="name">Nombre (A-Z)</option>
            <option value="price-asc">Precio (Menor a Mayor)</option>
            <option value="price-desc">Precio (Mayor a Menor)</option>
          </select>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
          <button
            onClick={() => setViewMode('cards')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'cards' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
          >
            <List className="w-5 h-5" />
          </button>
        </div>
        {(() => {
          const hasMissing = INITIAL_POLICIES.some(p => 
            !policies.some(existing => 
              existing.name?.toLowerCase() === p.name?.toLowerCase() &&
              existing.plan?.toLowerCase() === p.plan?.toLowerCase() &&
              Number(existing.region) === Number(p.region) &&
              !!existing.deductible === !!p.deductible
            )
          );
          return (policies.length === 0 || hasMissing) && (
            <button
              onClick={handleSeedPolicies}
              className="bg-indigo-50 text-indigo-600 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-colors border border-indigo-100 animate-pulse"
              title="Cargar políticas predeterminadas ausentes en la base de datos"
            >
              Cargar Iniciales / Faltantes
            </button>
          );
        })()}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : filteredPolicies.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400 flex flex-col items-center gap-2">
          <ShieldCheck className="w-12 h-12 opacity-20" />
          <p className="font-medium">No se encontraron planes que coincidan con los filtros.</p>
        </div>
      ) : viewMode === 'cards' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedPolicies.map((p) => (
            <div key={p.id} className={`bg-white p-6 rounded-2xl shadow-sm border transition-all relative group hover:shadow-md ${p.status === 'archived' ? 'opacity-60 border-gray-200' : 'border-gray-100'}`}>
              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => handleDuplicatePolicy(p)}
                  className="p-2 bg-white text-gray-400 hover:text-indigo-600 rounded-lg shadow-sm border border-gray-100"
                  title="Duplicar Plan"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setEditingPolicy(p)}
                  className="p-2 bg-white text-gray-400 hover:text-blue-600 rounded-lg shadow-sm border border-gray-100"
                  title="Editar Plan"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleArchivePolicy(p.id!)}
                  className="p-2 bg-white text-gray-400 hover:text-amber-600 rounded-lg shadow-sm border border-gray-100"
                  title="Archivar Plan"
                >
                  <Clock className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => handleDeletePolicy(p.id!)}
                  className="p-2 bg-white text-gray-400 hover:text-red-600 rounded-lg shadow-sm border border-gray-100"
                  title="Eliminar Plan"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex justify-between items-start mb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded uppercase border border-blue-100">{p.plan}</span>
                    {getStatusBadge(p)}
                  </div>
                  <h4 className="font-bold text-gray-900 text-lg">{p.name}</h4>
                </div>
                <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Región {p.region}</span>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Costo/Día</p>
                    <p className="text-sm font-black text-gray-600">${p.costPerDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Precio/Día</p>
                    <p className="text-sm font-black text-blue-600">${p.pricePerDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Precio/Mes</p>
                    <p className="text-sm font-black text-indigo-600">${(p.pricePerMonth || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {p.discountPercentage ? (
                  <div className="bg-green-50 p-2 rounded-lg border border-green-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-green-700 uppercase">Descuento Aplicado</span>
                    <span className="text-xs font-black text-green-700">{p.discountPercentage}%</span>
                  </div>
                ) : null}

                <div className="space-y-2 pt-2 border-t border-gray-50">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span className="font-medium">Vigencia:</span>
                    <span className="text-gray-900 font-bold">{p.startDate || 'N/A'} al {p.endDate || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
                    <span className="font-medium">Deducible:</span>
                    <span className={`font-bold ${p.deductible ? 'text-amber-600' : 'text-green-600'}`}>
                      {p.deductible ? 'Sí' : 'No'}
                    </span>
                  </div>
                  {p.CodigoPoliza && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-medium">Cód. Póliza:</span>
                      <span className="text-gray-900 font-bold">{p.CodigoPoliza}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Pagination Controls */}
        {sortedPolicies.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white px-6 py-4 rounded-2xl border border-gray-100 shadow-sm mt-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <p className="text-sm text-gray-500">
                Mostrando <span className="font-bold text-gray-900">{sortedPolicies.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, sortedPolicies.length)}</span> de <span className="font-bold text-gray-900">{sortedPolicies.length}</span> planes
              </p>
              <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                <span className="text-xs text-gray-500">Filas por página:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => {
                  return p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2;
                }).map((p, i, arr) => (
                  <React.Fragment key={p}>
                    {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 mx-1">...</span>}
                    <button
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[36px] h-9 rounded-lg text-xs font-bold transition-all ${
                        currentPage === p 
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-100' 
                          : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600'
                      }`}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                ))}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        )}
      </>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-bold">Estado</th>
                  <th className="px-6 py-4 font-bold">Plan</th>
                  <th className="px-6 py-4 font-bold">Nombre</th>
                  <th className="px-6 py-4 font-bold">Cód. Póliza</th>
                  <th className="px-6 py-4 font-bold">Vigencia</th>
                  <th className="px-6 py-4 font-bold text-right">Costo/Día</th>
                  <th className="px-6 py-4 font-bold text-right">Precio/Día</th>
                  <th className="px-6 py-4 font-bold text-right">Precio/Mes</th>
                  <th className="px-6 py-4 font-bold text-right">Descuento</th>
                  <th className="px-6 py-4 font-bold text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedPolicies.map((p) => (
                  <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.status === 'archived' ? 'opacity-60' : ''}`}>
                    <td className="px-6 py-4">{getStatusBadge(p)}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded uppercase border border-blue-100">{p.plan}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-gray-900">{p.name}</p>
                      <p className="text-[10px] text-gray-400">Región {p.region}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-mono text-gray-600">{p.CodigoPoliza || '-'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-[10px] font-medium text-gray-900">{p.startDate} al {p.endDate}</p>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-gray-600 text-sm">${p.costPerDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-right font-bold text-blue-600 text-sm">${p.pricePerDay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-right font-bold text-indigo-600 text-sm">${(p.pricePerMonth || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-right">
                      {p.discountPercentage ? (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                          {p.discountPercentage}%
                        </span>
                      ) : (
                        <span className="text-gray-300 text-[10px]">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button 
                          onClick={() => handleDuplicatePolicy(p)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          title="Duplicar Plan"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setEditingPolicy(p)} 
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          title="Editar Plan"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleArchivePolicy(p.id!)} 
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                          title="Archivar Plan"
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeletePolicy(p.id!)} 
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Eliminar Plan"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls List View */}
          {sortedPolicies.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50 px-6 py-4 border-t border-gray-100">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="text-sm text-gray-500">
                  Mostrando <span className="font-bold text-gray-900">{sortedPolicies.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, sortedPolicies.length)}</span> de <span className="font-bold text-gray-900">{sortedPolicies.length}</span> planes
                </p>
                <div className="flex items-center gap-2 border-l border-gray-205 pl-4">
                  <span className="text-xs text-gray-500">Filas por página:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => {
                    return p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2;
                  }).map((p, i, arr) => (
                    <React.Fragment key={p}>
                      {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 mx-1">...</span>}
                      <button
                        onClick={() => setCurrentPage(p)}
                        className={`min-w-[36px] h-9 rounded-lg text-xs font-bold transition-all ${
                          currentPage === p 
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-100' 
                            : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600'
                        }`}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  ))}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(isCreating || editingPolicy) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">{editingPolicy ? 'Editar Plan' : 'Nuevo Plan de Seguro'}</h3>
                <p className="text-blue-100 text-xs">Completa los datos del producto</p>
              </div>
              <button 
                onClick={() => {
                  setIsCreating(false);
                  setEditingPolicy(null);
                }} 
                className="p-2 hover:bg-blue-500 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSavePolicy} className="p-8 space-y-6 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Nombre del Plan</label>
                    <input
                      type="text"
                      required
                      value={editingPolicy ? editingPolicy.name : formData.name}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, name: e.target.value })
                        : setFormData({ ...formData, name: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Ej: Oro sin deducible"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Tipo de Plan</label>
                      <select
                        value={editingPolicy ? editingPolicy.plan : formData.plan}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, plan: e.target.value })
                          : setFormData({ ...formData, plan: e.target.value })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        {insuranceTypes.map(t => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Región</label>
                      <select
                        value={editingPolicy ? editingPolicy.region : formData.region}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, region: parseInt(e.target.value) as 1 | 2 })
                          : setFormData({ ...formData, region: parseInt(e.target.value) as 1 | 2 })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="1">Región 1</option>
                        <option value="2">Región 2</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <input
                      type="checkbox"
                      id="deductible"
                      checked={editingPolicy ? editingPolicy.deductible : formData.deductible}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, deductible: e.target.checked })
                        : setFormData({ ...formData, deductible: e.target.checked })
                      }
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="deductible" className="text-sm font-bold text-amber-900 cursor-pointer">
                      ¿Tiene deducible?
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-2 pb-2">
                    <p className="text-xs text-amber-600 font-bold bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                      ★ Solo el Super Administrador puede editar los precios del sistema.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Precio Público ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        disabled={!isSuperAdmin}
                        value={editingPolicy ? editingPolicy.pricePerDay : formData.pricePerDay}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, pricePerDay: parseFloat(e.target.value) })
                          : setFormData({ ...formData, pricePerDay: parseFloat(e.target.value) })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Costo Prov. ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        disabled={!isSuperAdmin}
                        value={editingPolicy ? editingPolicy.costPerDay : formData.costPerDay}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, costPerDay: parseFloat(e.target.value) })
                          : setFormData({ ...formData, costPerDay: parseFloat(e.target.value) })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Precio Mes ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isSuperAdmin}
                        value={editingPolicy ? editingPolicy.pricePerMonth : formData.pricePerMonth}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, pricePerMonth: parseFloat(e.target.value) })
                          : setFormData({ ...formData, pricePerMonth: parseFloat(e.target.value) })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Descuento (%)</label>
                      <input
                        type="number"
                        step="1"
                        value={editingPolicy ? editingPolicy.discountPercentage : formData.discountPercentage}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, discountPercentage: parseFloat(e.target.value) })
                          : setFormData({ ...formData, discountPercentage: parseFloat(e.target.value) })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Vigencia Inicio</label>
                      <input
                        type="date"
                        required
                        value={editingPolicy ? editingPolicy.startDate : formData.startDate}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, startDate: e.target.value })
                          : setFormData({ ...formData, startDate: e.target.value })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Vigencia Fin</label>
                      <input
                        type="date"
                        required
                        value={editingPolicy ? editingPolicy.endDate : formData.endDate}
                        onChange={e => editingPolicy 
                          ? setEditingPolicy({ ...editingPolicy, endDate: e.target.value })
                          : setFormData({ ...formData, endDate: e.target.value })
                        }
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Administration Section */}
              <div className="pt-6 border-t border-gray-100">
                <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  Datos de Administración (Exclusivo)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Nombre Póliza (Admin)</label>
                    <input
                      type="text"
                      value={editingPolicy ? (editingPolicy.NombrePoliza || '') : (formData.NombrePoliza || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, NombrePoliza: e.target.value })
                        : setFormData({ ...formData, NombrePoliza: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Nombre interno..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Código Póliza</label>
                    <input
                      type="text"
                      value={editingPolicy ? (editingPolicy.CodigoPoliza || '') : (formData.CodigoPoliza || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, CodigoPoliza: e.target.value })
                        : setFormData({ ...formData, CodigoPoliza: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Código..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Cantidad Deducible</label>
                    <input
                      type="number"
                      value={editingPolicy ? (editingPolicy.CantidadDeducible || 0) : (formData.CantidadDeducible || 0)}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, CantidadDeducible: parseFloat(e.target.value) })
                        : setFormData({ ...formData, CantidadDeducible: parseFloat(e.target.value) })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Insurance Type</label>
                    <input
                      type="text"
                      value={editingPolicy ? (editingPolicy.Insurance_Type || '') : (formData.Insurance_Type || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, Insurance_Type: e.target.value })
                        : setFormData({ ...formData, Insurance_Type: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">E-Mail Address</label>
                    <input
                      type="email"
                      value={editingPolicy ? (editingPolicy.E_Mail_Address || '') : (formData.E_Mail_Address || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, E_Mail_Address: e.target.value })
                        : setFormData({ ...formData, E_Mail_Address: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Código Exportación</label>
                    <input
                      type="text"
                      value={editingPolicy ? (editingPolicy.CodigoExportacion || '') : (formData.CodigoExportacion || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, CodigoExportacion: e.target.value })
                        : setFormData({ ...formData, CodigoExportacion: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">Sponsor Code</label>
                    <input
                      type="text"
                      value={editingPolicy ? (editingPolicy.SponsorCode || '') : (formData.SponsorCode || '')}
                      onChange={e => editingPolicy 
                        ? setEditingPolicy({ ...editingPolicy, SponsorCode: e.target.value })
                        : setFormData({ ...formData, SponsorCode: e.target.value })
                      }
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setEditingPolicy(null);
                  }}
                  className="px-6 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  {editingPolicy ? 'Guardar Cambios' : 'Crear Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Importar Planes desde CSV</h3>
                <p className="text-blue-100 text-xs">Crea o actualiza planes de seguro en lote por CSV</p>
              </div>
              <button 
                onClick={() => setShowImportModal(false)} 
                className="p-2 hover:bg-blue-500 rounded-full transition-colors"
                id="close-import-modal-btn"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="p-4 bg-amber-50 text-amber-900 border border-amber-200 rounded-2xl text-xs space-y-1">
                <p className="font-bold">⚠️ Requerimientos y Normas del CSV:</p>
                <p>1. Los campos obligatorios son: <strong className="font-bold">plan</strong> y <strong className="font-bold">name</strong>.</p>
                <p>2. Si se incluye el campo <strong className="font-bold">id</strong> y coincide con una póliza existente, se actualizará.</p>
                <p>3. En caso contrario, si coinciden <strong className="font-bold">plan, name, region</strong> y <strong className="font-bold">deductible</strong>, se sobreescribirá.</p>
                <p>4. Solo el Super Administrador puede registrar o modificar precios mediante la importación.</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                <div>
                  <h4 className="text-sm font-bold text-gray-700">¿No tienes el formato adecuado?</h4>
                  <p className="text-xs text-gray-400">Descarga nuestra plantilla de planes con todos los campos</p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplateCSV}
                  className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 transition-all font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
                  id="download-template-csv-btn"
                >
                  <Download className="w-4 h-4 text-blue-500" />
                  Descargar Plantilla
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase">Seleccionar archivo CSV</label>
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center hover:border-blue-400 hover:bg-blue-50/20 transition-all relative">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleImportFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    id="csv-file-input"
                  />
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-blue-500" />
                    <span className="text-sm font-bold text-gray-600">Haz clic o arrastra un archivo CSV aquí</span>
                    <span className="text-xs text-gray-400">Archivos .csv de hasta 10MB</span>
                  </div>
                </div>
              </div>

              <div className="relative flex items-center justify-center py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-100"></div>
                </div>
                <span className="relative px-3 bg-white text-xs font-bold text-gray-400 uppercase">O PEGAR DATOS CSV</span>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-400 uppercase">Texto CSV con Encabezado</label>
                <textarea
                  value={pastedCSV}
                  onChange={(e) => {
                    setPastedCSV(e.target.value);
                    if (importedFileRows.length > 0) {
                      setImportedFileRows([]);
                      setImportStatus({});
                    }
                  }}
                  rows={4}
                  placeholder="plan,name,deductible,region,costPerDay,pricePerDay...&#10;U6,Oro sin deducible,false,1,2.00,4.00,0,0"
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                  id="csv-paste-textarea"
                />
              </div>

              {importStatus.success && (
                <div className="p-4 bg-green-50 text-green-800 border border-green-200 rounded-2xl text-xs flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                  <div>{importStatus.success}</div>
                </div>
              )}
              {importStatus.error && (
                <div className="p-4 bg-red-50 text-red-800 border border-red-200 rounded-2xl text-xs flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <div>{importStatus.error}</div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-6 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-100 transition-all cursor-pointer"
                disabled={isProcessingImport}
                id="cancel-import-btn"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleProcessImport}
                disabled={isProcessingImport || (!importedFileRows.length && !pastedCSV.trim())}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                id="process-import-btn"
              >
                {isProcessingImport ? (
                  <>
                    <Clock className="w-5 h-5 animate-spin" />
                    <span>Importando...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    <span>Procesar Importación</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
