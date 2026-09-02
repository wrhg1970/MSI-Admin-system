import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { HistoricalRecord, UserProfile } from '../types';
import { getNormalizedYYYYMMDD, formatDisplayDate } from '../lib/policyUtils';
import { 
  Search, 
  Download, 
  User, 
  MapPin, 
  Calendar, 
  Filter, 
  Database, 
  Globe, 
  Clock, 
  Compass, 
  BadgeAlert, 
  X, 
  ChevronLeft, 
  ChevronRight,
  TrendingUp,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  Trash2,
  Lock,
  Briefcase,
  Layers,
  CreditCard,
  Percent,
  Check,
  Building,
  ClipboardList
} from 'lucide-react';

interface HistoricoManagerProps {
  profile?: UserProfile | null;
}

export default function HistoricoManager({ profile }: HistoricoManagerProps) {
  // Real-time historical records from firestore
  const [records, setRecords] = useState<HistoricalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('All');
  const [selectedDestination, setSelectedDestination] = useState('All');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('All');
  const [requestDateStart, setRequestDateStart] = useState('');
  const [requestDateEnd, setRequestDateEnd] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Modals state
  const [selectedRecord, setSelectedRecord] = useState<HistoricalRecord | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Import wizard steps
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'processing' | 'result'>('upload');
  const [pastedCSV, setPastedCSV] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [rowValidationErrors, setRowValidationErrors] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importSummary, setImportSummary] = useState({ success: 0, failed: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check role permissions
  const isUserAdmin = useMemo(() => {
    if (!profile) return false;
    return ['super_admin', 'admin', 'director', 'seguros', 'administracion'].includes(profile.role);
  }, [profile]);

  // Read historical records from Firestore
  useEffect(() => {
    const q = collection(db, 'historicalRecords');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: HistoricalRecord[] = [];
      snapshot.forEach((doc) => {
        fetched.push({ id: doc.id, ...doc.data() } as HistoricalRecord);
      });

      // Sort in-memory by createdAt timestamp
      fetched.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return timeB - timeA;
      });

      // Filter based on agent role if user is not admin
      let filteredFetched = fetched;
      if (!isUserAdmin && profile?.email) {
        const agentEmail = profile.email.toLowerCase().trim();
        filteredFetched = fetched.filter(item => 
          (item.agente || '').toLowerCase().trim() === agentEmail ||
          (item.email || '').toLowerCase().trim() === agentEmail
        );
      }

      setRecords(filteredFetched);
      setLoading(false);
    }, (err) => {
      console.error("Error loading historical records:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isUserAdmin, profile]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = records.length;
    const uniqueDestinations = new Set(records.map(r => r.destino).filter(Boolean)).size;

    // Average Age
    const validAges = records.map(r => Number(r.edad)).filter(edad => !isNaN(edad) && edad > 0);
    const averageAge = validAges.length > 0 
      ? Math.round(validAges.reduce((sum, edad) => sum + edad, 0) / validAges.length) 
      : 0;

    // Most popular Plan Name (tipoPoliza)
    const planCounts: Record<string, number> = {};
    records.forEach(r => {
      const plan = r.tipoPoliza || 'N/A';
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    });

    let mostPopularPlan = 'Ninguno';
    let maxCount = 0;
    Object.entries(planCounts).forEach(([plan, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostPopularPlan = plan;
      }
    });

    return {
      total,
      uniqueDestinations,
      averageAge,
      mostPopularPlan
    };
  }, [records]);

  // Unique lists for filters
  const uniquePlans = useMemo(() => {
    return Array.from(new Set(records.map(r => r.tipoPoliza))).filter(Boolean).sort();
  }, [records]);

  const uniqueDestinationsList = useMemo(() => {
    return Array.from(new Set(records.map(r => r.destino))).filter(Boolean).sort();
  }, [records]);

  // Helper to parse variable string dates (like DD/MM/YYYY or YYYY-MM-DD or standard JS date formats) into standard YYYY-MM-DD
  const parseToComparableDate = useCallback((dateStr: string): string | null => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const clean = dateStr.trim();
    if (!clean) return null;

    // 1. Try YYYY-MM-DD first
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      return clean;
    }
    const ymdPrefix = clean.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (ymdPrefix) {
      return `${ymdPrefix[1]}-${ymdPrefix[2]}-${ymdPrefix[3]}`;
    }

    // 2. Try DD/MM/YYYY (e.g., 15/08/2026 or 15-08-2026)
    const dmyPattern = clean.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
    if (dmyPattern) {
      const p1 = parseInt(dmyPattern[1], 10);
      const p2 = parseInt(dmyPattern[2], 10);
      const year = dmyPattern[3];
      
      if (p1 > 12) {
        // p1 is definitely the day, p2 is the month
        const day = String(p1).padStart(2, '0');
        const month = String(p2).padStart(2, '0');
        return `${year}-${month}-${day}`;
      } else {
        // Default to DD/MM/YYYY as it is the typical format in Spanish/MX-ES CSV uploads
        const day = String(p1).padStart(2, '0');
        const month = String(p2).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }

    // 3. Fallback to standard javascript Date parse
    try {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {}

    return null;
  }, []);

  // Filter records
  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const fullName = `${record.firstName || ''} ${record.lastName || ''}`.trim();
      const reqDateNorm = getNormalizedYYYYMMDD(record.fechaAlta || record.createdAt);
      const reqDateDisp = formatDisplayDate(record.fechaAlta || record.createdAt);
      const searchTarget = `${fullName} ${record.firstName || ''} ${record.lastName || ''} ${record.email || ''} ${record.destino || ''} ${record.ciudad || ''} ${record.agente || ''} ${record.cliente || ''} ${record.noRecibo || ''} ${record.invoice || ''} ${reqDateNorm} ${reqDateDisp}`.toLowerCase();
      const searchTokens = searchTerm.toLowerCase().trim().split(/\s+/);
      const matchSearch = !searchTerm.trim() || searchTokens.every(token => searchTarget.includes(token));

      const matchPlan = selectedPlan === 'All' || record.tipoPoliza === selectedPlan;
      const matchDest = selectedDestination === 'All' || record.destino === selectedDestination;

      // Age group classification
      let ageGroup = 'Adult';
      const recordAge = Number(record.edad) || 0;
      if (recordAge < 6) ageGroup = 'U6';
      else if (recordAge >= 6 && recordAge <= 25) ageGroup = 'Student';
      else if (recordAge > 69) ageGroup = 'O70';
      else ageGroup = 'Traveler';

      const matchAgeGroup = selectedAgeGroup === 'All' || ageGroup === selectedAgeGroup;

      // Date Range filtering using fechaAlta
      let matchDate = true;
      if (requestDateStart || requestDateEnd) {
        const recordComparableDate = parseToComparableDate(record.fechaAlta);
        if (recordComparableDate) {
          if (requestDateStart && recordComparableDate < requestDateStart) {
            matchDate = false;
          }
          if (requestDateEnd && recordComparableDate > requestDateEnd) {
            matchDate = false;
          }
        } else {
          // If a date filter is configured but this record doesn't have a parseable request date, exclude it
          matchDate = false;
        }
      }

      return matchSearch && matchPlan && matchDest && matchAgeGroup && matchDate;
    });
  }, [records, searchTerm, selectedPlan, selectedDestination, selectedAgeGroup, requestDateStart, requestDateEnd, parseToComparableDate]);

  // Paginated records
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRecords, currentPage]);

  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage) || 1;

  // Currency helper formatting
  const formatCurrency = (val: any, defaultCurrency: string = 'MXP') => {
    if (val === undefined || val === null || String(val).trim() === '') {
      return `$0.00 ${defaultCurrency}`;
    }

    const strVal = String(val).trim();
    
    // Check if the value itself explicitly overrides or specifies the currency
    const hasUSD = strVal.toUpperCase().includes('USD');
    const hasMX = strVal.toUpperCase().includes('MXN') || strVal.toUpperCase().includes('MXP') || strVal.toUpperCase().includes('MN');
    
    let targetCurrency = defaultCurrency;
    if (hasUSD) {
      targetCurrency = 'USD';
    } else if (hasMX) {
      targetCurrency = 'MXP';
    }

    let cleaned = strVal.replace(/[$,\s]/gi, '')
                        .replace(/USD/gi, '')
                        .replace(/MXN/gi, '')
                        .replace(/MXP/gi, '')
                        .replace(/MN/gi, '');
    
    const isParenthesizedNegative = /^\(.*\)$/.test(strVal);
    if (isParenthesizedNegative) {
      cleaned = '-' + cleaned.replace(/[()]/g, '');
    }

    const num = parseFloat(cleaned);
    if (isNaN(num)) {
      return strVal;
    }

    const formattedNum = new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);

    return `$${formattedNum} ${targetCurrency}`;
  };

  // Export to CSV helper
  const handleExportCSV = () => {
    const headers = [
      'Tipo de Cliente', 'Cliente', 'Agente', 'FechaAlta', 'TransactionType',
      'First Name', 'LastName', 'Birth Date', 'Edad', 'Gender', 'Email',
      'Tipo de Poliza', 'TipoCobertura', 'Origen', 'Destino', 'Ciudad',
      'Start Date', 'End Date', 'Comentarios', 'CantidadAPagar', 'CargoAdministrativo',
      'PrecioPublicoFinalMN', 'PrecioPublicoFinalUSD', 'FechaPagoSetmex', 'FormadePago',
      'No.Recibo', 'CostoFinalUSD', 'FechaInvoice', 'Invoice', 'ComisionUSD',
      'ComisionFinalMXP', 'Comision Final a Pagar', 'ComisionPagada', 'ComisionFechaPago',
      'ComisionFormaPago', 'ComisionComentario'
    ];

    const csvRows = [headers.join(',')];

    filteredRecords.forEach(r => {
      const row = [
        `"${r.tipoCliente || ''}"`,
        `"${r.cliente || ''}"`,
        `"${r.agente || ''}"`,
        `"${r.fechaAlta || ''}"`,
        `"${r.transactionType || ''}"`,
        `"${r.firstName || ''}"`,
        `"${r.lastName || ''}"`,
        `"${r.birthDate || ''}"`,
        r.edad || 0,
        `"${r.gender || ''}"`,
        `"${r.email || ''}"`,
        `"${r.tipoPoliza || ''}"`,
        `"${r.tipoCobertura || ''}"`,
        `"${r.origen || ''}"`,
        `"${r.destino || ''}"`,
        `"${r.ciudad || ''}"`,
        `"${r.startDate || ''}"`,
        `"${r.endDate || ''}"`,
        `"${(r.comentarios || '').replace(/"/g, '""')}"`,
        r.cantidadAPagar || 0,
        r.cargoAdministrativo || 0,
        r.precioPublicoFinalMN || 0,
        r.precioPublicoFinalUSD || 0,
        `"${r.fechaPagoSetmex || ''}"`,
        `"${r.formadePago || ''}"`,
        `"${r.noRecibo || ''}"`,
        r.costoFinalUSD || 0,
        `"${r.fechaInvoice || ''}"`,
        `"${r.invoice || ''}"`,
        r.comisionUSD || 0,
        r.comisionFinalMXP || 0,
        r.comisionFinalAPagar || 0,
        `"${r.comisionPagada || ''}"`,
        `"${r.comisionFechaPago || ''}"`,
        `"${r.comisionFormaPago || ''}"`,
        `"${(r.comisionComentario || '').replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `historico_importado_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Template download
  const handleDownloadTemplate = () => {
    const headers = [
      'Tipo de Cliente', 'Cliente', 'Agente', 'FechaAlta', 'TransactionType',
      'First Name', 'LastName', 'Birth Date', 'Edad', 'Gender', 'Email',
      'Tipo de Poliza', 'TipoCobertura', 'Origen', 'Destino', 'Ciudad',
      'Start Date', 'End Date', 'Comentarios', 'CantidadAPagar', 'CargoAdministrativo',
      'PrecioPublicoFinalMN', 'PrecioPublicoFinalUSD', 'FechaPagoSetmex', 'FormadePago',
      'No.Recibo', 'CostoFinalUSD', 'FechaInvoice', 'Invoice', 'ComisionUSD',
      'ComisionFinalMXP', 'Comision Final a Pagar', 'ComisionPagada', 'ComisionFechaPago',
      'ComisionFormaPago', 'ComisionComentario'
    ];
    
    // Add UTF-8 Bom to protect spanish character encodings
    const csvContent = "\uFEFF" + headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'plantilla_importacion_historico.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Parse file/text handler
  const handleFileParse = (fileToParse: File) => {
    setSelectedFile(fileToParse);
    Papa.parse(fileToParse, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateAndSetParsedData(results.data);
      },
      error: (error) => {
        setRowValidationErrors([`Error al analizar el archivo CSV: ${error.message}`]);
      }
    });
  };

  const handlePastedParse = () => {
    if (!pastedCSV.trim()) return;
    Papa.parse(pastedCSV, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateAndSetParsedData(results.data);
      },
      error: (error) => {
        setRowValidationErrors([`Error al analizar el texto copiado: ${error.message}`]);
      }
    });
  };

  // Helper parser for numbers with symbols or commas
  const parseNumberHelper = (valStr: any) => {
    if (valStr === undefined || valStr === null) return 0;
    const cleaned = String(valStr).replace(/[$,\s]/g, '').replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const validateAndSetParsedData = (data: any[]) => {
    const mappedRows: any[] = [];

    if (data.length === 0) {
      setRowValidationErrors(["El archivo está vacío o no contiene filas de datos."]);
      return;
    }

    // Helper to extract values by looking up alternate capitalization or exact names
    const getCSVVal = (rowObj: any, keysToTry: string[]) => {
      for (const k of keysToTry) {
        if (rowObj[k] !== undefined && rowObj[k] !== null) return String(rowObj[k]).trim();
        // Fallback case-insensitive
        const lowerK = k.toLowerCase().trim();
        const foundKey = Object.keys(rowObj).find(actualK => actualK.toLowerCase().trim() === lowerK);
        if (foundKey) return String(rowObj[foundKey]).trim();
      }
      return '';
    };

    data.forEach((row) => {
      const record: HistoricalRecord = {
        tipoCliente: getCSVVal(row, ['Tipo de Cliente', 'tipoCliente']),
        cliente: getCSVVal(row, ['Cliente', 'cliente']),
        agente: getCSVVal(row, ['Agente', 'agente']),
        fechaAlta: getCSVVal(row, ['FechaAlta', 'fechaAlta']),
        transactionType: getCSVVal(row, ['TransactionType', 'transactionType']),
        firstName: getCSVVal(row, ['First Name', 'firstName', 'Nombre']),
        lastName: getCSVVal(row, ['LastName', 'lastName', 'Apellido']),
        birthDate: getCSVVal(row, ['Birth Date', 'birthDate', 'Fecha Nacimiento']),
        edad: getCSVVal(row, ['Edad', 'edad']),
        gender: getCSVVal(row, ['Gender', 'gender', 'Sexo']),
        email: getCSVVal(row, ['Email', 'Correo', 'Correo electronico']),
        tipoPoliza: getCSVVal(row, ['Tipo de Poliza', 'tipoPoliza', 'Poliza']),
        tipoCobertura: getCSVVal(row, ['TipoCobertura', 'tipoCobertura']),
        origen: getCSVVal(row, ['Origen', 'origen']),
        destino: getCSVVal(row, ['Destino', 'destino']),
        ciudad: getCSVVal(row, ['Ciudad', 'ciudad']),
        startDate: getCSVVal(row, ['Start Date', 'startDate']),
        endDate: getCSVVal(row, ['End Date', 'endDate']),
        comentarios: getCSVVal(row, ['Comentarios', 'comentarios']),
        cantidadAPagar: getCSVVal(row, ['CantidadAPagar', 'cantidadAPagar']),
        cargoAdministrativo: getCSVVal(row, ['CargoAdministrativo', 'cargoAdministrativo']),
        precioPublicoFinalMN: getCSVVal(row, ['PrecioPublicoFinalMN', 'precioPublicoFinalMN']),
        precioPublicoFinalUSD: getCSVVal(row, ['PrecioPublicoFinalUSD', 'precioPublicoFinalUSD']),
        fechaPagoSetmex: getCSVVal(row, ['FechaPagoSetmex', 'fechaPagoSetmex']),
        formadePago: getCSVVal(row, ['FormadePago', 'formadePago']),
        noRecibo: getCSVVal(row, ['No.Recibo', 'noRecibo', 'NoRecibo']),
        costoFinalUSD: getCSVVal(row, ['CostoFinalUSD', 'costoFinalUSD']),
        fechaInvoice: getCSVVal(row, ['FechaInvoice', 'fechaInvoice']),
        invoice: getCSVVal(row, ['Invoice', 'invoice']),
        comisionUSD: getCSVVal(row, ['ComisionUSD', 'comisionUSD']),
        comisionFinalMXP: getCSVVal(row, ['ComisionFinalMXP', 'comisionFinalMXP']),
        comisionFinalAPagar: getCSVVal(row, ['Comision Final a Pagar', 'comisionFinalAPagar']),
        comisionPagada: getCSVVal(row, ['ComisionPagada', 'comisionPagada']),
        comisionFechaPago: getCSVVal(row, ['ComisionFechaPago', 'comisionFechaPago']),
        comisionFormaPago: getCSVVal(row, ['ComisionFormaPago', 'comisionFormaPago']),
        comisionComentario: getCSVVal(row, ['ComisionComentario', 'comisionComentario'])
      };

      mappedRows.push(record);
    });

    setParsedRows(mappedRows);
    setRowValidationErrors([]); // En la carga del Historico, no se hace ninguna validacion
    setImportStep('preview');
  };

  // Perform Firestore saving sequentially to support robust progress metering
  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) return;
    setImportStep('processing');
    setImportProgress(0);

    let successes = 0;
    let failures = 0;
    const total = parsedRows.length;

    for (let i = 0; i < total; i++) {
      try {
        const docToSave = {
          ...parsedRows[i],
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'historicalRecords'), docToSave);
        successes++;
      } catch (err) {
        console.error("Error writing historical log:", err);
        failures++;
      }
      setImportProgress(Math.round(((i + 1) / total) * 100));
    }

    setImportSummary({ success: successes, failed: failures });
    setImportStep('result');
    // Clear out pending states
    setParsedRows([]);
    setPastedCSV('');
    setSelectedFile(null);
  };

  // Destructive delete for SuperAdmin audit maintenance
  const handleDeleteRecord = async (recordId: string) => {
    if (profile?.role !== 'super_admin') {
      alert("Solo el super administrador puede eliminar registros históricos.");
      return;
    }
    if (!window.confirm("¿Está seguro de que desea eliminar permanentemente este registro histórico de la base de datos?")) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'historicalRecords', recordId));
      setSelectedRecord(null);
    } catch (err) {
      console.error("Error deleting historical document:", err);
      alert("No se pudo eliminar el registro. Intente de nuevo.");
    }
  };

  return (
    <div id="historico-container" className="space-y-6 max-w-7xl mx-auto p-4 md:p-6 animate-in fade-in duration-300">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-3">
            <Compass className="w-8 h-8 text-indigo-600" />
            Módulo Histórico de Pasajeros
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
            Consulte o actualice la base de datos de auditoría histórica consolidada. En esta vista **únicamente se desplegarán los registros que hayan sido explícitamente importados** mediante plantilla.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            id="btn-import-template-historico"
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-sm rounded-xl transition-all"
          >
            <Upload className="w-4 h-4" />
            Importar Historial (.CSV)
          </button>

          {records.length > 0 && (
            <button
              id="btn-export-historico"
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all hover:shadow-lg shadow-indigo-100"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Exportar Selección (.CSV)
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Auditados Totales</span>
            <p className="text-2xl font-semibold text-gray-900 leading-none mt-1">{stats.total}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-sky-50 text-sky-600 rounded-xl">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Países Destino</span>
            <p className="text-2xl font-semibold text-gray-900 leading-none mt-1">{stats.uniqueDestinations}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-xl">
            <User className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Edad Promedio</span>
            <p className="text-2xl font-semibold text-gray-900 leading-none mt-1">{stats.averageAge} años</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="p-3.5 bg-amber-50 text-amber-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Plan Más Común</span>
            <p className="text-sm font-bold text-gray-950 mt-1 truncate" title={stats.mostPopularPlan}>{stats.mostPopularPlan}</p>
          </div>
        </div>

      </div>

      {/* Filters bar */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-gray-50">
          <Filter className="w-4 h-4 text-gray-400" />
          <h2 className="text-xs font-black uppercase text-gray-500 tracking-wider">Panel de Filtros y Configuración</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="col-span-1 md:col-span-2 relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
              <Search className="w-4 h-4" />
            </span>
            <input
              id="search-historico-input"
              type="text"
              placeholder="Buscar por asegurado, email, destino, agente o cliente..."
              value={searchTerm}
              onChange={e => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-medium text-gray-800 text-sm transition-all"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div>
            <select
              id="plan-historico-filter"
              value={selectedPlan}
              onChange={e => {
                setSelectedPlan(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-bold text-gray-700 text-xs"
            >
              <option value="All">Tipo de Póliza: Todos</option>
              {uniquePlans.map(plan => (
                <option key={plan} value={plan}>{plan}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              id="dest-historico-filter"
              value={selectedDestination}
              onChange={e => {
                setSelectedDestination(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-bold text-gray-700 text-xs"
            >
              <option value="All">Destinos: Todos</option>
              {uniqueDestinationsList.map(dest => (
                <option key={dest} value={dest}>{dest}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Row for Date and Age Group Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
          <div className="space-y-1">
            <label htmlFor="req-date-start" className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">
              Fecha de Solicitud (Desde):
            </label>
            <input
              id="req-date-start"
              type="date"
              value={requestDateStart}
              onChange={e => {
                setRequestDateStart(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-semibold text-gray-700 text-xs transition-all"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="req-date-end" className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">
              Fecha de Solicitud (Hasta):
            </label>
            <input
              id="req-date-end"
              type="date"
              value={requestDateEnd}
              onChange={e => {
                setRequestDateEnd(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-semibold text-gray-700 text-xs transition-all"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="age-historico-filter" className="text-[10px] font-black uppercase text-gray-400 tracking-wider block">
              Clasificación de Edad:
            </label>
            <select
              id="age-historico-filter"
              value={selectedAgeGroup}
              onChange={e => {
                setSelectedAgeGroup(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-bold text-gray-700 text-xs transition-all"
            >
              <option value="All">Rango Edad: Todos</option>
              <option value="U6">Infantil / Children (&lt; 6 años)</option>
              <option value="Student">Estudiante / Student (6 - 25 años)</option>
              <option value="Traveler">Adulto / Adult (26 - 69 años)</option>
              <option value="O70">Adulto Mayor / Senior (70+ años)</option>
            </select>
          </div>
        </div>

        {/* Clear Filters Helper if there is some selection active */}
        {(searchTerm || selectedPlan !== 'All' || selectedDestination !== 'All' || selectedAgeGroup !== 'All' || requestDateStart || requestDateEnd) && (
          <div className="flex justify-between items-center bg-indigo-50/50 px-4 py-2.5 rounded-xl border border-indigo-100/40 animate-in fade-in duration-200">
            <span className="text-xs text-indigo-700 font-bold">
              Se encontraron {filteredRecords.length} resultado(s) aplicando los filtros seleccionados.
            </span>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedPlan('All');
                setSelectedDestination('All');
                setSelectedAgeGroup('All');
                setRequestDateStart('');
                setRequestDateEnd('');
                setCurrentPage(1);
              }}
              className="text-xs text-indigo-700 font-extrabold hover:underline"
            >
              Limpiar todos los filtros
            </button>
          </div>
        )}
      </div>

      {/* Main Results Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-550">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
            <p className="text-sm font-semibold">Cargando base de datos histórica...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-100">
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Asegurado / Email</th>
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest hidden md:table-cell">Cliente / Agente</th>
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Origen & Destino</th>
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest hidden sm:table-cell">Vigencia Cobertura</th>
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Precio Final</th>
                    <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Comisión a Pagar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedRecords.length > 0 ? (
                    paginatedRecords.map((record, index) => (
                      <tr 
                        key={record.id || index}
                        onClick={() => setSelectedRecord(record)}
                        className="hover:bg-indigo-50/20 cursor-pointer active:bg-indigo-50 transition-colors group"
                      >
                        
                        {/* Insured Profile */}
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors text-slate-500 font-bold">
                              {record.firstName?.charAt(0) || 'H'}{record.lastName?.charAt(0) || ''}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors text-sm">
                                {record.firstName} {record.lastName}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-gray-400 truncate max-w-[180px]">{record.email}</span>
                                <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-black rounded font-mono">
                                  {record.edad || 0} años
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Customer / Originator */}
                        <td className="p-4 hidden md:table-cell">
                          <p className="text-xs font-semibold text-gray-800">{record.cliente || 'Particular'}</p>
                          <p className="text-[10px] text-gray-400 truncate max-w-[150px]">{record.agente}</p>
                        </td>

                        {/* Travel Route */}
                        <td className="p-4">
                          <div className="flex items-center gap-1 text-xs font-semibold text-gray-850">
                            <span>{record.origen || 'MX'}</span>
                            <ChevronRight className="w-3 text-indigo-400" />
                            <span className="text-indigo-600">{record.destino}</span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                            {record.ciudad || 'No especificada'}
                          </p>
                        </td>

                        {/* Travel Dates */}
                        <td className="p-4 hidden sm:table-cell">
                          <div className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            <span>{record.startDate} al {record.endDate}</span>
                          </div>
                        </td>

                        {/* Price Public USD */}
                        <td className="p-4">
                          <p className="text-xs font-bold text-gray-950 font-mono">
                            {formatCurrency(record.precioPublicoFinalUSD, 'USD')}
                          </p>
                          <p className="text-[9px] text-gray-400 font-medium leading-none">
                            {formatCurrency(record.precioPublicoFinalMN, 'MXP')}
                          </p>
                        </td>

                        {/* Commission final to pay */}
                        <td className="p-4 text-right">
                          <p className="text-xs font-extrabold text-indigo-700 font-mono">
                            {formatCurrency(record.comisionFinalAPagar, 'MXP')}
                          </p>
                          {record.comisionPagada === 'Sí' || record.comisionPagada === 'Si' || record.comisionPagada === 'Paid' ? (
                            <span className="inline-block mt-1 px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-100 text-[8px] font-black uppercase tracking-wider rounded font-mono">
                              Comisión Pagada
                            </span>
                          ) : (
                            <span className="inline-block mt-1 px-1.5 py-0.2 bg-amber-50 text-amber-700 border border-amber-100 text-[8px] font-black uppercase tracking-wider rounded font-mono">
                              Pendiente
                            </span>
                          )}
                        </td>

                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-center py-20 text-gray-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <BadgeAlert className="w-12 h-12 text-gray-300" />
                          <div>
                            <p className="font-extrabold text-gray-600">No se encontraron registros históricos</p>
                            <p className="text-xs text-gray-400 mt-1 max-w-sm">
                              Esta base de datos solo almacena los registros que hayan sido importados mediante archivo CSV. Haga clic en **Importar Historial** arriba para comenzar.
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredRecords.length > 0 && (
              <div className="p-4 bg-gray-50/55 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-500 font-medium">
                  Mostrando <span className="font-bold text-gray-900">{(currentPage - 1) * itemsPerPage + 1}</span> a{' '}
                  <span className="font-bold text-gray-900">{Math.min(currentPage * itemsPerPage, filteredRecords.length)}</span> de{' '}
                  <span className="font-bold text-gray-900">{filteredRecords.length}</span> registros
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-2 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 transition-all"
                    title="Anterior"
                  >
                    <ChevronLeft className="w-4 h-4 text-gray-600" />
                  </button>
                  <span className="text-xs text-gray-700 font-bold px-3">
                    Pág. {currentPage} de {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-2 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50 transition-all"
                    title="Siguiente"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </div>

      {/* Detail Inspection Modal with targeted 5 Parts */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300">
          <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden border border-gray-100 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-indigo-900 to-slate-900 text-white flex justify-between items-start shrink-0">
              <div>
                <span className="px-2 py-0.5 bg-indigo-500/30 text-indigo-200 border border-indigo-400/20 text-[9px] font-black uppercase rounded tracking-widest font-mono">
                  Consulta de Expediente Histórico
                </span>
                <h3 className="text-xl font-bold mt-1.5 flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-400 shrink-0" />
                  {selectedRecord.firstName} {selectedRecord.lastName}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedRecord(null)}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors shrink-0"
                title="Cerrar"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
              
              {/* Part 1: Detalles del Viaje y Cobertura */}
              <div className="p-4 bg-gray-50 hover:bg-gray-100/50 transition-colors rounded-2xl border border-gray-200/50 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" />
                  Detalles del Viaje y Cobertura
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">País de Origen:</span>
                    <span className="font-bold text-gray-850">{selectedRecord.origen || 'No registrado'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">País de Destino:</span>
                    <span className="font-bold text-indigo-700">{selectedRecord.destino || 'No registrado'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Ciudad Destino:</span>
                    <span className="font-bold text-gray-850">{selectedRecord.ciudad || 'No registrado'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha de Inicio:</span>
                    <span className="font-semibold text-gray-850 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-400" />
                      {selectedRecord.startDate}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha de Fin:</span>
                    <span className="font-semibold text-gray-850 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-400" />
                      {selectedRecord.endDate}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Tipo de Cobertura:</span>
                    <span className="font-bold text-gray-850">{selectedRecord.tipoCobertura || 'Básica'}</span>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-gray-400 block font-medium mb-1">Comentarios o Glosas:</span>
                    <p className="p-2.5 bg-white text-gray-700 rounded-lg border border-gray-200/60 text-xs leading-relaxed italic">
                      {selectedRecord.comentarios || 'No se registraron comentarios de cobertura.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Part 2: Plan Asignado */}
              <div className="p-4 bg-gray-50 hover:bg-gray-100/50 transition-colors rounded-2xl border border-gray-200/50 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Plan Asignado
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Tipo de Cliente:</span>
                    <span className="font-bold text-gray-850">{selectedRecord.tipoCliente || 'No especificado'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Cliente:</span>
                    <span className="font-bold text-gray-850 truncate block" title={selectedRecord.cliente}>{selectedRecord.cliente || 'Particular'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Agente Originador:</span>
                    <span className="font-semibold text-indigo-700 truncate block" title={selectedRecord.agente}>{selectedRecord.agente || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha Alta:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.fechaAlta || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Tipo Transacción:</span>
                    <span className="font-bold text-indigo-700 font-mono tracking-wider">{selectedRecord.transactionType || 'NEW'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Tipo de Póliza:</span>
                    <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-black rounded uppercase">
                      {selectedRecord.tipoPoliza}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Primer Nombre:</span>
                    <span className="font-bold text-gray-850">{selectedRecord.firstName}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Apellido(s):</span>
                    <span className="font-bold text-gray-850">{selectedRecord.lastName}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha Nacimiento:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.birthDate}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Edad Calculada:</span>
                    <span className="font-black text-gray-850">{selectedRecord.edad} años</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Género / Sexo:</span>
                    <span className="font-medium text-gray-850">{selectedRecord.gender || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Email:</span>
                    <span className="font-medium text-gray-850 block truncate" title={selectedRecord.email}>{selectedRecord.email}</span>
                  </div>
                </div>
              </div>

              {/* Part 3: Pagos */}
              <div className="p-4 bg-gray-50 hover:bg-gray-100/50 transition-colors rounded-2xl border border-gray-200/50 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
                  <CreditCard className="w-3.5 h-3.5" />
                  Pagos
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Cantidad a Pagar (Premium):</span>
                    <span className="font-black text-gray-900 font-mono">{formatCurrency(selectedRecord.cantidadAPagar, 'MXP')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Cargo Administrativo:</span>
                    <span className="font-semibold text-gray-850 font-mono">{formatCurrency(selectedRecord.cargoAdministrativo, 'MXP')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha Pago Setmex:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.fechaPagoSetmex || 'Pendiente'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Forma de Pago:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.formadePago || 'No especificada'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">No. de Recibo:</span>
                    <span className="font-bold text-slate-800 font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{selectedRecord.noRecibo || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Part 4: Costos */}
              <div className="p-4 bg-gray-50 hover:bg-gray-100/50 transition-colors rounded-2xl border border-gray-200/50 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Costos
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Precio Público Final MN:</span>
                    <span className="font-black text-slate-800 font-mono">{formatCurrency(selectedRecord.precioPublicoFinalMN, 'MXP')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Precio Público Final USD:</span>
                    <span className="font-black text-slate-800 font-mono">{formatCurrency(selectedRecord.precioPublicoFinalUSD, 'USD')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Costo Final USD:</span>
                    <span className="font-black text-indigo-700 font-mono">{formatCurrency(selectedRecord.costoFinalUSD, 'USD')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha de Factura (Invoice):</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.fechaInvoice || 'Sin Factura'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Ref. Invoice:</span>
                    <span className="font-medium text-gray-850">{selectedRecord.invoice || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Part 5: Comisiones */}
              <div className="p-4 bg-indigo-50/45 rounded-2xl border border-indigo-100 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-2">
                  <Percent className="w-3.5 h-3.5" />
                  Comisiones
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
                  <div>
                    <span className="text-gray-400 block font-medium">Comisión USD:</span>
                    <span className="font-extrabold text-indigo-805 font-mono">{formatCurrency(selectedRecord.comisionUSD, 'USD')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Comisión Final MXP:</span>
                    <span className="font-extrabold text-indigo-805 font-mono">{formatCurrency(selectedRecord.comisionFinalMXP, 'MXP')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium text-indigo-700">Comisión Final a Pagar:</span>
                    <span className="font-black text-indigo-700 font-mono text-sm">{formatCurrency(selectedRecord.comisionFinalAPagar, 'MXP')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">¿Comisión Pagada?:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      selectedRecord.comisionPagada === 'Sí' || selectedRecord.comisionPagada === 'Si' || selectedRecord.comisionPagada === 'Paid'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {selectedRecord.comisionPagada || 'Pendiente'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Fecha de Pago Comisión:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.comisionFechaPago || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium">Forma Pago Comisión:</span>
                    <span className="font-semibold text-gray-850">{selectedRecord.comisionFormaPago || '-'}</span>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-gray-400 block font-medium mb-1">Comentario sobre Comisión:</span>
                    <p className="p-2.5 bg-white text-gray-700 rounded-lg border border-indigo-100 text-xs leading-relaxed">
                      {selectedRecord.comisionComentario || 'Ningún análisis de comisión agregado.'}
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Footer with audit actions */}
            <div className="p-6 bg-gray-50 text-right border-t border-gray-100 flex gap-3 justify-between items-center">
              <div>
                {profile?.role === 'super_admin' && (
                  <button
                    onClick={() => handleDeleteRecord(selectedRecord.id!)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 font-bold text-xs rounded-xl hover:bg-red-100 hover:text-red-700 transition-all border border-red-200"
                    title="Eliminar registro permanentemente"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar Registro
                  </button>
                )}
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-6 py-2.5 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 active:scale-95 transition-all shadow-sm"
              >
                Cerrar Consulta
              </button>
            </div>

          </div>
        </div>
      )}

      {/* CSV Import Wizard Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-all duration-300">
          <div className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden border border-gray-100 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-indigo-900 to-slate-900 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-xl">
                  <Upload className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Importador de Archivos Históricos</h3>
                  <p className="text-xs text-indigo-200 mt-0.5">Respete rigurosamente las columnas y tipos de datos del sistema</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  if (importStep !== 'processing') {
                    setIsImportModalOpen(false);
                    setImportStep('upload');
                  }
                }}
                disabled={importStep === 'processing'}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto max-h-[65vh]">
              
              {/* Step 1: Upload File or Paste CSV */}
              {importStep === 'upload' && (
                <div className="space-y-6">
                  {/* Explanation card */}
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex gap-3">
                    <ClipboardList className="w-5 h-5 text-indigo-650 shrink-0 mt-0.5" />
                    <div className="text-xs text-indigo-700 leading-relaxed font-semibold">
                      <p className="font-extrabold text-indigo-900">Requerimientos de la Plantilla:</p>
                      <p className="mt-1">Descargue la plantilla .CSV de importación para garantizar que las columnas coincidan de forma exacta. Hay 36 columnas reconocidas de auditoría que se organizarán en el detalle del expediente.</p>
                      <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-indigo-900 bg-white border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-100 hover:text-indigo-950 font-bold shadow-sm transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar Plantilla Vacía (.CSV)
                      </button>
                    </div>
                  </div>

                  {/* Drag and Drop Zone */}
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 hover:border-indigo-500 rounded-2xl p-10 text-center cursor-pointer bg-gray-50/50 hover:bg-indigo-50/10 transition-colors group"
                  >
                    <input 
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileParse(e.target.files[0]);
                        }
                      }}
                      accept=".csv"
                      className="hidden"
                    />
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="p-4 bg-white rounded-full shadow-sm text-gray-400 group-hover:text-indigo-600 transition-colors group-hover:scale-110 duration-200">
                        <Upload className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-sm">Arrastre y suelte su archivo CSV de Historial</p>
                        <p className="text-xs text-gray-450 mt-1">O haga clic aquí para examinar archivos locales</p>
                      </div>
                    </div>
                  </div>

                  {/* Paste CSV segment */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block">Alternativa: Copiar y pegar CSV en bruto</label>
                    <textarea
                      placeholder="Tipo de Cliente,Cliente,Agente,First Name,LastName,Email..."
                      value={pastedCSV}
                      onChange={e => setPastedCSV(e.target.value)}
                      className="w-full h-28 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-mono text-xs text-gray-700 transition-all resize-none"
                    />
                    <button
                      type="button"
                      disabled={!pastedCSV.trim()}
                      onClick={handlePastedParse}
                      className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl disabled:opacity-50 transition-all border border-indigo-200/50"
                    >
                      Analizar Texto Copiado
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Preview parsed records and validate errors */}
              {importStep === 'preview' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-gray-800">Vista Previa de Datos Analizados</h4>
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200">
                      {parsedRows.length} fila(s) detectada(s)
                    </span>
                  </div>

                  {rowValidationErrors.length > 0 && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 font-semibold space-y-1">
                      <p className="font-bold">Advertencias encontradas durante la validación ({rowValidationErrors.length}):</p>
                      <ul className="list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">
                        {rowValidationErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                      <p className="text-[10px] text-red-500 font-normal pt-1">
                        * Le sugerimos corregir los errores en su CSV original antes de proceder para preservar la integridad del auditoramiento.
                      </p>
                    </div>
                  )}

                  {/* Summary grid structure of columns mapped */}
                  <div className="border border-gray-150 rounded-xl overflow-hidden max-h-60 overflow-y-auto bg-gray-50 text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-gray-100 font-semibold text-gray-600 sticky top-0 bg-white border-b border-gray-200">
                        <tr>
                          <th className="p-2 border-r border-gray-200">Nombre Asegurado</th>
                          <th className="p-2 border-r border-gray-200">Email</th>
                          <th className="p-2 border-r border-gray-200">Póliza</th>
                          <th className="p-2">Destino</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {parsedRows.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="hover:bg-white">
                            <td className="p-2 border-r border-gray-200 font-medium text-gray-800">{row.firstName} {row.lastName}</td>
                            <td className="p-2 border-r border-gray-200 font-mono text-gray-500">{row.email}</td>
                            <td className="p-2 border-r border-gray-200 font-semibold text-indigo-700">{row.tipoPoliza || 'Oro'}</td>
                            <td className="p-2 text-gray-700">{row.destino || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedRows.length > 5 && (
                      <p className="p-2 text-center text-[10px] text-gray-400 bg-gray-100 font-medium border-t border-gray-250">
                        ... y otros {parsedRows.length - 5} registros más listos para ser importados.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => setImportStep('upload')}
                      className="px-5 py-2.5 border border-gray-200 text-gray-600 font-bold text-sm rounded-xl hover:bg-gray-50 transition-all"
                    >
                      Atrás (Cambiar archivo)
                    </button>
                    <button
                      type="button"
                      onClick={handleExecuteImport}
                      className="px-6 py-2.5 bg-indigo-650 hover:bg-indigo-755 text-white font-bold text-sm rounded-xl hover:shadow-lg transition-all flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Procesar Importación Completa
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Progress bar loop committing */}
              {importStep === 'processing' && (
                <div className="py-8 flex flex-col items-center justify-center gap-4 text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-700 mb-2"></div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">Commit de base de datos histórico en proceso</h4>
                    <p className="text-xs text-gray-400 mt-1">Por favor espere. Guardando de forma secuencial segura para prevenir desbordes de recursos.</p>
                  </div>
                  <div className="w-full max-w-sm bg-gray-150 rounded-full h-2.5 dark:bg-gray-200 mt-2">
                    <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-150" style={{ width: `${importProgress}%` }}></div>
                  </div>
                  <span className="text-xs font-mono font-bold text-indigo-700">{importProgress}% completado</span>
                </div>
              )}

              {/* Step 4: Final output status report */}
              {importStep === 'result' && (
                <div className="py-6 flex flex-col items-center justify-center gap-4 text-center">
                  <div className="p-4 bg-emerald-100 text-emerald-600 rounded-full">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-base">Importación completada con éxito</h4>
                    <p className="text-sm text-gray-550 mt-1 font-semibold">Resumen de transacciones:</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 w-72 bg-gray-50 p-4 rounded-2xl border border-gray-150 mt-2">
                    <div className="text-center font-bold">
                      <span className="text-xs uppercase text-slate-400">Éxito</span>
                      <p className="text-2xl text-emerald-600 mt-1 font-mono">{importSummary.success}</p>
                    </div>
                    <div className="text-center font-bold">
                      <span className="text-xs uppercase text-slate-400">Errados</span>
                      <p className="text-2xl text-red-650 mt-1 font-mono">{importSummary.failed}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsImportModalOpen(false);
                      setImportStep('upload');
                    }}
                    className="mt-4 px-6 py-2.5 bg-gray-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition-all"
                  >
                    Finalizar y Ver Registros
                  </button>
                </div>
              )}

            </div>

          </div>
        </div>
      )}

    </div>
  );
}
