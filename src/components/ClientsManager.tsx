import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Client, ClientType, LinkedAgent, Country, UserProfile, CustomRole } from '../types';
import { Plus, Trash2, Edit2, Save, X, Users, Building2, User, FileText, Phone, Mail, MapPin, Globe, CreditCard, Receipt, LayoutGrid, List, Eye, ChevronLeft, ChevronRight, Download, AlertTriangle, CheckSquare, Square, Check, RefreshCw } from 'lucide-react';
import TransactionModal from './TransactionModal';
import ClientDetailModal from './ClientDetailModal';
import ConfirmModal from './ConfirmModal';
import GoogleContactsImportModal from './GoogleContactsImportModal';
import { usePermissions } from '../hooks/usePermissions';
import Papa from 'papaparse';

interface ClientsManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function ClientsManager({ profile, rolePermissions }: ClientsManagerProps) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [clients, setClients] = useState<Client[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<ClientType | 'All'>('All');
  const [activeFormTab, setActiveFormTab] = useState<'general' | 'address' | 'agents'>('general');
  const [selectedClientForTransactions, setSelectedClientForTransactions] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedClientForDetail, setSelectedClientForDetail] = useState<Client | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Duplicates State
  const [activeView, setActiveView] = useState<'all' | 'duplicates'>('all');
  const [matchCriterion, setMatchCriterion] = useState<'name' | 'email' | 'phone'>('name');
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);
  const [isImportingContacts, setIsImportingContacts] = useState(false);

  // Helper to format timestamps or date objects in the duplicates table
  const formatTimestamp = (ts: any) => {
    if (!ts) return 'Sin fecha';
    let date: Date;
    if (ts.seconds) {
      date = new Date(ts.seconds * 1000);
    } else {
      date = new Date(ts);
    }
    return date.toLocaleString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const duplicateGroups = useMemo(() => {
    const individualClients = clients.filter(c => c.type === 'Individual');
    const groups: { [key: string]: Client[] } = {};

    const normalizeText = (text: string) => {
      if (!text) return '';
      return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[^a-z0-9]/g, "")      // keep only normal chars
        .trim();
    };

    individualClients.forEach(c => {
      let key = '';
      if (matchCriterion === 'name') {
        const first = normalizeText(c.firstName || '');
        const last = normalizeText(c.lastName || '');
        if (first || last) {
          key = `${first}|${last}`;
        }
      } else if (matchCriterion === 'email') {
        key = (c.email || '').toLowerCase().trim();
      } else if (matchCriterion === 'phone') {
        key = (c.phone || '').replace(/\D/g, ''); // leave only digits
      }

      if (!key || (matchCriterion === 'email' && key.length < 5) || (matchCriterion === 'phone' && key.length < 7)) {
        return; // skip empty or invalid keys
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(c);
    });

    const result: { key: string; clients: Client[] }[] = [];
    Object.keys(groups).forEach(k => {
      if (groups[k].length > 1) {
        // Sort clients in group so older ones (first copy or original) are first
        const sorted = [...groups[k]].sort((a, b) => {
          const timeA = a.createdAt ? (a.createdAt.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt).getTime()) : 0;
          const timeB = b.createdAt ? (b.createdAt.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt).getTime()) : 0;
          return timeA - timeB;
        });
        result.push({
          key: k,
          clients: sorted
        });
      }
    });

    return result;
  }, [clients, matchCriterion]);

  const duplicateGroupsCount = useMemo(() => {
    return duplicateGroups.length;
  }, [duplicateGroups]);

  // Helper to select duplicates in bulk
  const handleSelectBulk = (mode: 'oldest' | 'newest' | 'none' | 'all') => {
    if (mode === 'none') {
      setSelectedDuplicateIds([]);
      return;
    }

    const idsToSelect: string[] = [];
    duplicateGroups.forEach(group => {
      if (mode === 'oldest') {
        // Keep the oldest (index 0). Select indices 1...N-1
        group.clients.slice(1).forEach(c => {
          if (c.id) idsToSelect.push(c.id);
        });
      } else if (mode === 'newest') {
        // Keep the newest (last index). Select indices 0...N-2
        group.clients.slice(0, group.clients.length - 1).forEach(c => {
          if (c.id) idsToSelect.push(c.id);
        });
      } else if (mode === 'all') {
        group.clients.forEach(c => {
          if (c.id) idsToSelect.push(c.id);
        });
      }
    });

    setSelectedDuplicateIds(idsToSelect);
  };

  const toggleSelectDuplicate = (id: string) => {
    setSelectedDuplicateIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleMassDeleteDuplicates = async () => {
    if (selectedDuplicateIds.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Duplicados Masivamente',
      message: `¿Estás seguro de que deseas eliminar permanentemente los ${selectedDuplicateIds.length} clientes individuales seleccionados? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        setIsDeletingDuplicates(true);
        try {
          for (const id of selectedDuplicateIds) {
            await deleteDoc(doc(db, 'clients', id));
          }
          setSelectedDuplicateIds([]);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `clients_bulk_delete`);
        } finally {
          setIsDeletingDuplicates(false);
        }
      }
    });
  };

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

  const handleDownloadClients = () => {
    if (filteredClients.length === 0) return;

    const dataToExport = filteredClients.map(c => {
      const typeLabel = c.type === 'Individual' ? 'Individual' : 
                        c.type === 'Agent' ? 'Agente / Agencia' : 
                        c.type === 'Corporate' ? 'Corporativo' : 
                        c.type === 'University' ? 'Universidad' : c.type;

      const name = c.type === 'Individual' 
        ? `${c.firstName || ''} ${c.lastName || ''}`.trim()
        : c.commercialName || c.legalName || '';

      return {
        'ID': c.id || '',
        'Tipo': typeLabel,
        'Nombre/Empresa': name,
        'Email': c.email || '',
        'Teléfono': c.phone || '',
        'RFC': c.rfc || '',
        'País': c.country || '',
        'Estado': c.state || '',
        'Ciudad': c.city || '',
        'Dirección': c.address || '',
        'Código Postal': c.zip || '',
        'Comisión (%)': c.commission || 0,
        'Descuento (%)': c.discountPercentage || 0,
        'Notas': c.notes || ''
      };
    });

    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const formattedDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    link.download = `clientes_exportados_${formattedDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!profile || !hasPermission('clients')) return;

    const unsubClients = onSnapshot(query(collection(db, 'clients'), orderBy('createdAt', 'desc')), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'clients');
    });

    const unsubCountries = onSnapshot(query(collection(db, 'countries'), orderBy('name')), (snap) => {
      setCountries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'countries');
    });

    return () => {
      unsubClients();
      unsubCountries();
    };
  }, []);

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;

    try {
      const cleanData: any = {};
      
      // List of supported fields in Client to ensure they are cleaned
      const fields = [
        'type', 'phone', 'email', 'address', 'city', 'state', 'zip', 'country', 'rfc',
        'firstName', 'lastName', 'gender', 'birthDate', 'notes', 'legalName', 
        'commercialName', 'mainContact', 'linkedAgents', 'discountPercentage', 'commission', 
        'documents', 'createdAt'
      ];
      
      fields.forEach(field => {
        const value = editingClient[field as keyof Client];
        if (value !== undefined) {
          if (typeof value === 'number') {
            cleanData[field] = isNaN(value) ? 0 : value;
          } else {
            cleanData[field] = value;
          }
        }
      });

      // Special handling for nested linkedAgents to clean them up
      if (cleanData.linkedAgents && Array.isArray(cleanData.linkedAgents)) {
        cleanData.linkedAgents = cleanData.linkedAgents.map((agent: any) => {
          const cleanedAgent = { ...agent };
          Object.keys(cleanedAgent).forEach(k => {
            if (cleanedAgent[k] === undefined) {
              cleanedAgent[k] = '';
            } else if (typeof cleanedAgent[k] === 'number' && isNaN(cleanedAgent[k])) {
              cleanedAgent[k] = 0;
            }
          });
          return cleanedAgent;
        });
      }

      // Ensure some critical string fields are not completely missing/undefined
      const stringFields = ['phone', 'email', 'address', 'city', 'state', 'zip', 'rfc', 'firstName', 'lastName', 'notes', 'legalName', 'commercialName', 'mainContact'];
      stringFields.forEach(field => {
        if (cleanData[field] === undefined) {
          cleanData[field] = '';
        }
      });

      if (editingClient.id) {
        await updateDoc(doc(db, 'clients', editingClient.id), cleanData);
      } else {
        await addDoc(collection(db, 'clients'), {
          ...cleanData,
          createdAt: serverTimestamp()
        });
      }
      setEditingClient(null);
      setIsAddingClient(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'clients');
    }
  };

  const handleDeleteClient = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Cliente',
      message: '¿Estás seguro de eliminar este cliente? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'clients', id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `clients/${id}`);
        }
      }
    });
  };

  const addLinkedAgent = () => {
    if (!editingClient) return;
    const newAgent: LinkedAgent = {
      id: Math.random().toString(36).substr(2, 9),
      name: '',
      phone: '',
      email: '',
      commission: 0
    };
    setEditingClient({
      ...editingClient,
      linkedAgents: [...(editingClient.linkedAgents || []), newAgent]
    });
  };

  const updateLinkedAgent = (agentId: string, field: keyof LinkedAgent, value: string | number) => {
    if (!editingClient || !editingClient.linkedAgents) return;
    const updatedAgents = editingClient.linkedAgents.map(a => 
      a.id === agentId ? { ...a, [field]: value } : a
    );
    setEditingClient({ ...editingClient, linkedAgents: updatedAgents });
  };

  const removeLinkedAgent = (agentId: string) => {
    if (!editingClient || !editingClient.linkedAgents) return;
    const updatedAgents = editingClient.linkedAgents.filter(a => a.id !== agentId);
    setEditingClient({ ...editingClient, linkedAgents: updatedAgents });
  };

  const filteredClients = useMemo(() => {
    const list = clients.filter(c => {
      const matchesType = filterType === 'All' || c.type === filterType;
      const searchLower = searchTerm.toLowerCase();
      const name = c.type === 'Individual' 
        ? `${c.firstName} ${c.lastName}`.toLowerCase()
        : `${c.legalName} ${c.commercialName}`.toLowerCase();
      const matchesSearch = name.includes(searchLower) || c.email.toLowerCase().includes(searchLower) || c.rfc.toLowerCase().includes(searchLower);
      return matchesType && matchesSearch;
    });

    return list.sort((a, b) => {
      const nameA = a.type === 'Individual' 
        ? `${a.firstName} ${a.lastName}`.toLowerCase()
        : (a.commercialName || a.legalName || '').toLowerCase();
      const nameB = b.type === 'Individual' 
        ? `${b.firstName} ${b.lastName}`.toLowerCase()
        : (b.commercialName || b.legalName || '').toLowerCase();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });
  }, [clients, filterType, searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, searchTerm]);

  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredClients.slice(startIndex, startIndex + pageSize);
  }, [filteredClients, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredClients.length / pageSize);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Clientes</h1>
          <p className="text-gray-500">Administra agentes, corporativos e individuales</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadClients}
            disabled={filteredClients.length === 0}
            className="bg-green-50 text-green-700 border border-green-100 hover:bg-green-150 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
            title="Descargar la lista de clientes actual en formato CSV"
          >
            <Download className="w-4 h-4" />
            Descargar Clientes
          </button>
          {hasPermission('clients', 'create') && (
            <>
              <button
                onClick={() => setIsImportingContacts(true)}
                className="bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm mr-1"
                title="Importar clientes desde sus contactos de Google"
              >
                <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" referrerPolicy="no-referrer" />
                Importar de Google
              </button>
              <button
                onClick={() => {
                  setIsAddingClient(true);
                  setEditingClient({
                    type: 'Individual',
                    phone: '',
                    email: '',
                    address: '',
                    city: '',
                    state: '',
                    zip: '',
                    country: 'MX',
                    rfc: '',
                    firstName: '',
                    lastName: '',
                    gender: 'M',
                    birthDate: '',
                    notes: '',
                    createdAt: null
                  });
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Nuevo Cliente
              </button>
            </>
          )}
        </div>
      </header>

      {/* View Selector Tabs */}
      <div className="flex border-b border-gray-200 mt-4">
        <button
          onClick={() => setActiveView('all')}
          className={`py-3 px-6 text-sm font-black border-b-2 transition-all ${
            activeView === 'all'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Todos los Clientes ({clients.length})
        </button>
        <button
          onClick={() => setActiveView('duplicates')}
          className={`py-3 px-6 text-sm font-black border-b-2 transition-all flex items-center gap-2 ${
            activeView === 'duplicates'
              ? 'border-red-650 text-red-650'
              : 'border-transparent text-gray-500 hover:text-red-500 hover:border-red-200'
          }`}
        >
          <Trash2 className="w-4 h-4 text-red-500" />
          Depurador de Duplicados ({duplicateGroupsCount})
        </button>
      </div>

      {activeView === 'all' ? (
        <>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar</label>
              <input
                type="text"
                placeholder="Nombre, email o RFC..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
                className="p-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              >
                <option value="All">Todos</option>
                <option value="Agent">Agente</option>
                <option value="Corporate">Corporativo</option>
                <option value="Individual">Individual</option>
              </select>
            </div>
            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                title="Vista Cuadrícula"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                title="Vista Lista"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {paginatedClients.map((c) => (
                <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group relative">
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          c.type === 'Agent' ? 'bg-purple-100 text-purple-600' :
                          c.type === 'Corporate' ? 'bg-blue-100 text-blue-600' :
                          'bg-green-100 text-green-600'
                        }`}>
                          {c.type === 'Agent' ? <Users className="w-5 h-5" /> :
                           c.type === 'Corporate' ? <Building2 className="w-5 h-5" /> :
                           <User className="w-5 h-5" />}
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{c.type}</span>
                          <h3 className="font-bold text-gray-900 leading-tight">
                            {c.type === 'Individual' ? `${c.firstName} ${c.lastName}` : c.commercialName || c.legalName}
                          </h3>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setSelectedClientForDetail(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver Detalles">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => setSelectedClientForTransactions(c.email)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Ver Transacciones">
                          <Receipt className="w-4 h-4" />
                        </button>
                        {hasPermission('clients', 'edit') && (
                          <button onClick={() => setEditingClient(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('clients', 'delete') && (
                          <button onClick={() => handleDeleteClient(c.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span className="truncate">{c.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span>{c.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-600">
                        <CreditCard className="w-4 h-4 text-gray-400" />
                        <span className="font-mono text-xs">RFC: {c.rfc}</span>
                      </div>
                      <div className="flex items-start gap-2 text-gray-600">
                        <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                        <span className="text-xs">{c.city}, {c.state}, {c.country}</span>
                      </div>
                    </div>

                    {(c.type === 'Agent' || c.type === 'Corporate') && c.linkedAgents && c.linkedAgents.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-50">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Agentes Vinculados ({c.linkedAgents.length})</p>
                        <div className="flex -space-x-2 overflow-hidden">
                          {c.linkedAgents.slice(0, 5).map((a, idx) => (
                            <div key={idx} className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-600">
                              {a.name.charAt(0)}
                            </div>
                          ))}
                          {c.linkedAgents.length > 5 && (
                            <div className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-[8px] font-bold text-gray-400">
                              +{c.linkedAgents.length - 5}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Cliente</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Tipo</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Contacto</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">RFC</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Subagentes y Comisión</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paginatedClients.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-lg ${
                              c.type === 'Agent' ? 'bg-purple-100 text-purple-600' :
                              c.type === 'Corporate' ? 'bg-blue-100 text-blue-600' :
                              'bg-green-100 text-green-600'
                            }`}>
                              {c.type === 'Agent' ? <Users className="w-4 h-4" /> :
                               c.type === 'Corporate' ? <Building2 className="w-4 h-4" /> :
                               <User className="w-4 h-4" />}
                            </div>
                            <span className="font-bold text-gray-900">
                              {c.type === 'Individual' ? `${c.firstName} ${c.lastName}` : c.commercialName || c.legalName}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase border ${
                            c.type === 'Agent' ? 'bg-purple-50 text-purple-600 border-purple-100' :
                            c.type === 'Corporate' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                            'bg-green-50 text-green-600 border-green-100'
                          }`}>
                            {c.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-xs space-y-0.5">
                            <p className="text-gray-900 font-medium">{c.email}</p>
                            <p className="text-gray-500">{c.phone}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-gray-500">{c.rfc}</span>
                        </td>
                        <td className="px-6 py-4">
                          {c.linkedAgents && c.linkedAgents.length > 0 ? (
                            <div className="flex flex-col gap-1 max-w-[240px]">
                              {c.linkedAgents.map((a: any, idx: number) => (
                                <div key={idx} className="text-xs flex items-center justify-between gap-2 bg-gray-50 border border-gray-100 rounded-md px-2 py-0.5">
                                  <span className="text-gray-700 truncate font-semibold">{a.name}</span>
                                  <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px] shrink-0">
                                    {a.commission}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setSelectedClientForDetail(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver Detalles">
                              <Eye className="w-4 h-4" />
                            </button>
                            <button onClick={() => setSelectedClientForTransactions(c.email)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Ver Transacciones">
                              <Receipt className="w-4 h-4" />
                            </button>
                            {hasPermission('clients', 'edit') && (
                              <button onClick={() => setEditingClient(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}
                            {hasPermission('clients', 'delete') && (
                              <button onClick={() => handleDeleteClient(c.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination Controls */}
          {filteredClients.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white px-6 py-4 rounded-xl border border-gray-100 shadow-sm mt-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="text-sm text-gray-500">
                  Mostrando <span className="font-bold text-gray-900">{filteredClients.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, filteredClients.length)}</span> de <span className="font-bold text-gray-900">{filteredClients.length}</span> clientes
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
                    return p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1;
                  }).map((p, i, arr) => (
                    <React.Fragment key={p}>
                      {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 mx-1">...</span>}
                      <button
                        onClick={() => setCurrentPage(p)}
                        className={`min-w-[40px] h-10 rounded-lg text-sm font-bold transition-all ${
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
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Header Info Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex flex-col md:flex-row gap-4 items-start">
            <div className="p-3 bg-amber-100 text-amber-800 rounded-lg">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-amber-900 text-base">Revisión de Clientes Individuales Duplicados</h3>
              <p className="text-sm text-amber-800 leading-relaxed">
                Este panel analiza todos tus clientes de tipo <strong>Individual</strong> buscando coincidencias según el criterio que elijas. Puedes seleccionar los registros sobrantes uno a uno o usar las opciones de selección automática para borrarlos masivamente de manera segura.
              </p>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">Establecer criterio de duplicado</span>
                <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                  <button
                    onClick={() => { setMatchCriterion('name'); setSelectedDuplicateIds([]); }}
                    className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${matchCriterion === 'name' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Mismo Nombre Completo
                  </button>
                  <button
                    onClick={() => { setMatchCriterion('email'); setSelectedDuplicateIds([]); }}
                    className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${matchCriterion === 'email' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Mismo Correo Electrónico
                  </button>
                  <button
                    onClick={() => { setMatchCriterion('phone'); setSelectedDuplicateIds([]); }}
                    className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${matchCriterion === 'phone' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Mismo Teléfono
                  </button>
                </div>
              </div>

              {/* Counts */}
              <div className="flex gap-4 divide-x divide-gray-100 bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div className="text-center px-2">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase">Grupos de Duplicados</span>
                  <span className="text-xl font-extrabold text-amber-600">{duplicateGroupsCount}</span>
                </div>
                <div className="text-center px-4">
                  <span className="block text-[10px] font-bold text-gray-400 uppercase">Total Coincidencias</span>
                  <span className="text-xl font-extrabold text-amber-700">
                    {duplicateGroups.reduce((acc, curr) => acc + curr.clients.length, 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Smart Select Options & Mass Delete Button */}
            {duplicateGroups.length > 0 && (
              <div className="pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider mr-1">Selección Inteligente:</span>
                  <button
                    onClick={() => handleSelectBulk('oldest')}
                    className="px-3 py-1.5 bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors shadow-sm"
                    title="Marca todos los duplicados excepto la versión más antigua (registro original) para cada grupo"
                  >
                    Marcar copia (conservar registro más antiguo)
                  </button>
                  <button
                    onClick={() => handleSelectBulk('newest')}
                    className="px-3 py-1.5 bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors shadow-sm"
                    title="Marca todos los duplicados excepto la versión más reciente para cada grupo"
                  >
                    Marcar copia (conservar registro más reciente)
                  </button>
                  <button
                    onClick={() => handleSelectBulk('all')}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-150 rounded-lg text-xs font-bold transition-colors"
                  >
                    Todo
                  </button>
                  <button
                    onClick={() => handleSelectBulk('none')}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-150 rounded-lg text-xs font-bold transition-colors"
                  >
                    Desactivar todo
                  </button>
                </div>

                <div>
                  <button
                    onClick={handleMassDeleteDuplicates}
                    disabled={selectedDuplicateIds.length === 0 || isDeletingDuplicates}
                    className="px-6 py-2.5 bg-red-650 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-md hover:shadow-lg shadow-red-200 flex items-center gap-2 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isDeletingDuplicates 
                      ? 'Procesando eliminación...' 
                      : `Borrar Selección Masivamente (${selectedDuplicateIds.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* List layout of Duplicate Groups */}
          <div className="space-y-6">
            {duplicateGroups.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 py-16 text-center">
                <div className="inline-flex p-4 bg-green-50 text-green-600 rounded-full mb-4">
                  <Check className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">¡Limpieza Completa!</h3>
                <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
                  No se han encontrado clientes individuales duplicados con el criterio: <strong>
                    {matchCriterion === 'name' ? 'Nombre Completo' : matchCriterion === 'email' ? 'Correo Electrónico' : 'Teléfono'}
                  </strong>.
                </p>
                <div className="mt-4">
                  <button
                    onClick={() => setActiveView('all')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700"
                  >
                    Volver a todos los clientes
                  </button>
                </div>
              </div>
            ) : (
              duplicateGroups.map((group, groupIdx) => {
                let groupLabel = '';
                if (matchCriterion === 'name') {
                  const first = group.clients[0];
                  groupLabel = `${first.firstName || ''} ${first.lastName || ''}`.trim() || 'Sin Nombre';
                } else if (matchCriterion === 'email') {
                  groupLabel = group.clients[0].email || 'Sin Email';
                } else if (matchCriterion === 'phone') {
                  groupLabel = group.clients[0].phone || 'Sin Teléfono';
                }

                return (
                  <div key={group.key} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    {/* Header of group */}
                    <div className="bg-gray-50/70 px-6 py-4 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-amber-500"></div>
                        <div>
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Duplicidad por {matchCriterion === 'name' ? 'Nombre' : matchCriterion === 'email' ? 'Email' : 'Teléfono'}</span>
                          <h4 className="text-sm font-extrabold text-gray-800">{groupLabel}</h4>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
                        {group.clients.length} Registros Encontrados
                      </span>
                    </div>

                    {/* Stack of clients inside group */}
                    <div className="divide-y divide-gray-100">
                      {group.clients.map((client, clientIdx) => {
                        const isSelected = selectedDuplicateIds.includes(client.id || '');
                        const isOldest = clientIdx === 0;

                        return (
                          <div 
                            key={client.id} 
                            className={`p-5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                              isSelected ? 'bg-red-50/20' : isOldest ? 'bg-blue-50/10' : ''
                            }`}
                          >
                            <div className="flex items-start gap-4 flex-1">
                              {/* Checkbox wrapper */}
                              <button
                                type="button"
                                onClick={() => toggleSelectDuplicate(client.id || '')}
                                className="mt-1 transition-transform active:scale-95"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-5 h-5 text-red-650 fill-red-50" />
                                ) : (
                                  <Square className="w-5 h-5 text-gray-300 hover:text-gray-400" />
                                )}
                              </button>

                              <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-gray-900 text-sm">
                                    {client.firstName} {client.lastName}
                                  </span>
                                  
                                  {isOldest ? (
                                    <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100" title="Registro original más antiguo de la base de datos">
                                      Registro Original (Recomendado Conservar)
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                                      Registro Copia #{clientIdx} (Recomendado Eliminar)
                                    </span>
                                  )}
                                </div>

                                {/* Fields breakdown to easily spot slight differences */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-xs text-gray-600">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                    <span className="truncate">{client.email || <span className="text-gray-300 italic">Sin correo electrónico</span>}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                    <span>{client.phone || <span className="text-gray-300 italic">Sin teléfono registrado</span>}</span>
                                  </div>
                                  <div className="min-w-0">
                                    <span className="font-semibold text-gray-400">RFC:</span> <span className="font-mono text-[11px]">{client.rfc || <span className="text-gray-300 italic">N/A</span>}</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-400">F. Nacimiento:</span> <span>{client.birthDate || <span className="text-gray-300 italic">No registrada</span>}</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-400">Sexo:</span> <span className="uppercase">{client.gender || <span className="text-gray-300 italic">N/A</span>}</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-gray-400">Alta Sistema:</span> <span className="text-[11px] font-mono">{formatTimestamp(client.createdAt)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Client card buttons */}
                            <div className="flex gap-2 self-end md:self-auto h-fit">
                              <button
                                onClick={() => setEditingClient(client)}
                                className="px-3.5 py-1.5 border border-gray-200 text-gray-700 font-bold hover:bg-gray-50 rounded-lg text-xs transition-all"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => handleDeleteClient(client.id!)}
                                className="px-3.5 py-1.5 border border-red-100 hover:border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold transition-all"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Google Contacts Import Modal */}
      <GoogleContactsImportModal
        isOpen={isImportingContacts}
        onClose={() => setIsImportingContacts(false)}
        onImportSuccess={() => {
          // Live listener will automatically sync the list.
          // We can optionally add a toast or success notification.
        }}
      />

      {/* Detail Modal */}
      <ClientDetailModal
        isOpen={!!selectedClientForDetail}
        onClose={() => setSelectedClientForDetail(null)}
        client={selectedClientForDetail}
      />

      {/* Transaction Modal */}
      <TransactionModal 
        isOpen={!!selectedClientForTransactions}
        onClose={() => setSelectedClientForTransactions(null)}
        clientEmail={selectedClientForTransactions || undefined}
        title="Transacciones del Cliente"
      />

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />

      {/* Client Editor Modal */}
      {(editingClient || isAddingClient) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {editingClient?.id ? 'Editar Cliente' : 'Nuevo Cliente'}
                </h3>
                <p className="text-xs text-gray-500">Completa la información del perfil del cliente</p>
              </div>
              <button onClick={() => { setEditingClient(null); setIsAddingClient(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="flex-1 overflow-y-auto flex flex-col">
              {/* Form Tabs */}
              <div className="flex border-b border-gray-100 px-8 bg-gray-50/30">
                <button
                  type="button"
                  onClick={() => setActiveFormTab('general')}
                  className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                    activeFormTab === 'general' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Información General
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFormTab('address')}
                  className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                    activeFormTab === 'address' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Dirección y Fiscal
                </button>
                {(editingClient?.type === 'Agent' || editingClient?.type === 'Corporate') && (
                  <button
                    type="button"
                    onClick={() => setActiveFormTab('agents')}
                    className={`px-6 py-4 text-sm font-bold transition-all border-b-2 ${
                      activeFormTab === 'agents' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    Agentes Vinculados
                  </button>
                )}
              </div>

              <div className="p-8 space-y-8 flex-1">
                {activeFormTab === 'general' && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {/* Type Selection */}
                    <div className="grid grid-cols-3 gap-4">
                      {(['Agent', 'Corporate', 'Individual'] as ClientType[]).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setEditingClient({ ...editingClient!, type })}
                          className={`p-4 border-2 rounded-xl flex flex-col items-center gap-2 transition-all ${
                            editingClient?.type === type 
                              ? 'border-blue-600 bg-blue-50 text-blue-600' 
                              : 'border-gray-100 hover:border-gray-200 text-gray-400'
                          }`}
                        >
                          {type === 'Agent' ? <Users className="w-6 h-6" /> :
                           type === 'Corporate' ? <Building2 className="w-6 h-6" /> :
                           <User className="w-6 h-6" />}
                          <span className="text-sm font-bold">{type === 'Agent' ? 'Agente' : type === 'Corporate' ? 'Corporativo' : 'Individual'}</span>
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {editingClient?.type === 'Individual' ? (
                        <>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombres</label>
                            <input
                              type="text"
                              required
                              value={editingClient.firstName || ''}
                              onChange={e => setEditingClient({ ...editingClient, firstName: e.target.value })}
                              className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Apellidos</label>
                            <input
                              type="text"
                              required
                              value={editingClient.lastName || ''}
                              onChange={e => setEditingClient({ ...editingClient, lastName: e.target.value })}
                              className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sexo</label>
                            <div className="flex gap-4 p-2.5 border border-gray-200 rounded-lg">
                              <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${editingClient.gender === 'M' ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                                  {editingClient.gender === 'M' && <div className="w-2 h-2 bg-white rounded-full" />}
                                </div>
                                <input
                                  type="radio"
                                  className="hidden"
                                  checked={editingClient.gender === 'M'}
                                  onChange={() => setEditingClient({ ...editingClient, gender: 'M' })}
                                />
                                <span className="text-sm font-medium text-gray-700 uppercase">M</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${editingClient.gender === 'F' ? 'border-blue-600 bg-blue-600' : 'border-gray-300 group-hover:border-blue-400'}`}>
                                  {editingClient.gender === 'F' && <div className="w-2 h-2 bg-white rounded-full" />}
                                </div>
                                <input
                                  type="radio"
                                  className="hidden"
                                  checked={editingClient.gender === 'F'}
                                  onChange={() => setEditingClient({ ...editingClient, gender: 'F' })}
                                />
                                <span className="text-sm font-medium text-gray-700 uppercase">F</span>
                              </label>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fecha de Nacimiento</label>
                            <input
                              type="date"
                              value={editingClient.birthDate || ''}
                              onChange={e => setEditingClient({ ...editingClient, birthDate: e.target.value })}
                              className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Legal de la Empresa</label>
                              <input
                                type="text"
                                required
                                value={editingClient?.legalName || ''}
                                onChange={e => setEditingClient({ ...editingClient!, legalName: e.target.value })}
                                className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Comercial</label>
                              <input
                                type="text"
                                required
                                value={editingClient?.commercialName || ''}
                                onChange={e => setEditingClient({ ...editingClient!, commercialName: e.target.value })}
                                className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descuento (%)</label>
                              <input
                                type="number"
                                step="1"
                                value={editingClient?.discountPercentage || 0}
                                onChange={e => setEditingClient({ ...editingClient!, discountPercentage: parseFloat(e.target.value) })}
                                className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-green-600"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Contacto Principal</label>
                              <input
                                type="text"
                                required
                                value={editingClient?.mainContact || ''}
                                onChange={e => setEditingClient({ ...editingClient!, mainContact: e.target.value })}
                                className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Documentos</label>
                              <button type="button" className="w-full p-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-2">
                                <FileText className="w-4 h-4" />
                                Cargar Documentos
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Teléfono</label>
                        <input
                          type="tel"
                          required
                          value={editingClient?.phone || ''}
                          onChange={e => setEditingClient({ ...editingClient!, phone: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                        <input
                          type="email"
                          required
                          value={editingClient?.email || ''}
                          onChange={e => setEditingClient({ ...editingClient!, email: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notas</label>
                        <textarea
                          value={editingClient?.notes || ''}
                          onChange={e => setEditingClient({ ...editingClient!, notes: e.target.value })}
                          rows={3}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                          placeholder="Notas adicionales sobre el cliente..."
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeFormTab === 'address' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección</label>
                      <input
                        type="text"
                        required
                        value={editingClient?.address || ''}
                        onChange={e => setEditingClient({ ...editingClient!, address: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ciudad</label>
                      <input
                        type="text"
                        required
                        value={editingClient?.city || ''}
                        onChange={e => setEditingClient({ ...editingClient!, city: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                      <input
                        type="text"
                        required
                        value={editingClient?.state || ''}
                        onChange={e => setEditingClient({ ...editingClient!, state: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CP</label>
                      <input
                        type="text"
                        required
                        value={editingClient?.zip || ''}
                        onChange={e => setEditingClient({ ...editingClient!, zip: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">País</label>
                      <select
                        value={editingClient?.country || 'MX'}
                        onChange={e => setEditingClient({ ...editingClient!, country: e.target.value })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        {countries.map(c => <option key={c.id} value={c.code}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">RFC</label>
                      <input
                        type="text"
                        required
                        value={editingClient?.rfc || ''}
                        onChange={e => setEditingClient({ ...editingClient!, rfc: e.target.value.toUpperCase() })}
                        className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      />
                    </div>
                  </div>
                )}

                {activeFormTab === 'agents' && (editingClient?.type === 'Agent' || editingClient?.type === 'Corporate') && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Agentes Vinculados</h4>
                      <button
                        type="button"
                        onClick={addLinkedAgent}
                        className="text-blue-600 hover:text-blue-700 text-xs font-bold flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        Agregar Agente
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      {editingClient.linkedAgents?.map((agent) => (
                        <div key={agent.id} className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 bg-gray-50 rounded-xl relative group">
                          <button
                            type="button"
                            onClick={() => removeLinkedAgent(agent.id)}
                            className="absolute -top-2 -right-2 p-1 bg-red-100 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre</label>
                            <input
                              type="text"
                              required
                              value={agent.name}
                              onChange={e => updateLinkedAgent(agent.id, 'name', e.target.value)}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Teléfono</label>
                            <input
                              type="tel"
                              required
                              value={agent.phone}
                              onChange={e => updateLinkedAgent(agent.id, 'phone', e.target.value)}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Email</label>
                            <input
                              type="email"
                              required
                              value={agent.email}
                              onChange={e => updateLinkedAgent(agent.id, 'email', e.target.value)}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Comisión (%)</label>
                            <input
                              type="number"
                              required
                              step="0.1"
                              value={agent.commission}
                              onChange={e => updateLinkedAgent(agent.id, 'commission', parseFloat(e.target.value))}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Desc. (%)</label>
                            <input
                              type="number"
                              step="1"
                              value={agent.discountPercentage || 0}
                              onChange={e => updateLinkedAgent(agent.id, 'discountPercentage', parseFloat(e.target.value))}
                              className="w-full p-1.5 border border-gray-200 rounded text-xs font-bold text-green-600"
                            />
                          </div>
                        </div>
                      ))}
                      {(!editingClient.linkedAgents || editingClient.linkedAgents.length === 0) && (
                        <p className="text-center py-12 text-gray-400 text-xs italic border-2 border-dashed border-gray-100 rounded-xl">
                          No hay agentes vinculados. Haz clic en "Agregar Agente" para comenzar.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 border-t border-gray-100 bg-gray-50/50 flex gap-4">
                <button
                  type="button"
                  onClick={() => { setEditingClient(null); setIsAddingClient(false); }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Guardar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
