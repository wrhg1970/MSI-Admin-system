import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  serverTimestamp, 
  orderBy,
  setDoc,
  getDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole, CustomRole, Permission, SystemDocument } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { formatDisplayDate } from '../lib/policyUtils';
import ConfirmModal from './ConfirmModal';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Shield, 
  User, 
  Mail, 
  Calendar, 
  CheckCircle2, 
  X, 
  Save, 
  Lock, 
  Key,
  Building2,
  Users2,
  FileText,
  Upload,
  Download,
  AlertCircle,
  Database,
  Search,
  Settings,
  RefreshCw,
  ShoppingBag,
  MessageSquare,
  DollarSign,
  Activity,
  Globe,
  FileSpreadsheet,
  AlertTriangle,
  Clock,
  ArrowRight,
  CreditCard,
  PenTool,
  Signature,
  Cloud,
  Copy,
  ExternalLink,
  Terminal,
  HardDrive,
  Check
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Papa from 'papaparse';
import WooCommerceManager from './WooCommerceManager';
import WhatsAppIntegration from './WhatsAppIntegration';
import StripeIntegration from './StripeIntegration';
import QuotaDashboard from './QuotaDashboard';
import { 
  compressJsonToZipBlob, 
  compressJsonToBase64Zip, 
  decompressZipToJson, 
  readBackupFile, 
  formatBytes,
  downloadBlob 
} from '../lib/zipUtils';

const SYSTEM_ROLES: { id: UserRole; name: string; description: string; color: string }[] = [
  { id: 'super_admin', name: 'Super Administrador', description: 'Acceso total al sistema y configuración', color: 'bg-red-100 text-red-700' },
  { id: 'director', name: 'Director', description: 'Gestión estratégica, reportes y aprobación de pagos', color: 'bg-purple-100 text-purple-700' },
  { id: 'seguros', name: 'Seguros', description: 'Operación de pólizas y siniestros', color: 'bg-blue-100 text-blue-700' },
  { id: 'administracion', name: 'Administración', description: 'Gestión de clientes y pagos', color: 'bg-green-100 text-green-700' },
  { id: 'admin', name: 'Administrador', description: 'Gestión general del sistema', color: 'bg-gray-100 text-gray-700' },
  { id: 'agent', name: 'Agente', description: 'Venta de seguros y gestión de cartera', color: 'bg-orange-100 text-orange-700' },
  { id: 'client', name: 'Cliente', description: 'Acceso a sus propias pólizas', color: 'bg-gray-100 text-gray-700' },
];

const GCS_PROJECT_ID = 'ai-studio-msiadminplatform-aafdf6c5-a449-4ecd-ad08-755db11e4987';
const GCS_SERVICE_ACCOUNT = 'ai-studio-msiadminplatform-aafdf6c5-a449-4ecd-ad08-755db11e4987@appspot.gserviceaccount.com';

const GCS_SNIPPET_STEP1 = 'gcloud storage buckets create gs://miseguro-firestore-backups --location=us-east1 --default-storage-class=NEARLINE';
const GCS_SNIPPET_STEP2 = `gcloud projects add-iam-policy-binding ${GCS_PROJECT_ID} --member="serviceAccount:${GCS_SERVICE_ACCOUNT}" --role="roles/datastore.importExportAdmin"`;
const GCS_SNIPPET_STEP3 = `gcloud scheduler jobs create http firestore-weekly-backup --schedule="0 2 * * 0" --uri="https://firestore.googleapis.com/v1/projects/${GCS_PROJECT_ID}/databases/(default):exportDocuments" --http-method=POST --message-body="{\\"outputUriPrefix\\":\\"gs://miseguro-firestore-backups/semanal\\"}" --oauth-service-account-email="${GCS_SERVICE_ACCOUNT}" --location=us-east1`;
const GCS_SNIPPET_STEP4 = `gcloud firestore export gs://miseguro-firestore-backups/manual-$(date +%Y%m%d_%H%M%S) --project=${GCS_PROJECT_ID}`;

const getDefaultPermissions = (roleId: string) => {
  const perms: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean }> = {};
  const allMenus = [
    'dashboard', 'request', 'clients', 'providers', 'policies', 
    'catalogs', 'admin', 'commissions', 'reports', 'insurance-plans', 
    'claims', 'config', 'notifications', 'historico'
  ];

  if (roleId === 'super_admin' || roleId === 'admin' || roleId === 'director') {
    allMenus.forEach(m => {
      perms[m] = { view: true, create: true, edit: true, delete: true };
    });
  } else if (roleId === 'seguros') {
    const allowed = ['dashboard', 'request', 'clients', 'policies', 'catalogs', 'insurance-plans', 'providers', 'claims', 'historico'];
    allMenus.forEach(m => {
      const isAllowed = allowed.includes(m);
      perms[m] = { view: isAllowed, create: isAllowed, edit: isAllowed, delete: isAllowed };
    });
  } else if (roleId === 'administracion') {
    const allowed = ['dashboard', 'reports', 'commissions', 'providers', 'historico'];
    allMenus.forEach(m => {
      const isAllowed = allowed.includes(m);
      perms[m] = { view: isAllowed, create: isAllowed, edit: isAllowed, delete: isAllowed };
    });
  } else if (roleId === 'agent') {
    const allowed = ['dashboard', 'request', 'clients', 'policies', 'historico'];
    allMenus.forEach(m => {
      const isAllowed = allowed.includes(m);
      perms[m] = { view: isAllowed, create: isAllowed, edit: isAllowed, delete: false };
    });
  } else if (roleId === 'client') {
    const allowed = ['dashboard', 'request', 'policies', 'historico'];
    allMenus.forEach(m => {
      const isAllowed = allowed.includes(m);
      perms[m] = { view: isAllowed, create: false, edit: false, delete: false };
    });
  } else {
    allMenus.forEach(m => {
      perms[m] = { view: false, create: false, edit: false, delete: false };
    });
  }
  return perms;
};

interface ConfigPanelProps {
  profile: UserProfile | null;
  rolePermissions: CustomRole | null;
}

import { useSearchParams } from 'react-router-dom';

