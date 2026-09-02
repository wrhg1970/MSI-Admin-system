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
  ClaimDocument,
  Policy
} from '../types';
import { 
  AlertCircle, 
  Plus, 
  Search, 
  Calendar, 
  User, 
  ChevronRight, 
  ChevronDown,
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
  FolderCheck,
  UploadCloud,
  Download,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import ConfirmModal from './ConfirmModal';
import ClaimEmailModal from './ClaimEmailModal';
import { getNormalizedYYYYMMDD } from '../lib/policyUtils';
import { useCompany } from '../App';

interface ClaimsManagerProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

export default function ClaimsManager({ profile, rolePermissions }: ClaimsManagerProps) {
  const { settings: companySettings } = useCompany();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
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
  const [insuredSearchQuery, setInsuredSearchQuery] = useState('');
  const [isInsuredSearchOpen, setIsInsuredSearchOpen] = useState(false);
  
  const [formData, setFormData] = useState<Partial<Claim>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    insuranceId: '',
    reference: '',
    claimAmount: undefined,
    description: '',
    documents: [],
    sentToInsurerDate: '',
    insurerResponse: 'Pendiente',
    resolutionDate: '',
    resolutionDescription: '',
    reimbursedAmount: undefined,
    isClosed: false,
    calledCentral: false,
    calledCentralDate: '',
    docsDelivered: false,
    docsDeliveredDate: '',
    isComplete: false,
    isCompleteDate: '',
    sentToInsurer: false,
    sentToInsurerDateChecked: '',
    isExpedienteCompletoConfirmed: false,
    expedienteCompletoConfirmedAt: ''
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

    const unsubPolicies = onSnapshot(
      collection(db, 'policies'),
      (snapshot) => {
        setPolicies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
      },
      (error) => handleFirestoreError(error, OperationType.GET, 'policies')
    );

    return () => {
      unsubClaims();
      unsubInsurances();
      unsubActivities();
      unsubPolicies();
    };
  }, []);

  const handleSaveClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.insuranceId || !formData.date) return;

    try {
      const parsedClaimAmount = formData.claimAmount !== undefined && formData.claimAmount !== null && formData.claimAmount !== ('' as any) && !isNaN(Number(formData.claimAmount))
        ? Number(formData.claimAmount)
        : null;

      const claimData: any = {
        ...formData,
        reference: formData.reference || '',
        claimAmount: parsedClaimAmount,
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
          reference: formData.reference || '',
          claimAmount: parsedClaimAmount,
          description: formData.description,
          isClosed: false,
          documents: formData.documents || [],
          sentToInsurerDate: formData.sentToInsurerDate || '',
          insurerResponse: formData.insurerResponse || 'Pendiente',
          resolutionDate: formData.resolutionDate || '',
          resolutionDescription: formData.resolutionDescription || '',
          reimbursedAmount: formData.reimbursedAmount !== undefined && formData.reimbursedAmount !== null && !isNaN(Number(formData.reimbursedAmount)) ? Number(formData.reimbursedAmount) : null,
          calledCentral: formData.calledCentral || false,
          calledCentralDate: formData.calledCentralDate || '',
          docsDelivered: formData.docsDelivered || false,
          docsDeliveredDate: formData.docsDeliveredDate || '',
          isComplete: formData.isComplete || false,
          isCompleteDate: formData.isCompleteDate || '',
          sentToInsurer: formData.sentToInsurer || false,
          sentToInsurerDateChecked: formData.sentToInsurerDateChecked || '',
          isExpedienteCompletoConfirmed: formData.isExpedienteCompletoConfirmed || false,
          expedienteCompletoConfirmedAt: formData.expedienteCompletoConfirmedAt || '',
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
      reference: '',
      claimAmount: undefined,
      description: '',
      documents: [],
      sentToInsurerDate: '',
      insurerResponse: 'Pendiente',
      resolutionDate: '',
      resolutionDescription: '',
      reimbursedAmount: undefined,
      isClosed: false,
      calledCentral: false,
      calledCentralDate: '',
      docsDelivered: false,
      docsDeliveredDate: '',
      isComplete: false,
      isCompleteDate: '',
      sentToInsurer: false,
      sentToInsurerDateChecked: '',
      isExpedienteCompletoConfirmed: false,
      expedienteCompletoConfirmedAt: ''
    });
    setSelectedClaim(null);
    setModalTab('details');
    setInsuredSearchQuery('');
    setIsInsuredSearchOpen(false);
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

  const [isDragging, setIsDragging] = useState(false);
  const [uploadingStatus, setUploadingStatus] = useState<string | null>(null);

  // Compress image using HTML canvas if file is image
  const compressImage = (file: File, maxWidth = 1600, maxHeight = 1600, quality = 0.82): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => resolve(e.target?.result as string);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    if (formData.isClosed && !isSuperAdmin) {
      alert('El siniestro está cerrado. No se pueden adjuntar más documentos.');
      return;
    }

    setUploadingStatus(`Cargando ${files.length} archivo(s)...`);
    const newDocs: ClaimDocument[] = [];
    const uploadedNames: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadingStatus(`Procesando ${i + 1} de ${files.length}: ${file.name}`);

      try {
        let dataUrl = '';
        if (file.type.startsWith('image/')) {
          dataUrl = await compressImage(file);
        } else {
          if (file.size > 2 * 1024 * 1024) {
            alert(`El archivo "${file.name}" supera 2 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB). Te recomendamos usar archivos comprimidos para asegurar un rápido rendimiento.`);
          }
          dataUrl = await readFileAsDataUrl(file);
        }

        newDocs.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: dataUrl,
          description: '',
          date: format(new Date(), 'yyyy-MM-dd HH:mm')
        });
        uploadedNames.push(file.name);
      } catch (err) {
        console.error(`Error procesando archivo ${file.name}:`, err);
      }
    }

    if (newDocs.length > 0) {
      setFormData(prev => ({
        ...prev,
        documents: [...(prev.documents || []), ...newDocs]
      }));

      // If editing an existing claim, log activity right away
      if (selectedClaim?.id) {
        await addDoc(collection(db, 'claimActivities'), {
          claimId: selectedClaim.id,
          type: 'automatic',
          description: `📤 ${newDocs.length} documento(s) cargado(s): ${uploadedNames.join(', ')}`,
          date: new Date(),
          createdBy: profile?.email || profile?.uid,
          createdAt: serverTimestamp()
        }).catch(console.error);
      }
    }

    setUploadingStatus(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      await processFiles(filesArray);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      await processFiles(filesArray);
      e.target.value = ''; // Reset input
    }
  };

  const getFileTypeBadge = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['pdf'].includes(ext)) {
      return { label: 'PDF', bg: 'bg-red-50 text-red-700 border-red-200' };
    } else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      return { label: ext.toUpperCase(), bg: 'bg-blue-50 text-blue-700 border-blue-200' };
    } else if (['doc', 'docx', 'txt'].includes(ext)) {
      return { label: ext.toUpperCase(), bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    } else if (['zip', 'rar', '7z'].includes(ext)) {
      return { label: ext.toUpperCase(), bg: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    return { label: ext.toUpperCase() || 'FILE', bg: 'bg-gray-50 text-gray-700 border-gray-200' };
  };

  const downloadDocument = (doc: ClaimDocument) => {
    if (doc.url) {
      const a = document.createElement('a');
      a.href = doc.url;
      a.download = doc.name || 'documento';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
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

  const getInsuranceDaysInfo = (ins: InsuranceRequest) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endYMD = getNormalizedYYYYMMDD(ins.endDate);
    if (!endYMD) {
      return { isActive: true, daysSinceEnd: 0, endYMD: '' };
    }

    const [year, month, day] = endYMD.split('-').map(Number);
    const endDateObj = new Date(year, month - 1, day);
    endDateObj.setHours(0, 0, 0, 0);

    if (endDateObj >= today) {
      return { isActive: true, daysSinceEnd: 0, endYMD };
    }

    const diffMs = today.getTime() - endDateObj.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return { isActive: false, daysSinceEnd: diffDays, endYMD };
  };

  const eligibleInsurances = React.useMemo(() => {
    const list = insurances.filter(ins => {
      // Always include currently selected insurance if editing an existing claim
      if (formData.insuranceId && ins.id === formData.insuranceId) {
        return true;
      }

      if (ins.status === 'cancelled') {
        return false;
      }

      const { isActive, daysSinceEnd } = getInsuranceDaysInfo(ins);
      return isActive || daysSinceEnd <= 90;
    });

    return list.sort((a, b) => {
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });
  }, [insurances, formData.insuranceId]);

  const filteredInsurancesList = React.useMemo(() => {
    const query = insuredSearchQuery.trim().toLowerCase();
    if (!query) return eligibleInsurances;

    return eligibleInsurances.filter(ins => {
      const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
      const email = (ins.email || '').toLowerCase();
      const id = (ins.id || '').toLowerCase();
      const idSeg = (ins.IDseg || '').toLowerCase();
      const policyNum = (ins.policyNumber || '').toLowerCase();
      const policyName = (ins.policyName || ins.plan || '').toLowerCase();

      return fullName.includes(query) || 
             email.includes(query) || 
             id.includes(query) || 
             idSeg.includes(query) || 
             policyNum.includes(query) || 
             policyName.includes(query);
    });
  }, [eligibleInsurances, insuredSearchQuery]);

  const selectedInsurance = insurances.find(i => i.id === formData.insuranceId);

  const filteredClaims = claims.filter(c => {
    const ins = insurances.find(i => i.id === c.insuranceId);
    const searchString = `${ins?.firstName} ${ins?.lastName} ${c.description} ${c.reference || ''} ${c.id}`.toLowerCase();
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {getStatusBadge(claim)}
                        {claim.insurerResponse && (
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border ${
                            claim.insurerResponse === 'Aprobado'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : claim.insurerResponse === 'Rechazado'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {claim.insurerResponse === 'Aprobado' ? '✅ Aprobado' : claim.insurerResponse === 'Rechazado' ? '❌ Rechazado' : '⏳ Pendiente'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono shrink-0">#{claim.id?.substring(0, 8)}</span>
                    </div>
                    
                    <h3 className="font-bold text-gray-900 mb-1">{ins?.firstName} {ins?.lastName}</h3>
                    
                    <div className="space-y-1 mb-3">
                      {claim.reference && (
                        <p className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider">Ref (EN):</span>
                          <span>{claim.reference}</span>
                        </p>
                      )}
                      {claim.claimAmount !== undefined && claim.claimAmount !== null && (
                        <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-400 uppercase font-black tracking-wider">Reclamo:</span>
                          <span>${Number(claim.claimAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                        </p>
                      )}
                    </div>

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

                    <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClaim(claim);
                          setFormData(claim);
                          setModalTab('details');
                          setShowModal(true);
                        }}
                        className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl text-[10px] font-extrabold flex items-center gap-1.5 transition-colors"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Adjuntar Archivos</span>
                      </button>

                      <div className="flex items-center gap-1 text-rose-600 font-bold text-xs group-hover:translate-x-0.5 transition-transform">
                        <span>Ver Detalles</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
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
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                          Asegurado ({eligibleInsurances.length} disponibles)
                        </label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              if (formData.isClosed && !isSuperAdmin) return;
                              setIsInsuredSearchOpen(!isInsuredSearchOpen);
                            }}
                            className={`w-full flex items-center justify-between pl-12 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer hover:bg-gray-100 transition-all text-left font-bold text-sm ${
                              formData.isClosed && !isSuperAdmin ? 'opacity-60 cursor-not-allowed' : ''
                            }`}
                          >
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-600" />
                            {selectedInsurance ? (
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-gray-900 font-bold truncate">
                                  {selectedInsurance.firstName} {selectedInsurance.lastName}
                                </span>
                                <span className="text-xs text-gray-500 font-normal truncate">
                                  ({selectedInsurance.policyName || selectedInsurance.plan || selectedInsurance.id})
                                </span>
                                {(() => {
                                  const { isActive, daysSinceEnd } = getInsuranceDaysInfo(selectedInsurance);
                                  if (isActive) {
                                    return <span className="px-2 py-0.5 bg-green-100 text-green-800 text-[10px] font-bold rounded-full flex-shrink-0">Activo</span>;
                                  }
                                  return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full flex-shrink-0">Terminado ({daysSinceEnd}d)</span>;
                                })()}
                              </div>
                            ) : (
                              <span className="text-gray-400 font-medium text-xs">Buscar y seleccionar asegurado...</span>
                            )}
                            <ChevronDown className={`w-4 h-4 text-gray-400 ml-2 flex-shrink-0 transition-transform ${isInsuredSearchOpen ? 'rotate-180' : ''}`} />
                          </button>

                          {isInsuredSearchOpen && (
                            <>
                              <div 
                                className="fixed inset-0 z-20" 
                                onClick={() => setIsInsuredSearchOpen(false)} 
                              />
                              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 p-3 space-y-2">
                                <div className="relative">
                                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="Escriba para buscar asegurado..."
                                    value={insuredSearchQuery}
                                    onChange={(e) => setInsuredSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-rose-500"
                                  />
                                  {insuredSearchQuery && (
                                    <button
                                      type="button"
                                      onClick={() => setInsuredSearchQuery('')}
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>

                                <div className="flex items-center justify-between px-2 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-1.5">
                                  <span>Resultados ({filteredInsurancesList.length})</span>
                                  <span>Activos / Terminado &lt;90d</span>
                                </div>

                                <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                                  {filteredInsurancesList.length === 0 ? (
                                    <div className="p-4 text-center text-xs text-gray-400 italic">
                                      No se encontraron asegurados activos o finalizados en los últimos 90 días.
                                    </div>
                                  ) : (
                                    filteredInsurancesList.map((ins) => {
                                      const isSelected = ins.id === formData.insuranceId;
                                      const { isActive, daysSinceEnd } = getInsuranceDaysInfo(ins);

                                      return (
                                        <div
                                          key={ins.id}
                                          onClick={() => {
                                            setFormData(prev => ({ ...prev, insuranceId: ins.id || '' }));
                                            setIsInsuredSearchOpen(false);
                                            setInsuredSearchQuery('');
                                          }}
                                          className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                                            isSelected ? 'bg-rose-50 border border-rose-200' : 'hover:bg-gray-50 border border-transparent'
                                          }`}
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                              <p className={`text-xs font-bold truncate ${isSelected ? 'text-rose-700' : 'text-gray-900'}`}>
                                                {ins.firstName} {ins.lastName}
                                              </p>
                                              {isActive ? (
                                                <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[9px] font-bold rounded-full flex-shrink-0">
                                                  Activo
                                                </span>
                                              ) : (
                                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-bold rounded-full flex-shrink-0">
                                                  Terminado hace {daysSinceEnd}d
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-[10px] text-gray-500 truncate mt-0.5">
                                              {ins.policyName || ins.plan || 'Póliza sin nombre'} • Vigencia: {ins.startDate} al {ins.endDate}
                                            </p>
                                          </div>
                                          {isSelected && <CheckCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </>
                          )}
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                            Referencia
                          </label>
                          <p className="text-[10px] text-amber-600 font-semibold mb-2 flex items-center gap-1">
                            ⚠️ Debe estar en inglés / Must be in English
                          </p>
                          <input 
                            type="text"
                            value={formData.reference || ''}
                            onChange={(e) => setFormData({...formData, reference: e.target.value})}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                            placeholder="e.g. CLAIM-2026-EN / Emergency medical treatment"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                            Cantidad Reclamo ($ USD)
                          </label>
                          <input 
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.claimAmount !== undefined && formData.claimAmount !== null ? formData.claimAmount : ''}
                            onChange={(e) => setFormData({...formData, claimAmount: e.target.value !== '' ? parseFloat(e.target.value) : undefined})}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

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

                      <div className="space-y-4 pt-2 border-t border-gray-100">
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Respuesta Aseguradora</label>
                          <select 
                            value={formData.insurerResponse || 'Pendiente'}
                            onChange={(e) => {
                              const val = e.target.value;
                              const todayStr = format(new Date(), 'yyyy-MM-dd');
                              setFormData(prev => ({
                                ...prev,
                                insurerResponse: val,
                                resolutionDate: (val === 'Rechazado' || val === 'Aprobado')
                                  ? (prev.resolutionDate || todayStr)
                                  : prev.resolutionDate
                              }));
                            }}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none font-bold text-xs cursor-pointer"
                          >
                            <option value="Pendiente">⏳ Pendiente</option>
                            <option value="Rechazado">❌ Rechazado</option>
                            <option value="Aprobado">✅ Aprobado</option>
                          </select>
                        </div>

                        {formData.insurerResponse === 'Rechazado' && (
                          <div className="p-4 bg-red-50/70 border border-red-100 rounded-2xl space-y-3">
                            <div className="flex items-center gap-2 text-red-700 font-black text-xs">
                              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                              <span>Detalles del Rechazo</span>
                            </div>

                            <div>
                              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                                Fecha de Resolución
                              </label>
                              <input 
                                type="date"
                                value={formData.resolutionDate || format(new Date(), 'yyyy-MM-dd')}
                                onChange={(e) => setFormData({ ...formData, resolutionDate: e.target.value })}
                                disabled={formData.isClosed && !isSuperAdmin}
                                className="w-full p-2.5 bg-white border border-red-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none font-bold text-xs"
                              />
                              <p className="text-[9px] text-gray-400 mt-1">Se establece automáticamente con la fecha de hoy pero puede ser modificada.</p>
                            </div>

                            <div>
                              <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                                Descripción de la Resolución / Causa del Rechazo
                              </label>
                              <textarea 
                                rows={3}
                                value={formData.resolutionDescription || ''}
                                onChange={(e) => setFormData({ ...formData, resolutionDescription: e.target.value })}
                                disabled={formData.isClosed && !isSuperAdmin}
                                placeholder="Escriba los motivos o comentarios sobre la resolución del rechazo..."
                                className="w-full p-3 bg-white border border-red-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none font-medium text-xs resize-none"
                              />
                            </div>
                          </div>
                        )}

                        {formData.insurerResponse === 'Aprobado' && (
                          <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl space-y-3">
                            <div className="flex items-center gap-2 text-emerald-800 font-black text-xs">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>Detalles de Aprobación</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                                  Cantidad Reembolsada ($ USD)
                                </label>
                                <input 
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={formData.reimbursedAmount !== undefined && formData.reimbursedAmount !== null ? formData.reimbursedAmount : ''}
                                  onChange={(e) => setFormData({ ...formData, reimbursedAmount: e.target.value !== '' ? parseFloat(e.target.value) : undefined })}
                                  disabled={formData.isClosed && !isSuperAdmin}
                                  placeholder="0.00"
                                  className="w-full p-2.5 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-xs"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                                  Fecha de Resolución
                                </label>
                                <input 
                                  type="date"
                                  value={formData.resolutionDate || format(new Date(), 'yyyy-MM-dd')}
                                  onChange={(e) => setFormData({ ...formData, resolutionDate: e.target.value })}
                                  disabled={formData.isClosed && !isSuperAdmin}
                                  className="w-full p-2.5 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-xs"
                                />
                              </div>
                            </div>
                            <p className="text-[9px] text-gray-400">La fecha de resolución se establece automáticamente con la fecha de hoy pero puede ser modificada.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </form>

                  {/* Documents Side */}
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Documentos del Expediente ({formData.documents?.length || 0})
                        </label>
                      </div>

                      {/* Drag & Drop Dropzone */}
                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={`relative p-6 border-2 border-dashed rounded-3xl text-center transition-all flex flex-col items-center justify-center gap-2 ${
                          isDragging
                            ? 'border-rose-500 bg-rose-50/70 scale-[1.01] shadow-lg'
                            : 'border-gray-200 bg-gray-50/60 hover:bg-gray-50 hover:border-rose-300'
                        } ${(formData.isClosed && !isSuperAdmin) ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <input
                          type="file"
                          multiple
                          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.zip,.rar"
                          onChange={handleFileInputChange}
                          disabled={formData.isClosed && !isSuperAdmin}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        
                        <div className="p-3 bg-white text-rose-600 rounded-2xl shadow-sm border border-gray-100 mb-1">
                          {uploadingStatus ? (
                            <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
                          ) : (
                            <UploadCloud className="w-6 h-6" />
                          )}
                        </div>

                        {uploadingStatus ? (
                          <p className="text-xs font-bold text-rose-600 animate-pulse">{uploadingStatus}</p>
                        ) : (
                          <>
                            <p className="text-xs font-bold text-gray-800">
                              Arrastra y suelta tus archivos aquí
                            </p>
                            <p className="text-[10px] font-medium text-gray-400 max-w-xs">
                              Soporta selección múltiple de PDFs, imágenes, documentos Word o archivos ZIP.
                            </p>
                            <span className="mt-2 px-4 py-1.5 bg-rose-600 text-white rounded-xl text-[10px] font-extrabold shadow-sm hover:bg-rose-700 transition-colors pointer-events-none">
                              Examinar Archivos
                            </span>
                          </>
                        )}
                      </div>
                      
                      {/* Documents List */}
                      <div className="mt-4 space-y-3 max-h-[420px] overflow-y-auto pr-1">
                        {formData.documents?.length === 0 ? (
                          <div className="p-8 border border-gray-100 rounded-2xl text-center text-gray-400 italic text-xs flex flex-col items-center gap-2 bg-gray-50/40">
                            <FileUp className="w-8 h-8 opacity-20" />
                            <span>No se han adjuntado documentos aún.</span>
                          </div>
                        ) : (
                          formData.documents?.map((doc, idx) => {
                            const badge = getFileTypeBadge(doc.name);
                            return (
                              <div key={doc.id || idx} className="flex flex-col gap-2 p-3.5 bg-gray-50/80 hover:bg-white rounded-2xl border border-gray-100/90 group shadow-sm transition-all">
                                <div className="flex items-center gap-2.5">
                                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${badge.bg}`}>
                                    {badge.label}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-900 truncate" title={doc.name}>
                                      {doc.name}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <a
                                      href={doc.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Visualizar documento"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => downloadDocument(doc)}
                                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                      title="Descargar documento"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (formData.isClosed && !isSuperAdmin) return;
                                        setFormData({ ...formData, documents: formData.documents?.filter((_, i) => i !== idx) });
                                      }}
                                      disabled={formData.isClosed && !isSuperAdmin}
                                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                                      title="Eliminar de expediente"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-0.5">
                                  <div>
                                    <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Fecha</p>
                                    <input 
                                      type="text"
                                      value={doc.date || ''}
                                      onChange={(e) => {
                                        const newDocs = [...(formData.documents || [])];
                                        newDocs[idx] = { ...newDocs[idx], date: e.target.value };
                                        setFormData({ ...formData, documents: newDocs });
                                      }}
                                      disabled={formData.isClosed && !isSuperAdmin}
                                      className="w-full text-[9px] px-2 py-1 bg-white border border-gray-100 rounded-lg focus:ring-1 focus:ring-rose-500 outline-none font-medium"
                                    />
                                  </div>
                                  <div>
                                    <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1">Concepto / Nota</p>
                                    <input 
                                      type="text"
                                      value={doc.description || ''}
                                      onChange={(e) => {
                                        const newDocs = [...(formData.documents || [])];
                                        newDocs[idx] = { ...newDocs[idx], description: e.target.value };
                                        setFormData({ ...formData, documents: newDocs });
                                      }}
                                      disabled={formData.isClosed && !isSuperAdmin}
                                      placeholder="Ej. Factura médica, Pase de abordar..."
                                      className="w-full text-[9px] px-2 py-1 bg-white border border-gray-100 rounded-lg focus:ring-1 focus:ring-rose-500 outline-none font-medium"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })
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
                              const newFormData = {
                                ...formData,
                                [item.field]: checked,
                                [item.dateField]: checked ? format(new Date(), 'yyyy-MM-dd HH:mm') : ''
                              };
                              if (!checked) {
                                newFormData.isExpedienteCompletoConfirmed = false;
                              }
                              setFormData(newFormData);
                            }}
                            disabled={formData.isClosed && !isSuperAdmin}
                            className="w-5 h-5 rounded-lg border-2 border-gray-200 text-rose-600 focus:ring-rose-500 mt-0.5 cursor-pointer"
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

                  {/* Expediente Completo Confirm Button & Email trigger */}
                  {!!(formData.calledCentral && formData.docsDelivered && formData.isComplete && formData.sentToInsurer) && (
                    <div className="mt-6 animate-fadeIn">
                      {!formData.isExpedienteCompletoConfirmed ? (
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-sm">
                              <FolderCheck className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                                Operación del Siniestro Completa
                              </p>
                              <p className="text-[11px] font-medium text-emerald-800 mt-0.5">
                                Haz clic en Expediente Completo para confirmar la documentación y habilitar el envío del correo.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                isExpedienteCompletoConfirmed: true,
                                expedienteCompletoConfirmedAt: format(new Date(), 'dd/MMM/yyyy HH:mm')
                              }));
                            }}
                            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Expediente Completo</span>
                          </button>
                        </div>
                      ) : (
                        <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-300/80 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-sm">
                              <CheckCircle2 className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-emerald-950 uppercase tracking-wide">
                                  ✓ Expediente Completo Confirmado
                                </span>
                                {formData.expedienteCompletoConfirmedAt && (
                                  <span className="text-[9px] font-extrabold bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-md">
                                    {formData.expedienteCompletoConfirmedAt}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] font-medium text-emerald-800 mt-0.5">
                                Expediente verificado. Puedes enviar el correo oficial con el archivo ZIP de los documentos adjuntos.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsEmailModalOpen(true)}
                            className="px-6 py-3 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-white text-xs font-black rounded-xl shadow-md hover:shadow-xl transition-all flex items-center gap-2.5 whitespace-nowrap cursor-pointer"
                          >
                            <Mail className="w-4.5 h-4.5" />
                            <span>Enviar Correo</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
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

      <ClaimEmailModal
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        claim={{ ...(selectedClaim || {}), ...formData } as Claim}
        insurance={insurances.find(i => i.id === formData.insuranceId) || null}
        policy={policies.find(p => p.id === insurances.find(i => i.id === formData.insuranceId)?.policyId) || null}
        companySettings={companySettings}
        profile={profile}
        onSuccess={(updatedFields) => {
          if (updatedFields) {
            setFormData(prev => ({ ...prev, ...updatedFields }));
          }
        }}
      />
    </div>
  );
}
