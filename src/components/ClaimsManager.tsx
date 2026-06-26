import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc,
  serverTimestamp, 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  Claim, 
  ClaimActivity, 
  InsuranceRequest, 
  UserProfile, 
  CustomRole,
  ClaimDocument
} from '../types';
import { 
  AlertCircle, 
  Plus, 
  Search, 
  Calendar, 
  User, 
  ChevronRight, 
  FileText, 
  MessageSquare, 
  Clock, 
  CheckCircle2, 
  Lock, 
  Unlock,
  Upload,
  X,
  History,
  Phone,
  Video,
  FileUp,
  TrendingUp,
  Eye,
  Mail,
  Trash2,
  CheckCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import ConfirmModal from './ConfirmModal';

interface ClaimsManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function ClaimsManager({ profile, rolePermissions }: ClaimsManagerProps) {
  const [activeTab, setActiveTab] = useState<'claims' | 'dashboard'>('claims');
  const [modalTab, setModalTab] = useState<'details' | 'activity'>('details');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [activities, setActivities] = useState<ClaimActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [formData, setFormData] = useState<Partial<Claim>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    insuranceId: '',
    description: '',
    documents: [],
    sentToInsurerDate: '',
    insurerResponse: '',
    isClosed: false,
    calledCentral: false,
    calledCentralDate: '',
    docsDelivered: false,
    docsDeliveredDate: '',
    isComplete: false,
    isCompleteDate: '',
    sentToInsurer: false,
    sentToInsurerDateChecked: ''
  });

  const [newActivity, setNewActivity] = useState({
    type: 'comment' as ClaimActivity['type'],
    description: ''
  });

  const isSuperAdmin = profile?.role === 'super_admin' || 
    profile?.email === 'ventas@misegurointernacional.com' || 
    profile?.uid === 'VTuoortBNjVYkwVviYkbSlyUzNS2';

  useEffect(() => {
    const unsubClaims = onSnapshot(
      query(collection(db, 'claims'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setClaims(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Claim)));
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'claims')
    );

    const unsubInsurances = onSnapshot(
      collection(db, 'insurances'),
      (snapshot) => {
        setInsurances(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'insurances')
    );

    const unsubActivities = onSnapshot(
      query(collection(db, 'claimActivities'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClaimActivity)));
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'claimActivities')
    );

    return () => {
      unsubClaims();
      unsubInsurances();
      unsubActivities();
    };
  }, []);

  const handleSaveClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.insuranceId || !formData.date) return;

    try {
      const claimData: any = {
        ...formData,
        updatedAt: serverTimestamp(),
      };

      if (selectedClaim?.id) {
        if (selectedClaim.isClosed && !isSuperAdmin) {
          alert('Solo un Super Administrador puede editar un caso cerrado.');
          return;
        }
        
        // Detectar cambios en documentos para bitácora
        const oldDocsCount = selectedClaim.documents?.length || 0;
        const newDocsCount = formData.documents?.length || 0;
        
        // Detectar cierre del caso
        if (formData.isClosed && !selectedClaim.isClosed) {
          claimData.closedAt = serverTimestamp();
          await addDoc(collection(db, 'claimActivities'), {
            claimId: selectedClaim.id,
            type: 'automatic',
            description: '🚩 CASO CERRADO - El siniestro ha sido finalizado.',
            date: new Date(),
            createdBy: profile?.email || profile?.uid,
            createdAt: serverTimestamp()
          });
        }

        if (newDocsCount > oldDocsCount) {
          await addDoc(collection(db, 'claimActivities'), {
            claimId: selectedClaim.id,
            type: 'automatic',
            description: `📁 Se adjuntaron ${newDocsCount - oldDocsCount} nuevo(s) documento(s).`,
            date: new Date(),
            createdBy: profile?.email || profile?.uid,
            createdAt: serverTimestamp()
          });
        }

        await updateDoc(doc(db, 'claims', selectedClaim.id), claimData);
        
        await addDoc(collection(db, 'claimActivities'), {
          claimId: selectedClaim.id,
          type: 'automatic',
          description: '💾 Datos del siniestro actualizados.',
          date: new Date(),
          createdBy: profile?.email || profile?.uid,
          createdAt: serverTimestamp()
        });

      } else {
        // Crear nuevo siniestro
        const cleanClaimData = {
          date: formData.date,
          insuranceId: formData.insuranceId,
          description: formData.description,
          isClosed: false,
          documents: formData.documents || [],
          sentToInsurerDate: formData.sentToInsurerDate || '',
          insurerResponse: formData.insurerResponse || '',
          calledCentral: formData.calledCentral || false,
          calledCentralDate: formData.calledCentralDate || '',
          docsDelivered: formData.docsDelivered || false,
          docsDeliveredDate: formData.docsDeliveredDate || '',
          isComplete: formData.isComplete || false,
          isCompleteDate: formData.isCompleteDate || '',
          sentToInsurer: formData.sentToInsurer || false,
          sentToInsurerDateChecked: formData.sentToInsurerDateChecked || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: profile?.email || profile?.uid
        };

        const docRef = await addDoc(collection(db, 'claims'), cleanClaimData);

        await addDoc(collection(db, 'claimActivities'), {
          claimId: docRef.id,
          type: 'automatic',
          description: '✨ Apertura de nuevo siniestro en el sistema.',
          date: new Date(),
          createdBy: profile?.email || profile?.uid,
          createdAt: serverTimestamp()
        });
      }

      setShowModal(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'claims');
    }
  };

  const resetForm = () => {
    setFormData({
      date: format(new Date(), 'yyyy-MM-dd'),
      insuranceId: '',
      description: '',
      documents: [],
      sentToInsurerDate: '',
      insurerResponse: '',
      isClosed: false,
      calledCentral: false,
      calledCentralDate: '',
      docsDelivered: false,
      docsDeliveredDate: '',
      isComplete: false,
      isCompleteDate: '',
      sentToInsurer: false,
      sentToInsurerDateChecked: ''
    });
    setSelectedClaim(null);
    setModalTab('details');
  };

  const handleDeleteClaim = async () => {
    if (!selectedClaim?.id) return;

    try {
      await deleteDoc(doc(db, 'claims', selectedClaim.id));
      setShowModal(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'claims');
    }
  };

  const handleAddActivity = async () => {
    if (!selectedClaim?.id || !newActivity.description) return;

    try {
      await addDoc(collection(db, 'claimActivities'), {
        claimId: selectedClaim.id,
        type: newActivity.type,
        description: newActivity.description,
        date: new Date(),
        createdBy: profile?.email || profile?.uid,
        createdAt: serverTimestamp()
      });
      setNewActivity({ type: 'comment', description: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'claimActivities');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (approx 500KB limit to be safe given other fields in doc)
    if (file.size > 500 * 1024) {
      alert('El archivo es demasiado grande. Por favor suba archivos menores a 500KB para evitar límites de almacenamiento de la base de datos.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const newDoc: ClaimDocument = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        url: event.target?.result as string,
        description: '',
        date: format(new Date(), 'yyyy-MM-dd HH:mm')
      };
      
      const updatedDocs = [...(formData.documents || []), newDoc];
      setFormData(prev => ({
        ...prev,
        documents: updatedDocs
      }));

      // If we are editing an existing claim, log it right away
      if (selectedClaim?.id) {
        await addDoc(collection(db, 'claimActivities'), {
          claimId: selectedClaim.id,
          type: 'automatic',
          description: `📤 Documento cargado: ${file.name}`,
          date: new Date(),
          createdBy: profile?.email || profile?.uid,
          createdAt: serverTimestamp()
        });
      }
    };
    reader.readAsDataURL(file);
  };

  // Dashboard Stats Calculations
  const stats = {
    total: claims.length,
    open: claims.filter(c => !c.isClosed).length,
    closed: claims.filter(c => c.isClosed).length,
    withDocs: claims.filter(c => (c.documents?.length || 0) > 0).length,
    avgResolutionDays: (claims.filter(c => c.isClosed && c.closedAt && c.createdAt).reduce((acc, c) => {
      const created = c.createdAt?.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
      const closed = c.closedAt?.toDate ? c.closedAt.toDate() : new Date(c.closedAt);
      const diff = Math.ceil((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return acc + diff;
    }, 0) / (claims.filter(c => c.isClosed).length || 1)).toFixed(1),
    avgOpenAge: (claims.filter(c => !c.isClosed && c.createdAt).reduce((acc, c) => {
      const created = c.createdAt?.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
      const diff = Math.ceil((new Date().getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return acc + diff;
    }, 0) / (claims.filter(c => !c.isClosed).length || 1)).toFixed(1)
  };

  const selectedInsurance = insurances.find(i => i.id === formData.insuranceId);

  const filteredClaims = claims.filter(c => {
    const ins = insurances.find(i => i.id === c.insuranceId);
    const searchString = `${ins?.firstName} ${ins?.lastName} ${c.description} ${c.id}`.toLowerCase();
    return searchString.includes(searchTerm.toLowerCase());
  });

  const getStatusBadge = (claim: Claim) => {
    if (claim.isClosed) {
      return (
        <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-[10px] font-black rounded-full border border-green-100">
          <CheckCircle2 className="w-3 h-3" />
          CERRADO
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-black rounded-full border border-amber-100">
        <Clock className="w-3 h-3" />
        ABIERTO
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Siniestros</h1>
          <p className="text-gray-500">Gestión y seguimiento de reclamaciones</p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-100"
        >
          <Plus className="w-5 h-5" />
          Nuevo Siniestro
        </button>
      </header>

      {/* Main Tabs */}
      <div className="flex bg-gray-100 p-1 rounded-2xl w-full md:w-fit">
        <button
          onClick={() => setActiveTab('claims')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeTab === 'claims' ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <AlertCircle className="w-4 h-4" />
          Siniestros
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeTab === 'dashboard' ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Dashboard
        </button>
      </div>

      {activeTab === 'claims' ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar siniestros..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-100 rounded-2xl shadow-sm focus:ring-2 focus:ring-rose-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {loading ? (
              <div className="col-span-full py-12 text-center text-gray-400">Cargando...</div>
            ) : filteredClaims.length === 0 ? (
              <div className="col-span-full py-12 text-center text-gray-400">No se encontraron siniestros</div>
            ) : (
              filteredClaims.map((claim) => {
                const ins = insurances.find(i => i.id === claim.insuranceId);
                return (
                  <div 
                    key={claim.id}
                    onClick={() => {
                      setSelectedClaim(claim);
                      setFormData(claim);
                      setModalTab('details');
                      setShowModal(true);
                    }}
                    className="bg-white p-6 rounded-2xl border border-gray-100 hover:shadow-xl transition-all cursor-pointer group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      {getStatusBadge(claim)}
                      <span className="text-[10px] text-gray-400 font-mono">#{claim.id?.substring(0, 8)}</span>
                    </div>
                    
                    <h3 className="font-bold text-gray-900 mb-1">{ins?.firstName} {ins?.lastName}</h3>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-4">{claim.description}</p>
                    
                    <div className="flex flex-wrap items-center gap-4 text-[10px] text-gray-400 font-bold uppercase">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {claim.date}
                      </div>
                      <div className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {claim.documents?.length || 0} Docs
                      </div>
                      <div className="flex items-center gap-1 text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        {(() => {
                          const created = claim.createdAt?.toDate ? claim.createdAt.toDate() : new Date(claim.createdAt);
                          const end = claim.isClosed && claim.closedAt ? (claim.closedAt.toDate ? claim.closedAt.toDate() : new Date(claim.closedAt)) : new Date();
                          const diff = Math.ceil((end.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
                          return `${diff} días ${claim.isClosed ? '(Total)' : '(Activo)'}`;
                        })()}
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between text-rose-600">
                      <span className="text-xs font-bold">Ver Detalles</span>
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total</p>
                <p className="text-3xl font-black text-gray-900">{stats.total}</p>
                <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gray-400" style={{ width: '100%' }} />
                </div>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm border-l-4 border-l-amber-500">
                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Abiertos (Antigüedad Prom)</p>
                <p className="text-3xl font-black text-gray-900">{stats.open} <span className="text-xs text-gray-400">({stats.avgOpenAge} d)</span></p>
                <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${(stats.open/Math.max(stats.total, 1))*100}%` }} />
                </div>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm border-l-4 border-l-green-600">
                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Cerrados</p>
                <p className="text-3xl font-black text-gray-900">{stats.closed}</p>
                <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600" style={{ width: `${(stats.closed/Math.max(stats.total, 1))*100}%` }} />
                </div>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm border-l-4 border-l-rose-600">
                <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest mb-1">Resolución Promedio</p>
                <p className="text-3xl font-black text-gray-900">{stats.avgResolutionDays} <span className="text-xs">días</span></p>
                <p className="text-[8px] text-gray-400 font-bold mt-2 uppercase">Casos cerrados</p>
             </div>
             <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm border-l-4 border-l-blue-600">
                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Con Documentos</p>
                <p className="text-3xl font-black text-gray-900">{stats.withDocs}</p>
                <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${(stats.withDocs/Math.max(stats.total, 1))*100}%` }} />
                </div>
             </div>
           </div>

           <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-gray-50 bg-gray-50/50">
              <h3 className="font-black text-gray-900 flex items-center gap-2 uppercase tracking-tighter">
                <History className="w-5 h-5 text-rose-600" />
                Últimos movimientos de siniestros
              </h3>
            </div>
            <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
              {activities.slice(0, 15).map((activity) => {
                const claim = claims.find(c => c.id === activity.claimId);
                const ins = claim ? insurances.find(i => i.id === claim.insuranceId) : null;
                
                return (
                  <div key={activity.id} className="p-4 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className={`p-2 rounded-xl flex-shrink-0 ${
                        activity.type === 'automatic' ? 'bg-blue-50 text-blue-600' :
                        activity.type === 'call' ? 'bg-green-50 text-green-600' :
                        activity.type === 'zoom' ? 'bg-indigo-50 text-indigo-600' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {activity.type === 'automatic' ? <Clock className="w-4 h-4" /> :
                         activity.type === 'call' ? <Phone className="w-4 h-4" /> :
                         activity.type === 'zoom' ? <Video className="w-4 h-4" /> :
                         <MessageSquare className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-gray-900 text-sm">{activity.description}</span>
                          <span className="text-[10px] text-gray-400 font-medium">
                            {format(activity.date?.toDate ? activity.date.toDate() : new Date(activity.date), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>
                        {ins && (
                          <div className="text-[10px] text-rose-600 font-black uppercase tracking-widest">
                            {ins.firstName} {ins.lastName} (#{claim?.id?.substring(0, 8)})
                          </div>
                        )}
                        <div className="text-[8px] text-gray-300 font-bold uppercase mt-1">
                          Autor: {activity.createdBy || 'Sistema'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Claim Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-5xl max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden relative">
            <button 
              onClick={() => setShowModal(false)}
              className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full transition-all z-10"
            >
              <X className="w-6 h-6 text-gray-400" />
            </button>

            {/* Modal Tabs */}
            <div className="flex border-b border-gray-100 bg-gray-50/50">
              <button
                onClick={() => setModalTab('details')}
                className={`px-8 py-6 font-black text-xs uppercase tracking-widest transition-all border-b-2 ${
                  modalTab === 'details' ? 'border-rose-600 text-rose-600' : 'border-transparent text-gray-400'
                }`}
              >
                Detalle Siniestro
              </button>
              {selectedClaim && (
                <button
                  className={`px-8 py-6 font-black text-xs uppercase tracking-widest transition-all border-b-2 ${
                    modalTab === 'activity' ? 'border-rose-600 text-rose-600' : 'border-transparent text-gray-400'
                  }`}
                  onClick={() => setModalTab('activity')}
                >
                  Bitácora de Actividad
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {modalTab === 'details' ? (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  {/* Form Side */}
                  <form id="claimForm" onSubmit={handleSaveClaim} className="space-y-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Fecha del Siniestro</label>
                        <div className="relative">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-600" />
                          <input 
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({...formData, date: e.target.value})}
                            required
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500 outline-none font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Asegurado</label>
                        <div className="relative">
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-600" />
                          <select
                            value={formData.insuranceId}
                            onChange={(e) => setFormData({...formData, insuranceId: e.target.value})}
                            required
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500 outline-none font-bold appearance-none"
                          >
                            <option value="">Seleccionar Póliza...</option>
                            {insurances.map(i => (
                              <option key={i.id} value={i.id}>{i.firstName} {i.lastName} ({i.id})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {selectedInsurance && (
                        <div className="bg-rose-50/50 p-6 rounded-3xl border border-rose-100/50 space-y-4">
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <p className="text-[8px] font-black text-rose-400 uppercase tracking-tighter">Póliza / Plan</p>
                              <p className="text-xs font-bold text-gray-900">{selectedInsurance.policyName || 'N/A'}</p>
                              <p className="text-[9px] text-gray-500">{selectedInsurance.subcategoryName || 'N/A'}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-rose-400 uppercase tracking-tighter">Destino</p>
                              <p className="text-xs font-bold text-gray-900">{selectedInsurance.destinationCountry}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[8px] font-black text-rose-400 uppercase tracking-tighter">Vigencia y Coberturas</p>
                              <p className="text-[10px] font-bold text-gray-900">{selectedInsurance.startDate} al {selectedInsurance.endDate}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black text-rose-400 uppercase tracking-tighter">Agente</p>
                              <p className="text-xs font-bold text-gray-900">{selectedInsurance.agentId || 'Venta Directa'}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Descripción del Siniestro</label>
                        <textarea 
                          value={formData.description}
                          onChange={(e) => setFormData({...formData, description: e.target.value})}
                          required
                          disabled={formData.isClosed && !isSuperAdmin}
                          rows={4}
                          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500 outline-none font-medium text-sm resize-none"
                          placeholder="Describa lo ocurrido..."
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Fecha Envío Aseguradora</label>
                          <input 
                            type="date"
                            value={formData.sentToInsurerDate || ''}
                            onChange={(e) => setFormData({...formData, sentToInsurerDate: e.target.value})}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Estado de Cierre</label>
                          <button
                            type="button"
                            onClick={() => {
                              if (formData.isClosed && !isSuperAdmin) return;
                              setFormData({...formData, isClosed: !formData.isClosed})
                            }}
                            className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl transition-all font-black text-[10px] border-2 ${
                              formData.isClosed 
                                ? 'bg-green-600 text-white border-green-700' 
                                : 'bg-gray-100 text-gray-400 border-gray-100 hover:bg-gray-200'
                            }`}
                          >
                            {formData.isClosed ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                            {formData.isClosed ? 'SINIESTRO CERRADO' : 'Siniestro Abierto'}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Respuesta Aseguradora</label>
                        <input 
                          type="text"
                          value={formData.insurerResponse || ''}
                          onChange={(e) => setFormData({...formData, insurerResponse: e.target.value})}
                          disabled={formData.isClosed && !isSuperAdmin}
                          className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                          placeholder="Notas o estatus de la aseguradora..."
                        />
                      </div>
                    </div>
                  </form>

                  {/* Documents Side */}
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">Documentos Adjuntos</label>
                        <label className="cursor-pointer px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black hover:bg-rose-100 transition-all flex items-center gap-2">
                          <Upload className="w-3.5 h-3.5" />
                          ADJUNTAR
                          <input type="file" className="hidden" onChange={handleFileUpload} disabled={formData.isClosed && !isSuperAdmin} />
                        </label>
                      </div>
                      
                      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                        {formData.documents?.length === 0 ? (
                          <div className="p-12 border-2 border-dashed border-gray-100 rounded-3xl text-center text-gray-400 italic text-xs flex flex-col items-center gap-3">
                            <FileUp className="w-10 h-10 opacity-20" />
                            No se han subido documentos
                          </div>
                        ) : (
                          formData.documents?.map((doc, idx) => (
                            <div key={doc.id} className="flex flex-col gap-2 p-4 bg-gray-50 rounded-2xl border border-gray-100 group shadow-sm transition-all hover:bg-white hover:shadow-md">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                  <FileText className="w-4 h-4 text-rose-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-gray-900 truncate">{doc.name}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <a href={doc.url} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-blue-600"><Eye className="w-4 h-4" /></a>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (formData.isClosed && !isSuperAdmin) return;
                                      setFormData({ ...formData, documents: formData.documents?.filter((_, i) => i !== idx) });
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-red-500"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Fecha</p>
                                  <input 
                                    type="text"
                                    value={doc.date}
                                    onChange={(e) => {
                                      const newDocs = [...(formData.documents || [])];
                                      newDocs[idx] = { ...newDocs[idx], date: e.target.value };
                                      setFormData({ ...formData, documents: newDocs });
                                    }}
                                    disabled={formData.isClosed && !isSuperAdmin}
                                    className="w-full text-[9px] px-2 py-1 bg-white border border-gray-100 rounded focus:ring-1 focus:ring-rose-500 outline-none"
                                  />
                                </div>
                                <div>
                                  <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Concepto / Nota</p>
                                  <input 
                                    type="text"
                                    value={doc.description}
                                    onChange={(e) => {
                                      const newDocs = [...(formData.documents || [])];
                                      newDocs[idx] = { ...newDocs[idx], description: e.target.value };
                                      setFormData({ ...formData, documents: newDocs });
                                    }}
                                    disabled={formData.isClosed && !isSuperAdmin}
                                    className="w-full text-[9px] px-2 py-1 bg-white border border-gray-100 rounded focus:ring-1 focus:ring-rose-500 outline-none"
                                  />
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seccion de Operacion */}
                <div className="mt-10 pt-10 border-t border-gray-100">
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-rose-600" />
                    Operación del Siniestro
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                      { label: '¿Ya llamó a la central?', field: 'calledCentral', dateField: 'calledCentralDate' },
                      { label: '¿Ya entregó toda la documentación?', field: 'docsDelivered', dateField: 'docsDeliveredDate' },
                      { label: '¿Está completo?', field: 'isComplete', dateField: 'isCompleteDate' },
                      { label: '¿Ya se envió a la aseguradora?', field: 'sentToInsurer', dateField: 'sentToInsurerDateChecked' },
                    ].map((item) => (
                      <div key={item.field} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col gap-3 transition-all hover:shadow-sm">
                        <label className="flex items-start gap-3 cursor-pointer group">
                          <input 
                            type="checkbox"
                            checked={!!formData[item.field as keyof Claim]}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setFormData({
                                ...formData,
                                [item.field]: checked,
                                [item.dateField]: checked ? format(new Date(), 'yyyy-MM-dd HH:mm') : ''
                              });
                            }}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-5 h-5 rounded-lg border-2 border-gray-200 text-rose-600 focus:ring-rose-500 mt-0.5"
                          />
                          <span className="text-[11px] font-bold text-gray-700 leading-tight group-hover:text-rose-600 transition-colors">{item.label}</span>
                        </label>
                        {formData[item.dateField as keyof Claim] && (
                          <div className="flex items-center gap-1.5 text-[9px] text-rose-600 font-black bg-rose-50 px-2.5 py-1.5 rounded-xl self-start border border-rose-100/50">
                            <Calendar className="w-3 h-3" />
                            {(formData[item.dateField as keyof Claim] as string)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
                <div className="max-w-3xl mx-auto py-4">
                   <div className="flex items-center justify-between mb-8">
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Registrar nueva interacción</label>
                    <div className="flex gap-2">
                        {(['call', 'zoom', 'email', 'comment'] as const).map(type => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setNewActivity(prev => ({ ...prev, type }))}
                            className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all border flex items-center gap-2 ${
                              newActivity.type === type ? 'bg-rose-600 text-white border-rose-700' : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'
                            }`}
                          >
                            {type === 'call' && <Phone className="w-3 h-3" />}
                            {type === 'zoom' && <Video className="w-3 h-3" />}
                            {type === 'email' && <Mail className="w-3 h-3" />}
                            {type === 'comment' && <MessageSquare className="w-3 h-3" />}
                            {type.toUpperCase()}
                          </button>
                        ))}
                      </div>
                   </div>

                   <div className="flex gap-3 mb-10">
                      <input 
                        type="text"
                        value={newActivity.description}
                        onChange={(e) => setNewActivity({...newActivity, description: e.target.value})}
                        placeholder={`Describa la ${newActivity.type}...`}
                        className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-6 py-4 text-sm font-medium outline-none focus:ring-2 focus:ring-rose-500 shadow-inner"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddActivity()}
                      />
                      <button
                        type="button"
                        onClick={handleAddActivity}
                        disabled={!newActivity.description}
                        className="px-8 bg-rose-600 text-white rounded-2xl shadow-xl shadow-rose-100 hover:bg-rose-700 transition-all font-black"
                      >
                        RGISTRAR
                      </button>
                    </div>

                    <div className="space-y-6">
                      {activities.filter(a => a.claimId === selectedClaim?.id).map(activity => (
                        <div key={activity.id} className="flex gap-4 relative group">
                          <div className="absolute top-2.5 left-2.5 bottom-0 w-0.5 bg-gray-50" />
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center z-10 shadow-sm transition-transform group-hover:scale-110 ${
                             activity.type === 'automatic' ? 'bg-blue-100 text-blue-600' :
                             activity.type === 'call' ? 'bg-green-100 text-green-600' :
                             activity.type === 'zoom' ? 'bg-indigo-100 text-indigo-600' :
                             'bg-gray-100 text-gray-400'
                          }`}>
                            {activity.type === 'automatic' ? <Clock className="w-2.5 h-2.5" /> :
                             activity.type === 'call' ? <Phone className="w-2.5 h-2.5" /> :
                             activity.type === 'zoom' ? <Video className="w-2.5 h-2.5" /> :
                             <MessageSquare className="w-2.5 h-2.5" />}
                          </div>
                          <div className="flex-1 pb-6">
                            <p className="text-sm font-bold text-gray-900 leading-relaxed mb-1">{activity.description}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                {format(activity.date?.toDate ? activity.date.toDate() : new Date(activity.date), "dd MMMM, HH:mm", { locale: es })}
                              </span>
                              <span className="text-[10px] text-gray-200">•</span>
                              <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{activity.createdBy || 'Sistema'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-gray-100 bg-gray-50/30 flex justify-end gap-4">
               {isSuperAdmin && selectedClaim && (
                 <button 
                  onClick={() => setShowDeleteConfirm(true)}
                  className="mr-auto px-6 py-3 border border-rose-200 text-rose-600 rounded-2xl font-bold text-sm hover:bg-rose-50 transition-all flex items-center gap-2"
                 >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                 </button>
               )}
               <button 
                onClick={() => setShowModal(false)}
                className="px-8 py-3 bg-white border border-gray-200 rounded-2xl text-gray-500 font-bold text-sm hover:bg-gray-100 transition-all"
               >
                Cerrar Ventana
               </button>
               {modalTab === 'details' && (
                 <button 
                  form="claimForm"
                  type="submit"
                  disabled={formData.isClosed && !isSuperAdmin}
                  className={`px-12 py-3 rounded-2xl text-white font-black text-sm transition-all shadow-xl ${
                    formData.isClosed && !isSuperAdmin ? 'bg-gray-400 cursor-not-allowed' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'
                  }`}
                 >
                  {selectedClaim ? 'Guardar Cambios' : 'Abrir Siniestro'}
                 </button>
               )}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteClaim}
        title="Eliminar Siniestro"
        message="¿Está seguro de que desea eliminar este siniestro? Esta acción no se puede deshacer y eliminará también el historial de actividades."
        confirmText="Sí, eliminar"
        cancelText="Cancelar"
      />
    </div>
  );
}
