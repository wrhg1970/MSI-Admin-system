import React, { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { collection, addDoc, serverTimestamp, query, getDocs, where, orderBy, limit, onSnapshot, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Policy, Client, Country, InsuranceRequest, UserProfile, PlanType } from '../types';
import { differenceInYears, differenceInDays, parseISO, format, isValid } from 'date-fns';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Download, Clock, History, ChevronDown, ChevronUp, Sparkles, Check, Search } from 'lucide-react';
import { COUNTRIES, INITIAL_POLICIES } from '../constants';
import { getPolicyNumber, getNormalizedYYYYMMDD, formatDisplayDate } from '../lib/policyUtils';

interface ImportLog {
  id?: string;
  type: string;
  method: string;
  fileName?: string;
  successCount: number;
  errorCount: number;
  errors: { message: string }[];
  timestamp: any;
  userId: string;
}

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  policies: Policy[];
  countries: Country[];
  clients: Client[];
  insuranceTypes: { name: string; minAge: number; maxAge: number }[];
  exchangeRate: number;
  profile: UserProfile | null;
}

export default function BulkImportModal({ 
  isOpen, 
  onClose, 
  policies, 
  countries, 
  clients, 
  insuranceTypes,
  exchangeRate,
  profile
}: BulkImportModalProps) {
  const [importType, setImportType] = useState<'Individual' | 'Agent/Corporate' | 'Payments'>('Individual');
  const [file, setFile] = useState<File | null>(null);
  const [pastedData, setPastedData] = useState('');
  const [importMethod, setImportMethod] = useState<'file' | 'paste'>('file');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [currentSuccesses, setCurrentSuccesses] = useState(0);
  const [currentErrors, setCurrentErrors] = useState(0);
  const [results, setResults] = useState<{ success: number; errors: { row: any, message: string }[] } | null>(null);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-import preview states
  const [importState, setImportState] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [pendingSuccessfulRows, setPendingSuccessfulRows] = useState<any[]>([]);
  const [pendingErrors, setPendingErrors] = useState<{ row: any; message: string }[]>([]);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'discrepancy' | 'normal'>('all');
  const [previewSearch, setPreviewSearch] = useState('');
  const [selectAllDiscrepancies, setSelectAllDiscrepancies] = useState(false);

  const findCountryCode = (name: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return '';

    // 1. First check if it is already an exact 2-letter country code match
    const cByCode = countries.find(c => c.code.toLowerCase() === n);
    if (cByCode) return cByCode.code;

    // 2. Specific known maps
    if (n.includes('mexico') || n.includes('méxico') || n === 'mx') return 'MX';
    if (n.includes('estados unidos') || n.includes('usa') || n.includes('eeuu') || n === 'us') return 'US';
    if (n.includes('canada') || n.includes('canadá') || n === 'ca') return 'CA';
    if (n.includes('españa') || n.includes('espana') || n === 'es') return 'ES';
    if (n.includes('argentina') || n === 'ar') return 'AR';
    if (n.includes('colombia') || n === 'co') return 'CO';
    if (n.includes('chile') || n === 'cl') return 'CL';
    if (n.includes('francia') || n === 'fr') return 'FR';
    if (n.includes('alemania') || n === 'de') return 'DE';
    if (n.includes('reino unido') || n === 'gb' || n === 'uk') return 'GB';
    if (n.includes('brasil') || n === 'br') return 'BR';
    if (n.includes('peru') || n.includes('perú') || n === 'pe') return 'PE';

    // 3. Exact name match
    const cExactName = countries.find(c => c.name.toLowerCase() === n);
    if (cExactName) return cExactName.code;

    // 4. Fuzzy match ONLY if input length is greater than 2 to avoid false substrings (like 'ca' matching 'belgica')
    if (n.length > 2) {
      const c = countries.find(c => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase()));
      if (c) return c.code;
    }

    return name.toUpperCase();
  };

  // Date parsing/validation helpers
  const parseDateHelper = (d: string) => {
    if (!d) return '';
    return getNormalizedYYYYMMDD(d) || String(d).trim();
  };

  const validateDateHelper = (d: string) => {
    if (!d) return false;
    const ymd = getNormalizedYYYYMMDD(d);
    if (!ymd) return false;
    const date = parseISO(ymd);
    return isValid(date);
  };

  const isPlanTypeDiscrepant = (p1: string, p2: string) => {
    if (!p1 || !p2) return false;
    const norm = (p: string) => {
      let s = p.toLowerCase().trim();
      if (s === 'traveller') s = 'traveler';
      if (s === 'estudiante') s = 'student';
      return s;
    };
    return norm(p1) !== norm(p2);
  };

  const matchPlanNames = (planA: string, planB: string): boolean => {
    const norm = (s: string) => {
      let l = (s || '').trim().toLowerCase();
      if (l === 'traveler' || l === 'traveller' || l === 'viajero' || l === 'viajera') return 'traveler';
      if (l === 'student' || l === 'estudiante') return 'student';
      return l;
    };
    return norm(planA) === norm(planB);
  };

  const getPassengerValLocal = (row: any, key: string) => {
    const cleanKey = (s: string) => {
      let val = s || '';
      val = val.replace(/Ã³/g, 'o').replace(/Ã³/gi, 'o')
               .replace(/Ã¡/gi, 'a')
               .replace(/Ã©/gi, 'e')
               .replace(/Ã/gi, 'i')
               .replace(/Ãº/gi, 'u')
               .replace(/Ã±/gi, 'n')
               .replace(/Ã‘/gi, 'n')
               .replace(/Ã³/gi, 'o');
      return val.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    };

    const normalizedKey = cleanKey(key);
    
    let actualKey = Object.keys(row).find(k => {
      const normK = cleanKey(k);
      return normK === normalizedKey;
    });

    if (!actualKey) {
      actualKey = Object.keys(row).find(k => {
        const normK = cleanKey(k);
        return normK.includes(normalizedKey) || normalizedKey.includes(normK);
      });
    }

    return actualKey ? (row[actualKey] !== undefined && row[actualKey] !== null ? String(row[actualKey]).trim() : '') : '';
  };

  const calculateInsuranceData = (
    row: any,
    index: number,
    planTypeOverride?: string
  ): { insuranceData: any; error?: string } => {
    const birthDate = parseDateHelper(getPassengerValLocal(row, 'Fecha de nacimiento'));
    const requestDate = parseDateHelper(getPassengerValLocal(row, 'Fecha de solicitud')) || format(new Date(), 'yyyy-MM-dd');
    const startDate = parseDateHelper(getPassengerValLocal(row, 'Fecha Salida'));
    const endDate = parseDateHelper(getPassengerValLocal(row, 'Fecha Regreso'));

    if (!validateDateHelper(birthDate) || !validateDateHelper(startDate) || !validateDateHelper(endDate) || (requestDate && !validateDateHelper(requestDate))) {
      return { insuranceData: null, error: `Fila ${index + 2}: Formato de fecha inválido o vacío. Use DD/MM/YYYY o YYYY-MM-DD` };
    }

    const refDate = startDate ? parseISO(startDate) : new Date();
    const age = Math.max(0, differenceInYears(refDate, parseISO(birthDate)));
    const days = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;

    if (days <= 0) {
      return { insuranceData: null, error: `Fila ${index + 2}: La fecha de regreso debe ser posterior a la de salida` };
    }

    const destCode = findCountryCode(getPassengerValLocal(row, 'Pais Destino') || '');
    let targetRegion: 1 | 2 = 2; // Zona 2 (todos los demás países)
    if (destCode && ['US', 'CA', 'WW'].includes(destCode.toUpperCase())) {
      targetRegion = 1; // Zona 1
    }

    const extremeSportsVal = (getPassengerValLocal(row, 'Deportes Extremos') || '').toLowerCase();
    const isExtremeSports = ['si', 'sí', 'yes', 'true', '1'].includes(extremeSportsVal);
    const notes = getPassengerValLocal(row, 'Notas') || '';

    const getPlanForAge = (ageVal: number): string => {
      if (isExtremeSports && ageVal >= 7 && ageVal <= 69) return 'Xtreme';
      if (ageVal >= 0 && ageVal <= 6) return 'U6';
      if (ageVal >= 7 && ageVal <= 25) return 'Student';
      if (ageVal >= 26 && ageVal <= 69) return 'Traveler';
      if (ageVal >= 70) return 'O70';

      if (insuranceTypes && insuranceTypes.length > 0) {
        const matchedType = insuranceTypes.find(t => ageVal >= Number(t.minAge) && ageVal <= Number(t.maxAge));
        if (matchedType) return matchedType.name;
      }
      return 'Traveler';
    };

    const policyName = getPassengerValLocal(row, 'Poliza');
    const csvPlan = getPassengerValLocal(row, 'Plan');
    
    let planType = planTypeOverride || (csvPlan || '').trim() || getPlanForAge(age);
    let planTypeLower = planType.toLowerCase();
    
    if (planTypeLower === 'traveller' || planTypeLower === 'traveler' || planTypeLower === 'viajero' || planTypeLower === 'viajera') {
      planTypeLower = 'traveler';
    } else if (planTypeLower === 'estudiante' || planTypeLower === 'student') {
      planTypeLower = 'student';
    }

    let policy = policies.find(p => 
      p.name.toLowerCase() === policyName.toLowerCase() && 
      matchPlanNames(p.plan, planTypeLower) &&
      p.region === targetRegion
    );

    if (!policy) {
      const matchInInit = INITIAL_POLICIES.find(p =>
        p.name?.toLowerCase() === policyName.toLowerCase() &&
        matchPlanNames(p.plan || '', planTypeLower) &&
        p.region === targetRegion
      );
      if (matchInInit) {
        policy = {
          id: `local-${targetRegion}-${planTypeLower}`,
          name: matchInInit.name || policyName,
          plan: matchInInit.plan || planType,
          region: matchInInit.region || targetRegion,
          deductible: !!matchInInit.deductible,
          costPerDay: matchInInit.costPerDay || 0,
          pricePerDay: matchInInit.pricePerDay || 0,
          pricePerMonth: matchInInit.pricePerMonth || 0,
          discountPercentage: matchInInit.discountPercentage || 0,
          status: 'active'
        } as any;
      }
    }

    if (!policy) {
      policy = policies.find(p => 
        p.name.toLowerCase() === policyName.toLowerCase() && 
        matchPlanNames(p.plan, planTypeLower)
      );
    }

    if (!policy) {
      const derivedPlan = getPlanForAge(age);
      policy = policies.find(p => 
        p.name.toLowerCase() === policyName.toLowerCase() && 
        matchPlanNames(p.plan, derivedPlan) &&
        p.region === targetRegion
      );
      
      if (!policy) {
        policy = policies.find(p => 
          p.name.toLowerCase() === policyName.toLowerCase() && 
          matchPlanNames(p.plan, derivedPlan)
        );
      }
    }

    if (!policy) {
      policy = policies.find(p => p.name.toLowerCase() === policyName.toLowerCase());
    }

    // Always align found policy with INITIAL_POLICIES pricing/cost as the absolute source of truth
    if (policy) {
      let config = INITIAL_POLICIES.find(p =>
        matchPlanNames(p.plan || '', policy.plan || '') &&
        p.name?.toLowerCase() === policy.name?.toLowerCase() &&
        p.region === targetRegion
      );
      if (!config) {
        config = INITIAL_POLICIES.find(p =>
          matchPlanNames(p.plan || '', policy.plan || '') &&
          p.name?.toLowerCase() === policy.name?.toLowerCase()
        );
      }
      if (!config) {
        config = INITIAL_POLICIES.find(p =>
          matchPlanNames(p.plan || '', policy.plan || '') &&
          (p.name?.toLowerCase().includes(policy.name?.toLowerCase()) || policy.name?.toLowerCase().includes(p.name?.toLowerCase() || ''))
        );
      }
      if (config) {
        const targetConfig = INITIAL_POLICIES.find(p =>
          matchPlanNames(p.plan || '', config?.plan || '') &&
          p.name?.toLowerCase() === config?.name?.toLowerCase() &&
          p.region === targetRegion
        ) || config;

        policy = {
          ...policy,
          region: targetRegion,
          costPerDay: targetConfig.costPerDay || policy.costPerDay,
          pricePerDay: targetConfig.pricePerDay || policy.pricePerDay,
          pricePerMonth: targetConfig.pricePerMonth || policy.pricePerMonth,
          discountPercentage: targetConfig.discountPercentage !== undefined ? targetConfig.discountPercentage : policy.discountPercentage
        };
      }
    }

    if (!policy) {
      return { insuranceData: null, error: `Fila ${index + 2}: Póliza "${policyName}" no encontrada` };
    }

    const calculatedMonths = Math.floor(days / 30.4);
    const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
    
    let billedMonths = calculatedMonths;
    let billedDays = additionalDays;
    
    if (additionalDays > 15) {
      billedMonths = calculatedMonths + 1;
      billedDays = 0;
    }

    if (days < 40) {
      billedMonths = 0;
      billedDays = days;
    }
    
    const months = billedMonths;

    const pricePerDay = policy.pricePerDay || 0;
    const pricePerMonth = policy.pricePerMonth || (pricePerDay * 30);
    
    let monthlyRate = pricePerMonth;
    if (billedMonths >= 4) {
      monthlyRate = pricePerMonth * 0.8;
    }
    
    let basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
    basePrice = Math.round(basePrice * 100) / 100;
    
    let totalCost = policy.costPerDay * days;

    let discount = 0;
    let commissionPercent = 0;
    let policyDiscountPercentage = policy.discountPercentage || 0;
    let clientDiscountPercentage = 0;

    let clientId = '';
    let linkedAgentId = '';
    if (importType === 'Agent/Corporate') {
      const clientName = getPassengerValLocal(row, 'Cliente');
      const client = clients.find(c => 
        (c.commercialName?.toLowerCase() === clientName.toLowerCase()) || 
        (c.legalName?.toLowerCase() === clientName.toLowerCase()) ||
        (c.email?.toLowerCase() === clientName.toLowerCase())
      );
      if (!client) {
        return { insuranceData: null, error: `Fila ${index + 2}: Cliente "${clientName}" no encontrado` };
      }
      clientId = client.id!;

      const agentVal = getPassengerValLocal(row, 'Agente que lo solicita') || getPassengerValLocal(row, 'Agente');
      if (agentVal) {
        const lowerAgent = agentVal.toLowerCase().trim();
        const foundAgent = client.linkedAgents?.find(la => 
          la.email?.toLowerCase().trim() === lowerAgent ||
          la.name?.toLowerCase().trim() === lowerAgent ||
          la.id?.toLowerCase().trim() === lowerAgent
        );
        if (foundAgent) {
          linkedAgentId = foundAgent.email;
        } else {
          return { insuranceData: null, error: `Fila ${index + 2}: Agente "${agentVal}" no encontrado en los agentes vinculados del cliente "${clientName}"` };
        }
      } else if (client.linkedAgents && client.linkedAgents.length > 0) {
        return { insuranceData: null, error: `Fila ${index + 2}: Debe proporcionar el 'Agente que lo solicita' para el cliente "${clientName}"` };
      }
    }

    const client = clientId ? clients.find(c => c.id === clientId) : null;
    if (client) {
      clientDiscountPercentage = client.discountPercentage || 0;
      commissionPercent = client.commission || 0;

      if (linkedAgentId) {
        const la = client.linkedAgents?.find(a => a.email === linkedAgentId);
        if (la) {
          if (la.discountPercentage !== undefined) {
            clientDiscountPercentage = la.discountPercentage;
          }
          commissionPercent = la.commission;
        }
      }
    } else if (profile?.role === 'agent') {
      commissionPercent = profile.commission || 0;
    }

    if (clientDiscountPercentage > 0) {
      discount = Math.round((basePrice * (clientDiscountPercentage / 100)) * 100) / 100;
    }

    const totalFinal = Math.round((basePrice - discount) * 100) / 100;
    const agentCommission = Math.round((totalFinal * (commissionPercent / 100)) * 100) / 100;

    let clientTypeRaw = importType === 'Individual' ? 'Individual' : getPassengerValLocal(row, 'Tipo de cliente');
    let clientType = clientTypeRaw;
    if (clientTypeRaw === 'Agente') clientType = 'Agent';
    if (clientTypeRaw === 'Corporativo') clientType = 'Corporate';
    if (clientTypeRaw === 'Universidad') clientType = 'University';

    const originCountryRaw = getPassengerValLocal(row, 'Pais Origen') || '';
    const destCountryRaw = getPassengerValLocal(row, 'Pais Destino') || '';

    const insurance: any = {
      clientType: clientType,
      clientId: clientId || '',
      linkedAgentId: linkedAgentId || '',
      IDseg: (getPassengerValLocal(row, 'IDSeg') || getPassengerValLocal(row, 'IDseg') || '').trim(),
      firstName: getPassengerValLocal(row, 'Nombre') || '',
      lastName: getPassengerValLocal(row, 'Apellido') || '',
      gender: (getPassengerValLocal(row, 'Sexo') === 'Mujer' || getPassengerValLocal(row, 'Sexo') === 'F' ? 'F' : 'M') as 'M' | 'F',
      email: getPassengerValLocal(row, 'Correo electronico') || '',
      birthDate: birthDate,
      age,
      originCountry: findCountryCode(originCountryRaw),
      destinationCountry: findCountryCode(destCountryRaw),
      city: getPassengerValLocal(row, 'Ciudad') || '',
      policyId: policy.id,
      policyName: policy.name,
      policyNumber: getPolicyNumber(policy, age),
      plan: planType,
      actionType: (getPassengerValLocal(row, 'Tipo de Accion') || getPassengerValLocal(row, 'Tipo de Acción') || 'NEW').trim().toUpperCase(),
      isExtremeSports,
      notes,
      requestDate,
      startDate,
      endDate,
      days,
      totalPrice: basePrice,
      totalCost: totalCost,
      discount,
      adjustment: 0,
      agentCommission,
      totalFinal,
      totalPaid: 0,
      status: 'pending',
      commissionStatus: agentCommission > 0 ? 'confirmed' : 'pending',
      createdAt: serverTimestamp(),
      imported: true
    };

    if (profile?.role === 'agent' && profile.uid) {
      insurance.agentId = profile.uid;
    }

    return { insuranceData: insurance };
  };

  useEffect(() => {
    if (!isOpen || !profile) return;
    if (!isOpen || !profile) return;

    const q = query(
      collection(db, 'bulkImportLogs'),
      where('userId', '==', profile.uid),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setImportLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportLog)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bulkImportLogs');
    });

    return () => unsubscribe();
  }, [isOpen, profile]);

  if (!isOpen) return null;

  const downloadTemplate = () => {
    let headers = [];
    if (importType === 'Individual') {
      headers = [
        'Tipo de cliente', 'Nombre', 'Apellido', 'Sexo', 'Correo electronico', 
        'Fecha de nacimiento', 'Fecha de solicitud', 'Tipo de Acción', 'Pais Origen', 
        'Pais Destino', 'Ciudad', 'Fecha Salida', 'Fecha Regreso', 'Plan', 'Poliza', 'Deportes Extremos', 'Notas'
      ];
    } else if (importType === 'Agent/Corporate') {
      headers = [
        'Tipo de cliente', 'Cliente', 'Agente que lo solicita', 'Nombre', 'Apellido', 'Sexo', 'Correo electronico', 
        'Fecha de nacimiento', 'Fecha de solicitud', 'Tipo de Acción', 'Pais Origen',
        'Pais Destino', 'Ciudad', 'Fecha Salida', 'Fecha Regreso', 'Plan', 'Poliza', 'Deportes Extremos', 'Notas'
      ];
    } else {
      // Payments
      headers = [
        'IDSeg', 'Email Cliente', 'Nombre Cliente', 'Apellido Cliente', 'Poliza o Plan', 'Monto USD', 'Monto MXP', 'Fecha (YYYY-MM-DD)', 'Metodo de Pago', 'Tipo de Pago', 'Fecha de solicitud', 'Referencia', 'Recibo', 'Notas'
      ];
    }
    
    const csvContent = headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `plantilla_importacion_${importType.toLowerCase().replace('/', '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const downloadErrorsFromList = (errorsList: { row: any, message: string }[]) => {
    if (errorsList.length === 0) return;

    const errorRows = errorsList.map(err => ({
      ...err.row,
      'Error Message': err.message
    }));

    const csv = Papa.unparse(errorRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `errores_importacion_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processImport = async () => {
    if (importMethod === 'file' && !file) return;
    if (importMethod === 'paste' && !pastedData.trim()) return;
    
    setImporting(true);
    setResults(null);
    setImportProgress(0);
    setTotalRows(0);
    setCurrentSuccesses(0);
    setCurrentErrors(0);

    // Concurrency execution pool to optimize database insertions
    const runWithConcurrency = async <T extends unknown>(
      items: (() => Promise<T>)[],
      concurrency: number,
      onProgress: (index: number, success: boolean, err?: any) => void
    ) => {
      const resultsList: { success: boolean; error?: any; value?: T }[] = [];
      let index = 0;
      
      const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
          const currentIndex = index++;
          try {
            const val = await items[currentIndex]();
            resultsList[currentIndex] = { success: true, value: val };
            onProgress(currentIndex, true);
          } catch (err) {
            resultsList[currentIndex] = { success: false, error: err };
            onProgress(currentIndex, false, err);
          }
        }
      });
      
      await Promise.all(workers);
      return resultsList;
    };

    const parseOptions = {
      header: true,
      skipEmptyLines: true,
      complete: async (results: any) => {
        const rows = results.data as any[];
        setTotalRows(rows.length);
        const errors: { row: any, message: string }[] = [];

        // Fetch existing insurances once for offline-safe validation and duplicate resolution
        let existingInsurances: any[] = [];
        try {
          const snap = await getDocs(collection(db, 'insurances'));
          existingInsurances = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (err) {
          console.error("Error fetching existing insurances for duplicate check:", err);
        }

        // Sequential IDseg auto-assignment setup
        let nextNum = 10001;
        let prefix = 'IDseg';
        let padLength = 5;

        try {
          const counterDocRef = doc(db, 'settings', 'counters');
          const counterDocSnap = await getDoc(counterDocRef);
          
          if (counterDocSnap.exists() && counterDocSnap.data().IDsegCounter !== undefined) {
            nextNum = Number(counterDocSnap.data().IDsegCounter) + 1;
            if (counterDocSnap.data().IDsegPrefix) {
              prefix = counterDocSnap.data().IDsegPrefix;
            }
            if (counterDocSnap.data().IDsegPadLength) {
              padLength = Number(counterDocSnap.data().IDsegPadLength);
            }
          } else {
            // Self-seed from existing insurances
            let maxNum = 0;
            existingInsurances.forEach(ins => {
              if (ins.IDseg) {
                const match = ins.IDseg.match(/^([a-zA-Z_\-]+)?(\d+)$/);
                if (match) {
                  const pfx = match[1] || '';
                  const numStr = match[2];
                  const num = parseInt(numStr, 10);
                  if (num > maxNum) {
                    maxNum = num;
                    prefix = pfx || 'IDseg';
                    padLength = numStr.length;
                  }
                } else {
                  const digitMatch = ins.IDseg.match(/\d+/);
                  if (digitMatch) {
                    const num = parseInt(digitMatch[0], 10);
                    if (num > maxNum) {
                      maxNum = num;
                    }
                  }
                }
              }
            });

            if (maxNum > 0) {
              nextNum = maxNum + 1;
            } else {
              nextNum = 10001; // Default starting number
            }

            // Save the counter to settings/counters for fast subsequent retrievals
            await setDoc(counterDocRef, {
              IDsegCounter: nextNum - 1,
              IDsegPrefix: prefix,
              IDsegPadLength: padLength
            }, { merge: true });
          }
        } catch (err) {
          console.error("Error fetching/seeding IDseg counter for import:", err);
        }

        let currentIDsegCounter = nextNum;

        const createKey = (ins: any) => {
          const first = (ins.firstName || '').trim().toLowerCase();
          const last = (ins.lastName || '').trim().toLowerCase();
          const dob = (ins.birthDate || '').trim();
          const start = (ins.startDate || '').trim();
          const end = (ins.endDate || '').trim();
          const dest = (ins.destinationCountry || '').trim().toLowerCase();
          const op = (ins.actionType || 'NEW').trim().toUpperCase();
          const plan = (ins.plan || '').trim().toLowerCase();
          const polId = (ins.policyId || '').trim().toLowerCase();
          const polName = (ins.policyName || '').trim().toLowerCase();
          return `${first}|${last}|${dob}|${start}|${end}|${dest}|${op}|${plan}|${polId}|${polName}`;
        };
        const existingKeys = new Set(
          existingInsurances.map(createKey)
        );

        // Date parsing/validation helpers
        const parseDateHelper = (d: string) => {
          if (!d) return '';
          const trimmed = d.trim();
          if (trimmed.includes('/')) {
            const parts = trimmed.split('/');
            if (parts.length === 3) {
              if (parts[0].length === 4) {
                // Assume YYYY/MM/DD
                const year = parts[0];
                const month = parts[1].padStart(2, '0');
                const day = parts[2].padStart(2, '0');
                return `${year}-${month}-${day}`;
              } else {
                // Assume DD/MM/YYYY
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                return `${year}-${month}-${day}`;
              }
            }
          }
          return trimmed;
        };

        const validateDateHelper = (d: string) => {
          if (!d) return false;
          const date = new Date(d);
          return isValid(date);
        };

        // In-memory update accumulator to cleanly combine multiple sub-payments for the same insurance request
        const accumulatedInsuranceUpdates: Record<string, {
          totalPaid: number;
          status: string;
          commissionStatus?: string;
          providerPaymentStatus?: string;
        }> = {};

        const successfulRows: any[] = [];

        // Quick synchronous validation and scoring sweep across all rows to match accurately upfront
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          
          // Clean encoding anomalies
          Object.keys(row).forEach(key => {
            if (typeof row[key] === 'string') {
              let val = row[key];
              val = val.replace(/Turqu\uFFFD/gi, 'Turquí');
              val = val.replace(/Rep\uFFFDblica/gi, 'República');
              val = val.replace(/Espa\uFFFD/gi, 'Españ');
              val = val.replace(/Ba\uFFFDuelos/gi, 'Bañuelos');
              val = val.replace(/Uma\uFFFD/gi, 'Umañ');
              val = val.replace(/Casta\uFFFD/gi, 'Castañ');
              val = val.replace(/Brise\uFFFD/gi, 'Briseñ');
              val = val.replace(/Trevi\uFFFD/gi, 'Treviñ');
              val = val.replace(/Pe\uFFFD/gi, 'Peñ');
              val = val.replace(/\uFFFD/g, 'ñ');
              row[key] = val.trim();
            }
          });

          const getVal = (row: any, key: string) => {
            const cleanKey = (s: string) => {
              let val = s || '';
              val = val.replace(/Ã³/g, 'o').replace(/Ã³/gi, 'o')
                       .replace(/Ã¡/gi, 'a')
                       .replace(/Ã©/gi, 'e')
                       .replace(/Ã/gi, 'i')
                       .replace(/Ãº/gi, 'u')
                       .replace(/Ã±/gi, 'n')
                       .replace(/Ã‘/gi, 'n')
                       .replace(/Ã³/gi, 'o');
              return val.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            };

            const normalizedKey = cleanKey(key);
            
            let actualKey = Object.keys(row).find(k => {
              const normK = cleanKey(k);
              return normK === normalizedKey;
            });

            if (!actualKey) {
              actualKey = Object.keys(row).find(k => {
                const normK = cleanKey(k);
                return normK.includes(normalizedKey) || normalizedKey.includes(normK);
              });
            }

            return actualKey ? (row[actualKey] !== undefined && row[actualKey] !== null ? String(row[actualKey]).trim() : '') : '';
          };

          if (importType !== 'Payments') {
            const rowIDseg = `${prefix}${String(currentIDsegCounter).padStart(padLength, '0')}`;
            currentIDsegCounter++;
            row['IDSeg'] = rowIDseg;
            row['IDseg'] = rowIDseg;
          }

          const parseCurrencyHelper = (val: string) => {
            if (!val) return 0;
            const cleaned = val.replace(/[$,\r\n\t]/g, '').replace(/\s+/g, '').replace(/,/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
          };

          let requiredFields = [];
          if (importType === 'Individual') {
            requiredFields = ['Nombre', 'Apellido', 'Correo electronico', 'Fecha de nacimiento', 'Pais Origen', 'Pais Destino', 'Fecha Salida', 'Fecha Regreso', 'Plan', 'Poliza'];
          } else if (importType === 'Agent/Corporate') {
            requiredFields = ['Tipo de cliente', 'Cliente', 'Nombre', 'Apellido', 'Correo electronico', 'Fecha de nacimiento', 'Pais Origen', 'Pais Destino', 'Fecha Salida', 'Fecha Regreso', 'Plan', 'Poliza'];
          } else {
            requiredFields = ['IDSeg', 'Fecha (YYYY-MM-DD)', 'Metodo de Pago'];
          }

          const missing = requiredFields.filter(f => !getVal(row, f));
          if (missing.length > 0) {
            errors.push({ row, message: `Fila ${i + 2}: Faltan campos obligatorios (${missing.join(', ')})` });
            continue;
          }

          if (importType === 'Payments') {
            const idSeg = (getVal(row, 'IDSeg') || getVal(row, 'IDseg') || '').trim();
            const email = (getVal(row, 'Email Cliente') || getVal(row, 'Email') || getVal(row, 'Correo electronico') || '').toLowerCase().trim();
            const policyOrPlan = (getVal(row, 'Poliza o Plan') || getVal(row, 'Poliza') || getVal(row, 'Plan') || '').toLowerCase().trim();
            const firstName = (getVal(row, 'Nombre Cliente') || getVal(row, 'Nombre') || '').toLowerCase().trim();
            const lastName = (getVal(row, 'Apellido Cliente') || getVal(row, 'Apellido') || '').toLowerCase().trim();
            const amountUSD = parseCurrencyHelper(getVal(row, 'Monto USD') || getVal(row, 'Monto') || getVal(row, 'USD') || '0');
            const amountMXP = parseCurrencyHelper(getVal(row, 'Monto MXP') || getVal(row, 'MXP') || '0');
            const dateStr = getVal(row, 'Fecha (YYYY-MM-DD)') || getVal(row, 'Fecha') || '';
            const method = getVal(row, 'Metodo de Pago') || getVal(row, 'Metodo') || 'Deposito MXP';
            const rawType = (getVal(row, 'Tipo de Pago') || getVal(row, 'Tipo') || '').toLowerCase().trim();
            
            if (!idSeg) {
              errors.push({ row, message: `Fila ${i + 2}: Debe proporcionar el 'IDSeg' para identificar al asegurado` });
              continue;
            }

            let type: 'client_payment' | 'provider_payment' | 'agent_commission' = 'client_payment';
            if (rawType.includes('proveedor')) {
              type = 'provider_payment';
            } else if (rawType.includes('comision') || rawType.includes('agente')) {
              type = 'agent_commission';
            } else {
              type = 'client_payment';
            }
            
            const dateToParse = parseDateHelper(dateStr);
            const parsedDate = dateToParse ? new Date(dateToParse) : new Date();

            if (!isValid(parsedDate)) {
              errors.push({ row, message: `Fila ${i + 2}: Fecha de pago inválida (${dateStr || 'Vacio'})` });
              continue;
            }

            const notes = getVal(row, 'Notas') || '';
            const refData = getVal(row, 'Referencia') || '';
            const receipt = getVal(row, 'Recibo') || '';
            const reqDateStr = getVal(row, 'Fecha de solicitud') || getVal(row, 'Solicitud') || '';
            const reqDateParsed = reqDateStr ? parseDateHelper(reqDateStr) : '';

            const normalizeName = (name: string) => {
              if (!name) return '';
              return name
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9 ]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            };

            const matchesNames = (ins: any, fName: string, lName: string) => {
              const insFullName = normalizeName(`${ins.firstName || ''} ${ins.lastName || ''}`);
              const rowFullName = normalizeName(`${fName} ${lName}`);

              if (insFullName === rowFullName) return true;

              if (insFullName && rowFullName) {
                if (insFullName.includes(rowFullName) || rowFullName.includes(insFullName)) {
                  return true;
                }
              }

              const insFirst = normalizeName(ins.firstName || '');
              const insLast = normalizeName(ins.lastName || '');
              const rowFirst = normalizeName(fName);
              const rowLast = normalizeName(lName);

              if (insFirst && rowFirst && insLast && rowLast) {
                if ((insFirst.includes(rowFirst) || rowFirst.includes(insFirst)) && 
                    (insLast.includes(rowLast) || rowLast.includes(insLast))) {
                  return true;
                }
              }

              // Multi-word exact overlaps for complex Latino last names
              const insWords = insFullName.split(' ').filter(w => w.length > 2);
              const rowWords = rowFullName.split(' ').filter(w => w.length > 2);
              if (insWords.length > 0 && rowWords.length > 0) {
                const intersection = insWords.filter(w => rowWords.includes(w));
                if (intersection.length >= 2) return true;
              }

              return false;
            };

            const isPolicyPlanMatch = (ins: any) => {
              const insPolicyName = (ins.policyName || '').trim().toLowerCase();
              const insPolicyId = (ins.policyId || '').trim().toLowerCase();
              const insPlan = (ins.plan || '').trim().toLowerCase();
              const cleanPolicyOrPlan = policyOrPlan.trim().toLowerCase();

              if (!cleanPolicyOrPlan) return true;

              return (
                insPolicyName === cleanPolicyOrPlan || 
                insPolicyId === cleanPolicyOrPlan || 
                insPlan === cleanPolicyOrPlan ||
                (cleanPolicyOrPlan.length > 2 && (
                  insPolicyName.includes(cleanPolicyOrPlan) || 
                  insPlan.includes(cleanPolicyOrPlan) ||
                  cleanPolicyOrPlan.includes(insPolicyName) ||
                  cleanPolicyOrPlan.includes(insPlan)
                ))
              );
            };

            const isRequestDateMatch = (ins: any) => {
              if (!reqDateParsed) return true;
              const insReqDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
              return insReqDate === reqDateParsed;
            };

            // Candidates are matched strictly and exclusively by IDSeg
            let candidates: any[] = [];
            if (idSeg) {
              candidates = existingInsurances.filter(ins => {
                const insIDseg = (ins.IDseg || ins.IDSeg || '').trim().toLowerCase();
                return insIDseg && insIDseg === idSeg.toLowerCase();
              });
            }

            let insurance = null;

            if (candidates.length > 0) {
              const scoredCandidates = candidates.map(ins => {
                let score = 0;
                const insEmail = (ins.email || '').toLowerCase().trim();
                const insIDseg = (ins.IDseg || ins.IDSeg || '').trim().toLowerCase();

                if (idSeg && insIDseg === idSeg.toLowerCase()) {
                  score += 150;
                }
                
                if (email && insEmail === email) {
                  score += 50;
                }
                
                if (firstName && lastName && matchesNames(ins, firstName, lastName)) {
                  score += 50;
                }
                
                if (policyOrPlan && isPolicyPlanMatch(ins)) {
                  score += 30;
                  const cleanPolicyOrPlan = policyOrPlan.trim().toLowerCase();
                  if (cleanPolicyOrPlan === (ins.policyId || '').toLowerCase() || cleanPolicyOrPlan === (ins.policyName || '').toLowerCase()) {
                    score += 15;
                  }
                }
                
                if (isRequestDateMatch(ins)) {
                  score += 20;
                }
                
                // Prioritize Unpaid policies (extremely important to apply new payment tasks correctly)
                if (ins.status === 'pending') {
                  score += 45;
                } else if (ins.status === 'partially_paid') {
                  score += 40;
                } else if (ins.status === 'paid') {
                  score -= 10;
                } else if (ins.status === 'cancelled') {
                  score -= 40;
                }

                // Balance matching weight
                const remainingDue = (ins.totalFinal || ins.totalPrice || 0) - (ins.totalPaid || 0);
                if (amountUSD > 0 && Math.abs(amountUSD - remainingDue) < 0.05) {
                  score += 25;
                } else if (amountUSD > 0 && Math.abs(amountUSD - (ins.totalFinal || ins.totalPrice || 0)) < 0.05) {
                  score += 15;
                }

                return { ins, score };
              });

              scoredCandidates.sort((a, b) => b.score - a.score);
              if (scoredCandidates[0].score >= 30) {
                insurance = scoredCandidates[0].ins;
              }
            }

            if (!insurance) {
              errors.push({ row, message: `Fila ${i + 2}: No se encontró seguro para el IDSeg "${idSeg}"` });
              continue;
            }

            let finalAmountUSD = amountUSD;
            let finalAmountMXP = amountMXP;
            let finalCurrency = 'USD';
            let finalExchangeRate = exchangeRate || 17.5;

            if (finalAmountUSD > 0 && finalAmountMXP > 0) {
              finalCurrency = 'MXP';
              finalExchangeRate = finalAmountMXP / finalAmountUSD;
            } else if (finalAmountUSD > 0) {
              finalCurrency = 'USD';
              finalAmountMXP = Math.round(finalAmountUSD * finalExchangeRate * 100) / 100;
            } else if (finalAmountMXP > 0) {
              finalCurrency = 'MXP';
              finalAmountUSD = Math.round((finalAmountMXP / finalExchangeRate) * 100) / 100;
            }

            const payment: any = {
              insuranceId: insurance.id,
              amount: finalAmountUSD,
              amountMXP: finalAmountMXP,
              currency: finalCurrency,
              exchangeRate: finalExchangeRate,
              type: type,
              paymentMethod: method,
              status: 'completed',
              date: parsedDate,
              notes: notes,
              receiptUrl: refData,
              receiptNumber: receipt,
              createdAt: serverTimestamp()
            };

            const insuranceId = insurance.id;
            if (!accumulatedInsuranceUpdates[insuranceId]) {
              accumulatedInsuranceUpdates[insuranceId] = {
                totalPaid: insurance.totalPaid || 0,
                status: insurance.status,
                commissionStatus: insurance.commissionStatus || 'pending',
                providerPaymentStatus: insurance.providerPaymentStatus || 'pending'
              };
            }

            const accUpdate = accumulatedInsuranceUpdates[insuranceId];
            const currentPaid = accUpdate.totalPaid;
            const newPaid = currentPaid + (type === 'client_payment' ? finalAmountUSD : 0);
            const totalFinal = insurance.totalFinal || insurance.totalPrice || 0;
            
            let newStatus = accUpdate.status;
            if ((totalFinal - newPaid) < 2) newStatus = 'paid';
            else if (newPaid > 0) newStatus = 'partially_paid';

            accUpdate.totalPaid = newPaid;
            accUpdate.status = newStatus;

            if (type === 'agent_commission') {
              accUpdate.commissionStatus = 'paid';
            }
            if (type === 'provider_payment') {
              accUpdate.providerPaymentStatus = 'paid';
            }

            // Sync modification back to existingInsurances instantly so subsequent rows match accurately
            insurance.totalPaid = newPaid;
            insurance.status = newStatus;
            insurance.commissionStatus = accUpdate.commissionStatus;
            insurance.providerPaymentStatus = accUpdate.providerPaymentStatus;

            successfulRows.push({
              rowIndex: i,
              row,
              paymentData: payment,
              insuranceId,
              getUpdateData: () => {
                const finalAcc = accumulatedInsuranceUpdates[insuranceId];
                const res: any = {
                  totalPaid: finalAcc.totalPaid,
                  status: finalAcc.status
                };
                if (finalAcc.commissionStatus === 'paid') {
                  res.commissionStatus = 'paid';
                }
                if (finalAcc.providerPaymentStatus === 'paid') {
                  res.providerPaymentStatus = 'paid';
                }
                return res;
              }
            });
            continue;
          }

          // Individual or Agent/Corporate imports
          let clientId = '';
          let linkedAgentId = '';
          if (importType === 'Agent/Corporate') {
            const clientName = getVal(row, 'Cliente');
            const client = clients.find(c => 
              (c.commercialName?.toLowerCase() === clientName.toLowerCase()) || 
              (c.legalName?.toLowerCase() === clientName.toLowerCase()) ||
              (c.email?.toLowerCase() === clientName.toLowerCase())
            );
            if (!client) {
              errors.push({ row, message: `Fila ${i + 2}: Cliente "${clientName}" no encontrado` });
              continue;
            }
            clientId = client.id!;

            // Optional Sub-Agent parsing
            const agentVal = getVal(row, 'Agente que lo solicita') || getVal(row, 'Agente');
            if (agentVal) {
              const lowerAgent = agentVal.toLowerCase().trim();
              const foundAgent = client.linkedAgents?.find(la => 
                la.email?.toLowerCase().trim() === lowerAgent ||
                la.name?.toLowerCase().trim() === lowerAgent ||
                la.id?.toLowerCase().trim() === lowerAgent
              );
              if (foundAgent) {
                linkedAgentId = foundAgent.email;
              } else {
                errors.push({ row, message: `Fila ${i + 2}: Agente "${agentVal}" no encontrado en los agentes vinculados del cliente "${clientName}"` });
                continue;
              }
            } else if (client.linkedAgents && client.linkedAgents.length > 0) {
              errors.push({ row, message: `Fila ${i + 2}: Debe proporcionar el 'Agente que lo solicita' para el cliente "${clientName}"` });
              continue;
            }
          }

          const birthDate = parseDateHelper(getVal(row, 'Fecha de nacimiento'));
          const requestDate = parseDateHelper(getVal(row, 'Fecha de solicitud')) || format(new Date(), 'yyyy-MM-dd');
          const startDate = parseDateHelper(getVal(row, 'Fecha Salida'));
          const endDate = parseDateHelper(getVal(row, 'Fecha Regreso'));

          if (!validateDateHelper(birthDate) || !validateDateHelper(startDate) || !validateDateHelper(endDate) || (requestDate && !validateDateHelper(requestDate))) {
            errors.push({ row, message: `Fila ${i + 2}: Formato de fecha inválido. Use DD/MM/YYYY o YYYY-MM-DD` });
            continue;
          }

          const refDate = startDate ? parseISO(startDate) : new Date();
          const age = Math.max(0, differenceInYears(refDate, parseISO(birthDate)));
          const days = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;

          const destCode = findCountryCode(getVal(row, 'Pais Destino') || '');
          let targetRegion: 1 | 2 = 2; // Zona 2 (todos los demás países)
          if (destCode && ['US', 'CA', 'WW'].includes(destCode.toUpperCase())) {
            targetRegion = 1; // Zona 1
          }

          const extremeSportsVal = (getVal(row, 'Deportes Extremos') || '').toLowerCase();
          const isExtremeSports = ['si', 'sí', 'yes', 'true', '1'].includes(extremeSportsVal);
          const notes = getVal(row, 'Notas') || '';

          const getPlanForAge = (ageVal: number): string => {
            if (isExtremeSports && ageVal >= 7 && ageVal <= 69) return 'Xtreme';
            if (ageVal >= 0 && ageVal <= 6) return 'U6';
            if (ageVal >= 7 && ageVal <= 25) return 'Student';
            if (ageVal >= 26 && ageVal <= 69) return 'Traveler';
            if (ageVal >= 70) return 'O70';

            if (insuranceTypes && insuranceTypes.length > 0) {
              const matchedType = insuranceTypes.find(t => ageVal >= Number(t.minAge) && ageVal <= Number(t.maxAge));
              if (matchedType) return matchedType.name;
            }
            return 'Traveler';
          };

          const policyName = getVal(row, 'Poliza');
          const csvPlan = getVal(row, 'Plan');
          
          let planTypeRaw = (csvPlan || '').trim();
          let planType: string = planTypeRaw || getPlanForAge(age);
          let planTypeLower = planType.toLowerCase();
          
          if (planTypeLower === 'traveller' || planTypeLower === 'traveler' || planTypeLower === 'viajero' || planTypeLower === 'viajera') {
            planTypeLower = 'traveler';
          } else if (planTypeLower === 'estudiante' || planTypeLower === 'student') {
            planTypeLower = 'student';
          }

          let policy = policies.find(p => 
            p.name.toLowerCase() === policyName.toLowerCase() && 
            matchPlanNames(p.plan, planTypeLower) &&
            p.region === targetRegion
          );

          if (!policy) {
            const matchInInit = INITIAL_POLICIES.find(p =>
              p.name?.toLowerCase() === policyName.toLowerCase() &&
              matchPlanNames(p.plan || '', planTypeLower) &&
              p.region === targetRegion
            );
            if (matchInInit) {
              policy = {
                id: `local-${targetRegion}-${planTypeLower}`,
                name: matchInInit.name || policyName,
                plan: matchInInit.plan || planType,
                region: matchInInit.region || targetRegion,
                deductible: !!matchInInit.deductible,
                costPerDay: matchInInit.costPerDay || 0,
                pricePerDay: matchInInit.pricePerDay || 0,
                pricePerMonth: matchInInit.pricePerMonth || 0,
                discountPercentage: matchInInit.discountPercentage || 0,
                status: 'active'
              } as any;
            }
          }

          if (!policy) {
            policy = policies.find(p => 
              p.name.toLowerCase() === policyName.toLowerCase() && 
              matchPlanNames(p.plan, planTypeLower)
            );
          }

          // Fallback inteligente correlacionado con la edad en lugar de tomar secuencialmente la primera póliza que encuentre
          if (!policy) {
            const derivedPlan = getPlanForAge(age);
            policy = policies.find(p => 
              p.name.toLowerCase() === policyName.toLowerCase() && 
              matchPlanNames(p.plan, derivedPlan) &&
              p.region === targetRegion
            );
            
            if (!policy) {
              policy = policies.find(p => 
                p.name.toLowerCase() === policyName.toLowerCase() && 
                matchPlanNames(p.plan, derivedPlan)
              );
            }
          }

          // Último recurso de fallback: primera póliza con el mismo nombre
          if (!policy) {
            policy = policies.find(p => p.name.toLowerCase() === policyName.toLowerCase());
          }

          // Always align found policy with INITIAL_POLICIES pricing/cost as the absolute source of truth
          if (policy) {
            let config = INITIAL_POLICIES.find(p =>
              matchPlanNames(p.plan || '', policy.plan || '') &&
              p.name?.toLowerCase() === policy.name?.toLowerCase() &&
              p.region === targetRegion
            );
            if (!config) {
              config = INITIAL_POLICIES.find(p =>
                matchPlanNames(p.plan || '', policy.plan || '') &&
                p.name?.toLowerCase() === policy.name?.toLowerCase()
              );
            }
            if (!config) {
              config = INITIAL_POLICIES.find(p =>
                matchPlanNames(p.plan || '', policy.plan || '') &&
                (p.name?.toLowerCase().includes(policy.name?.toLowerCase()) || policy.name?.toLowerCase().includes(p.name?.toLowerCase() || ''))
              );
            }
            if (config) {
              const targetConfig = INITIAL_POLICIES.find(p =>
                matchPlanNames(p.plan || '', config?.plan || '') &&
                p.name?.toLowerCase() === config?.name?.toLowerCase() &&
                p.region === targetRegion
              ) || config;

              policy = {
                ...policy,
                region: targetRegion,
                costPerDay: targetConfig.costPerDay || policy.costPerDay,
                pricePerDay: targetConfig.pricePerDay || policy.pricePerDay,
                pricePerMonth: targetConfig.pricePerMonth || policy.pricePerMonth,
                discountPercentage: targetConfig.discountPercentage !== undefined ? targetConfig.discountPercentage : policy.discountPercentage
              };
            }
          }

          if (!policy) {
            errors.push({ row, message: `Fila ${i + 2}: Póliza "${policyName}" no encontrada` });
            continue;
          }

          if (days <= 0) {
            errors.push({ row, message: `Fila ${i + 2}: La fecha de regreso debe ser posterior a la de salida` });
            continue;
          }

          const calculatedMonths = Math.floor(days / 30.4);
          const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
          
          let billedMonths = calculatedMonths;
          let billedDays = additionalDays;
          
          if (additionalDays > 15) {
            billedMonths = calculatedMonths + 1;
            billedDays = 0;
          }

          if (days < 40) {
            billedMonths = 0;
            billedDays = days;
          }
          
          const months = billedMonths;

          const pricePerDay = policy.pricePerDay || 0;
          const pricePerMonth = policy.pricePerMonth || (pricePerDay * 30);
          
          let monthlyRate = pricePerMonth;
          if (billedMonths >= 4) {
            monthlyRate = pricePerMonth * 0.8;
          }
          
          let basePrice = (billedMonths * monthlyRate) + (billedDays * pricePerDay);
          basePrice = Math.round(basePrice * 100) / 100;
          
          let totalCost = policy.costPerDay * days;

          let discount = 0;
          let commissionPercent = 0;
          let policyDiscountPercentage = policy.discountPercentage || 0;
          let clientDiscountPercentage = 0;

          const client = clientId ? clients.find(c => c.id === clientId) : null;
          if (client) {
            clientDiscountPercentage = client.discountPercentage || 0;
            commissionPercent = client.commission || 0;

            if (linkedAgentId) {
              const la = client.linkedAgents?.find(a => a.email === linkedAgentId);
              if (la) {
                if (la.discountPercentage !== undefined) {
                  clientDiscountPercentage = la.discountPercentage;
                }
                commissionPercent = la.commission;
              }
            }
          } else if (profile?.role === 'agent') {
            commissionPercent = profile.commission || 0;
          }

          if (clientDiscountPercentage > 0) {
            discount = Math.round((basePrice * (clientDiscountPercentage / 100)) * 100) / 100;
          }

          const totalFinal = Math.round((basePrice - discount) * 100) / 100;
          const agentCommission = Math.round((totalFinal * (commissionPercent / 100)) * 100) / 100;

          let clientTypeRaw = importType === 'Individual' ? 'Individual' : getVal(row, 'Tipo de cliente');
          let clientType = clientTypeRaw;
          if (clientTypeRaw === 'Agente') clientType = 'Agent';
          if (clientTypeRaw === 'Corporativo') clientType = 'Corporate';
          if (clientTypeRaw === 'Universidad') clientType = 'University';

          const originCountryRaw = getVal(row, 'Pais Origen') || '';
          const destCountryRaw = getVal(row, 'Pais Destino') || '';

          const insurance: any = {
            clientType: clientType,
            clientId: clientId || '',
            linkedAgentId: linkedAgentId || '',
            IDseg: (getVal(row, 'IDSeg') || getVal(row, 'IDseg') || '').trim(),
            firstName: getVal(row, 'Nombre') || '',
            lastName: getVal(row, 'Apellido') || '',
            gender: (getVal(row, 'Sexo') === 'Mujer' || getVal(row, 'Sexo') === 'F' ? 'F' : 'M') as 'M' | 'F',
            email: getVal(row, 'Correo electronico') || '',
            birthDate: birthDate,
            age,
            originCountry: findCountryCode(originCountryRaw),
            destinationCountry: findCountryCode(destCountryRaw),
            city: getVal(row, 'Ciudad') || '',
            policyId: policy.id,
            policyName: policy.name,
            policyNumber: getPolicyNumber(policy, age),
            plan: planType,
            actionType: (getVal(row, 'Tipo de Accion') || getVal(row, 'Tipo de Acción') || 'NEW').trim().toUpperCase(),
            isExtremeSports,
            notes,
            requestDate,
            startDate,
            endDate,
            days,
            totalPrice: basePrice,
            totalCost: totalCost,
            discount,
            adjustment: 0,
            agentCommission,
            totalFinal,
            totalPaid: 0,
            status: 'pending',
            commissionStatus: agentCommission > 0 ? 'confirmed' : 'pending',
            createdAt: serverTimestamp(),
            imported: true
          };

          if (profile?.role === 'agent' && profile.uid) {
            insurance.agentId = profile.uid;
          }

          const isBypassDuplicateCheck = ['CAN', 'EXT', 'COR'].includes(insurance.actionType || '');
          const insuranceKey = createKey(insurance);
          if (!isBypassDuplicateCheck && existingKeys.has(insuranceKey)) {
            errors.push({ row, message: `Fila ${i + 2}: Registro omitido por estar duplicado (Mismo nombre, apellido, fecha de nacimiento, fecha de salida, fecha de regreso, destino, plan, póliza y tipo de operación)` });
            continue;
          }
          if (!isBypassDuplicateCheck) {
            existingKeys.add(insuranceKey);
          }

          successfulRows.push({
            rowIndex: i,
            row,
            insuranceData: insurance
          });
        }
        if (importType === 'Payments') {
          const enrichedRows = successfulRows.map((item, idx) => {
            const payment = item.paymentData;
            const matchedIns = existingInsurances.find(ins => ins.id === item.insuranceId);
            const passengerName = matchedIns 
              ? `${matchedIns.firstName || ''} ${matchedIns.lastName || ''}`.trim() || 'Asegurado sin nombre'
              : 'Asegurado no encontrado';
            const idSegMatched = matchedIns ? (matchedIns.IDseg || matchedIns.IDSeg || '') : '';
            const policyMatched = matchedIns ? (matchedIns.policyName || '') : '';

            let isDiscrepancy = false;
            let discrepancyMessage = '';

            if (matchedIns) {
              const currentPaid = matchedIns.totalPaid || 0;
              const totalFinal = matchedIns.totalFinal || matchedIns.totalPrice || 0;
              
              if (matchedIns.status === 'paid' || (totalFinal - currentPaid) < 2) {
                isDiscrepancy = true;
                discrepancyMessage = `El seguro con IDSeg "${idSegMatched}" ya está completamente pagado ($${currentPaid} de $${totalFinal} USD). Este pago de $${payment.amount} USD se registrará de todos modos.`;
              } else if (currentPaid + payment.amount > totalFinal + 0.01 && payment.type === 'client_payment') {
                isDiscrepancy = true;
                discrepancyMessage = `El monto a recibir ($${payment.amount} USD) excede el saldo pendiente ($${(totalFinal - currentPaid).toFixed(2)} USD). El total pagado resultante será $${(currentPaid + payment.amount).toFixed(2)} de un total de $${totalFinal} USD.`;
              } else if (payment.type === 'provider_payment' && matchedIns.totalCost && payment.amount > matchedIns.totalCost) {
                isDiscrepancy = true;
                discrepancyMessage = `El pago registrado al proveedor ($${payment.amount} USD) es mayor al costo total de la póliza ($${matchedIns.totalCost} USD).`;
              }
            }

            return {
              id: `preview-payment-${idx}`,
              rowIndex: item.rowIndex,
              row: item.row,
              passengerName,
              idSegMatched,
              policyMatched,
              paymentData: payment,
              insuranceId: item.insuranceId,
              getUpdateData: item.getUpdateData,
              isDiscrepancy,
              discrepancyMessage,
              expectedPlan: '',
              selectedPlan: '',
              useExpectedPlan: false,
            };
          });

          setPendingSuccessfulRows(enrichedRows);
          setPendingErrors(errors);
          setImporting(false);

          if (enrichedRows.length > 0) {
            setImportState('preview');
          } else {
            // No successful rows to preview, skip directly to errors results
            setResults({ success: 0, errors });
            setImportState('results');
          }
        } else {
          // For Insurance requests, transition to preview modal of rows
          const enrichedRows = successfulRows.map((item, idx) => {
            const ins = item.insuranceData;
            const passengerName = `${ins.firstName || ''} ${ins.lastName || ''}`.trim() || 'Pasajero sin nombre';
            const age = ins.age !== undefined ? ins.age : 0;
            const isExtreme = ins.isExtremeSports || false;

            const getPlanForAgeLocal = (ageVal: number): string => {
              if (isExtreme && ageVal >= 7 && ageVal <= 69) return 'Xtreme';
              if (ageVal >= 0 && ageVal <= 6) return 'U6';
              if (ageVal >= 7 && ageVal <= 25) return 'Student';
              if (ageVal >= 26 && ageVal <= 69) return 'Traveler';
              if (ageVal >= 70) return 'O70';

              if (insuranceTypes && insuranceTypes.length > 0) {
                const matchedType = insuranceTypes.find(t => ageVal >= Number(t.minAge) && ageVal <= Number(t.maxAge));
                if (matchedType) return matchedType.name;
              }
              return 'Traveler';
            };

            const expectedPlan = getPlanForAgeLocal(age);
            const selectedPlan = ins.plan || '';
            const isDiscrepant = isPlanTypeDiscrepant(expectedPlan, selectedPlan);

            return {
              id: `preview-${idx}`,
              rowIndex: item.rowIndex,
              row: item.row,
              passengerName,
              age,
              expectedPlan,
              selectedPlan,
              selectedPolicyName: ins.policyName || '',
              isDiscrepancy: isDiscrepant,
              useExpectedPlan: false,
              insuranceData: ins
            };
          });

          setPendingSuccessfulRows(enrichedRows);
          setPendingErrors(errors);
          setImporting(false);

          if (enrichedRows.length > 0) {
            setImportState('preview');
          } else {
            // No successful rows to preview, skip directly to errors results
            setResults({ success: 0, errors });
            setImportState('results');
          }
        }
      }
    };

    if (importMethod === 'file' && file) {
      Papa.parse(file, parseOptions);
    } else {
      Papa.parse(pastedData, parseOptions);
    }
  };

  const toggleRowPlanType = (itemId: string) => {
    setPendingSuccessfulRows(prev => prev.map(item => {
      if (item.id === itemId) {
        const nextUseExpected = !item.useExpectedPlan;
        const targetPlan = nextUseExpected ? item.expectedPlan : item.selectedPlan;
        
        // Recalculate complete insuranceData with this targetPlan override
        const calcResult = calculateInsuranceData(item.row, item.rowIndex, targetPlan);
        if (calcResult.error) {
          console.error("Recalculation error:", calcResult.error);
          return item;
        }
        
        return {
          ...item,
          useExpectedPlan: nextUseExpected,
          insuranceData: calcResult.insuranceData
        };
      }
      return item;
    }));
  };

  const applyBulkExpectedPlans = (apply: boolean) => {
    setPendingSuccessfulRows(prev => prev.map(item => {
      if (item.isDiscrepancy) {
        const targetPlan = apply ? item.expectedPlan : item.selectedPlan;
        const calcResult = calculateInsuranceData(item.row, item.rowIndex, targetPlan);
        return {
          ...item,
          useExpectedPlan: apply,
          insuranceData: calcResult.insuranceData || item.insuranceData
        };
      }
      return item;
    }));
    setSelectAllDiscrepancies(apply);
  };

  const commitImportFromPreview = async () => {
    setImporting(true);
    setImportState('importing');
    setImportProgress(pendingErrors.length);
    setCurrentSuccesses(0);
    setCurrentErrors(pendingErrors.length);

    // Turn selected preview rows into lazy-eval DB creation tasks
    const dbTasks = pendingSuccessfulRows.map(item => async () => {
      if (importType === 'Payments') {
        await addDoc(collection(db, 'payments'), item.paymentData);
        if (item.insuranceId && item.getUpdateData) {
          const insRef = doc(db, 'insurances', item.insuranceId);
          await updateDoc(insRef, item.getUpdateData());
        }
      } else {
        await addDoc(collection(db, 'insurances'), item.insuranceData);
      }
    });

    // Concurrency execution pool to optimize database insertions
    const runWithConcurrency = async <T extends unknown>(
      items: (() => Promise<T>)[],
      concurrency: number,
      onProgress: (index: number, success: boolean, err?: any) => void
    ) => {
      const resultsList: { success: boolean; error?: any; value?: T }[] = [];
      let index = 0;
      
      const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
          const currentIndex = index++;
          try {
            const val = await items[currentIndex]();
            resultsList[currentIndex] = { success: true, value: val };
            onProgress(currentIndex, true);
          } catch (err) {
            resultsList[currentIndex] = { success: false, error: err };
            onProgress(currentIndex, false, err);
          }
        }
      });
      
      await Promise.all(workers);
      return resultsList;
    };

    let successes = 0;
    const errorsList = [...pendingErrors];
    let maxAssignedNum = 0;
    let maxPfx = 'IDseg';
    let maxPadLength = 5;

    await runWithConcurrency(dbTasks, 15, (index, success, err) => {
      const item = pendingSuccessfulRows[index];
      if (success) {
        successes++;
        if (importType !== 'Payments' && item.insuranceData && item.insuranceData.IDseg) {
          const match = item.insuranceData.IDseg.match(/^([a-zA-Z_\-]+)?(\d+)$/);
          if (match) {
            const pfx = match[1] || 'IDseg';
            const numStr = match[2];
            const num = parseInt(numStr, 10);
            if (num > maxAssignedNum) {
              maxAssignedNum = num;
              maxPfx = pfx;
              maxPadLength = numStr.length;
            }
          }
        }
      } else {
        console.error("Error writing preview row to Firestore:", err);
        let message = '';
        if (err instanceof Error) {
          try {
            const errInfo = JSON.parse(err.message);
            message = `Fila ${item.rowIndex + 2}: Error de permisos al guardar (${errInfo.operationType} en ${errInfo.path}). Verifique que cumpla los formatos.`;
          } catch {
            message = `Fila ${item.rowIndex + 2}: ${err.message}`;
          }
        } else {
          message = `Fila ${item.rowIndex + 2}: Error al registrar en la base de datos`;
        }
        errorsList.push({ row: item.row, message });
      }

      setImportProgress(errorsList.length + successes);
      setCurrentSuccesses(successes);
      setCurrentErrors(errorsList.length);
    });

    if (maxAssignedNum > 0) {
      try {
        const counterDocRef = doc(db, 'settings', 'counters');
        const counterSnap = await getDoc(counterDocRef);
        let currentCounterValue = 0;
        if (counterSnap.exists()) {
          currentCounterValue = Number(counterSnap.data().IDsegCounter) || 0;
        }
        if (maxAssignedNum > currentCounterValue) {
          await setDoc(counterDocRef, {
            IDsegCounter: maxAssignedNum,
            IDsegPrefix: maxPfx,
            IDsegPadLength: maxPadLength
          }, { merge: true });
        }
      } catch (cntErr) {
        console.error("Error updating IDseg counter after bulk import commit:", cntErr);
      }
    }

    setResults({ success: successes, errors: errorsList });

    if (errorsList.length > 0) {
      downloadErrorsFromList(errorsList);
    }
    
    // Log import log history in Firestore
    if (profile) {
      try {
        await addDoc(collection(db, 'bulkImportLogs'), {
          type: importType,
          method: importMethod,
          fileName: file?.name || 'Datos pegados',
          successCount: successes,
          errorCount: errorsList.length,
          errors: errorsList.slice(0, 100).map(e => ({ message: e.message })),
          timestamp: serverTimestamp(),
          userId: profile.uid
        });
      } catch (err) {
        console.error("Error saving import log:", err);
      }
    }
    
    setImporting(false);
    setImportState('results');
  };

  const downloadErrorsCsv = () => {
    if (!results || results.errors.length === 0) return;
    downloadErrorsFromList(results.errors);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className={`bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 transition-all ${importState === 'preview' ? 'max-w-4xl w-full md:max-h-[90vh]' : 'max-w-2xl w-full'}`}>
        <div className="bg-indigo-600 p-6 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold">Importación Masiva {importType === 'Payments' ? 'de Pagos' : 'de Seguros'}</h3>
            <p className="text-indigo-100 text-xs">
              {importState === 'preview' 
                ? 'Revisa el resumen de validación antes de confirmar la carga final' 
                : importType === 'Payments' 
                  ? 'Sube un archivo CSV para registrar múltiples pagos y comisiones' 
                  : 'Sube un archivo CSV para procesar múltiples solicitudes'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-indigo-500 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className={`p-8 space-y-6 overflow-y-auto ${importState === 'preview' ? 'max-h-[calc(90vh-100px)]' : ''}`}>
          {importState === 'importing' ? (
            <div className="space-y-6 py-8 px-4 text-center animate-in fade-in zoom-in duration-300">
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="relative flex items-center justify-center">
                  {/* Outer spinning ring */}
                  <div className="w-24 h-24 rounded-full border-8 border-gray-100 border-t-indigo-600 animate-spin" />
                  {/* Inner text containing % */}
                  <div className="absolute font-sans text-lg font-black text-indigo-950">
                    {totalRows > 0 ? Math.round((importProgress / totalRows) * 100) : 0}%
                  </div>
                </div>
                
                <div className="space-y-1">
                  <h4 className="text-lg font-bold text-gray-950">Procesando Importación...</h4>
                  <p className="text-sm text-gray-500 font-medium">
                    {totalRows > 0 
                      ? `Registros procesados: ${importProgress} de ${totalRows}`
                      : 'Leyendo archivo y verificando duplicados...'}
                  </p>
                </div>
              </div>

              {totalRows > 0 && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${(importProgress / totalRows) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider px-1">
                    <span>Inicio</span>
                    <span>Procesando Fila {importProgress}</span>
                    <span>Fin</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
                  <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Éxitos</p>
                  <p className="text-2xl font-black text-emerald-700">{currentSuccesses}</p>
                </div>
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
                  <p className="text-xs font-bold text-rose-600 uppercase tracking-wider mb-1">Errores</p>
                  <p className="text-2xl font-black text-rose-700">{currentErrors}</p>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-left text-xs font-medium text-amber-800 flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  Por favor, mantén esta ventana abierta. Los errores de carga se descargarán automáticamente al finalizar para que puedas corregirlos.
                </p>
              </div>
            </div>
          ) : importState === 'preview' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Stats Summary Bento cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-indigo-50/50 border border-indigo-100/80 rounded-2xl p-4">
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-0.5">Pendiente de Procesar</p>
                  <p className="text-2xl font-black text-indigo-900">
                    {pendingSuccessfulRows.length}{' '}
                    <span className="text-xs font-normal text-indigo-600">
                      {importType === 'Payments' ? 'pagos' : 'solicitudes'}
                    </span>
                  </p>
                </div>

                <div className={`${pendingSuccessfulRows.filter(r => r.isDiscrepancy).length > 0 ? 'bg-amber-50 border-amber-100/80 animate-pulse' : 'bg-gray-50 border-gray-100'} border rounded-2xl p-4`}>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-0.5">
                    {importType === 'Payments' ? 'Advertencias o Inconsistencias' : 'Discrepancias de Plan hoy'}
                  </p>
                  <p className="text-2xl font-black text-amber-900">{pendingSuccessfulRows.filter(r => r.isDiscrepancy).length}</p>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-0.5">Omitidos o con Error</p>
                  <p className="text-2xl font-black text-rose-600">{pendingErrors.length}</p>
                </div>
              </div>

              {/* Bulk expected matching action banner */}
              {importType !== 'Payments' && pendingSuccessfulRows.filter(r => r.isDiscrepancy).length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200/80 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      Corrección de Clasificación Inteligente
                    </p>
                    <p className="text-[11px] text-amber-700">Se detectó que hay pasajeros ingresados en planes no recomendados para su edad (ej: Traveler marcado como U6). ¿Deseas aplicar la corrección recomendada para todos?</p>
                  </div>
                  
                  <div className="flex gap-2 shrink-0">
                    {!selectAllDiscrepancies ? (
                      <button 
                        onClick={() => applyBulkExpectedPlans(true)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Corregir todos por edad
                      </button>
                    ) : (
                      <button 
                        onClick={() => applyBulkExpectedPlans(false)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-250 hover:bg-gray-300 text-gray-950 font-bold text-xs rounded-xl border border-gray-300 shadow-sm transition-all"
                      >
                        Deshacer correcciones
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Search & filtering bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-55/40 p-2 rounded-2xl border border-gray-150">
                <div className="flex p-0.5 bg-gray-100 rounded-xl border border-gray-200 shrink-0">
                  <button
                    onClick={() => setPreviewFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${previewFilter === 'all' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-500'}`}
                  >
                    Todos ({pendingSuccessfulRows.length})
                  </button>
                  <button
                    onClick={() => setPreviewFilter('discrepancy')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${previewFilter === 'discrepancy' ? 'bg-white shadow-xs text-amber-600' : 'text-gray-500'}`}
                  >
                    {importType === 'Payments' ? 'Con Advertencia' : 'Con Discrepancia'} ({pendingSuccessfulRows.filter(r => r.isDiscrepancy).length})
                  </button>
                  <button
                    onClick={() => setPreviewFilter('normal')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${previewFilter === 'normal' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-500'}`}
                  >
                    {importType === 'Payments' ? 'Correctos' : 'Confirmados'} ({pendingSuccessfulRows.filter(r => !r.isDiscrepancy).length})
                  </button>
                </div>

                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder={importType === 'Payments' ? "Buscar por asegurado..." : "Buscar pasajero por nombre..."}
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              {/* List of preview entries */}
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1 flex flex-col custom-scrollbar">
                {pendingSuccessfulRows
                  .filter(item => {
                    const matchesSearch = item.passengerName.toLowerCase().includes(previewSearch.toLowerCase());
                    const matchesFilter = previewFilter === 'all'
                      ? true
                      : previewFilter === 'discrepancy'
                        ? item.isDiscrepancy
                        : !item.isDiscrepancy;
                    return matchesSearch && matchesFilter;
                  })
                  .map((item) => {
                    if (importType === 'Payments') {
                      const pay = item.paymentData;
                      const typeLabel = pay.type === 'client_payment' 
                        ? 'Pago de Cliente' 
                        : pay.type === 'agent_commission' 
                          ? 'Comisión Agente' 
                          : 'Pago Proveedor';
                      
                      const typeColor = pay.type === 'client_payment'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                        : pay.type === 'agent_commission'
                          ? 'bg-pink-50 text-pink-700 border-pink-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-100';

                      return (
                        <div 
                          key={item.id}
                          className={`p-4 rounded-2xl border transition-all ${item.isDiscrepancy ? 'bg-amber-50/20 border-amber-200/60 hover:border-amber-300' : 'bg-white border-gray-100 hover:border-gray-200'} shadow-xs`}
                        >
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-gray-900">{item.passengerName}</span>
                                {item.idSegMatched && (
                                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-gray-150 text-gray-700">
                                    IDseg: {item.idSegMatched}
                                  </span>
                                )}
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${typeColor}`}>
                                  {typeLabel}
                                </span>
                              </div>
                              
                              <p className="text-[11px] text-gray-500 font-medium">
                                Método: <span className="font-semibold text-gray-700">{pay.paymentMethod}</span> • Fecha Pago: <span className="font-semibold text-gray-700">{formatDisplayDate(pay.date)}</span> {item.policyMatched ? <> • Póliza: <span className="font-semibold text-gray-750 uppercase">{item.policyMatched}</span></> : ''}
                              </p>
                              
                              {item.isDiscrepancy ? (
                                <div className="mt-2 bg-amber-50 border border-amber-100/70 p-2.5 rounded-xl flex items-start gap-2 max-w-xl text-[11px] text-amber-800">
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                                  <div className="font-medium text-left">
                                    <span className="font-bold text-amber-900">Advertencia técnica:</span> {item.discrepancyMessage}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-600 font-semibold uppercase tracking-wider">
                                  <Check className="w-3.5 h-3.5" />
                                  Listo para aplicar • Monto validado correctamente
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-2 text-right self-stretch md:self-auto shrink-0">
                              <div>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-0.5">Monto del Pago</p>
                                <p className="text-sm font-sans font-black text-indigo-950 font-mono">
                                  ${pay.amount} <span className="text-[10px] font-normal text-gray-500">USD</span>
                                </p>
                                {pay.currency === 'MXP' && pay.amountMXP > 0 && (
                                  <p className="text-[10px] text-gray-500 font-semibold font-mono">
                                    (${pay.amountMXP} MXP @ {pay.exchangeRate.toFixed(2)})
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const ins = item.insuranceData;
                    return (
                      <div 
                        key={item.id}
                        className={`p-4 rounded-2xl border transition-all ${item.isDiscrepancy ? 'bg-amber-50/20 border-amber-200/60 hover:border-amber-300' : 'bg-white border-gray-100 hover:border-gray-200'} shadow-xs`}
                      >
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-gray-900">{item.passengerName}</span>
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                                {item.age} años
                              </span>
                            </div>
                            
                            <p className="text-[11px] text-gray-500 font-medium font-sans">
                              Desde: <span className="font-semibold text-gray-700">{formatDisplayDate(item.insuranceData.startDate)}</span> al <span className="font-semibold text-gray-700">{formatDisplayDate(item.insuranceData.endDate)}</span> ({item.insuranceData.days} días) • Destino: <span className="font-bold uppercase text-gray-700">{item.insuranceData.destinationCountry}</span>
                            </p>
                            
                            {item.isDiscrepancy ? (
                              <div className="mt-2 bg-amber-50 border border-amber-100/70 p-2.5 rounded-xl flex items-start gap-2 max-w-xl text-[11px] text-amber-800">
                                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold text-amber-900">Advertencia de clasificación:</span> El archivo CSV indica <span className="font-black underline">{item.selectedPlan}</span>, pero por edad se recomienda <span className="font-black text-indigo-700 underline">{item.expectedPlan}</span>.
                                </div>
                              </div>
                            ) : (
                              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-600 font-semibold uppercase tracking-wider">
                                <Check className="w-3.5 h-3.5" />
                                Plan clasificado correctamente ({item.insuranceData.plan})
                              </div>
                            )}
                          </div>

                          {/* Interactive plan toggler & price displaying */}
                          <div className="flex flex-col items-end gap-2 text-right self-stretch md:self-auto shrink-0">
                            {item.isDiscrepancy && (
                              <div className="flex rounded-xl bg-gray-100 p-0.5 border border-gray-200">
                                <button
                                  onClick={() => toggleRowPlanType(item.id)}
                                  className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${!item.useExpectedPlan ? 'bg-amber-500 text-white shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                                >
                                  Conservar {item.selectedPlan}
                                </button>
                                <button
                                  onClick={() => toggleRowPlanType(item.id)}
                                  className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${item.useExpectedPlan ? 'bg-indigo-600 text-white shadow-xs' : 'text-gray-500 hover:text-gray-900'}`}
                                >
                                  Corregir a {item.expectedPlan}
                                </button>
                              </div>
                            )}

                            <div>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-0.5">Precio de venta</p>
                              <p className="text-sm font-sans font-black text-indigo-950 font-mono">
                                {item.insuranceData.totalFinal} <span className="text-[10px] font-normal text-gray-500">USD</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                {pendingSuccessfulRows.filter(item => {
                  const matchesSearch = item.passengerName.toLowerCase().includes(previewSearch.toLowerCase());
                  const matchesFilter = previewFilter === 'all'
                    ? true
                    : previewFilter === 'discrepancy'
                      ? item.isDiscrepancy
                      : !item.isDiscrepancy;
                  return matchesSearch && matchesFilter;
                }).length === 0 && (
                  <p className="text-center py-12 text-gray-400 text-xs italic bg-gray-50 border border-dashed rounded-2xl">
                    No se encontraron registros que coincidan con la búsqueda o filtro activo
                  </p>
                )}
              </div>

              {/* Control Actions */}
              <div className="flex gap-4 border-t border-gray-100 pt-6">
                <button
                  onClick={() => setImportState('upload')}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-2xl font-bold transition-all text-sm text-center"
                >
                  Regresar y Cargar Otro
                </button>
                <button
                  onClick={commitImportFromPreview}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg text-white rounded-2xl font-black transition-all text-sm text-center shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  Confirmar e Importar ({pendingSuccessfulRows.length} {importType === 'Payments' ? 'pagos' : 'seguros'})
                </button>
              </div>
            </div>
          ) : !results ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-4">
                <div className="flex p-1 bg-gray-100 rounded-2xl border border-gray-200">
                  <button
                    onClick={() => { setImportType('Individual'); setResults(null); setFile(null); setPastedData(''); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${importType === 'Individual' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}
                  >
                    Individual
                  </button>
                  <button
                    onClick={() => { setImportType('Agent/Corporate'); setResults(null); setFile(null); setPastedData(''); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${importType === 'Agent/Corporate' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}
                  >
                    Agente / Corporativo
                  </button>
                  <button
                    onClick={() => { setImportType('Payments'); setResults(null); setFile(null); setPastedData(''); }}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${importType === 'Payments' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}
                  >
                    Pagos
                  </button>
                </div>

                <div className="flex p-1 bg-gray-100 rounded-2xl border border-gray-200">
                  <button
                    onClick={() => setImportMethod('file')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${importMethod === 'file' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}
                  >
                    Subir Archivo
                  </button>
                  <button
                    onClick={() => setImportMethod('paste')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${importMethod === 'paste' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500'}`}
                  >
                    Pegar Datos (CSV)
                  </button>
                </div>
              </div>

              <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  <div>
                    <p className="text-sm font-bold text-indigo-900">Plantilla de Importación</p>
                    <p className="text-xs text-indigo-700">Descarga el formato correcto para {importType}</p>
                  </div>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-600 rounded-xl text-xs font-bold border border-indigo-200 hover:bg-indigo-100 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Descargar CSV
                </button>
              </div>

              {importMethod === 'file' ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-3xl p-12 text-center hover:border-indigo-400 hover:bg-indigo-50/30 transition-all cursor-pointer group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".csv"
                    className="hidden"
                  />
                  <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-indigo-100 transition-colors">
                    <Upload className="w-8 h-8 text-gray-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                  <p className="text-gray-900 font-bold">{file ? file.name : 'Selecciona o arrastra tu archivo CSV'}</p>
                  <p className="text-gray-400 text-xs mt-1">Solo archivos .csv son permitidos</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Pega aquí el contenido de tu CSV:</label>
                  <textarea
                    value={pastedData}
                    onChange={(e) => setPastedData(e.target.value)}
                    placeholder="Tipo de cliente,Cliente,Nombre,Apellido,..."
                    className="w-full h-48 p-4 bg-gray-50 border border-gray-200 rounded-3xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                  />
                </div>
              )}

              <button
                onClick={processImport}
                disabled={(importMethod === 'file' ? !file : !pastedData.trim()) || importing}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-indigo-100"
              >
                Iniciar Importación
              </button>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className={`p-6 rounded-3xl border ${results.errors.length === 0 ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
                <div className="flex items-center gap-4 mb-4">
                  {results.errors.length === 0 ? (
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  ) : (
                    <AlertCircle className="w-10 h-10 text-amber-500" />
                  )}
                  <div>
                    <h4 className="text-lg font-bold text-gray-900">Importación Finalizada</h4>
                    <p className="text-sm text-gray-600">Se procesaron {results.success} registros exitosamente.</p>
                  </div>
                </div>

                {results.errors.length > 0 && (
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Errores Encontrados ({results.errors.length}):</p>
                      <button
                        onClick={downloadErrorsCsv}
                        className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-bold hover:bg-amber-700 transition-all shadow-sm"
                      >
                        <Download className="w-3 h-3" />
                        Descargar Errores (CSV)
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto bg-white/50 rounded-xl p-3 border border-amber-200 text-xs text-amber-800 space-y-1">
                      {results.errors.map((err, idx) => (
                        <p key={idx}>• {err.message}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => { setResults(null); setFile(null); setImportState('upload'); }}
                className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all"
              >
                Nueva Importación
              </button>
            </div>
          )}

          {/* Import History */}
          <div className="border-t border-gray-100 pt-6">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center justify-between w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:bg-gray-100 transition-all group"
            >
              <div className="flex items-center gap-3">
                <History className="w-5 h-5 text-indigo-600" />
                <div className="text-left">
                  <h4 className="text-sm font-bold text-gray-900">Historial de Importaciones</h4>
                  <p className="text-[10px] text-gray-500 font-medium">Últimos 10 registros de errores y éxitos</p>
                </div>
              </div>
              {showHistory ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
            </button>

            {showHistory && (
              <div className="mt-4 space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar animate-in slide-in-from-top-2 duration-300">
                {importLogs.length === 0 ? (
                  <p className="text-center py-8 text-gray-400 text-xs italic">No hay registros previos</p>
                ) : (
                  importLogs.map((log) => (
                    <div 
                      key={log.id} 
                      className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all"
                    >
                      <button
                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id!)}
                        className="w-full p-4 flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${log.errorCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                                {log.type}
                              </span>
                              <span className="text-xs font-bold text-gray-900">
                                {log.fileName}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {log.timestamp?.toDate ? format(log.timestamp.toDate(), 'dd/MM/yyyy HH:mm') : 'Haciendo un momento'} • {log.successCount} éxitos, {log.errorCount} errores
                            </p>
                          </div>
                        </div>
                        {log.errorCount > 0 && (
                          <div className="flex items-center text-amber-600 font-bold text-[10px] uppercase">
                            Ver Errores
                            {expandedLogId === log.id ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                          </div>
                        )}
                      </button>
                      
                      {expandedLogId === log.id && log.errorCount > 0 && (
                        <div className="px-4 pb-4 animate-in slide-in-from-top-1">
                          <div className="bg-amber-50 rounded-lg p-3 border border-amber-100 space-y-1.5">
                            {log.errors.map((error, idx) => (
                              <div key={idx} className="flex gap-2 text-[10px] text-amber-800">
                                <span className="opacity-50 flex-shrink-0">•</span>
                                <span>{error.message}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
