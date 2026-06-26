import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, orderBy, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Provider, Category, Subcategory, UserProfile, CustomRole, Payment } from '../types';
import { Plus, Trash2, Edit2, Save, X, Building2, User, FileText, Phone, Mail, MapPin, LayoutGrid, List, Search, CreditCard, Upload, Globe, Hash } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { usePermissions } from '../hooks/usePermissions';

interface ProvidersManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function ProvidersManager({ profile, rolePermissions }: ProvidersManagerProps) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [insurances, setInsurances] = useState<any[]>([]);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'general' | 'bank' | 'payments'>('general');
  const [providerPayments, setProviderPayments] = useState<Payment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [importing, setImporting] = useState(false);
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

  const requestedProviders = [
    'Emilia Pamela Abrego Lopez',
    'Avelino Ramones',
    'Proyecciones Inmobiliarias Edifica',
    'Fasherm Servicios S.A. DE C.V.',
    'Diverza Buzon Fiscal',
    'PROCAP PERSONAL S.A. DE C.V.',
    'KROHN PUBLICIDAD Y SERVICIOS MULTIPLES S.A. DE C.V.',
    'AT&T Comercialización Móvil, S. de R.L. de C.V.',
    'Actinver',
    'Cultural Insurance Service Internacional',
    'Edilberto Cesareo Roman Vega Montes',
    'Jinhua Rich Crafts & Gigts Co. Ltd'
  ];

  const pendingProviders = requestedProviders.filter(reqName => 
    !providers.some(p => p.legalName?.toLowerCase()?.trim() === reqName.toLowerCase().trim() || p.commercialName?.toLowerCase()?.trim() === reqName.toLowerCase().trim())
  );

  useEffect(() => {
    if (!profile || !hasPermission('providers')) return;

    const unsubProviders = onSnapshot(query(collection(db, 'providers'), orderBy('createdAt', 'desc')), (snap) => {
      setProviders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Provider)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'providers');
    });

    const unsubCats = onSnapshot(query(collection(db, 'categories'), orderBy('name')), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'categories');
    });

    const unsubSubs = onSnapshot(query(collection(db, 'subcategories'), orderBy('name')), (snap) => {
      setSubcategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'subcategories');
    });

    const unsubInsurances = onSnapshot(collection(db, 'insurances'), (snap) => {
      setInsurances(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching insurances:", error);
    });

    return () => {
      unsubProviders();
      unsubCats();
      unsubSubs();
      unsubInsurances();
    };
  }, [profile]);

  useEffect(() => {
    if (!editingProvider || !editingProvider.id) {
      setProviderPayments([]);
      return;
    }

    const q = query(
      collection(db, 'payments'),
      where('providerId', '==', editingProvider.id),
      orderBy('date', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      setProviderPayments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      console.error("Error fetching provider payments:", error);
    });

    return () => unsub();
  }, [editingProvider?.id]);

  // Automatic seeder for 12 requested providers when user with creation permissions logs in
  useEffect(() => {
    let active = true;
    const autoSeed = async () => {
      if (
        !profile || 
        !hasPermission('providers', 'create') || 
        providers.length === 0 || 
        pendingProviders.length === 0 ||
        categories.length === 0 ||
        subcategories.length === 0
      ) {
        return;
      }

      try {
        let defaultCatId = categories[0]?.id || '';
        let defaultSubcatId = subcategories.find(s => s.categoryId === defaultCatId)?.id || '';
        
        // Ensure default category and subcategory exist
        if (!defaultCatId) {
          const catRef = await addDoc(collection(db, 'categories'), {
            name: 'Servicios Generales',
            description: 'Categoría para proveedores de servicios generales creada automáticamente.',
            createdAt: serverTimestamp()
          });
          defaultCatId = catRef.id;
          
          const subcatRef = await addDoc(collection(db, 'subcategories'), {
            categoryId: defaultCatId,
            name: 'Proveedores',
            description: 'Subcategoría para proveedores generales creada automáticamente.',
            createdAt: serverTimestamp()
          });
          defaultSubcatId = subcatRef.id;
        } else if (!defaultSubcatId) {
          const subcatRef = await addDoc(collection(db, 'subcategories'), {
            categoryId: defaultCatId,
            name: 'Proveedores',
            description: 'Subcategoría para proveedores generales creada automáticamente.',
            createdAt: serverTimestamp()
          });
          defaultSubcatId = subcatRef.id;
        }

        // Mass register any missing pending providers
        if (active) {
          console.log(`Auto-seeding ${pendingProviders.length} missing providers...`);
          for (const name of pendingProviders) {
            await addDoc(collection(db, 'providers'), {
              legalName: name,
              commercialName: name,
              rfc: 'XAXX010101000',
              mainContact: name,
              phone: '55 1234 5678',
              email: `contacto@${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") || 'proveedor'}.com`,
              address: 'Dirección Generada',
              city: 'Ciudad de México',
              state: 'CDMX',
              zip: '01000',
              country: name.toLowerCase().includes('internacional') || name.toLowerCase().includes('ltd') ? 'Estados Unidos' : 'México',
              categoryId: defaultCatId,
              subcategoryId: defaultSubcatId,
              createdAt: serverTimestamp(),
              bankName: '',
              bankAccountName: '',
              bankAccountNumber: '',
              clabe: '',
              swift: '',
              abaNumber: '',
              reference: ''
            });
          }
          console.log("Auto-seeding completed successfully!");
        }
      } catch (err) {
        console.error("Error auto-importing providers:", err);
      }
    };

    autoSeed();
    return () => {
      active = false;
    };
  }, [profile, providers, categories, subcategories]);

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;

    // Validate general tab required fields
    if (
      !editingProvider.legalName?.trim() ||
      !editingProvider.commercialName?.trim() ||
      !editingProvider.rfc?.trim() ||
      !editingProvider.mainContact?.trim() ||
      !editingProvider.phone?.trim() ||
      !editingProvider.email?.trim() ||
      !editingProvider.address?.trim() ||
      !editingProvider.city?.trim() ||
      !editingProvider.state?.trim() ||
      !editingProvider.zip?.trim() ||
      !editingProvider.country?.trim() ||
      !editingProvider.categoryId ||
      !editingProvider.subcategoryId
    ) {
      alert('Por favor, completa todos los campos obligatorios en la pestaña de Información General.');
      setActiveModalTab('general');
      return;
    }

    try {
      if (editingProvider.id) {
        const { id, ...data } = editingProvider;
        await updateDoc(doc(db, 'providers', id), data);
      } else {
        await addDoc(collection(db, 'providers'), {
          ...editingProvider,
          createdAt: serverTimestamp()
        });
      }
      setEditingProvider(null);
      setIsAddingProvider(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'providers');
    }
  };

  const handleDeleteProvider = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Proveedor',
      message: '¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'providers', id));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `providers/${id}`);
        }
      }
    });
  };

  const filteredProviders = providers.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    return (
      p.legalName.toLowerCase().includes(searchLower) ||
      p.commercialName.toLowerCase().includes(searchLower) ||
      p.email.toLowerCase().includes(searchLower) ||
      p.rfc.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestión de Proveedores</h1>
          <p className="text-gray-500">Administra la información de tus proveedores y prestadores de servicios</p>
        </div>
        {hasPermission('providers', 'create') && (
          <button
            onClick={() => {
              setIsAddingProvider(true);
              setEditingProvider({
                legalName: '',
                commercialName: '',
                address: '',
                city: '',
                state: '',
                zip: '',
                country: 'México',
                rfc: '',
                mainContact: '',
                phone: '',
                email: '',
                categoryId: '',
                subcategoryId: '',
                createdAt: null,
                bankName: '',
                bankAccountName: '',
                bankAccountNumber: '',
                clabe: '',
                swift: '',
                abaNumber: '',
                reference: ''
              });
              setActiveModalTab('general');
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo Proveedor
          </button>
        )}
      </header>

      {/* Banner de Importación Rápida de los 12 Proveedores Solicitados */}
      {hasPermission('providers', 'create') && pendingProviders.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50/60 to-indigo-50/60 border border-blue-100 p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5 animate-fadeIn">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-blue-600/10 text-blue-700 rounded-xl shrink-0">
              <Building2 className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-blue-900 uppercase tracking-wider">Alta Pendiente de Proveedores Solicitados ({pendingProviders.length})</h3>
              <p className="text-xs text-blue-700 font-medium leading-relaxed max-w-2xl">
                Hemos detectado {pendingProviders.length} de los proveedores solicitados que aún no se encuentran en su catálogo. Puede realizar un alta masiva inmediata con datos por defecto listos para facturación y asignación de cuentas.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1.5 max-h-24 overflow-y-auto">
                {pendingProviders.map((name, idx) => (
                  <span key={idx} className="text-[10px] bg-white text-gray-700 font-bold px-2.5 py-1 rounded-lg border border-gray-150/70 shadow-sm">{name}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="shrink-0">
            <button
              onClick={async () => {
                setImporting(true);
                try {
                  let defaultCatId = categories[0]?.id || '';
                  let defaultSubcatId = subcategories.find(s => s.categoryId === defaultCatId)?.id || '';
                  
                  // Se crean categoría y subcategoría por defecto si no existen
                  if (!defaultCatId) {
                    const catRef = await addDoc(collection(db, 'categories'), {
                      name: 'Servicios Generales',
                      description: 'Categoría para proveedores de servicios generales creada automáticamente.',
                      createdAt: serverTimestamp()
                    });
                    defaultCatId = catRef.id;
                    
                    const subcatRef = await addDoc(collection(db, 'subcategories'), {
                      categoryId: defaultCatId,
                      name: 'Proveedores',
                      description: 'Subcategoría para proveedores generales creada automáticamente.',
                      createdAt: serverTimestamp()
                    });
                    defaultSubcatId = subcatRef.id;
                  }

                  // Registrar masivamente
                  for (const name of pendingProviders) {
                    await addDoc(collection(db, 'providers'), {
                      legalName: name,
                      commercialName: name,
                      rfc: 'XAXX010101000',
                      mainContact: name,
                      phone: '55 1234 5678',
                      email: `contacto@${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") || 'proveedor'}.com`,
                      address: 'Dirección Generada',
                      city: 'Ciudad de México',
                      state: 'CDMX',
                      zip: '01000',
                      country: name.toLowerCase().includes('internacional') || name.toLowerCase().includes('ltd') ? 'Estados Unidos' : 'México',
                      categoryId: defaultCatId,
                      subcategoryId: defaultSubcatId,
                      createdAt: serverTimestamp(),
                      bankName: '',
                      bankAccountName: '',
                      bankAccountNumber: '',
                      clabe: '',
                      swift: '',
                      abaNumber: '',
                      reference: ''
                    });
                  }
                } catch (err) {
                  console.error("Error bulk-importing providers:", err);
                  alert("Hubo un error al dar de alta los proveedores.");
                } finally {
                  setImporting(false);
                }
              }}
              disabled={importing}
              className="px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-md hover:shadow-lg hover:shadow-blue-50 transition-all flex items-center gap-2 cursor-pointer disabled:bg-gray-100 disabled:text-gray-400"
            >
              {importing ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                  Registrando...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Alta Masiva Inmediata
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Nombre, email o RFC..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
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
          {filteredProviders.map((p) => (
            <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group relative">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Proveedor</span>
                      <h3 className="font-bold text-gray-900 leading-tight">
                        {p.commercialName || p.legalName}
                      </h3>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {hasPermission('providers', 'edit') && (
                      <button onClick={() => { setEditingProvider(p); setActiveModalTab('general'); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    {hasPermission('providers', 'delete') && (
                      <button onClick={() => handleDeleteProvider(p.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{p.mainContact}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{p.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{p.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <CreditCard className="w-4 h-4 text-gray-400" />
                    <span className="font-mono text-xs">RFC: {p.rfc}</span>
                  </div>
                  <div className="flex items-start gap-2 text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                    <span className="text-xs">{p.city}, {p.state}, {p.country}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Categoría</span>
                    <span className="text-xs font-bold text-blue-600">
                      {categories.find(c => c.id === p.categoryId)?.name || 'N/A'}
                    </span>
                  </div>
                  {p.documentUrl && (
                    <a 
                      href={p.documentUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 p-2 bg-blue-50 rounded-lg transition-colors"
                      title="Ver Documento"
                    >
                      <FileText className="w-4 h-4" />
                    </a>
                  )}
                </div>
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
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Proveedor</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Contacto</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">Categoría</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider">RFC</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredProviders.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-blue-100 text-blue-600 rounded-lg">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{p.commercialName || p.legalName}</span>
                          <span className="text-[10px] text-gray-400">{p.legalName}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs space-y-0.5">
                        <p className="text-gray-900 font-medium">{p.mainContact}</p>
                        <p className="text-gray-500">{p.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-blue-600">
                          {categories.find(c => c.id === p.categoryId)?.name || 'N/A'}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {subcategories.find(s => s.id === p.subcategoryId)?.name || ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs text-gray-500">{p.rfc}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {p.documentUrl && (
                          <a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver Documento">
                            <FileText className="w-4 h-4" />
                          </a>
                        )}
                        {hasPermission('providers', 'edit') && (
                          <button onClick={() => { setEditingProvider(p); setActiveModalTab('general'); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('providers', 'delete') && (
                          <button onClick={() => handleDeleteProvider(p.id!)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
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

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />

      {/* Provider Editor Modal */}
      {(editingProvider || isAddingProvider) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {editingProvider?.id ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                </h3>
                <p className="text-xs text-gray-500">Completa la información del perfil del proveedor</p>
              </div>
              <button onClick={() => { setEditingProvider(null); setIsAddingProvider(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {/* Tabs Header */}
            <div className="flex border-b border-gray-100 bg-gray-50/30 px-6">
              <button
                type="button"
                onClick={() => setActiveModalTab('general')}
                className={`py-3 px-4 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeModalTab === 'general'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                <Building2 className="w-4.5 h-4.5" />
                Información General
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('bank')}
                className={`py-3 px-4 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeModalTab === 'bank'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                <CreditCard className="w-4.5 h-4.5" />
                Datos Bancarios
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('payments')}
                className={`py-3 px-4 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeModalTab === 'payments'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                <FileText className="w-4.5 h-4.5" />
                Pagos
              </button>
            </div>

            <form onSubmit={handleSaveProvider} className="flex-1 overflow-y-auto p-8 flex flex-col justify-between">
              <div className="flex-1 min-h-0">
                {/* TAB 1: GENERAL INFO */}
                {activeModalTab === 'general' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Basic Info Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                        <Building2 className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Información de la Empresa</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre Legal <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.legalName || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, legalName: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Razón Social"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre Comercial <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.commercialName || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, commercialName: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Nombre de Fantasía"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">RFC <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={editingProvider?.rfc || ''}
                              onChange={e => setEditingProvider({ ...editingProvider!, rfc: e.target.value.toUpperCase() })}
                              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                              placeholder="RFC123456789"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Contact Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                        <User className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Contacto Principal</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre del Contacto <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.mainContact || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, mainContact: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Nombre Completo"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Teléfono <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="tel"
                              value={editingProvider?.phone || ''}
                              onChange={e => setEditingProvider({ ...editingProvider!, phone: e.target.value })}
                              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                              placeholder="+52 ..."
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Email <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="email"
                              value={editingProvider?.email || ''}
                              onChange={e => setEditingProvider({ ...editingProvider!, email: e.target.value })}
                              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                              placeholder="correo@ejemplo.com"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Address Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Dirección</h4>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Calle y Número <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.address || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, address: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Ciudad <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.city || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, city: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Estado <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.state || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, state: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CP <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={editingProvider?.zip || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, zip: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">País <span className="text-red-500">*</span></label>
                          <div className="relative">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={editingProvider?.country || ''}
                              onChange={e => setEditingProvider({ ...editingProvider!, country: e.target.value })}
                              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Categorization & Documents Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                        <Hash className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Categorización y Documentos</h4>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Categoría <span className="text-red-500">*</span></label>
                          <select
                            value={editingProvider?.categoryId || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, categoryId: e.target.value, subcategoryId: '' })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          >
                            <option value="">Seleccionar Categoría</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Subcategoría <span className="text-red-500">*</span></label>
                          <select
                            value={editingProvider?.subcategoryId || ''}
                            onChange={e => setEditingProvider({ ...editingProvider!, subcategoryId: e.target.value })}
                            className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            disabled={!editingProvider?.categoryId}
                          >
                            <option value="">Seleccionar Subcategoría</option>
                            {subcategories.filter(s => s.categoryId === editingProvider?.categoryId).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Documento (URL)</label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type="url"
                                placeholder="https://..."
                                value={editingProvider?.documentUrl || ''}
                                onChange={e => setEditingProvider({ ...editingProvider!, documentUrl: e.target.value })}
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                              />
                            </div>
                            <button type="button" className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold hover:bg-gray-200 flex items-center gap-2 transition-colors">
                              <Upload className="w-4 h-4" />
                              Subir
                            </button>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 italic">Sube el documento a un servicio de almacenamiento y pega el enlace aquí.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: BANK DETAILS */}
                {activeModalTab === 'bank' && (
                  <div className="space-y-6 max-w-2xl mx-auto">
                    <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Datos Bancarios de Proveedor</h4>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre del Banco</label>
                        <input
                          type="text"
                          value={editingProvider?.bankName || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, bankName: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          placeholder="Ej. BBVA, Santander, Chase"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nombre de la Cuenta</label>
                        <input
                          type="text"
                          value={editingProvider?.bankAccountName || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, bankAccountName: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          placeholder="Titular de la cuenta / Empresa"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Número de Cuenta</label>
                        <input
                          type="text"
                          value={editingProvider?.bankAccountNumber || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, bankAccountNumber: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          placeholder="Número de cuenta"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CLABE</label>
                        <input
                          type="text"
                          value={editingProvider?.clabe || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, clabe: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                          placeholder="18 dígitos"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">SWIFT</label>
                        <input
                          type="text"
                          value={editingProvider?.swift || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, swift: e.target.value.toUpperCase() })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                          placeholder="Código internacional SWIFT / BIC"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">ABA Number</label>
                        <input
                          type="text"
                          value={editingProvider?.abaNumber || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, abaNumber: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono"
                          placeholder="Código de ruteo ABA"
                        />
                      </div>

                      <div className="col-span-1 md:col-span-2">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Referencia (Opcional)</label>
                        <input
                          type="text"
                          value={editingProvider?.reference || ''}
                          onChange={e => setEditingProvider({ ...editingProvider!, reference: e.target.value })}
                          className="w-full p-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                          placeholder="Referencia de pago"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 3: PAYMENTS LIST */}
                {activeModalTab === 'payments' && (
                  <div className="space-y-6 flex flex-col h-full min-h-[350px]">
                    <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Historial de Pagos Realizados</h4>
                      </div>
                      <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-bold">
                        {providerPayments.length} Pago(s) Registrado(s)
                      </span>
                    </div>

                    {!editingProvider?.id ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                        <CreditCard className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-sm font-bold text-gray-500">Nuevo Proveedor</p>
                        <p className="text-xs text-gray-400 mt-1">Guarda el perfil del proveedor primero para registrar pagos y consultar el historial.</p>
                      </div>
                    ) : providerPayments.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                        <Building2 className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-sm font-bold text-gray-500">Sin pagos registrados</p>
                        <p className="text-xs text-gray-400 mt-1">No se han encontrado pagos vinculados a este proveedor en el sistema.</p>
                      </div>
                    ) : (
                      <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm bg-white">
                        <div className="overflow-x-auto max-h-[45vh]">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                <th className="px-4 py-3">Fecha</th>
                                <th className="px-4 py-3">Producto/Servicio</th>
                                <th className="px-4 py-3 text-right">Monto</th>
                                <th className="px-4 py-3 text-right">Iva</th>
                                <th className="px-4 py-3 text-right">Cantidad Final</th>
                                <th className="px-4 py-3 text-center">Factura</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 font-normal">
                              {providerPayments.map((p) => {
                                const insurance = insurances.find(ins => ins.id === p.insuranceId);
                                const productText = p.notes || (p.insuranceId === 'conciliacion_bancaria' ? 'Conciliación Bancaria' : (insurance ? `${insurance.policyName || 'Póliza'} - ${insurance.firstName} ${insurance.lastName}` : 'Gasto Operativo'));
                                
                                const currency = p.currency || 'USD';
                                const subtotal = p.amount / 1.16;
                                const iva = p.amount - subtotal;
                                const total = p.amount;

                                const formatVal = (v: number) => 
                                  `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

                                const dateStr = p.date?.toDate 
                                  ? p.date.toDate().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
                                  : p.date ? new Date(p.date).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

                                return (
                                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                                      {dateStr}
                                    </td>
                                    <td className="px-4 py-3 text-xs font-medium text-gray-950 max-w-[200px] truncate" title={productText}>
                                      {productText}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-right text-gray-600 font-mono">
                                      {formatVal(subtotal)}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-right text-gray-500 font-mono">
                                      {formatVal(iva)}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-right font-bold text-gray-900 font-mono bg-blue-50/20">
                                      {formatVal(total)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      {p.receiptUrl ? (
                                        <a
                                          href={p.receiptUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold rounded hover:bg-blue-100 transition-all border border-blue-100"
                                          title={p.invoiceNumber || p.receiptNumber || 'Ver factura'}
                                        >
                                          <FileText className="w-3 h-3" />
                                          {p.invoiceNumber || p.receiptNumber || 'Ver XML/PDF'}
                                        </a>
                                      ) : (
                                        <span className="text-[10px] text-gray-400 italic">No disponible</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-8 border-t border-gray-100 flex gap-4 mt-8">
                <button
                  type="button"
                  onClick={() => { setEditingProvider(null); setIsAddingProvider(false); }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  {activeModalTab === 'payments' ? 'Cerrar' : 'Cancelar'}
                </button>
                {activeModalTab !== 'payments' && (
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                  >
                    <Save className="w-5 h-5" />
                    Guardar Proveedor
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