export default function ConfigPanel({ profile, rolePermissions }: ConfigPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [activeTab, setActiveTab] = useState<'company' | 'roles' | 'users' | 'documents' | 'import' | 'woocommerce' | 'whatsapp' | 'stripe' | 'backup' | 'quota'>((searchParams.get('tab') as any) || 'company');
  
  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['company', 'roles', 'users', 'documents', 'import', 'woocommerce', 'whatsapp', 'stripe', 'backup', 'quota'].includes(tab)) {
      setActiveTab(tab as any);
    }
  }, [searchParams]);

  const handleTabChange = (tab: 'company' | 'roles' | 'users' | 'documents' | 'import' | 'woocommerce' | 'whatsapp' | 'stripe' | 'backup' | 'quota') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const systemRoleIds = ['super_admin', 'director', 'seguros', 'administracion', 'admin', 'agent', 'client'];
  const trulyCustomRoles = useMemo(() => {
    return customRoles.filter(role => !systemRoleIds.includes(role.id));
  }, [customRoles]);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isAddingRole, setIsAddingRole] = useState(false);
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
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // States and variables for full-database exports
  const [isExportingFull, setIsExportingFull] = useState(false);
  const [exportCollectionProgress, setExportCollectionProgress] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{
    status: 'idle' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  // States and variables for full-database backup import/restore
  const [isImportingFull, setIsImportingFull] = useState(false);
  const [importCollectionProgress, setImportCollectionProgress] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{
    status: 'idle' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [selectedBackupFile, setSelectedBackupFile] = useState<any>(null);
  const [selectedBackupMeta, setSelectedBackupMeta] = useState<any>(null);

  // Collections we can backup & export
  const EXPORTABLE_COLLECTIONS = [
    { id: 'users', label: 'Perfiles de Usuarios (users)', desc: 'Información y permisos de los miembros de la plataforma' },
    { id: 'clients', label: 'Clientes Registrados (clients)', desc: 'Clientes tipo Individual, Agencia y Corporativo' },
    { id: 'insurances', label: 'Solicitudes y Pólizas Activas (insurances)', desc: 'Datos del asegurado primario, coberturas y días de viaje' },
    { id: 'policies', label: 'Pólizas Base y Productos (policies)', desc: 'Catálogos de productos del sistema' },
    { id: 'policyLetters', label: 'Cartas de Seguro / Cobertura (policyLetters)', desc: 'Plantillas de correo y cartas configuradas de cada seguro' },
    { id: 'payments', label: 'Transacciones y Cobranza (payments)', desc: 'Ingresos por cuotas de clientes y egresos por comisiones de agentes' },
    { id: 'claims', label: 'Siniestros y Reclamaciones (claims)', desc: 'Casos de siniestros aperturados y estados de pago' },
    { id: 'claimActivities', label: 'Historial de Siniestros (claimActivities)', desc: 'Log detallado de novedades en reclamaciones' },
    { id: 'insuranceActivities', label: 'Historial de Pólizas (insuranceActivities)', desc: 'Log detallado de cambios de estatus de seguros' },
    { id: 'notificationLogs', label: 'Historial de Correos/Notificaciones (notificationLogs)', desc: 'Mensajería automatizada enviada a clientes o agentes' },
    { id: 'insuranceTypes', label: 'Ramas y Tipos de Cobertura (insuranceTypes)', desc: 'Definiciones de rangos de edad y límites de cobertura' },
    { id: 'actionTypes', label: 'Mapeos de Notificación (actionTypes)', desc: 'Comandos de mensajería automatizada' },
    { id: 'paymentMethods', label: 'Cuentas y Pasarelas de Pago (paymentMethods)', desc: 'Métodos de pago aprobados' },
    { id: 'categories', label: 'Categorías de Administración (categories)', desc: 'Estructuras de cuentas contables primarias' },
    { id: 'subcategories', label: 'Subcategorías Contables (subcategories)', desc: 'Desgloses asociados de cuentas contables' },
    { id: 'providers', label: 'Proveedores Aseguradores (providers)', desc: 'Centrales internacionales de reaseguros' },
    { id: 'exchangeRates', label: 'Tipos de Cambio Históricos (exchangeRates)', desc: 'Registro de conversión a USD' },
    { id: 'countries', label: 'Catálogo de Países (countries)', desc: 'Países de origen y destino configurados' }
  ];

  const [exportScope, setExportScope] = useState<Record<string, boolean>>({
    users: true,
    clients: true,
    insurances: true,
    policies: true,
    policyLetters: true,
    payments: true,
    claims: true,
    claimActivities: true,
    insuranceActivities: true,
    notificationLogs: true,
    insuranceTypes: true,
    actionTypes: true,
    paymentMethods: true,
    categories: true,
    subcategories: true,
    providers: true,
    exchangeRates: true,
    countries: true,
  });

  const [importScope, setImportScope] = useState<Record<string, boolean>>({});

  // Automated & Cloud backups states
  const [cloudBackups, setCloudBackups] = useState<any[]>([]);
  const [backupSchedule, setBackupSchedule] = useState<{
    enabled: boolean;
    frequency: 'hourly' | 'daily' | 'weekly';
    lastBackupTime: string | null;
  }>({ enabled: false, frequency: 'daily', lastBackupTime: null });
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [isTriggeringCloudBackup, setIsTriggeringCloudBackup] = useState(false);
  const [cloudBackupStatus, setCloudBackupStatus] = useState<{
    status: 'idle' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const [copiedGcsSnippet, setCopiedGcsSnippet] = useState<string | null>(null);

  const handleCopySnippet = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedGcsSnippet(id);
    setTimeout(() => setCopiedGcsSnippet(null), 2500);
  };

  // Load cloud backups and scheduler settings
  const fetchCloudBackupsAndSchedule = async () => {
    setIsLoadingBackups(true);
    try {
      const scheduleSnap = await getDoc(doc(db, "settings", "backup_schedule"));
      if (scheduleSnap.exists()) {
        setBackupSchedule(scheduleSnap.data() as any);
      } else {
        setBackupSchedule({ enabled: false, frequency: 'daily', lastBackupTime: null });
      }

      const backupsSnap = await getDocs(collection(db, "backups"));
      const backupsData = backupsSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          meta: data.meta
        };
      });
      // Sort newest first
      backupsData.sort((a, b) => (b.meta?.exportedAt || "").localeCompare(a.meta?.exportedAt || ""));
      setCloudBackups(backupsData);
    } catch (err: any) {
      console.error("Error loading backups / schedule:", err);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'backup') {
      fetchCloudBackupsAndSchedule();
    }
  }, [activeTab]);

  const handleSaveSchedule = async () => {
    setIsSavingSchedule(true);
    setCloudBackupStatus({ status: 'idle' });
    try {
      const scheduleRef = doc(db, "settings", "backup_schedule");
      const scheduleSnap = await getDoc(scheduleRef);
      const currentData = scheduleSnap.exists() ? scheduleSnap.data() : { lastBackupTime: null };

      const newSchedule = {
        enabled: !!backupSchedule.enabled,
        frequency: backupSchedule.frequency || "daily",
        lastBackupTime: currentData?.lastBackupTime || null
      };

      await setDoc(scheduleRef, newSchedule);
      setBackupSchedule(newSchedule);
      setCloudBackupStatus({
        status: 'success',
        message: 'Configuración de copia de seguridad programada guardada con éxito.'
      });
    } catch (err: any) {
      setCloudBackupStatus({
        status: 'error',
        message: `Error al guardar configuración: ${err.message}`
      });
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleTriggerCloudBackup = async () => {
    setIsTriggeringCloudBackup(true);
    setCloudBackupStatus({ status: 'idle' });
    try {
      const backupData: Record<string, any[]> = {};
      const recordCounts: Record<string, number> = {};

      for (const collectionMeta of EXPORTABLE_COLLECTIONS) {
        const colRef = collection(db, collectionMeta.id);
        const snap = await getDocs(colRef);

        backupData[collectionMeta.id] = snap.docs.map(doc => {
          const rawData = doc.data();
          const serializedData = serializeFirestoreObject(rawData);
          return {
            id: doc.id,
            ...serializedData
          };
        });
        recordCounts[collectionMeta.id] = backupData[collectionMeta.id].length;
      }

      // Compress backup payload using JSZip DEFLATE level 9
      const { base64Zip, originalSize, compressedSize } = await compressJsonToBase64Zip(backupData);
      const ratio = Math.round((1 - compressedSize / originalSize) * 100);

      const backupDoc = {
        meta: {
          appId: "mi-seguro-internacional",
          version: "2.0-full-backup",
          exportedAt: new Date().toISOString(),
          exportedBy: profile?.email || 'Administrador (Manual)',
          totalCollectionsCount: EXPORTABLE_COLLECTIONS.length,
          recordCounts: recordCounts,
          isCompressed: true,
          originalSize,
          compressedSize,
          compressionRatio: `${ratio}%`
        },
        zippedData: base64Zip,
        databaseJson: ""
      };

      const backupId = `backup_${Date.now()}`;
      await setDoc(doc(db, "backups", backupId), backupDoc);

      // Keep only last 5 backups
      const backupsSnap = await getDocs(collection(db, "backups"));
      const backupsList = backupsSnap.docs.map(d => ({
        id: d.id,
        exportedAt: d.data().meta?.exportedAt || ""
      }));

      backupsList.sort((a, b) => a.exportedAt.localeCompare(b.exportedAt));

      if (backupsList.length > 5) {
        const toDelete = backupsList.slice(0, backupsList.length - 5);
        for (const oldBackup of toDelete) {
          await deleteDoc(doc(db, "backups", oldBackup.id));
        }
      }

      await fetchCloudBackupsAndSchedule();
      setCloudBackupStatus({
        status: 'success',
        message: `¡Copia de seguridad comprimida en la nube completada con éxito! (${formatBytes(originalSize)} comprimido a ${formatBytes(compressedSize)} - reducción del ${ratio}%).`
      });
    } catch (err: any) {
      setCloudBackupStatus({
        status: 'error',
        message: `Error al ejecutar respaldo: ${err.message}`
      });
    } finally {
      setIsTriggeringCloudBackup(false);
    }
  };

  const handleDownloadCloudBackup = async (id: string, name: string) => {
    try {
      const backupSnap = await getDoc(doc(db, "backups", id));
      if (!backupSnap.exists()) throw new Error("Copia de seguridad no encontrada");

      const data = backupSnap.data()!;
      let databaseObj: any = {};

      if (data.zippedData) {
        databaseObj = await decompressZipToJson(data.zippedData);
      } else if (data.databaseJson) {
        databaseObj = JSON.parse(data.databaseJson || "{}");
      }

      const fileData = {
        meta: data.meta,
        database: databaseObj
      };

      const zipBlob = await compressJsonToZipBlob(fileData, 'backup.json');
      downloadBlob(zipBlob, `${name}.zip`);
    } catch (err: any) {
      alert(`No se pudo descargar la copia de seguridad: ${err.message}`);
    }
  };

  const handleRestoreCloudBackup = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas restaurar la base de datos completa con este respaldo? Esta acción sobrescribirá los datos actuales con la información de la copia de seguridad seleccionada.')) {
      return;
    }

    setIsLoadingBackups(true);
    setCloudBackupStatus({ status: 'idle' });
    try {
      const backupSnap = await getDoc(doc(db, "backups", id));
      if (!backupSnap.exists()) throw new Error("Copia de seguridad no encontrada");

      const data = backupSnap.data()!;
      let database: any = {};

      if (data.zippedData) {
        database = await decompressZipToJson(data.zippedData);
      } else if (data.databaseJson) {
        database = JSON.parse(data.databaseJson || "{}");
      }

      let restoredCount = 0;
      const collectionsToRestore = Object.keys(database);

      for (const colName of collectionsToRestore) {
        const docList = database[colName];
        if (!Array.isArray(docList)) continue;

        for (const docObj of docList) {
          const { id: docId, ...docData } = docObj;
          if (!docId) continue;

          const processedData = { ...docData };

          for (const field of Object.keys(processedData)) {
            const val = processedData[field];
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(val)) {
              processedData[field] = new Date(val);
            }
          }

          await setDoc(doc(db, colName, docId), processedData);
          restoredCount++;
        }
      }

      setCloudBackupStatus({
        status: 'success',
        message: `Base de datos restaurada con éxito. Se importaron ${restoredCount} documentos pertenecientes a ${collectionsToRestore.length} colecciones.`
      });
    } catch (err: any) {
      setCloudBackupStatus({
        status: 'error',
        message: `Error al restaurar respaldo: ${err.message}`
      });
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleDeleteCloudBackup = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar permanentemente esta copia de seguridad en la nube?')) {
      return;
    }
    try {
      await deleteDoc(doc(db, "backups", id));
      await fetchCloudBackupsAndSchedule();
    } catch (err: any) {
      alert(`No se pudo eliminar el respaldo: ${err.message}`);
    }
  };

  // Robust function to nested serialize firestore documents recursively
  const serializeFirestoreObject = (data: any): any => {
    if (data === null || data === undefined) return '';
    
    // Firestore Timestamp conversion
    if (typeof data === 'object' && data.seconds !== undefined && data.nanoseconds !== undefined) {
      try {
        const d = new Date(data.seconds * 1000);
        return d.toISOString();
      } catch (_) {
        return '';
      }
    }
    
    // Standard JS Date
    if (data instanceof Date) {
      return data.toISOString();
    }

    if (Array.isArray(data)) {
      return data.map(item => typeof item === 'object' ? serializeFirestoreObject(item) : item);
    }

    if (typeof data === 'object') {
      const cleanObj: any = {};
      for (const key of Object.keys(data)) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const val = data[key];
          if (val === null || val === undefined) {
            cleanObj[key] = '';
          } else if (typeof val === 'object' && val.seconds !== undefined) {
            // Unify Timestamps to ISO Strings
            cleanObj[key] = serializeFirestoreObject(val);
          } else if (typeof val === 'object') {
            // Keep object but recursively serialize its values (avoids converting everything to flat string inside the backup JSON)
            cleanObj[key] = serializeFirestoreObject(val);
          } else {
            cleanObj[key] = val;
          }
        }
      }
      return cleanObj;
    }

    return data;
  };

  // Convert array of Objects to flat objects for CSV (used by export individuals as CSV)
  const flattenObjectForCSV = (obj: any): any => {
    const flattened: any = {};
    const flatten = (current: any, prefix = '') => {
      if (current === null || current === undefined) return;
      if (typeof current !== 'object') {
        flattened[prefix.slice(0, -1)] = current;
        return;
      }
      if (Array.isArray(current)) {
        flattened[prefix.slice(0, -1)] = current.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('; ');
        return;
      }
      for (const key of Object.keys(current)) {
        const value = current[key];
        const nextPrefix = `${prefix}${key}_`;
        if (value && typeof value === 'object' && value.seconds === undefined && !Array.isArray(value)) {
          flatten(value, nextPrefix);
        } else if (value && typeof value === 'object' && value.seconds !== undefined) {
          // Flatten Timestamp to raw date
          try {
            flattened[nextPrefix.slice(0, -1)] = new Date(value.seconds * 1000).toISOString();
          } catch (_) {
            flattened[nextPrefix.slice(0, -1)] = String(value);
          }
        } else {
          flattened[nextPrefix.slice(0, -1)] = value;
        }
      }
    };
    flatten(obj);
    return flattened;
  };

  // 1. One Click Complete Database backup (Compressed ZIP or Plain JSON)
  const handleDownloadFullBackup = async (formatType: 'zip' | 'json' = 'zip') => {
    setIsExportingFull(true);
    setExportStatus({ status: 'idle' });
    
    try {
      const selectedColMetas = EXPORTABLE_COLLECTIONS.filter(col => exportScope[col.id]);
      if (selectedColMetas.length === 0) {
        throw new Error("Debes seleccionar al menos una colección para exportar en su copia de seguridad.");
      }

      const backupData: Record<string, any[]> = {};
      
      for (const collectionMeta of selectedColMetas) {
        setExportCollectionProgress(collectionMeta.label);
        const colRef = collection(db, collectionMeta.id);
        const snap = await getDocs(colRef);
        
        backupData[collectionMeta.id] = snap.docs.map(doc => {
          const rawData = doc.data();
          const serializedData = serializeFirestoreObject(rawData);
          return {
            id: doc.id,
            ...serializedData
          };
        });
      }

      // Create a final structured file
      const finalCountMap: Record<string, number> = {};
      Object.entries(backupData).forEach(([colName, list]) => {
        finalCountMap[colName] = list.length;
      });

      const backupEnvelope = {
        meta: {
          appId: "mi-seguro-internacional",
          version: "2.0-full-backup",
          exportedAt: new Date().toISOString(),
          exportedBy: profile?.email || 'Sistema',
          totalCollectionsCount: selectedColMetas.length,
          recordCounts: finalCountMap,
          isCompressed: formatType === 'zip'
        },
        database: backupData
      };

      const dateStamp = new Date().toISOString().split('T')[0];
      const timeStamp = Date.now();

      if (formatType === 'zip') {
        const zipBlob = await compressJsonToZipBlob(backupEnvelope, 'backup.json');
        downloadBlob(zipBlob, `Backup_MiSeguroInternacional_${dateStamp}_${timeStamp}.zip`);
        
        setExportStatus({
          status: 'success',
          message: `¡Copia de seguridad comprimida (.ZIP) generada con éxito! (${formatBytes(zipBlob.size)}). Se incluyeron ${selectedColMetas.length} colección(es).`
        });
      } else {
        const jsonStr = JSON.stringify(backupEnvelope, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, `Backup_MiSeguroInternacional_${dateStamp}_${timeStamp}.json`);
        
        setExportStatus({
          status: 'success',
          message: `¡Copia de seguridad JSON generada con éxito! (${formatBytes(blob.size)}). Se incluyeron ${selectedColMetas.length} colección(es).`
        });
      }
    } catch (error: any) {
      console.error("Full backup failure: ", error);
      setExportStatus({
        status: 'error',
        message: `Error al compilar base de datos: ${error.message || 'Error desconocido'}`
      });
    } finally {
      setIsExportingFull(false);
      setExportCollectionProgress(null);
    }
  };

  // Legacy wrapper
  const handleDownloadFullBackupJSON = () => handleDownloadFullBackup('json');

  // 2. Export individual collection to CSV (Excel compatible)
  const handleExportCollectionCSV = async (collectionId: string, label: string) => {
    try {
      const colRef = collection(db, collectionId);
      const snap = await getDocs(colRef);
      
      if (snap.empty) {
        alert(`La colección de "${label}" se encuentra vacía y no tiene registros para exportar.`);
        return;
      }

      const rows = snap.docs.map(doc => ({
        ID_Documento: doc.id,
        ...serializeFirestoreObject(doc.data())
      }));

      // Flatten items inside to handle nested objects inside columns beautifully
      const formattedRowsForCSV = rows.map(row => flattenObjectForCSV(row));

      const csvString = Papa.unparse(formattedRowsForCSV);
      
      // Inject byte-order mark (BOM) to force MS Excel to read Spanish characters with UTF-8 format correctly
      const blob = new Blob(["\ufeff" + csvString], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Copia_${collectionId}_Excel_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (error: any) {
      console.error(`Error exporting collection ${collectionId}:`, error);
      alert(`Error al generar la exportación de la lista: ${error.message || 'Error desconocido'}`);
    }
  };

  // 3. Handle validation/loading of the Backup (.zip or .json) file
  const handleBackupFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await readBackupFile(file);
      const parsed = result.data;

      if (!parsed || !parsed.meta || !parsed.database) {
        setSelectedBackupFile(null);
        setSelectedBackupMeta(null);
        setImportStatus({
          status: 'error',
          message: 'El archivo no tiene la firma o estructura de respaldo de Mi Seguro Internacional (faltan campos "meta" o "database").'
        });
        return;
      }

      setSelectedBackupFile(parsed.database);
      setSelectedBackupMeta({
        ...parsed.meta,
        fileInfo: {
          name: result.fileName,
          isCompressed: result.isCompressed,
          sizeFormatted: formatBytes(result.originalSize)
        }
      });
      
      // Initialize importScope, by default check everything inside database
      const scope: Record<string, boolean> = {};
      Object.keys(parsed.database).forEach(colName => {
        scope[colName] = true;
      });
      setImportScope(scope);

      setImportStatus({ status: 'idle' });
    } catch (err: any) {
      setSelectedBackupFile(null);
      setSelectedBackupMeta(null);
      setImportStatus({
        status: 'error',
        message: `El archivo de respaldo es inválido o está corrupto: ${err.message || err}`
      });
    }
  };

  // 4. One-Click restore of DB content
  const handleImportBackupJSON = async () => {
    if (!selectedBackupFile || !selectedBackupMeta) {
      alert('Sube un archivo de respaldo válido primero.');
      return;
    }

    const startRestorationProcess = async () => {
      setIsImportingFull(true);
      setImportStatus({ status: 'idle' });
      let restoredCount = 0;

      try {
        const collectionsToRestore = Object.keys(selectedBackupFile).filter(colName => importScope[colName]);

        if (collectionsToRestore.length === 0) {
          throw new Error("Debes seleccionar al menos una colección para restaurar.");
        }

        for (const colName of collectionsToRestore) {
          const docList = selectedBackupFile[colName];
          if (!Array.isArray(docList)) continue;

          setImportCollectionProgress(`Importando "${colName}"... (${docList.length} docs)`);

          let batch = writeBatch(db);
          let countInBatch = 0;

          for (const docObj of docList) {
            const { id, ...docData } = docObj;
            if (!id) continue;

            const processedData = { ...docData };

            // Reconstruct Date fields if they appear to be ISO dates inside string
            for (const field of Object.keys(processedData)) {
              const val = processedData[field];
              if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(val)) {
                processedData[field] = new Date(val);
              }
            }

            // Restore maintaining exact original ID
            const docRef = doc(db, colName, id);
            batch.set(docRef, processedData);
            countInBatch++;
            restoredCount++;

            if (countInBatch >= 400) {
              await batch.commit();
              batch = writeBatch(db);
              countInBatch = 0;
            }
          }

          if (countInBatch > 0) {
            await batch.commit();
          }
        }

        setImportStatus({
          status: 'success',
          message: `¡Copia de seguridad restaurada exitosamente con restauración selectiva! Se importaron/actualizaron ${restoredCount} documentos pertenecientes a ${collectionsToRestore.length} colección(es) correctamente en la base de datos.`
        });
        setSelectedBackupFile(null);
        setSelectedBackupMeta(null);

        // Reset the input file if any
        const inputElem = document.getElementById('backup-upload-input') as HTMLInputElement;
        if (inputElem) inputElem.value = '';

      } catch (err: any) {
        console.error("Restoration error:", err);
        setImportStatus({
          status: 'error',
          message: `Error físico al escribir documentos en Firestore: ${err.message || 'Error desconocido'}`
        });
      } finally {
        setIsImportingFull(false);
        setImportCollectionProgress(null);
      }
    };

    const countToRestore = Object.keys(selectedBackupFile).filter(colName => importScope[colName]).length;
    setConfirmModal({
      isOpen: true,
      title: '⚠ Confirmar Restauración Seleccionada',
      message: `Estás a punto de reescribir/actualizar ${countToRestore} colección(es) seleccionada(s) de la base de datos con los registros del archivo del: ${new Date(selectedBackupMeta.exportedAt).toLocaleString()}. Esta acción es irreversible y reemplazará los datos de las colecciones seleccionadas. ¿Deseas iniciar la restauración?`,
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        startRestorationProcess();
      }
    });
  };

  // Company Info State
  const [companyInfo, setCompanyInfo] = useState({
    name: 'Mi Seguro Internacional',
    taxId: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    phone: '',
    email: 'ventas@misegurointernacional.com',
    website: 'https://misegurointernacional.com',
    logoUrl: '',
    logoUrlDark: '',
    directorSignature: '',
    sidebarTheme: 'light'
  });
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null);

  // Import State
  const [importType, setImportType] = useState<'clients' | 'clients_individual' | 'catalogs' | 'insurances' | 'exchange_rates' | 'countries' | 'action_types'>('clients');
  const [importData, setImportData] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [documents, setDocuments] = useState<SystemDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docForm, setDocForm] = useState({
    name: '',
    date: new Date().toISOString().split('T')[0],
    validity: ''
  });

  useEffect(() => {
    // Load Company Info with real-time updates
    const unsubCompany = onSnapshot(doc(db, 'settings', 'company'), (docSnap) => {
      if (docSnap.exists()) {
        setCompanyInfo(docSnap.data() as any);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/company');
    });

    const unsubUsers = onSnapshot(query(collection(db, 'users'), orderBy('createdAt', 'desc')), (snap) => {
      setUsers(snap.docs.map(doc => {
        const data = doc.data();
        return {
          uid: doc.id,
          email: data.email || '',
          displayName: data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Usuario',
          role: data.role || 'client',
          createdAt: data.createdAt,
          ...data
        } as UserProfile;
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    const unsubRoles = onSnapshot(query(collection(db, 'roles'), orderBy('createdAt', 'desc')), (snap) => {
      setCustomRoles(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomRole)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'roles');
    });

    const unsubDocs = onSnapshot(collection(db, 'documents'), (snap) => {
      setDocuments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'documents');
    });

    return () => {
      unsubCompany();
      unsubUsers();
      unsubRoles();
      unsubDocs();
    };
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logoUrl' | 'logoUrlDark' | 'directorSignature' = 'logoUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Verify format is JPG or PNG
    const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
    if (!isJpgOrPng) {
      alert('Por favor selecciona un archivo de imagen en formato JPG o PNG.');
      return;
    }

    // Check size to fit within Firestore document limit (< 1MB) safely
    if (file.size > 850 * 1024) {
      alert('La imagen seleccionada es demasiado grande. Por favor sube una imagen de menos de 850 KB.');
      return;
    }

    setUploadingLogo(type);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;

        setCompanyInfo(prev => ({ ...prev, [type]: base64String }));
        
        // Update Firestore immediately with the Base64 image string
        await setDoc(doc(db, 'settings', 'company'), {
          [type]: base64String,
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        const typeLabel = type === 'directorSignature' ? 'Firma del Director' : (type === 'logoUrl' ? 'Logo principal' : 'Logo para fondo oscuro');
        alert(`${typeLabel} actualizado y almacenado internamente con éxito.`);
        setUploadingLogo(null);
      };
      reader.onerror = () => {
        alert('Error al leer el archivo de imagen.');
        setUploadingLogo(null);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `company ${type} base64 upload`);
      setUploadingLogo(null);
    }
  };

  const handleSaveCompanyInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'settings', 'company'), {
        ...companyInfo,
        updatedAt: serverTimestamp()
      });
      alert('Información de la empresa guardada correctamente.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/company');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      const isAgent = editingUser.role === 'agent';
      const userPayload: any = {
        role: editingUser.role,
        displayName: editingUser.displayName,
        commission: isAgent ? (Number(editingUser.commission) || 0) : null,
        parentAgentId: isAgent && editingUser.parentAgentId ? editingUser.parentAgentId : null
      };

      if (isAddingUser) {
        // Creating a new user document
        // Note: This doesn't create a Firebase Auth user, but prepares the profile
        // We use the email as the ID if the UID is not yet known
        const userDocId = editingUser.uid || editingUser.email;
        await setDoc(doc(db, 'users', userDocId), {
          ...editingUser,
          ...userPayload,
          uid: userDocId,
          createdAt: serverTimestamp()
        });
        setIsAddingUser(false);
      } else {
        await updateDoc(doc(db, 'users', editingUser.uid), userPayload);
      }
      setEditingUser(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${editingUser.uid || editingUser.email}`);
    }
  };

  const MENUS = [
    { id: 'dashboard', name: 'Dashboard' },
    { id: 'request', name: 'Solicitud' },
    { id: 'clients', name: 'Clientes' },
    { id: 'providers', name: 'Proveedores' },
    { id: 'policies', name: 'Pólizas' },
    { id: 'catalogs', name: 'Catálogos' },
    { id: 'admin', name: 'Admin' },
    { id: 'commissions', name: 'Comisiones' },
    { id: 'reports', name: 'Reportes' },
    { id: 'insurance-plans', name: 'Planes' },
    { id: 'claims', name: 'Siniestros' },
    { id: 'notifications', name: 'Notificaciones' },
    { id: 'config', name: 'Configuración' },
    { id: 'historico', name: 'Histórico' },
  ];

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;

    try {
      if (editingRole.id && !isAddingRole) {
        const { id, ...data } = editingRole;
        await setDoc(doc(db, 'roles', id), {
          ...data,
          createdAt: editingRole.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } else {
        const { id, ...data } = editingRole; // Strip empty ID
        await addDoc(collection(db, 'roles'), {
          ...data,
          createdAt: serverTimestamp()
        });
      }
      setEditingRole(null);
      setIsAddingRole(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'roles');
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!id) return;
    const isSystemRole = systemRoleIds.includes(id);
    setConfirmModal({
      isOpen: true,
      title: isSystemRole ? 'Restablecer Rol' : 'Eliminar Rol',
      message: isSystemRole 
        ? '¿Estás seguro de restablecer los permisos de este rol de sistema a los valores predeterminados?' 
        : '¿Estás seguro de eliminar este rol?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'roles', id));
          alert(isSystemRole ? 'Rol de sistema restablecido con éxito' : 'Rol eliminado con éxito');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `roles/${id}`);
        }
      }
    });
  };

  const handleDeleteUser = async (uid: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Usuario',
      message: '¿Estás seguro de eliminar este usuario?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', uid));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
        }
      }
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportData(results.data);
      },
      error: (error) => {
        alert('Error al procesar el archivo CSV: ' + error.message);
      }
    });
  };

  const handleProcessImport = async () => {
    if (importData.length === 0) return;
    setImporting(true);
    try {
      const collectionName = (importType === 'clients' || importType === 'clients_individual') ? 'clients' : 
                            importType === 'catalogs' ? 'policies' : 
                            importType === 'exchange_rates' ? 'exchangeRates' : 
                            importType === 'action_types' ? 'actionTypes' : 'countries';
      
      for (const item of importData) {
        // Filter out empty keys that might come from empty CSV columns
        const processedItem: any = {};
        Object.keys(item).forEach(key => {
          if (key && key.trim() !== '' && item[key] !== undefined) {
            const value = item[key];
            processedItem[key] = typeof value === 'string' ? value.replace(/\uFFFD/g, 'ñ').trim() : value;
          }
        });

        // Type conversion based on collection
        if (importType === 'clients_individual') {
          // Normalizar las llaves en español a los campos que espera la base de datos para Clientes individuales
          const finalItem: any = {
            type: 'Individual',
            phone: '',
            address: '',
            city: '',
            state: '',
            zip: '',
            country: '',
            rfc: '',
            notes: '',
            legalName: '',
            commercialName: '',
            mainContact: '',
            sendBirthdayGreeting: false,
          };

          const getVal = (possibleKeys: string[]) => {
            const keysInObj = Object.keys(processedItem);
            for (const pk of possibleKeys) {
              const matchedKey = keysInObj.find(k => {
                const normalizedK = k.toLowerCase()
                  .replace(/_/g, ' ')
                  .replace(/[áéíóú]/g, (char) => {
                    const map: Record<string, string> = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u' };
                    return map[char] || char;
                  })
                  .trim();
                const normalizedPk = pk.toLowerCase();
                return normalizedK === normalizedPk || normalizedK.includes(normalizedPk);
              });
              if (matchedKey) {
                return processedItem[matchedKey];
              }
            }
            return '';
          };

          finalItem.firstName = getVal(['nombre', 'first name', 'firstname', 'firstName']);
          finalItem.lastName = getVal(['apellido', 'last name', 'lastname', 'lastName']);
          
          const rawGender = getVal(['sexo', 'gender', 'genero']);
          if (rawGender) {
            const g = String(rawGender).toLowerCase().trim();
            if (g.startsWith('m') || g === 'masculino' || g === 'hombre' || g === 'msc') {
              finalItem.gender = 'M';
            } else if (g.startsWith('f') || g === 'femenino' || g === 'mujer' || g === 'fem') {
              finalItem.gender = 'F';
            } else {
              finalItem.gender = 'M';
            }
          } else {
            finalItem.gender = 'M';
          }

          const rawBirth = getVal(['fecha de nacimiento', 'fecha nacimiento', 'fecha_nacimiento', 'birth date', 'birthdate', 'nacimiento']);
          if (rawBirth) {
            const convertDate = (d: string) => {
              if (!d) return '';
              const trimmed = d.trim();
              if (trimmed.includes('/')) {
                const parts = trimmed.split('/');
                if (parts.length === 3) {
                  if (parts[0].length === 4) {
                    const year = parts[0];
                    const month = parts[1].padStart(2, '0');
                    const day = parts[2].padStart(2, '0');
                    return `${year}-${month}-${day}`;
                  } else {
                    const day = parts[0].padStart(2, '0');
                    const month = parts[1].padStart(2, '0');
                    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                    return `${year}-${month}-${day}`;
                  }
                }
              }
              return trimmed;
            };
            finalItem.birthDate = convertDate(String(rawBirth));
          } else {
            finalItem.birthDate = '';
          }

          finalItem.email = getVal(['correo', 'email', 'correo electronico', 'correo_electronico', 'mail', 'contacto']);

          // Reemplazar processedItem con nuestra estructura tipada final
          Object.keys(processedItem).forEach(key => delete processedItem[key]);
          Object.assign(processedItem, finalItem);

        } else if (collectionName === 'policies') {
          if (processedItem.deductible) processedItem.deductible = String(processedItem.deductible).toLowerCase() === 'true';
          if (processedItem.region) processedItem.region = parseInt(processedItem.region);
          if (processedItem.costPerDay) processedItem.costPerDay = parseFloat(processedItem.costPerDay);
          if (processedItem.pricePerDay) processedItem.pricePerDay = parseFloat(processedItem.pricePerDay);
          
          const convertDate = (d: string) => {
            if (!d) return '';
            if (d.includes('/')) {
              const parts = d.split('/');
              if (parts.length === 3) {
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                return `${year}-${month}-${day}`;
              }
            }
            return d;
          };
          if (processedItem.startDate) processedItem.startDate = convertDate(processedItem.startDate);
          if (processedItem.endDate) processedItem.endDate = convertDate(processedItem.endDate);
        }
 else if (collectionName === 'exchangeRates') {
          if (processedItem.rate) processedItem.rate = parseFloat(processedItem.rate);
        } else if (collectionName === 'countries') {
          if (processedItem.region) processedItem.region = parseInt(processedItem.region);
        }

        await addDoc(collection(db, collectionName), {
          ...processedItem,
          createdAt: serverTimestamp(),
          imported: true
        });
      }
      alert(`Importación de ${importData.length} registros completada.`);
      setImportData([]);
    } catch (error) {
      console.error('Import error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'import');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    let headers: string[] = [];
    switch (importType) {
      case 'clients':
        headers = ['type', 'email', 'phone', 'rfc', 'legalName', 'commercialName', 'mainContact', 'firstName', 'lastName', 'address', 'city', 'state', 'zip', 'country'];
        break;
      case 'clients_individual':
        headers = ['nombre', 'apellido', 'sexo', 'fecha_nacimiento', 'correo_electronico'];
        break;
      case 'catalogs':
        headers = ['plan', 'name', 'deductible', 'region', 'costPerDay', 'pricePerDay'];
        break;
      case 'exchange_rates':
        headers = ['rate', 'date'];
        break;
      case 'countries':
        headers = ['code', 'name', 'region', 'language'];
        break;
      case 'action_types':
        headers = ['action', 'name', 'description', 'status'];
        break;
    }

    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `template_${importType}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docForm.name) {
      alert('Por favor ingresa el nombre del documento y selecciona un archivo.');
      return;
    }

    setUploadingDoc(true);
    try {
      const storageRef = ref(storage, `documents/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);

      await addDoc(collection(db, 'documents'), {
        name: docForm.name,
        url,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        type: 'system',
        date: docForm.date,
        validity: docForm.validity,
        storagePath: snapshot.ref.fullPath,
        createdAt: serverTimestamp()
      });
      
      setDocForm({ name: '', date: new Date().toISOString().split('T')[0], validity: '' });
      alert('Documento subido correctamente.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'documents');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId: string, storagePath: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Documento',
      message: '¿Estás seguro de eliminar este documento?',
      onConfirm: async () => {
        try {
          // Delete from Storage
          const storageRef = ref(storage, storagePath);
          await deleteObject(storageRef);

          // Delete from Firestore
          await deleteDoc(doc(db, 'documents', docId));
          
          alert('Documento eliminado correctamente.');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `documents/${docId}`);
        }
      }
    });
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchesSearch = u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            u.email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, searchTerm, roleFilter]);

  return (
    <div className="flex flex-col md:flex-row gap-8 animate-in fade-in slide-in-from-left-4 duration-500">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 space-y-2">
        <div className="px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
          <p className="text-xs text-gray-500 mt-1">Gestión global del sistema</p>
        </div>
        {[
          { id: 'company', label: 'Información de la empresa', icon: Building2 },
          { id: 'roles', label: 'Roles', icon: Shield },
          { id: 'users', label: 'Usuarios', icon: Users2 },
          { id: 'documents', label: 'Documentos', icon: FileText },
          { id: 'import', label: 'Importación', icon: Upload },
          { id: 'woocommerce', label: 'WooCommerce', icon: ShoppingBag },
          { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
          { id: 'stripe', label: 'Stripe (Pasarela)', icon: CreditCard },
          { id: 'backup', label: 'Mantenimiento / Backup', icon: Database },
          { id: 'quota', label: 'Cuotas y Consumo', icon: Activity },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => handleTabChange(item.id as any)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === item.id 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
                : 'text-gray-500 hover:bg-white hover:shadow-sm'
            }`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-8 min-h-[600px]">
        {activeTab === 'company' && (
          <div className="max-w-2xl space-y-8">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Información de la Empresa</h3>
              <p className="text-gray-500 text-sm">Configura los datos generales que aparecerán en tus recibos y pólizas.</p>
            </div>
            <form onSubmit={handleSaveCompanyInfo} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Logo de la Empresa</label>
                  <div className="flex flex-col gap-8 p-6 bg-gray-50 border border-gray-200 rounded-2xl">
                    {/* Primary Logo (For light backgrounds) */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">Logo Principal</h4>
                          <p className="text-[10px] text-gray-500">Se usa en fondos claros (Sidebar, Cartas, Home).</p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-6 items-start">
                        <div className="w-48 h-24 bg-white rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden p-2 shadow-sm">
                          {companyInfo.logoUrl ? (
                            <img 
                              src={companyInfo.logoUrl} 
                              alt="Primary Logo" 
                              className="max-w-full max-h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Building2 className="w-8 h-8 text-gray-200" />
                              <span className="text-[10px] text-gray-300">Sin logo</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-[200px] space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg text-sm font-bold text-white hover:bg-blue-700 cursor-pointer transition-all shadow-md shadow-blue-200">
                              {uploadingLogo === 'logoUrl' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                              {uploadingLogo === 'logoUrl' ? 'Subiendo...' : 'Subir Imagen (JPG/PNG)'}
                              <input 
                                type="file" 
                                className="hidden" 
                                accept="image/png, image/jpeg"
                                onChange={(e) => handleLogoUpload(e, 'logoUrl')}
                                disabled={!!uploadingLogo}
                              />
                            </label>
                            {companyInfo.logoUrl && (
                              <button
                                type="button"
                                onClick={() => setCompanyInfo(prev => ({ ...prev, logoUrl: '' }))}
                                className="p-2 bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                                title="Quitar logo"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {companyInfo.logoUrl?.startsWith('data:image/') ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg w-fit">
                              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                              Logo guardado físicamente dentro de la plataforma
                            </div>
                          ) : (
                            <input 
                              type="url"
                              value={companyInfo.logoUrl || ''}
                              onChange={e => setCompanyInfo(prev => ({ ...prev, logoUrl: e.target.value }))}
                              placeholder="URL directa del logo principal (Opcional)"
                              className="w-full text-xs p-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-8 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">Logo para Fondos Oscuros</h4>
                          <p className="text-[10px] text-gray-500">Se usa en recibos (cabecera azul) y menús oscuros.</p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-6 items-start">
                        <div className="w-48 h-24 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-center overflow-hidden p-2 shadow-sm">
                          {companyInfo.logoUrlDark ? (
                            <img 
                              src={companyInfo.logoUrlDark} 
                              alt="Dark Logo" 
                              className="max-w-full max-h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Building2 className="w-8 h-8 text-slate-700" />
                              <span className="text-[10px] text-slate-600">Sin logo claro</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-[200px] space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 rounded-lg text-sm font-bold text-white hover:bg-slate-800 cursor-pointer transition-all shadow-md shadow-slate-200">
                              {uploadingLogo === 'logoUrlDark' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                              {uploadingLogo === 'logoUrlDark' ? 'Subiendo...' : 'Subir Imagen (JPG/PNG)'}
                              <input 
                                type="file" 
                                className="hidden" 
                                accept="image/png, image/jpeg"
                                onChange={(e) => handleLogoUpload(e, 'logoUrlDark')}
                                disabled={!!uploadingLogo}
                              />
                            </label>
                            {companyInfo.logoUrlDark && (
                              <button
                                type="button"
                                onClick={() => setCompanyInfo(prev => ({ ...prev, logoUrlDark: '' }))}
                                className="p-2 bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                                title="Quitar logo"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {companyInfo.logoUrlDark?.startsWith('data:image/') ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg w-fit">
                              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                              Logo oscuro guardado físicamente dentro de la plataforma
                            </div>
                          ) : (
                            <input 
                              type="url"
                              value={companyInfo.logoUrlDark || ''}
                              onChange={e => setCompanyInfo(prev => ({ ...prev, logoUrlDark: e.target.value }))}
                              placeholder="URL directa del logo oscuro (Opcional)"
                              className="w-full text-xs p-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-8 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">Firma del Director</h4>
                          <p className="text-[10px] text-gray-500">Se utiliza en cartas de pólizas, cartas COVID y otros certificados oficiales.</p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-6 items-start">
                        <div className="w-48 h-24 bg-white rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden p-2 shadow-sm">
                          {companyInfo.directorSignature ? (
                            <img 
                              src={companyInfo.directorSignature} 
                              alt="Firma Director" 
                              className="max-w-full max-h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <Signature className="w-8 h-8 text-gray-200" />
                              <span className="text-[10px] text-gray-300">Sin firma</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-[200px] space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg text-sm font-bold text-white hover:bg-blue-700 cursor-pointer transition-all shadow-md shadow-blue-200">
                              {uploadingLogo === 'directorSignature' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                              {uploadingLogo === 'directorSignature' ? 'Subiendo...' : 'Subir Firma (JPG/PNG)'}
                              <input 
                                type="file" 
                                className="hidden" 
                                accept="image/png, image/jpeg"
                                onChange={(e) => handleLogoUpload(e, 'directorSignature')}
                                disabled={!!uploadingLogo}
                              />
                            </label>
                            {companyInfo.directorSignature && (
                              <button
                                type="button"
                                onClick={() => setCompanyInfo(prev => ({ ...prev, directorSignature: '' }))}
                                className="p-2 bg-white border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                                title="Quitar firma"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          {companyInfo.directorSignature?.startsWith('data:image/') ? (
                            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg w-fit">
                              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                              Firma guardada físicamente dentro de la plataforma
                            </div>
                          ) : (
                            <input 
                              type="url"
                              value={companyInfo.directorSignature || ''}
                              onChange={e => setCompanyInfo(prev => ({ ...prev, directorSignature: e.target.value }))}
                              placeholder="URL directa de la firma del director (Opcional)"
                              className="w-full text-xs p-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Nombre Comercial</label>
                  <input 
                    type="text" 
                    value={companyInfo.name || ''}
                    onChange={e => setCompanyInfo({...companyInfo, name: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">RFC / Tax ID</label>
                  <input 
                    type="text" 
                    value={companyInfo.taxId || ''}
                    onChange={e => setCompanyInfo({...companyInfo, taxId: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Teléfono</label>
                  <input 
                    type="text" 
                    value={companyInfo.phone || ''}
                    onChange={e => setCompanyInfo({...companyInfo, phone: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Dirección</label>
                  <input 
                    type="text" 
                    value={companyInfo.address || ''}
                    onChange={e => setCompanyInfo({...companyInfo, address: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Ciudad</label>
                  <input 
                    type="text" 
                    value={companyInfo.city || ''}
                    onChange={e => setCompanyInfo({...companyInfo, city: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Estado</label>
                  <input 
                    type="text" 
                    value={companyInfo.state || ''}
                    onChange={e => setCompanyInfo({...companyInfo, state: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">CP</label>
                  <input 
                    type="text" 
                    value={companyInfo.zip || ''}
                    onChange={e => setCompanyInfo({...companyInfo, zip: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">País</label>
                  <input 
                    type="text" 
                    value={companyInfo.country || ''}
                    onChange={e => setCompanyInfo({...companyInfo, country: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Tema de la Barra Lateral</label>
                  <select 
                    value={companyInfo.sidebarTheme || 'light'}
                    onChange={e => setCompanyInfo({...companyInfo, sidebarTheme: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                  >
                    <option value="light">Claro (Blanco)</option>
                    <option value="dark">Oscuro (Azul Marino)</option>
                    <option value="glass">Luminoso (Cristal)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Email de Contacto</label>
                  <input 
                    type="email" 
                    value={companyInfo.email || ''}
                    onChange={e => setCompanyInfo({...companyInfo, email: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Sitio Web</label>
                  <input 
                    type="url" 
                    value={companyInfo.website || ''}
                    onChange={e => setCompanyInfo({...companyInfo, website: e.target.value})}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              {hasPermission('config', 'edit') && (
                <button 
                  type="submit"
                  disabled={submitting}
                  className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {submitting ? 'Guardando...' : <Save className="w-5 h-5" />}
                  Guardar Cambios
                </button>
              )}
            </form>
          </div>
        )}

        {activeTab === 'roles' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Gestión de Roles</h3>
                <p className="text-gray-500 text-sm">Define los niveles de acceso y asocia permisos específicos a cada rol.</p>
              </div>
              {hasPermission('config', 'create') && (
                <button
                  onClick={() => {
                    setIsAddingRole(true);
                    setEditingRole({ id: '', name: '', description: '', menuPermissions: {}, createdAt: null });
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Rol
                </button>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Lock className="w-3 h-3" />
                  Roles del Sistema
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {SYSTEM_ROLES.map((role) => {
                    const customized = customRoles.find(r => r.id === role.id);
                    const isCustomized = !!customized;
                    const rolePerms = customized?.menuPermissions || getDefaultPermissions(role.id);
                    return (
                      <div key={`system-${role.id}`} className="p-6 border border-gray-100 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all group relative">
                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {role.id !== 'super_admin' && hasPermission('config', 'edit') && (
                            <button 
                              onClick={() => {
                                setIsAddingRole(false);
                                setEditingRole({
                                  id: role.id,
                                  name: role.name,
                                  description: role.description,
                                  menuPermissions: rolePerms,
                                  createdAt: customized?.createdAt || null
                                });
                              }} 
                              className="p-1 text-gray-400 hover:text-blue-600"
                              title="Editar permisos de este rol de sistema"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {isCustomized && role.id !== 'super_admin' && hasPermission('config', 'delete') && (
                            <button 
                              onClick={() => handleDeleteRole(role.id)} 
                              className="p-1 text-gray-400 hover:text-red-500"
                              title="Restablecer permisos por defecto del sistema"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          {role.id === 'super_admin' && (
                            <div className="text-gray-300">
                              <Lock className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${role.color}`}>{role.name}</span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase">Sistema</span>
                          {isCustomized && (
                            <span className="px-2 py-1 rounded text-[10px] font-black uppercase bg-teal-50 text-teal-600 border border-teal-200">Personalizado</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-gray-600 leading-relaxed line-clamp-2">{role.description}</p>
                        
                        <div className="mt-4 pt-4 border-t border-gray-50">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Permisos por Menú:</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {MENUS.map(menu => {
                              const perms = rolePerms?.[menu.id];
                              if (!perms) return null;
                              const active = Object.entries(perms).filter(([_, v]) => v).map(([k]) => k.charAt(0).toUpperCase());
                              if (active.length === 0) return null;
                              return (
                                <div key={menu.id} className="flex flex-col">
                                  <span className="text-[9px] font-bold text-gray-500">{menu.name}</span>
                                  <div className="flex gap-1">
                                    {active.map(a => (
                                      <span key={a} className="text-[8px] font-black text-blue-600 bg-blue-50 px-1 rounded">{a}</span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Edit2 className="w-3 h-3" />
                  Roles Personalizados
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {trulyCustomRoles.length === 0 ? (
                    <div className="col-span-full py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                      <Shield className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                      <p className="text-sm text-gray-400 italic">No hay roles personalizados creados aún.</p>
                    </div>
                  ) : (
                    trulyCustomRoles.map((role, idx) => (
                      <div key={`custom-${role.id || 'empty'}-${idx}`} className="p-6 border border-gray-100 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all group relative animate-in fade-in-50 duration-200">
                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {hasPermission('config', 'edit') && (
                            <button onClick={() => setEditingRole(role)} className="p-1 text-gray-400 hover:text-blue-600">
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission('config', 'delete') && (
                            <button onClick={() => handleDeleteRole(role.id!)} className="p-1 text-gray-400 hover:text-red-600">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-1 rounded text-[10px] font-black uppercase bg-indigo-100 text-indigo-700">Personalizado</span>
                        </div>
                        <h4 className="font-bold text-gray-900">{role.name}</h4>
                        <p className="mt-2 text-sm text-gray-600 leading-relaxed line-clamp-2">{role.description}</p>
                        <div className="mt-4 pt-4 border-t border-gray-50">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Permisos por Menú:</p>
                          <div className="grid grid-cols-2 gap-2">
                            {MENUS.map(menu => {
                              const perms = role.menuPermissions?.[menu.id];
                              if (!perms) return null;
                              const active = Object.entries(perms).filter(([_, v]) => v).map(([k]) => k.charAt(0).toUpperCase());
                              if (active.length === 0) return null;
                              return (
                                <div key={menu.id} className="flex flex-col">
                                  <span className="text-[9px] font-bold text-gray-500">{menu.name}</span>
                                  <div className="flex gap-1">
                                    {active.map(a => (
                                      <span key={a} className="text-[8px] font-black text-blue-600 bg-blue-50 px-1 rounded">{a}</span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-8">
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Usuarios del Sistema</h3>
                <p className="text-gray-500 text-sm">Administra las cuentas de usuario y asigna sus roles correspondientes.</p>
              </div>
              <div className="flex gap-4">
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      placeholder="Buscar usuario..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm w-64"
                    />
                  </div>
                  <select
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  >
                    <option value="all">Todos los roles</option>
                    <optgroup label="Roles de Sistema">
                      {SYSTEM_ROLES.map(r => <option key={`filter-sys-${r.id}`} value={r.id}>{r.name}</option>)}
                    </optgroup>
                    <optgroup label="Roles Personalizados">
                      {customRoles.map(r => <option key={`filter-cust-${r.id || Math.random()}`} value={r.id}>{r.name}</option>)}
                    </optgroup>
                  </select>
                </div>
                {hasPermission('config', 'create') && (
                  <button
                    onClick={() => {
                      setIsAddingUser(true);
                      setEditingUser({ uid: '', email: '', displayName: '', role: 'client', commission: 0, createdAt: null });
                    }}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo Usuario
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium">Usuario</th>
                    <th className="px-6 py-4 font-medium">Email</th>
                    <th className="px-6 py-4 font-medium">Rol Actual</th>
                    <th className="px-6 py-4 font-medium">Comisión</th>
                    <th className="px-6 py-4 font-medium">Fecha Creación</th>
                    <th className="px-6 py-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map((u) => (
                    <tr key={u.uid} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs shrink-0">
                            {u.displayName?.charAt(0) || u.email.charAt(0)}
                          </div>
                          <div>
                            <span className="text-sm font-medium text-gray-900 block">{u.displayName}</span>
                            {u.role === 'agent' && (() => {
                              const parentAgent = u.parentAgentId ? users.find(x => x.uid === u.parentAgentId) : null;
                              const subagentsOfThisAgent = users.filter(x => x.parentAgentId === u.uid);
                              return (
                                <div className="mt-1 flex flex-col gap-1">
                                  {parentAgent ? (
                                    <span className="inline-flex items-center w-fit bg-amber-50 text-amber-700 text-[9px] px-1.5 py-0.5 rounded border border-amber-200 font-extrabold leading-none">
                                      Subagente de: {parentAgent.displayName || parentAgent.email}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center w-fit bg-blue-50 text-blue-700 text-[9px] px-1.5 py-0.5 rounded border border-blue-200 font-extrabold leading-none">
                                      Agente Principal
                                    </span>
                                  )}
                                  {subagentsOfThisAgent.length > 0 && (
                                    <div className="text-[9px] text-gray-400 font-extrabold max-w-xs leading-tight">
                                      Subagentes: {subagentsOfThisAgent.map(sa => sa.displayName || sa.email).join(', ')}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{u.email}</td>
                      <td className="px-6 py-4">
                        <select 
                          value={u.role || 'client'}
                          onChange={async (e) => {
                            try {
                              const newRole = e.target.value;
                              const isAgent = newRole === 'agent';
                              await updateDoc(doc(db, 'users', u.uid), { 
                                role: newRole,
                                ...(isAgent ? { commission: u.commission ?? 0 } : {})
                              });
                            } catch (error) {
                              handleFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
                            }
                          }}
                          className="text-xs font-bold p-1 bg-gray-100 border border-gray-200 rounded outline-none"
                        >
                          <optgroup label="Roles de Sistema">
                            {SYSTEM_ROLES.map(r => <option key={`user-${u.uid}-sys-${r.id}`} value={r.id}>{r.name}</option>)}
                          </optgroup>
                          <optgroup label="Roles Personalizados">
                            {customRoles.map(r => <option key={`user-${u.uid}-cust-${r.id || Math.random()}`} value={r.id}>{r.name}</option>)}
                          </optgroup>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {u.role === 'agent' ? `${u.commission ?? 0}%` : '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {u.createdAt ? formatDisplayDate(u.createdAt) : '---'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {hasPermission('config', 'edit') && (
                            <button 
                              onClick={() => {
                                setIsAddingUser(false);
                                setEditingUser(u);
                              }}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission('config', 'delete') && (
                            <button 
                              onClick={() => handleDeleteUser(u.uid)}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                            >
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

        {activeTab === 'documents' && (
          <div className="space-y-8">
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Repositorio de Documentos</h3>
                <p className="text-gray-500 text-sm">Gestiona plantillas, catálogos y documentos oficiales del sistema.</p>
              </div>
            </div>

            <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-4">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-600" />
                Subir Nuevo Documento
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha</label>
                  <input 
                    type="date"
                    value={docForm.date || ''}
                    onChange={e => setDocForm({...docForm, date: e.target.value})}
                    className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Nombre del Documento</label>
                  <input 
                    type="text"
                    placeholder="Ej: Catálogo 2024"
                    value={docForm.name || ''}
                    onChange={e => setDocForm({...docForm, name: e.target.value})}
                    className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Vigencia</label>
                  <input 
                    type="date"
                    value={docForm.validity || ''}
                    onChange={e => setDocForm({...docForm, validity: e.target.value})}
                    className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <input
                    type="file"
                    id="doc-upload"
                    className="hidden"
                    onChange={handleDocumentUpload}
                    disabled={uploadingDoc}
                    accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx"
                  />
                  <label
                    htmlFor="doc-upload"
                    className={`w-full bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 cursor-pointer ${uploadingDoc ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {uploadingDoc ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    {uploadingDoc ? 'Subiendo...' : 'Seleccionar y Subir'}
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {documents.length === 0 ? (
                <div className="col-span-full py-12 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No hay documentos cargados en el sistema.</p>
                </div>
              ) : (
                documents.map((doc: any) => (
                  <div key={doc.id} className="p-4 border border-gray-100 rounded-2xl flex items-center gap-4 hover:shadow-md transition-all group">
                    <div className="bg-gray-100 p-3 rounded-xl group-hover:bg-blue-50 transition-colors">
                      <FileText className="w-6 h-6 text-gray-400 group-hover:text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{doc.name}</p>
                      <div className="flex flex-col gap-0.5 mt-1">
                        <p className="text-[9px] text-gray-400 uppercase font-bold">
                          Subido: {doc.date || (doc.createdAt?.toDate ? doc.createdAt.toDate().toLocaleDateString() : 'Reciente')}
                        </p>
                        {doc.validity && (
                          <p className="text-[9px] text-amber-600 uppercase font-bold flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5" />
                            Vigencia: {doc.validity}
                          </p>
                        )}
                        <p className="text-[9px] text-gray-400 font-medium">
                          {doc.size}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a 
                        href={doc.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-gray-300 hover:text-blue-600 p-1"
                        title="Ver Documento"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      {hasPermission('config', 'delete') && (
                        <button 
                          onClick={() => handleDeleteDocument(doc.id, doc.storagePath)}
                          className="text-gray-300 hover:text-red-600 p-1"
                          title="Eliminar Documento"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Importación de Datos</h3>
                <p className="text-gray-500 text-sm">Carga masiva de clientes, catálogos o seguros mediante archivos CSV.</p>
              </div>
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-4 py-2 rounded-xl transition-all"
              >
                <Download className="w-4 h-4" />
                Descargar Plantilla
              </button>
            </div>
            
            <div className="bg-blue-50 border border-blue-100 p-6 rounded-2xl flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-blue-600 mt-1" />
              <div className="text-sm text-blue-800 leading-relaxed">
                <p className="font-bold mb-1">Instrucciones de Importación:</p>
                <ul className="list-disc list-inside space-y-1 opacity-80">
                  <li>El archivo debe estar en formato CSV.</li>
                  <li>La primera fila debe contener los nombres de las columnas.</li>
                  <li>Asegúrate de que los datos coincidan con el tipo de importación seleccionado.</li>
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Tipo de Importación</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                    {(['clients', 'clients_individual', 'catalogs', 'exchange_rates', 'countries', 'action_types'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setImportType(type as any)}
                        className={`p-3 rounded-xl text-[10px] font-bold border transition-all ${
                          importType === (type as any)
                            ? 'bg-blue-600 border-blue-600 text-white shadow-md' 
                            : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'
                        }`}
                      >
                        {type === 'clients' ? 'Clientes' : 
                         type === 'clients_individual' ? 'Individuales' :
                         type === 'catalogs' ? 'Catálogos' : 
                         type === 'exchange_rates' ? 'Tipos de Cambio' : 
                         type === 'action_types' ? 'Tipos de Acción' : 'Países'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center hover:border-blue-400 transition-all bg-gray-50/50 relative">
                  <input 
                    type="file" 
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <Upload className="w-10 h-10 text-gray-300 mx-auto mb-4" />
                  <p className="text-sm font-bold text-gray-900">Haz clic o arrastra un archivo CSV</p>
                  <p className="text-xs text-gray-400 mt-1">Máximo 5MB por archivo</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 min-h-[200px]">
                  <h4 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600" />
                    Vista Previa ({importData.length} registros)
                  </h4>
                  {importData.length > 0 ? (
                    <div className="max-h-[300px] overflow-auto">
                      <table className="w-full text-[10px]">
                        <thead className="bg-gray-100 sticky top-0">
                          <tr>
                            {Object.keys(importData[0]).slice(0, 4).map(key => (
                              <th key={key} className="p-2 text-left font-bold text-gray-500 uppercase">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importData.slice(0, 5).map((row, idx) => (
                            <tr key={idx} className="border-b border-gray-100">
                              {Object.values(row).slice(0, 4).map((val: any, i) => (
                                <td key={i} className="p-2 text-gray-600 truncate max-w-[100px]">{val}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importData.length > 5 && (
                        <p className="text-center text-[10px] text-gray-400 mt-2">... y {importData.length - 5} registros más</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full py-12 text-gray-300">
                      <FileText className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs italic">No hay datos cargados</p>
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleProcessImport}
                  disabled={importing || importData.length === 0}
                  className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none"
                >
                  {importing ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Database className="w-5 h-5" />
                      Iniciar Importación
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'woocommerce' && (
          <WooCommerceManager />
        )}

        {activeTab === 'whatsapp' && (
          <WhatsAppIntegration />
        )}

        {activeTab === 'stripe' && (
          <StripeIntegration />
        )}

        {activeTab === 'backup' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Mantenimiento y Respaldo</h3>
              <p className="text-gray-500 text-sm">Gestiona la exportación y salvaguarda de toda la información registrada en el sistema de manera unificada o segmentada.</p>
            </div>

            {/* SECCIÓN DE COPIAS PROGRAMADAS Y GESTIÓN EN LA NUBE */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Card 1: Configuración de Programación */}
              <div className="lg:col-span-1 bg-white p-6 rounded-3xl border border-gray-150 shadow-sm space-y-6">
                <div>
                  <h4 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-indigo-600 animate-pulse" />
                    Programar Copias Automáticas
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">Configura la pasarela para ejecutar copias de seguridad de la base de datos de manera automatizada en la nube.</p>
                </div>

                <div className="space-y-4">
                  {/* Toggle Habilitar */}
                  <label className="flex items-center justify-between p-3.5 bg-gray-50 hover:bg-gray-100/50 rounded-2xl cursor-pointer transition-all border border-gray-100 select-none">
                    <div className="leading-tight">
                      <span className="text-xs font-bold text-gray-800 block">Habilitar Copias Automáticas</span>
                      <span className="text-[10px] text-gray-500 block">Activa el cron del servidor</span>
                    </div>
                    <input 
                      type="checkbox"
                      checked={backupSchedule.enabled}
                      onChange={(e) => setBackupSchedule(prev => ({ ...prev, enabled: e.target.checked }))}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  {/* Frecuencia */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-wider">Frecuencia de Respaldo</label>
                    <select
                      value={backupSchedule.frequency}
                      disabled={!backupSchedule.enabled}
                      onChange={(e) => setBackupSchedule(prev => ({ ...prev, frequency: e.target.value as any }))}
                      className="w-full text-xs p-3 bg-white border border-gray-250 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 font-medium disabled:opacity-50"
                    >
                      <option value="hourly">Cada Hora (Hourly)</option>
                      <option value="daily">Diariamente (Daily)</option>
                      <option value="weekly">Semanalmente (Weekly)</option>
                    </select>
                  </div>

                  {/* Indicador Última Ejecución */}
                  <div className="p-3 bg-indigo-50/40 text-indigo-950 rounded-2xl border border-indigo-100/50 text-[11px] leading-relaxed">
                    <div className="flex items-center gap-1 text-indigo-700 font-bold mb-1">
                      <Activity className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                      Estatus del Programador:
                    </div>
                    <p>Frecuencia: <span className="font-bold text-indigo-900">{backupSchedule.frequency === 'hourly' ? 'Cada Hora' : backupSchedule.frequency === 'daily' ? 'Diario' : 'Semanal'}</span></p>
                    <p>Última Ejecución: <span className="font-bold text-indigo-900">{backupSchedule.lastBackupTime ? new Date(backupSchedule.lastBackupTime).toLocaleString() : 'Nunca'}</span></p>
                    <p className="mt-1.5 text-[9px] text-gray-400 font-mono">El servidor revisará cada 5 minutos.</p>
                  </div>

                  {/* Botón Guardar */}
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    disabled={isSavingSchedule}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs p-3.5 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {isSavingSchedule ? 'Guardando...' : 'Guardar Configuración'}
                  </button>
                </div>
              </div>

              {/* Card 2: Listado de Últimos 5 Resguardos en la Nube */}
              <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-gray-150 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-base font-black text-gray-900 flex items-center gap-2">
                      <Database className="w-5 h-5 text-indigo-600" />
                      Historial Cloud (Últimos 5 Respaldos)
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">Respaldos almacenados de manera rotativa. El servidor mantendrá estrictamente las últimas 5 copias.</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleTriggerCloudBackup}
                    disabled={isTriggeringCloudBackup}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-black text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer flex items-center gap-2 self-start shrink-0 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTriggeringCloudBackup ? 'animate-spin' : ''}`} />
                    Respaldar Ahora
                  </button>
                </div>

                {/* Status local notifications */}
                {cloudBackupStatus.status === 'success' && (
                  <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <p className="font-semibold">{cloudBackupStatus.message}</p>
                  </div>
                )}
                {cloudBackupStatus.status === 'error' && (
                  <div className="p-4 bg-rose-50 text-rose-800 border border-rose-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <p className="font-semibold">{cloudBackupStatus.message}</p>
                  </div>
                )}

                {/* Tabla de copias */}
                {isLoadingBackups ? (
                  <div className="space-y-3 py-6">
                    <div className="h-10 bg-gray-50 animate-pulse rounded-xl" />
                    <div className="h-10 bg-gray-50 animate-pulse rounded-xl" />
                    <div className="h-10 bg-gray-50 animate-pulse rounded-xl" />
                  </div>
                ) : cloudBackups.length === 0 ? (
                  <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <Database className="w-10 h-10 text-gray-350 mx-auto mb-2" />
                    <p className="text-xs font-bold text-gray-500">Aún no se han generado copias de seguridad en la nube.</p>
                    <p className="text-[10px] text-gray-400 mt-1">Configura la programación o haz clic en "Respaldar Ahora" para crear la primera.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cloudBackups.map((bk, idx) => {
                      const dateStr = bk.meta?.exportedAt ? new Date(bk.meta.exportedAt).toLocaleString() : 'Fecha desconocida';
                      const author = bk.meta?.exportedBy || 'Sistema';
                      const count = bk.meta?.totalCollectionsCount || 0;
                      
                      return (
                        <div key={bk.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-indigo-100 hover:bg-indigo-50/10 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded">
                                #{cloudBackups.length - idx}
                              </span>
                              {bk.meta?.isCompressed && (
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded border border-emerald-200 flex items-center gap-1">
                                  <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                                  ZIP {bk.meta?.compressionRatio ? `(${bk.meta.compressionRatio} Ahorro)` : ''}
                                </span>
                              )}
                              <span className="text-xs font-black text-gray-800 font-mono">
                                {dateStr}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-gray-500">
                              <p>Origen: <span className="font-bold text-gray-700">{author}</span></p>
                              <span className="text-gray-300">|</span>
                              <p>Colecciones: <span className="font-bold text-gray-700">{count}</span></p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Action: Restaurar */}
                            <button
                              type="button"
                              onClick={() => handleRestoreCloudBackup(bk.id)}
                              className="p-2 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider"
                              title="Restaurar base de datos a este punto"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Restaurar
                            </button>

                            {/* Action: Descargar */}
                            <button
                              type="button"
                              onClick={() => handleDownloadCloudBackup(bk.id, `Backup_Cloud_MiSeguroInternacional_${bk.id}`)}
                              className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider"
                              title="Descargar copia como JSON"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Descargar
                            </button>

                            {/* Action: Eliminar */}
                            <button
                              type="button"
                              onClick={() => handleDeleteCloudBackup(bk.id)}
                              className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider"
                              title="Eliminar esta copia permanentemente"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Eliminar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Google Cloud Storage Automated Weekly Backups Guide Card */}
            <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl border border-indigo-500/20 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none hidden md:block">
                <Cloud className="w-56 h-56 text-indigo-400" />
              </div>

              <div className="max-w-4xl relative z-10 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                      <Cloud className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-black tracking-tight text-white">Respaldos Automáticos Semanales en Google Cloud Storage</h3>
                        <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-black uppercase tracking-wider">
                          Nativo GCP
                        </span>
                      </div>
                      <p className="text-xs text-indigo-200/70 mt-0.5">
                        Exportación automatizada sin servidor directamente desde Firestore a un bucket seguro de Google Cloud Storage.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-xl border border-white/10 text-xs font-mono text-indigo-200">
                    <Database className="w-3.5 h-3.5 text-indigo-400" />
                    <span>ID Proyecto: <strong className="text-white">ai-studio-msiadminplatform-aafdf6c5-a449-4ecd-ad08-755db11e4987</strong></span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Step 1 */}
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-indigo-300 font-bold mb-1">
                        <span className="flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                          1. Crear Bucket en Cloud Storage
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">Nearline / us-east1</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Crea el contenedor seguro de almacenamiento en la misma región para costo mínimo y velocidad máxima.
                      </p>
                    </div>
                    <div className="bg-black/40 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-2 font-mono text-[10px] text-emerald-300">
                      <span className="truncate">{GCS_SNIPPET_STEP1}</span>
                      <button
                        type="button"
                        onClick={() => handleCopySnippet(GCS_SNIPPET_STEP1, 'step1')}
                        className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white transition-all shrink-0 cursor-pointer"
                        title="Copiar comando"
                      >
                        {copiedGcsSnippet === 'step1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-indigo-300 font-bold mb-1">
                        <span className="flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-indigo-400" />
                          2. Permisos IAM de Exportación
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">Service Account</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Otorga permiso a la cuenta de servicio de Firestore para escribir los respaldos en el bucket.
                      </p>
                    </div>
                    <div className="bg-black/40 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-2 font-mono text-[10px] text-emerald-300">
                      <span className="truncate">{GCS_SNIPPET_STEP2}</span>
                      <button
                        type="button"
                        onClick={() => handleCopySnippet(GCS_SNIPPET_STEP2, 'step2')}
                        className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white transition-all shrink-0 cursor-pointer"
                        title="Copiar comando"
                      >
                        {copiedGcsSnippet === 'step2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-indigo-300 font-bold mb-1">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-indigo-400" />
                          3. Programar Semanal en Cloud Scheduler
                        </span>
                        <span className="text-[10px] text-emerald-400 font-mono">0 2 * * 0 (Dom 02:00 AM)</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Crea el trabajo cron en Cloud Scheduler que invocará automáticamente la API de exportación de Firestore cada domingo.
                      </p>
                    </div>
                    <div className="bg-black/40 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-2 font-mono text-[10px] text-emerald-300">
                      <span className="truncate">{GCS_SNIPPET_STEP3}</span>
                      <button
                        type="button"
                        onClick={() => handleCopySnippet(GCS_SNIPPET_STEP3, 'step3')}
                        className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white transition-all shrink-0 cursor-pointer"
                        title="Copiar comando"
                      >
                        {copiedGcsSnippet === 'step3' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl space-y-2.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-indigo-300 font-bold mb-1">
                        <span className="flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                          4. Respaldo Manual Inmediato a GCS
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">1 Clic CLI</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">
                        Ejecuta un respaldo completo instantáneo desde la consola de Google Cloud Shell en cualquier momento.
                      </p>
                    </div>
                    <div className="bg-black/40 p-2.5 rounded-xl border border-white/10 flex items-center justify-between gap-2 font-mono text-[10px] text-emerald-300">
                      <span className="truncate">{GCS_SNIPPET_STEP4}</span>
                      <button
                        type="button"
                        onClick={() => handleCopySnippet(GCS_SNIPPET_STEP4, 'step4')}
                        className="p-1.5 hover:bg-white/10 rounded text-gray-300 hover:text-white transition-all shrink-0 cursor-pointer"
                        title="Copiar comando"
                      >
                        {copiedGcsSnippet === 'step4' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-indigo-500/10 border border-indigo-400/20 rounded-2xl flex items-start gap-2.5 text-xs text-indigo-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p>
                    <strong>Rotación y Costos:</strong> Al utilizar la clase de almacenamiento <code className="text-white bg-white/10 px-1 py-0.5 rounded">Nearline</code> en Google Cloud Storage, el costo mensual por resguardar toda la base de datos de Mi Seguro Internacional es de apenas centavos de dólar. Además, puedes configurar una regla de ciclo de vida (Lifecycle Rule) en el bucket para retener 60 días y depurar copias obsoletas automáticamente.
                  </p>
                </div>
              </div>
            </div>

            {/* Main Action Callout Card (One-click complete backup) */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 p-8 rounded-3xl border border-blue-100/80 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none hidden md:block">
                <Database className="w-48 h-48 text-blue-600" />
              </div>

              <div className="max-w-4xl">
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-100/50 text-blue-800 rounded-full w-fit mb-4">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Copia Selectiva</span>
                </div>

                <h4 className="text-lg font-black text-gray-900 mb-2">Descargar Copia de Seguridad de la Base de Datos</h4>
                <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                  Esta opción consulta de manera segura las colecciones activas de tu base de datos Firestore en tiempo real. Genera un archivo comprimido de alta densidad (<strong className="text-blue-700">.ZIP</strong> con compresión DEFLATE) o bien un archivo <strong className="text-blue-700">JSON</strong> estructurado. La compresión ZIP reduce el peso en más del 80%, evitando límites de memoria y facilitando respaldos masivos de cualquier tamaño.
                </p>

                {/* Checklist for selective collections to export */}
                <div className="mb-6 bg-white/70 backdrop-blur-sm p-5 rounded-2xl border border-blue-100/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100/50 pb-2">
                    <span className="text-xs font-black text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5 text-blue-600" />
                      Colecciones a incluir en el archivo JSON de Respaldo:
                    </span>
                    <div className="flex gap-2.5">
                      <button 
                        type="button" 
                        onClick={() => {
                          const allTrue: Record<string, boolean> = {};
                          EXPORTABLE_COLLECTIONS.forEach(col => allTrue[col.id] = true);
                          setExportScope(allTrue);
                        }} 
                        className="text-[10px] font-black text-blue-600 hover:text-blue-855 uppercase tracking-wider hover:underline"
                      >
                        Marcar todas
                      </button>
                      <span className="text-blue-200">|</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          const allFalse: Record<string, boolean> = {};
                          EXPORTABLE_COLLECTIONS.forEach(col => allFalse[col.id] = false);
                          setExportScope(allFalse);
                        }} 
                        className="text-[10px] font-black text-blue-600 hover:text-blue-855 uppercase tracking-wider hover:underline"
                      >
                        Desmarcar todas
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {EXPORTABLE_COLLECTIONS.map(col => (
                      <label key={col.id} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-white/90 cursor-pointer text-xs group transition-all select-none border border-transparent hover:border-blue-100">
                        <input 
                          type="checkbox" 
                          checked={!!exportScope[col.id]} 
                          onChange={(e) => {
                            setExportScope(prev => ({ ...prev, [col.id]: e.target.checked }));
                          }}
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                        />
                        <div className="leading-tight">
                          <span className="font-bold text-gray-800 block group-hover:text-blue-600 transition-colors">{col.id}</span>
                          <span className="text-[10px] text-gray-500 block truncate max-w-[200px]">{col.label.split(' (')[0]}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Status messages */}
                {exportStatus.status === 'success' && (
                  <div className="mb-6 p-4 bg-green-50 text-green-800 border border-green-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">¡Copia de seguridad completada con éxito!</p>
                      <p className="mt-1 opacity-90">{exportStatus.message}</p>
                    </div>
                  </div>
                )}

                {exportStatus.status === 'error' && (
                  <div className="mb-6 p-4 bg-red-50 text-red-800 border border-red-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Error al procesar respaldo completo</p>
                      <p className="mt-1 opacity-90">{exportStatus.message}</p>
                    </div>
                  </div>
                )}

                {/* Progress bar when fetching */}
                {isExportingFull && (
                  <div className="mb-6 p-4 bg-blue-100/30 text-blue-800 border border-blue-200/50 rounded-2xl space-y-2 animate-pulse text-xs">
                    <div className="flex items-center gap-2 font-bold">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      Procesando descarga masiva...
                    </div>
                    {exportCollectionProgress && (
                      <p className="text-[11px] text-blue-600 font-mono">
                        Consultando colección: <span className="font-bold">{exportCollectionProgress}</span>
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleDownloadFullBackup('zip')}
                    disabled={isExportingFull}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black text-sm px-6 py-4 rounded-2xl shadow-lg shadow-blue-200 hover:shadow-xl hover:shadow-blue-300 transition-all cursor-pointer flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    <Download className="w-5 h-5" />
                    {isExportingFull ? 'Generando Copia...' : 'Descargar Backup Comprimido (.ZIP - Recomendado)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadFullBackup('json')}
                    disabled={isExportingFull}
                    className="bg-white hover:bg-gray-50 text-blue-700 font-bold text-xs px-4 py-3.5 rounded-2xl border border-blue-200 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                    Exportar JSON sin comprimir (.JSON)
                  </button>
                </div>
              </div>
            </div>

            {/* Live Database Restoration Card (One Click ZIP/JSON Restore) */}
            <div className="bg-gradient-to-br from-amber-50/70 to-orange-50/40 p-8 rounded-3xl border border-amber-200/50 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none hidden md:block">
                <Upload className="w-48 h-48 text-amber-600" />
              </div>

              <div className="max-w-4xl">
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-800 rounded-full w-fit mb-4">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Importación Selectiva</span>
                </div>

                <h4 className="text-lg font-black text-gray-900 mb-2">Restaurar Base de Datos desde Respaldo (.ZIP o .JSON)</h4>
                <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                  ¿Tienes un archivo de copia de seguridad en formato <strong className="text-amber-800">.ZIP</strong> o <strong className="text-amber-800">.JSON</strong>? Súbelo para ver las colecciones guardadas, verificar la información y procesar la importación selectiva.
                </p>

                {/* Status messages for Import */}
                {importStatus.status === 'success' && (
                  <div className="mb-6 p-4 bg-green-50 text-green-800 border border-green-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">¡Restauración de base de datos terminada!</p>
                      <p className="mt-1 opacity-90">{importStatus.message}</p>
                    </div>
                  </div>
                )}

                {importStatus.status === 'error' && (
                  <div className="mb-6 p-4 bg-red-50 text-red-800 border border-red-100 rounded-2xl flex items-start gap-3 text-xs animate-in slide-in-from-top-2 duration-300">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Error al procesar archivo de restauración</p>
                      <p className="mt-1 opacity-90">{importStatus.message}</p>
                    </div>
                  </div>
                )}

                {/* Progress bar when writing to Firestore */}
                {isImportingFull && (
                  <div className="mb-6 p-4 bg-amber-100 text-amber-900 border border-amber-200 rounded-2xl space-y-2 animate-pulse text-xs">
                    <div className="flex items-center gap-2 font-bold">
                      <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      Escribiendo documentos en tiempo real...
                    </div>
                    {importCollectionProgress && (
                      <p className="text-[11px] text-amber-700 font-mono">
                        Estado actual: <span className="font-semibold">{importCollectionProgress}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Trigger controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                  <div className="flex-1">
                    <input
                      id="backup-upload-input"
                      type="file"
                      accept=".json,.zip"
                      disabled={isImportingFull}
                      onChange={handleBackupFileSelected}
                      className="block w-full text-xs text-gray-500
                        file:mr-4 file:py-2.5 file:px-4
                        file:rounded-xl file:border-0
                        file:text-xs file:font-black
                        file:bg-amber-100 file:text-amber-800
                        hover:file:bg-amber-200
                        cursor-pointer"
                    />
                  </div>

                  {selectedBackupFile && (
                    <button
                      type="button"
                      onClick={handleImportBackupJSON}
                      disabled={isImportingFull}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-black text-sm px-6 py-3.5 rounded-2xl shadow-lg shadow-amber-200 hover:shadow-xl transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Iniciar Restauración Seleccionada
                    </button>
                  )}
                </div>

                {/* Metadata card and selective checklist if backup loaded */}
                {selectedBackupMeta && selectedBackupFile && (
                  <div className="mt-5 p-5 bg-white border border-amber-200 rounded-2xl text-xs space-y-4 text-gray-700 animate-in fade-in duration-300">
                    <div>
                      <span className="font-black text-amber-850 uppercase tracking-widest text-[9px] block mb-2">Copia de Respaldo Cargada con Éxito:</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 font-medium bg-amber-50/50 p-3 rounded-xl border border-amber-150">
                        <p>📅 Fecha de Creación: <span className="font-bold text-gray-900">{new Date(selectedBackupMeta.exportedAt).toLocaleString()}</span></p>
                        <p>👤 Creador de la Copia: <span className="font-bold text-gray-900">{selectedBackupMeta.exportedBy}</span></p>
                        <p>📋 Cantidad de Tablas: <span className="font-bold text-gray-900">{selectedBackupMeta.totalCollectionsCount}</span></p>
                        <p>📦 Peso de Sincronía: <span className="font-mono font-bold text-amber-700 text-[10px]">{Object.keys(selectedBackupMeta.recordCounts || {}).length} colecciones</span></p>
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2.5">
                        <span className="font-black text-amber-850 uppercase tracking-widest text-[9px]">Seleccionar Tablas del Respaldo a Restaurar:</span>
                        <div className="flex gap-2">
                          <button 
                            type="button" 
                            onClick={() => {
                              const keys = Object.keys(selectedBackupFile || {});
                              const allTrue: Record<string, boolean> = {};
                              keys.forEach(k => allTrue[k] = true);
                              setImportScope(allTrue);
                            }} 
                            className="text-[9px] font-black text-amber-700 hover:text-amber-900 uppercase tracking-wider hover:underline"
                          >
                            Marcar Todos
                          </button>
                          <span className="text-amber-200">|</span>
                          <button 
                            type="button" 
                            onClick={() => {
                              const keys = Object.keys(selectedBackupFile || {});
                              const allFalse: Record<string, boolean> = {};
                              keys.forEach(k => allFalse[k] = false);
                              setImportScope(allFalse);
                            }} 
                            className="text-[9px] font-black text-amber-700 hover:text-amber-900 uppercase tracking-wider hover:underline"
                          >
                            Desmarcar Todos
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-3 bg-gray-50 border border-gray-150 rounded-xl">
                        {Object.keys(selectedBackupFile || {}).map(colName => {
                          const recordCount = selectedBackupMeta.recordCounts?.[colName] ?? selectedBackupFile[colName]?.length ?? 0;
                          const knownMeta = EXPORTABLE_COLLECTIONS.find(c => c.id === colName);
                          return (
                            <label key={colName} className="flex items-center gap-2 p-1.5 hover:bg-amber-100/30 rounded-lg cursor-pointer text-xs group transition-all select-none">
                              <input 
                                type="checkbox" 
                                checked={!!importScope[colName]} 
                                onChange={(e) => {
                                  setImportScope(prev => ({ ...prev, [colName]: e.target.checked }));
                                }}
                                className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5 cursor-pointer"
                              />
                              <div className="leading-tight">
                                <span className="font-bold text-gray-850 group-hover:text-amber-700 font-mono text-[11px] block">{colName} ({recordCount} docs)</span>
                                {knownMeta && (
                                  <span className="text-[9px] text-gray-500 block truncate max-w-[150px]">{knownMeta.label.split(' (')[0]}</span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Individual downloads table */}
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-black text-gray-900">Copias de Seguridad Selectivas por Tabla (Excel / CSV)</h4>
                <p className="text-xs text-gray-500">¿Solo necesitas una tabla en específico? Descarga cada colección de forma independiente procesada en formato CSV nativo de fácil lectura y compatible con Microsoft Excel.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {EXPORTABLE_COLLECTIONS.map(item => {
                  return (
                    <div key={item.id} className="bg-white p-5 rounded-2xl border border-gray-100 hover:border-blue-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                          <h5 className="font-bold text-gray-900 text-sm">{item.label}</h5>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{item.desc}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleExportCollectionCSV(item.id, item.label)}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100/50 hover:border-emerald-200 rounded-xl text-xs font-black transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exportar a Excel (CSV)
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'quota' && (
          <QuotaDashboard />
        )}
      </main>

      {/* User Editor Modal */}
      {(editingUser || isAddingUser) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {isAddingUser ? 'Nuevo Usuario' : 'Editar Usuario'}
              </h3>
              <button onClick={() => { setEditingUser(null); setIsAddingUser(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="p-8 space-y-6">
              {isAddingUser ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Nombre Completo</label>
                    <input
                      type="text"
                      required
                      value={editingUser?.displayName || ''}
                      onChange={e => setEditingUser({ ...editingUser!, displayName: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Email</label>
                    <input
                      type="email"
                      required
                      value={editingUser?.email || ''}
                      onChange={e => setEditingUser({ ...editingUser!, email: e.target.value })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Usuario</label>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                      {editingUser?.displayName?.charAt(0) || editingUser?.email.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">{editingUser?.displayName || 'Sin nombre'}</p>
                      <p className="text-xs text-gray-400">{editingUser?.email}</p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Rol del Sistema</label>
                <select
                  value={editingUser?.role}
                  onChange={e => setEditingUser({ ...editingUser!, role: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                >
                  <optgroup label="Roles de Sistema">
                    {SYSTEM_ROLES.map(r => <option key={`edit-user-sys-${r.id}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                  <optgroup label="Roles Personalizados">
                    {customRoles.map(r => <option key={`edit-user-cust-${r.id || Math.random()}`} value={r.id}>{r.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {editingUser?.role === 'agent' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Comisión (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      required
                      value={editingUser.commission ?? 0}
                      onChange={e => setEditingUser({ ...editingUser, commission: parseFloat(e.target.value) || 0 })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Agente Superior / Principal (Opcional)</label>
                    <select
                      value={editingUser.parentAgentId || ''}
                      onChange={e => setEditingUser({ ...editingUser, parentAgentId: e.target.value || undefined })}
                      className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium text-gray-700 bg-white"
                    >
                      <option value="">Ninguno (Es Agente Principal)</option>
                      {users
                        .filter(u => u.role === 'agent' && u.uid !== editingUser.uid)
                        .map(u => (
                          <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1 font-medium">Asigna un agente principal si este usuario es un subagente.</p>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => { setEditingUser(null); setIsAddingUser(false); }}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                >
                  {isAddingUser ? 'Crear Usuario' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Role Editor Modal */}
      {(editingRole || isAddingRole) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  {editingRole?.id && !isAddingRole ? 'Editar Rol' : 'Nuevo Rol Personalizado'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Define los detalles y permisos del rol.</p>
              </div>
              <button onClick={() => { setEditingRole(null); setIsAddingRole(false); }} className="p-2 hover:bg-white rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSaveRole} className="flex flex-col md:flex-row h-[600px] max-h-[80vh]">
              {/* Left Side: Details */}
              <div className="w-full md:w-2/5 p-8 border-r border-gray-100 overflow-y-auto space-y-6">
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Shield className="w-3 h-3" />
                    Detalles del Rol
                  </h4>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5">Nombre del Rol</label>
                    <input
                      type="text"
                      required
                      placeholder="Ej: Supervisor de Ventas"
                      value={editingRole?.name || ''}
                      onChange={e => setEditingRole({ ...editingRole!, name: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5">Descripción</label>
                    <textarea
                      rows={4}
                      placeholder="Describe las responsabilidades de este rol..."
                      value={editingRole?.description || ''}
                      onChange={e => setEditingRole({ ...editingRole!, description: e.target.value })}
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm text-gray-600"
                    />
                  </div>
                </div>
              </div>

              {/* Right Side: Permissions */}
              <div className="flex-1 p-8 bg-gray-50/30 overflow-y-auto">
                <div className="space-y-4">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <Key className="w-3 h-3" />
                    Permisos por Menú
                  </h4>

                  <div className="space-y-3">
                    {MENUS.map(menu => (
                      <div key={menu.id} className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                        <p className="text-sm font-bold text-gray-900 mb-3">{menu.name}</p>
                        <div className="grid grid-cols-2 gap-3">
                          {(['view', 'create', 'edit', 'delete'] as const).map(action => (
                            <label key={action} className="flex items-center gap-2 cursor-pointer">
                              <input 
                                type="checkbox"
                                checked={editingRole?.menuPermissions?.[menu.id]?.[action] || false}
                                onChange={e => {
                                  const currentPerms = editingRole?.menuPermissions || {};
                                  const menuPerms = currentPerms[menu.id] || { view: false, create: false, edit: false, delete: false };
                                  setEditingRole({
                                    ...editingRole!,
                                    menuPermissions: {
                                      ...currentPerms,
                                      [menu.id]: {
                                        ...menuPerms,
                                        [action]: e.target.checked
                                      }
                                    }
                                  });
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-[10px] font-bold text-gray-500 uppercase">
                                {action === 'view' ? 'Ver' : action === 'create' ? 'Crear' : action === 'edit' ? 'Editar' : 'Borrar'}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 flex gap-4 sticky bottom-0 bg-gray-50/30 pt-4">
                  <button
                    type="button"
                    onClick={() => { setEditingRole(null); setIsAddingRole(false); }}
                    className="flex-1 px-6 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all"
                  >
                    {editingRole?.id && !isAddingRole ? 'Guardar Cambios' : 'Crear Rol'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permission Editor Modal Removed */}
      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
      />
    </div>
  );
}
