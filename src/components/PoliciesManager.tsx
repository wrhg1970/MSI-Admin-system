import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, getDocs, where, getDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { InsuranceRequest, UserProfile, Payment, Policy, CustomRole, PolicyLetter } from '../types';
import { COUNTRIES } from '../constants';
import { ShieldCheck, Eye, Trash2, Edit2, CheckCircle, XCircle, DollarSign, FileText, FileSpreadsheet, Search, Filter, Receipt, Calendar, Clock, AlertTriangle, ArrowRight, User, Users, Mail, LayoutGrid, List, Baby, Upload, Download, Globe, Building2, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, TrendingUp, Send, Loader2 } from 'lucide-react';
import TransactionModal from './TransactionModal';
import InsuranceDetailModal from './InsuranceDetailModal';
import EmailModal from './EmailModal';
import BulkEmailConfigModal from './BulkEmailConfigModal';
import { generatePDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';
import { format, parseISO, parse, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { usePermissions } from '../hooks/usePermissions';
import Papa from 'papaparse';
import { useCompany } from '../App';
import { triggerWhatsAppNotification } from '../services/whatsapp';
import BatchDetailModal from './BatchDetailModal';

const LANGUAGE_ORDER = ['es', 'en', 'policy', 'covid', 'fr', 'it', 'de'];

const sortLettersByLanguage = <T extends { language: string }>(letters: T[]): T[] => {
  return [...letters].sort((a, b) => {
    let indexA = LANGUAGE_ORDER.indexOf(a.language);
    let indexB = LANGUAGE_ORDER.indexOf(b.language);
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    return a.language.localeCompare(b.language);
  });
};

export default function PoliciesManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const { settings } = useCompany();
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyLetters, setPolicyLetters] = useState<PolicyLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [policyTypeFilter, setPolicyTypeFilter] = useState('all');
  const [clientTypeFilter, setClientTypeFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [subAgentFilter, setSubAgentFilter] = useState('all');
  const [actionTypeFilter, setActionTypeFilter] = useState('all');
  const [clients, setClients] = useState<any[]>([]);
  const [actionTypes, setActionTypes] = useState<{action: string, name: string}[]>([]);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'requestDate', direction: 'desc' });
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });
  const [requestDateRange, setRequestDateRange] = useState(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return {
      start: todayStr,
      end: todayStr
    };
  });
  const [validityRange, setValidityRange] = useState({
    start: '',
    end: ''
  });
  const [operationalStatusFilter, setOperationalStatusFilter] = useState('all');
  const [caremedExportedFilter, setCaremedExportedFilter] = useState('all');
  const [caremedInvoicedFilter, setCaremedInvoicedFilter] = useState('all');
  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  const [selectedInsuranceForDetail, setSelectedInsuranceForDetail] = useState<InsuranceRequest | null>(null);
  const [selectedInsuranceForEmail, setSelectedInsuranceForEmail] = useState<InsuranceRequest | null>(null);
  const [insuranceToDelete, setInsuranceToDelete] = useState<InsuranceRequest | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<{id: string, type: 'payment' | 'commission'} | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [languageModal, setLanguageModal] = useState<{
    isOpen: boolean;
    insurance: InsuranceRequest | null;
    availableLetters: PolicyLetter[];
    selectedLanguages: string[];
  }>({
    isOpen: false,
    insurance: null,
    availableLetters: [],
    selectedLanguages: []
  });
  
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'list';

  const [selectedExportDate, setSelectedExportDate] = useState<string | null>(null);
  const [caremedSearchTerm, setCaremedSearchTerm] = useState('');

  const [caremedDateFilter, setCaremedDateFilter] = useState('');
  const [caremedInsuredSearch, setCaremedInsuredSearch] = useState('');

  // Bulk Invoice Assignment states
  const [caremedSelectedIds, setCaremedSelectedIds] = useState<string[]>([]);
  const [invoiceInput, setInvoiceInput] = useState('');
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Invoices Caremed submenu states
  const [caremedInvoices, setCaremedInvoices] = useState<any[]>([]);
  const [selectedInvoicedExportDate, setSelectedInvoicedExportDate] = useState<string | null>(null);
  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState<string | null>(null);
  const [invoicedSearchTerm, setInvoicedSearchTerm] = useState('');
  const [invoicedDateFilter, setInvoicedDateFilter] = useState('');

  const [selectedBatchForDetail, setSelectedBatchForDetail] = useState<{ exportDate: string; policies: InsuranceRequest[] } | null>(null);
  const [caremedSubTab, setCaremedSubTab] = useState<'pending' | 'history'>('pending');

  // AI Invoice Scanning & Verification states
  const [parsingInvoice, setParsingInvoice] = useState(false);
  const [manualInvoice, setManualInvoice] = useState({ number: '', amount: '', notes: '' });
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editInvoiceValues, setEditInvoiceValues] = useState({ number: '', amount: '', notes: '' });

  // Group insurances by Caremed export date (only those without an assigned invoice)
  const caremedExports = useMemo(() => {
    const exportsMap: { [key: string]: InsuranceRequest[] } = {};
    insurances.forEach(ins => {
      if (ins.Caremed && !ins.InvoiceCaremed) {
        if (!exportsMap[ins.Caremed]) {
          exportsMap[ins.Caremed] = [];
        }
        exportsMap[ins.Caremed].push(ins);
      }
    });

    return Object.entries(exportsMap).map(([exportDate, items]) => ({
      exportDate,
      count: items.length,
      policies: items
    })).sort((a, b) => b.exportDate.localeCompare(a.exportDate));
  }, [insurances]);

  // Group insurances by Caremed export date that have an assigned invoice
  const invoicedCaremedExports = useMemo(() => {
    const exportsMap: { [key: string]: InsuranceRequest[] } = {};
    insurances.forEach(ins => {
      if (ins.Caremed && ins.InvoiceCaremed) {
        if (!exportsMap[ins.Caremed]) {
          exportsMap[ins.Caremed] = [];
        }
        exportsMap[ins.Caremed].push(ins);
      }
    });

    return Object.entries(exportsMap).map(([exportDate, items]) => ({
      exportDate,
      count: items.length,
      policies: items
    })).sort((a, b) => b.exportDate.localeCompare(a.exportDate));
  }, [insurances]);

  // Group insurances by Caremed Invoice values
  const caremedInvoicesGrouped = useMemo(() => {
    const invoicesMap: { [key: string]: InsuranceRequest[] } = {};
    insurances.forEach(ins => {
      if (ins.Caremed && ins.InvoiceCaremed) {
        const invKey = ins.InvoiceCaremed.trim();
        if (!invoicesMap[invKey]) {
          invoicesMap[invKey] = [];
        }
        invoicesMap[invKey].push(ins);
      }
    });

    return Object.entries(invoicesMap).map(([invoiceNumber, items]) => {
      // Find the main exportDate from these items (most recent first)
      const sortedItems = [...items].sort((a, b) => (b.Caremed || '').localeCompare(a.Caremed || ''));
      const exportDate = sortedItems[0]?.Caremed || '';
      
      // Compute total systems calculated cost
      const totalCalculatedCost = items.reduce((sum, p) => sum + (p.totalCost || 0), 0);

      return {
        invoiceNumber,
        exportDate,
        count: items.length,
        policies: items,
        totalCalculatedCost
      };
    }).sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber));
  }, [insurances]);

  // Filter Caremed Invoices by search and date filters
  const filteredCaremedInvoices = useMemo(() => {
    return caremedInvoicesGrouped.filter(inv => {
      // 1. Filter by Date (the exportDate matches our date filter, or any of its policies' Caremed dates)
      if (invoicedDateFilter) {
        const hasMatchingDate = inv.policies.some(ins => {
          const batchYMD = (ins.Caremed || '').substring(0, 10);
          return batchYMD === invoicedDateFilter;
        });
        if (!hasMatchingDate) return false;
      }

      // 2. Filter by Invoice number or insured name/id
      if (invoicedSearchTerm) {
        const search = invoicedSearchTerm.toLowerCase();
        if (inv.invoiceNumber.toLowerCase().includes(search)) {
          return true;
        }
        const hasMatchingPolicy = inv.policies.some(ins => {
          const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
          const policyId = (ins.policyId || '').toLowerCase();
          return fullName.includes(search) || policyId.includes(search);
        });
        if (!hasMatchingPolicy) return false;
      }

      return true;
    });
  }, [caremedInvoicesGrouped, invoicedDateFilter, invoicedSearchTerm]);

  // Filter Caremed exports by date and insured search
  const filteredCaremedExports = useMemo(() => {
    return caremedExports.filter(batch => {
      // 1. Filter by Date (comparing with YYYY-MM-DD from calendar)
      if (caremedDateFilter) {
        const batchYMD = batch.exportDate.substring(0, 10);
        if (batchYMD !== caremedDateFilter) {
          return false;
        }
      }

      // 2. Filter by Insured Name / last name / country / policy ID
      if (caremedInsuredSearch) {
        const search = caremedInsuredSearch.toLowerCase();
        const hasMatchingPolicy = batch.policies.some(ins => {
          const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
          const policyId = (ins.policyId || '').toLowerCase();
          const originCountry = (ins.originCountry || '').toLowerCase();
          const destinationCountry = (ins.destinationCountry || '').toLowerCase();
          return fullName.includes(search) || 
                 policyId.includes(search) ||
                 originCountry.includes(search) ||
                 destinationCountry.includes(search);
        });
        if (!hasMatchingPolicy) {
          return false;
        }
      }

      return true;
    });
  }, [caremedExports, caremedDateFilter, caremedInsuredSearch]);

  // Group ALL insurances by Caremed export date (for complete file/batch history)
  const allCaremedExports = useMemo(() => {
    const exportsMap: { [key: string]: InsuranceRequest[] } = {};
    insurances.forEach(ins => {
      if (ins.Caremed) {
        if (!exportsMap[ins.Caremed]) {
          exportsMap[ins.Caremed] = [];
        }
        exportsMap[ins.Caremed].push(ins);
      }
    });

    return Object.entries(exportsMap).map(([exportDate, items]) => ({
      exportDate,
      count: items.length,
      policies: items
    })).sort((a, b) => b.exportDate.localeCompare(a.exportDate));
  }, [insurances]);

  // Filter ALL Caremed exports by date and insured search
  const filteredAllCaremedExports = useMemo(() => {
    return allCaremedExports.filter(batch => {
      // 1. Filter by Date
      if (caremedDateFilter) {
        const batchYMD = batch.exportDate.substring(0, 10);
        if (batchYMD !== caremedDateFilter) {
          return false;
        }
      }

      // 2. Filter by Insured Name / last name / country / policy ID
      if (caremedInsuredSearch) {
        const search = caremedInsuredSearch.toLowerCase();
        const hasMatchingPolicy = batch.policies.some(ins => {
          const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
          const policyId = (ins.policyId || '').toLowerCase();
          const originCountry = (ins.originCountry || '').toLowerCase();
          const destinationCountry = (ins.destinationCountry || '').toLowerCase();
          return fullName.includes(search) || 
                 policyId.includes(search) ||
                 originCountry.includes(search) ||
                 destinationCountry.includes(search);
        });
        if (!hasMatchingPolicy) {
          return false;
        }
      }

      return true;
    });
  }, [allCaremedExports, caremedDateFilter, caremedInsuredSearch]);

  // Filter Invoiced exports by date and search term
  const filteredInvoicedCaremedExports = useMemo(() => {
    return invoicedCaremedExports.filter(batch => {
      // 1. Filter by Date
      if (invoicedDateFilter) {
        const batchYMD = batch.exportDate.substring(0, 10);
        if (batchYMD !== invoicedDateFilter) {
          return false;
        }
      }

      // 2. Filter by Invoice number or client name
      if (invoicedSearchTerm) {
        const search = invoicedSearchTerm.toLowerCase();
        const hasMatchingPolicy = batch.policies.some(ins => {
          const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
          const invoiceNum = (ins.InvoiceCaremed || '').toLowerCase();
          const policyId = (ins.policyId || '').toLowerCase();
          return fullName.includes(search) || 
                 invoiceNum.includes(search) ||
                 policyId.includes(search);
        });
        if (!hasMatchingPolicy) return false;
      }

      return true;
    });
  }, [invoicedCaremedExports, invoicedDateFilter, invoicedSearchTerm]);

  useEffect(() => {
    if (tab === 'caremed') {
      if (filteredCaremedExports.length > 0) {
        const exists = filteredCaremedExports.some(b => b.exportDate === selectedExportDate);
        if (!exists) {
          setSelectedExportDate(filteredCaremedExports[0].exportDate);
        }
      } else {
        setSelectedExportDate(null);
      }
    }
  }, [tab, filteredCaremedExports, selectedExportDate]);

  useEffect(() => {
    if (tab === 'invoices') {
      if (filteredCaremedInvoices.length > 0) {
        const exists = filteredCaremedInvoices.some(b => b.invoiceNumber === selectedInvoiceNumber);
        if (!exists) {
          setSelectedInvoiceNumber(filteredCaremedInvoices[0].invoiceNumber);
        }
      } else {
        setSelectedInvoiceNumber(null);
      }
    }
  }, [tab, filteredCaremedInvoices, selectedInvoiceNumber]);

  useEffect(() => {
    const filterType = searchParams.get('filter');
    if (filterType === 'unexported') {
      setCaremedExportedFilter('not_exported');
      setRequestDateRange({ start: '', end: '' });
    } else if (filterType === 'uninvoiced') {
      setCaremedInvoicedFilter('not_invoiced');
      setRequestDateRange({ start: '', end: '' });
    } else if (filterType === 'unpaid') {
      setStatusFilter('pending');
      setRequestDateRange({ start: '', end: '' });
    }
  }, [searchParams]);

  const findMatchingPolicy = (ins: any, policies: Policy[]): Policy | undefined => {
    // 1. Resolve Plan Type
    let insPlan = ins.plan;
    if (!insPlan && ins.policyId) {
      const lowerId = ins.policyId.toLowerCase();
      if (lowerId.includes('travel') || lowerId.includes('trav') || lowerId.includes('viaj')) {
        insPlan = 'traveler';
      } else if (lowerId.includes('student') || lowerId.includes('estud')) {
        insPlan = 'student';
      } else if (lowerId.includes('u6')) {
        insPlan = 'u6';
      } else if (lowerId.includes('o70')) {
        insPlan = 'o70';
      } else if (lowerId.includes('xtreme')) {
        insPlan = 'xtreme';
      } else {
        insPlan = ins.policyId.split('-')[0];
      }
    }

    const getNormalizedPlanType = (plan: string) => {
      const l = (plan || '').toLowerCase().trim();
      if (l.includes('travel') || l.includes('trav') || l.includes('viaj')) return 'traveler';
      if (l.includes('student') || l.includes('estud')) return 'student';
      if (l.includes('u6')) return 'u6';
      if (l.includes('o70')) return 'o70';
      if (l.includes('xtreme')) return 'xtreme';
      return l;
    };
    const targetPlanNorm = getNormalizedPlanType(insPlan);

    // 2. Resolve Region
    let targetRegion = 2;
    if (typeof ins.region !== 'undefined' && ins.region !== null) {
      targetRegion = Number(ins.region);
    } else {
      const countryCode = (ins.destinationCountry || '').toUpperCase().trim();
      if (countryCode && ['US', 'CA', 'WW', 'USA', 'CAN'].includes(countryCode)) {
        targetRegion = 1;
      }
    }

    // 3. Resolve Plan Name
    const policyName = ins.policyName || ins.insuranceType || '';
    
    const getCanonicalPlanName = (nameStr: string): string => {
      const s = (nameStr || '').toLowerCase();
      let metal = '';
      if (s.includes('oro') || s.includes('gold')) metal = 'oro';
      else if (s.includes('plata') || s.includes('silver')) metal = 'plata';
      else if (s.includes('bronce') || s.includes('bronze')) metal = 'bronce';
      else if (s.includes('xtreme') || s.includes('pro')) metal = 'xtreme';

      let deductible = 'con deducible';
      if (s.includes('sin') || s.includes('no ded') || s.includes('without')) {
        deductible = 'sin deducible';
      } else if (s.includes('con') || s.includes('deducible') || s.includes('with ded')) {
        deductible = 'con deducible';
      }

      if (metal === 'xtreme') return 'plan xtreme pro';
      if (s.includes('traveler oro') || s.includes('traveler_oro')) return 'plan traveler oro';
      if (s.includes('student oro') || s.includes('student_oro')) return 'plan student oro';

      if (metal) {
         return `${metal} ${deductible}`;
      }
      return s.trim();
    };

    const targetNameNorm = getCanonicalPlanName(policyName);

    // 4. Match using the 3 filters: Tipo de Plan, Region, Nombre del Plan
    const matches = policies.filter(p => {
      const matchesPlan = getNormalizedPlanType(p.plan) === targetPlanNorm;
      const matchesRegion = Number(p.region) === Number(targetRegion);
      const matchesName = getCanonicalPlanName(p.name) === targetNameNorm;
      return matchesPlan && matchesRegion && matchesName;
    });

    if (matches.length === 1) {
      return matches[0];
    }
    
    // If multiple candidates exist, prefer the one with fully configured codes
    if (matches.length > 1) {
      const best = matches.find(p => p.SponsorCode && p.CodigoPoliza && p.CodigoExportacion);
      if (best) return best;
      return matches[0];
    }

    // Relaxed fallback on Name within the target Plan and Region
    const relaxedMatches = policies.filter(p => {
      const matchesPlan = getNormalizedPlanType(p.plan) === targetPlanNorm;
      const matchesRegion = Number(p.region) === Number(targetRegion);
      const pNameNorm = getCanonicalPlanName(p.name);
      return matchesPlan && matchesRegion && (pNameNorm.includes(targetNameNorm) || targetNameNorm.includes(pNameNorm));
    });

    if (relaxedMatches.length > 0) {
      const best = relaxedMatches.find(p => p.SponsorCode && p.CodigoPoliza && p.CodigoExportacion);
      if (best) return best;
      return relaxedMatches[0];
    }

    // Exact direct ID / CodigoPoliza fallback as a safety measure
    let directFound = policies.find(p => 
      p.id === ins.policyId || 
      (p.CodigoPoliza && p.CodigoPoliza === ins.policyId)
    );
    if (directFound) return directFound;

    // Safety fallback: first matching plan and region
    const planRegionMatches = policies.filter(p => {
      const matchesPlan = getNormalizedPlanType(p.plan) === targetPlanNorm;
      return matchesPlan && Number(p.region) === Number(targetRegion);
    });
    if (planRegionMatches.length > 0) {
      return planRegionMatches[0];
    }

    return undefined;
  };

  const handleDownloadSpecificCareMedCSV = (exportDate: string, items: InsuranceRequest[]) => {
    try {
      const dataToExport = items.map(item => {
        const ins = item as any;
        const policy = findMatchingPolicy(ins, policies);

        return {
          'Sponsor_Code': policy?.SponsorCode || '',
          'Policy_Number': policy?.CodigoPoliza || '',
          'Transaction_Type': ins.actionType || 'NEW',
          'Last_Name': ins.lastName || '',
          'First_Name': ins.firstName || '',
          'Gender': ins.gender || '',
          'Birth_Date': formatDateToYYYYMMDD(ins.birthDate || ''),
          'Start_Date': formatDateToYYYYMMDD(ins.startDate || ''),
          'End_Date': formatDateToYYYYMMDD(ins.endDate || ''),
          'Enrollment_Cell_Code': policy?.CodigoExportacion || '',
          'Insurance_Type': 'MED',
          'Country_Of_Origin': ins.originCountry || '',
          'Country_Of_Destination': ins.destinationCountry || '',
          'DEST_CITY_NAME': ins.city || '',
          'Sponsor_Prog_Name': '',
          'Sponsor_Partic_ID': '',
          'E_MAIL_ADDRESS': policy?.E_Mail_Address || ''
        };
      });

      const csv = Papa.unparse(dataToExport);
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const formattedDate = exportDate.replace(/[: ]/g, '_');
      link.download = `caremed_export_${formattedDate}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert('Error al volver a exportar: ' + err.message);
    }
  };

  const handleAssignInvoiceCaremed = async () => {
    if (!invoiceInput.trim() || caremedSelectedIds.length === 0) return;
    setInvoiceSaving(true);
    setInvoiceMessage(null);
    try {
      const updatePromises = caremedSelectedIds.map(async (id) => {
        await updateDoc(doc(db, 'insurances', id), {
          InvoiceCaremed: invoiceInput.trim()
        });
      });
      await Promise.all(updatePromises);

      setInvoiceMessage({
        type: 'success',
        text: `Se ha asignado el invoice "${invoiceInput.trim()}" a ${caremedSelectedIds.length} pólizas con éxito.`
      });
      setCaremedSelectedIds([]);
      setInvoiceInput('');

      // Auto-clear message
      setTimeout(() => {
        setInvoiceMessage(null);
      }, 5000);
    } catch (error) {
      console.error("Error assigning Invoice Caremed:", error);
      setInvoiceMessage({
        type: 'error',
        text: 'No se pudo asignar el invoice. Por favor intente más tarde.'
      });
    } finally {
      setInvoiceSaving(false);
    }
  };

  const handleRemoveInvoiceCaremed = async (insuranceId: string) => {
    try {
      await updateDoc(doc(db, 'insurances', insuranceId), {
        InvoiceCaremed: null
      });
    } catch (error) {
      console.error("Error removing Invoice Caremed:", error);
      alert("Error al remover el invoice de la póliza.");
    }
  };

  const handleInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>, exportDate: string, customInvoiceNumber?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingInvoice(true);
    try {
      const reader = new FileReader();
      const loadPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(new Error("Error leyendo el archivo"));
      });
      reader.readAsDataURL(file);
      const base64Data = await loadPromise;
      
      const response = await fetch('/api/caremed/parse-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileData: base64Data,
          fileName: file.name,
          fileType: file.type
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Error al procesar el archivo');
      }

      const data = await response.json();

      await addDoc(collection(db, 'caremedInvoices'), {
        exportDate,
        invoiceNumber: customInvoiceNumber || data.invoiceNumber || 'SIN_NÚMERO',
        amount: Number(data.amount) || 0,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        uploadedAt: new Date().toISOString(),
        notes: data.notes || '',
        simulated: data.simulated || false
      });

    } catch (error: any) {
      console.error(error);
      alert("Error al cargar la factura: " + error.message);
    } finally {
      setParsingInvoice(false);
      e.target.value = '';
    }
  };

  const handleAddManualInvoice = async (exportDate: string, customInvoiceNumber?: string) => {
    const finalInvoiceNumber = (customInvoiceNumber || manualInvoice.number).trim();
    if (!finalInvoiceNumber || !manualInvoice.amount.trim()) {
      alert("Por favor ingresa un número de factura y un importe.");
      return;
    }

    const amt = parseFloat(manualInvoice.amount);
    if (isNaN(amt)) {
      alert("El importe debe ser un número válido.");
      return;
    }

    try {
      await addDoc(collection(db, 'caremedInvoices'), {
        exportDate,
        invoiceNumber: finalInvoiceNumber,
        amount: amt,
        fileName: 'Entrada Manual',
        fileSize: 0,
        fileType: 'text/plain',
        uploadedAt: new Date().toISOString(),
        notes: manualInvoice.notes.trim()
      });

      setManualInvoice({ number: '', amount: '', notes: '' });
      setShowManualForm(false);
    } catch (err: any) {
      console.error("Error adding manual invoice:", err);
      alert("Fallo al guardar la factura: " + err.message);
    }
  };

  const handleDeleteCaremedInvoice = async (invoiceId: string) => {
    if (!confirm("¿Estás seguro de eliminar este invoice adjunto del lote?")) return;
    try {
      await deleteDoc(doc(db, 'caremedInvoices', invoiceId));
    } catch (err: any) {
      console.error("Error deleting invoice:", err);
      alert("Fallo al borrar el invoice adjunto.");
    }
  };

  const handleStartEditInvoice = (inv: any) => {
    setEditingInvoiceId(inv.id);
    setEditInvoiceValues({
      number: inv.invoiceNumber,
      amount: String(inv.amount),
      notes: inv.notes || ''
    });
  };

  const handleSaveEditInvoice = async (invoiceId: string) => {
    if (!editInvoiceValues.number.trim() || !editInvoiceValues.amount.trim()) {
      alert("Se requiere número e importe");
      return;
    }

    const amt = parseFloat(editInvoiceValues.amount);
    if (isNaN(amt)) {
      alert("El importe debe ser un número");
      return;
    }

    try {
      await updateDoc(doc(db, 'caremedInvoices', invoiceId), {
        invoiceNumber: editInvoiceValues.number.trim(),
        amount: amt,
        notes: editInvoiceValues.notes.trim()
      });
      setEditingInvoiceId(null);
    } catch (err: any) {
      console.error("Error editing invoice:", err);
      alert("Fallo al editar la factura.");
    }
  };

  const isSuperAdmin = profile?.role === 'super_admin';
  const isSuperAdminOrDirector = profile?.role === 'super_admin' || profile?.role === 'director';

  useEffect(() => {
    if (!profile || !hasPermission('policies')) return;

    const q = query(collection(db, 'insurances'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest));
      setInsurances(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances');
    });

    const fetchPolicies = async () => {
      try {
        const snap = await getDocs(collection(db, 'policies'));
        setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
      } catch (error) {
        console.error("Error fetching policies:", error);
      }
    };
    fetchPolicies();

    const unsubLetters = onSnapshot(collection(db, 'policyLetters'), (snap) => {
      setPolicyLetters(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PolicyLetter)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'policyLetters');
    });

    const fetchClients = async () => {
      try {
        const snap = await getDocs(collection(db, 'clients'));
        setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } )));
      } catch (error) {
        console.error("Error fetching clients:", error);
      }
    };
    fetchClients();

    const fetchActionTypes = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'actionTypes'), orderBy('action')));
        setActionTypes(snap.docs.map(doc => doc.data() as any));
      } catch (error) {
        console.error("Error fetching action types:", error);
      }
    };
    fetchActionTypes();

    const unsubInvoices = onSnapshot(collection(db, 'caremedInvoices'), (snapshot) => {
      setCaremedInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching caremedInvoices:", error);
    });

    return () => {
      unsubscribe();
      unsubLetters();
      unsubInvoices();
    };
  }, []);

  const availablePlans = React.useMemo(() => {
    const plans = Array.from(new Set(policies.map(p => p.plan))).filter(Boolean).sort();
    return plans;
  }, [policies]);

  const availablePolicyTypes = React.useMemo(() => {
    const filtered = policies.filter(p => planFilter === 'all' || p.plan === planFilter);
    const types = Array.from(new Set(filtered.map(p => p.name))).filter(Boolean).sort();
    return types;
  }, [policies, planFilter]);

  const selectedClient = React.useMemo(() => {
    return clients.find(c => c.id === agentFilter);
  }, [clients, agentFilter]);

  const filteredInsurances = React.useMemo(() => {
    let result = insurances.filter(ins => {
      // Role-based visibility enforcement
      if (profile?.role === 'agent') {
        const isOwnerByUid = ins.agentId === profile.uid;
        const isOwnerByEmail = ins.linkedAgentId?.toLowerCase() === profile.email.toLowerCase();
        const isOwnerByEmailInAgentId = ins.agentId?.toLowerCase() === profile.email.toLowerCase();
        if (!isOwnerByUid && !isOwnerByEmail && !isOwnerByEmailInAgentId) return false;
      }
      if (profile?.role === 'client' && ins.email?.toLowerCase() !== profile?.email?.toLowerCase()) return false;

      const client = clients.find(c => c.id === ins.clientId);
      const clientName = client ? (client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim()) : '';
      const subAgent = client?.linkedAgents?.find((la: any) => la.email === ins.linkedAgentId || la.id === ins.linkedAgentId);
      const subAgentName = subAgent ? subAgent.name : '';
      const subAgentEmail = ins.linkedAgentId || '';

      const matchesSearch = 
        ins.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ins.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ins.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ins.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (ins.IDseg && ins.IDseg.toLowerCase().includes(searchTerm.toLowerCase())) ||
        clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        subAgentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        subAgentEmail.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || ins.status === statusFilter;
      
      const policy = policies.find(p => p.id === ins.policyId);
      const plan = ins.plan || policy?.plan || ins.policyId.split('-')[0];
      const policyName = ins.policyName || policy?.name || '';

      const matchesPlan = planFilter === 'all' || plan === planFilter;
      const matchesPolicyType = policyTypeFilter === 'all' || 
        (policyName.includes(policyTypeFilter)) || 
        (ins.policyId.includes(policyTypeFilter));
      
      const date = ins.createdAt?.toDate ? ins.createdAt.toDate() : new Date(ins.createdAt);
      const matchesDate = (!dateRange.start || date >= new Date(dateRange.start)) &&
                          (!dateRange.end || date <= new Date(dateRange.end));

      // Filter by request date
      const actualRequestDate = ins.requestDate || (ins.createdAt?.toDate ? format(ins.createdAt.toDate(), 'yyyy-MM-dd') : (ins.createdAt ? format(new Date(ins.createdAt), 'yyyy-MM-dd') : ''));
      const matchesRequestDate = (!requestDateRange.start || actualRequestDate >= requestDateRange.start) &&
                                 (!requestDateRange.end || actualRequestDate <= requestDateRange.end);

      // New filters
      const matchesValidity = (!validityRange.start || ins.startDate >= validityRange.start) &&
                              (!validityRange.end || ins.endDate <= validityRange.end);
      
      const today = format(new Date(), 'yyyy-MM-dd');
      let opStatus = 'Activo';
      if (ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled') {
        opStatus = 'Cancelado';
      } else if (today > ins.endDate) {
        opStatus = 'Terminado';
      }
      
      const matchesOperationalStatus = operationalStatusFilter === 'all' || opStatus === operationalStatusFilter;
      
      const matchesClientType = clientTypeFilter === 'all' || ins.clientType === clientTypeFilter;
      const matchesAgent = agentFilter === 'all' || ins.clientId === agentFilter;
      const matchesSubAgent = subAgentFilter === 'all' || ins.linkedAgentId === subAgentFilter;
      const matchesActionType = actionTypeFilter === 'all' || ins.actionType === actionTypeFilter;

      // CareMed filters
      const matchesCaremedExported = caremedExportedFilter === 'all' || 
        (caremedExportedFilter === 'exported' ? !!ins.Caremed : !ins.Caremed);

      const matchesCaremedInvoiced = caremedInvoicedFilter === 'all' ||
        (caremedInvoicedFilter === 'invoiced' ? !!ins.InvoiceCaremed : !ins.InvoiceCaremed);

      return matchesSearch && matchesStatus && matchesPlan && matchesPolicyType && matchesDate && matchesRequestDate && matchesValidity && matchesOperationalStatus && matchesClientType && matchesAgent && matchesSubAgent && matchesActionType && matchesCaremedExported && matchesCaremedInvoiced;
    });

    // Sorting
    result.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      if (sortConfig.key === 'requestDate') {
        valA = a.requestDate || '';
        valB = b.requestDate || '';
      } else if (sortConfig.key === 'clientName') {
        valA = `${a.firstName} ${a.lastName}`.toLowerCase();
        valB = `${b.firstName} ${b.lastName}`.toLowerCase();
      } else {
        // Default to createdAt if no key matches
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
        valA = dateA;
        valB = dateB;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [insurances, searchTerm, statusFilter, planFilter, policyTypeFilter, dateRange, requestDateRange, validityRange, operationalStatusFilter, caremedExportedFilter, caremedInvoicedFilter, policies, clientTypeFilter, agentFilter, subAgentFilter, actionTypeFilter, clients, sortConfig]);

  // Reset page and selection when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedInsuranceIds([]);
  }, [searchTerm, statusFilter, planFilter, policyTypeFilter, dateRange, requestDateRange, validityRange, operationalStatusFilter, caremedExportedFilter, caremedInvoicedFilter, clientTypeFilter, agentFilter, subAgentFilter, actionTypeFilter]);

  const paginatedInsurances = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredInsurances.slice(startIndex, startIndex + pageSize);
  }, [filteredInsurances, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredInsurances.length / pageSize);

  const summaryStats = useMemo(() => {
    let count = 0;
    let ventas = 0;
    let costo = 0;
    let comisiones = 0;

    filteredInsurances.forEach(i => {
      count++;
      const mul = i.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      ventas += (i.totalFinal || i.totalPrice || 0) * mul;
      costo += (i.totalCost || 0) * mul;
      comisiones += (i.agentCommission || 0) * mul;
    });

    return { count, ventas, costo, comisiones };
  }, [filteredInsurances]);

  const handleDownloadInsurances = () => {
    if (filteredInsurances.length === 0) return;

    const dataToExport = filteredInsurances.map(item => {
      const ins = item as any;
      const client = clients.find(c => c.id === ins.clientId);
      const clientName = ins.clientType === 'Individual' ? 'Individual' : (client?.commercialName || client?.legalName || 'Faltante');
      const creationDate = ins.createdAt ? (ins.createdAt.toDate ? format(ins.createdAt.toDate(), 'yyyy-MM-dd HH:mm:ss') : format(new Date(ins.createdAt), 'yyyy-MM-dd HH:mm:ss')) : '';

      return {
        'IDSeg': ins.IDseg || '',
        'ID Interno': ins.id || '',
        'Nombre': ins.firstName || '',
        'Apellido': ins.lastName || '',
        'Sexo': ins.gender || '',
        'Email': ins.email || '',
        'Fecha de Nacimiento': ins.birthDate || '',
        'Edad': ins.age || '',
        'Solicitud': ins.requestDate || '',
        'Acción': ins.actionType || 'NEW',
        'Origen': ins.originCountry || '',
        'Destino': ins.destinationCountry || '',
        'Ciudad': ins.city || '',
        'Inicio': ins.startDate || '',
        'Fin': ins.endDate || '',
        'Días': ins.days || '',
        'Seguro': ins.policyName || '',
        'Plan': ins.plan || '',
        'Tipo de Cliente': ins.clientType || '',
        'Cliente/Agente/Corp': clientName,
        'Agente Vinculado (Email)': ins.linkedAgentId || '',
        'Importe USD': ins.totalPrice || 0,
        'Importe MXP': ins.priceMXP || 0,
        'Descuento USD': ins.discount || 0,
        'Total Cobrado USD': ins.totalFinal || 0,
        'Costo USD': ins.totalCost || 0,
        'Comisión Agencia USD': ins.agentCommission || 0,
        'Total Pagado USD': ins.totalPaid || 0,
        'Estado de Emisión': ins.status === 'pending' ? 'Pendiente' : ins.status === 'reviewed' ? 'Revisado' : ins.status === 'issued' ? 'Emitido' : ins.status === 'cancelled' ? 'Cancelado' : ins.status,
        'Fecha de Creación': creationDate,
        'Deportes Extremos': ins.isExtremeSports ? 'Sí' : 'No',
        'Notas': ins.notes || ''
      };
    });

    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = format(new Date(), 'yyyyMMdd_HHmmss');
    link.download = `polizas_exportadas_${dateStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCareMedCSV = async () => {
    if (selectedInsuranceIds.length === 0) {
      alert('Por favor selecciona al menos una póliza para exportar a CareMed.');
      return;
    }

    try {
      const selectedInsurancesList = insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
      const exportDateString = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

      const dataToExport = selectedInsurancesList.map(item => {
        const ins = item as any;
        const policy = findMatchingPolicy(ins, policies);

        return {
          'Sponsor_Code': policy?.SponsorCode || '',
          'Policy_Number': policy?.CodigoPoliza || '',
          'Transaction_Type': ins.actionType || 'NEW',
          'Last_Name': ins.lastName || '',
          'First_Name': ins.firstName || '',
          'Gender': ins.gender || '',
          'Birth_Date': formatDateToYYYYMMDD(ins.birthDate || ''),
          'Start_Date': formatDateToYYYYMMDD(ins.startDate || ''),
          'End_Date': formatDateToYYYYMMDD(ins.endDate || ''),
          'Enrollment_Cell_Code': policy?.CodigoExportacion || '',
          'Insurance_Type': 'MED',
          'Country_Of_Origin': ins.originCountry || '',
          'Country_Of_Destination': ins.destinationCountry || '',
          'DEST_CITY_NAME': ins.city || '',
          'Sponsor_Prog_Name': '',
          'Sponsor_Partic_ID': '',
          'E_MAIL_ADDRESS': policy?.E_Mail_Address || ''
        };
      });

      // Update documents in Firestore with Caremed export date
      const updatePromises = selectedInsurancesList.map(async (ins) => {
        if (ins.id) {
          await updateDoc(doc(db, 'insurances', ins.id), {
            Caremed: exportDateString
          });
        }
      });
      await Promise.all(updatePromises);

      const csv = Papa.unparse(dataToExport);
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateStr = format(new Date(), 'yyyyMMdd_HHmmss');
      link.download = `caremed_export_${dateStr}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      alert(`Se exportaron con éxito ${selectedInsurancesList.length} pólizas. Se actualizó la fecha de exportación CareMed.`);
    } catch (err: any) {
      console.error(err);
      alert('Ocurrió un error al exportar a CareMed: ' + err.message);
    }
  };

  const [selectedInsuranceIds, setSelectedInsuranceIds] = useState<string[]>([]);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  const handleToggleSelectInsurance = (id: string) => {
    if (!id) return;
    setSelectedInsuranceIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllCurrentPage = () => {
    const currentIds = paginatedInsurances.map(i => i.id).filter((id): id is string => !!id);
    const allAlreadySelected = currentIds.every(id => selectedInsuranceIds.includes(id));
    
    if (allAlreadySelected) {
      setSelectedInsuranceIds(prev => prev.filter(id => !currentIds.includes(id)));
    } else {
      setSelectedInsuranceIds(prev => {
        const newSelections = currentIds.filter(id => !prev.includes(id));
        return [...prev, ...newSelections];
      });
    }
  };

  const [isBulkSending, setIsBulkSending] = useState(false);
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false);
  const [bulkSendProgress, setBulkSendProgress] = useState<{ current: number, total: number, statusText: string } | null>(null);

  const formatDateToYYYYMMDD = (dateVal: any): string => {
    if (!dateVal) return '';

    let cleanStr = '';
    if (typeof dateVal === 'string') {
      cleanStr = dateVal.trim();
    } else if (dateVal instanceof Date) {
      if (isNaN(dateVal.getTime())) return '';
      const year = dateVal.getFullYear();
      const month = String(dateVal.getMonth() + 1).padStart(2, '0');
      const day = String(dateVal.getDate()).padStart(2, '0');
      return `${year}/${month}/${day}`;
    } else if (typeof dateVal === 'object') {
      if (typeof dateVal.toDate === 'function') {
        const d = dateVal.toDate();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
      } else if (dateVal.seconds) {
        const d = new Date(dateVal.seconds * 1000);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
      } else {
        cleanStr = String(dateVal);
      }
    } else {
      cleanStr = String(dateVal);
    }

    if (!cleanStr) return '';

    // Check if format is YYYY-MM-DD or YYYY/MM/DD or similar:
    const matchYMD = cleanStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchYMD) {
      const year = matchYMD[1];
      const month = matchYMD[2].padStart(2, '0');
      const day = matchYMD[3].padStart(2, '0');
      return `${year}/${month}/${day}`;
    }

    // Check if format is DD-MM-YYYY or DD/MM/YYYY or similar:
    const matchDMY = cleanStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchDMY) {
      const day = matchDMY[1].padStart(2, '0');
      const month = matchDMY[2].padStart(2, '0');
      const year = matchDMY[3];
      return `${year}/${month}/${day}`;
    }

    // Try normal JS parsing as fallback
    try {
      const d = new Date(cleanStr);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
      }
    } catch (e) {
      // ignore
    }

    return cleanStr.replace(/-/g, '/');
  };

  const handleBulkSendEmails = async (config: {
    selectedLanguages: string[];
    ccEmails: string[];
    subjectTemplate: string;
    bodyTemplate: string;
    fallbackToDefault: boolean;
  }) => {
    const selectedInsurancesList = insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
    if (selectedInsurancesList.length === 0) {
      alert('Por favor selecciona al menos una póliza para enviar por correo.');
      return;
    }

    setIsBulkSending(true);
    setShowBulkEmailModal(false);
    setBulkSendProgress({ current: 0, total: selectedInsurancesList.length, statusText: 'Iniciando generación de certificados...' });

    const successes: string[] = [];
    const failures: { name: string; error: string }[] = [];

    for (let i = 0; i < selectedInsurancesList.length; i++) {
      const ins = selectedInsurancesList[i];
      const fullName = `${ins.firstName} ${ins.lastName}`;
      const emailTo = ins.email ? ins.email.trim() : '';

      setBulkSendProgress({
        current: i,
        total: selectedInsurancesList.length,
        statusText: `Procesando ${fullName} (${emailTo || 'Sin correo'})...`
      });

      if (!emailTo) {
        failures.push({ name: fullName, error: 'La póliza no tiene un correo electrónico registrado.' });
        continue;
      }

      try {
        const policy = policies.find(p => p.id === ins.policyId || (p.CodigoPoliza && p.CodigoPoliza === ins.policyId) || p.name === ins.policyId);
        const policyCode = policy?.CodigoPoliza || policy?.id || ins.policyId || '';
        const policyName = policy?.name || policy?.NombrePoliza || ins.policyName || '';
        const policyInfo = policyCode && policyName ? `${policyCode} - ${policyName}` : (policyCode || policyName || '');

        const formatToShow = (dateVal: any) => {
          if (!dateVal) return '';
          try {
            const parsed = parseISO(dateVal);
            if (isValid(parsed)) return format(parsed, 'dd/MM/yyyy');
            const d = new Date(dateVal);
            if (isValid(d)) return format(d, 'dd/MM/yyyy');
          } catch (e) {}
          return String(dateVal);
        };

        const replaceAllPlaceholders = (template: string) => {
          if (!template) return '';
          return template
            .replace(/{nombre}/g, fullName)
            .replace(/{Nombre}/g, fullName)
            .replace(/{fecha_nacimiento}/g, formatToShow(ins.birthDate))
            .replace(/{Fecha_nacimiento}/g, formatToShow(ins.birthDate))
            .replace(/Codigo de la Poliza\s+-\s+Nombre Póliza \(Admin\)/g, policyInfo)
            .replace(/Codigo de la Poliza\s+-\s+Nombre Póliza/g, policyInfo)
            .replace(/{poliza_info}/g, policyInfo)
            .replace(/{poliza}/g, policyInfo)
            .replace(/{Poliza}/g, policyInfo)
            .replace(/{Pais Origen}/g, ins.originCountry || 'México')
            .replace(/{origen}/g, ins.originCountry || 'México')
            .replace(/{Pais Destino}/g, ins.destinationCountry || '')
            .replace(/{destino}/g, ins.destinationCountry || '')
            .replace(/{Fecha_inicio}/g, formatToShow(ins.startDate))
            .replace(/{fecha_inicio}/g, formatToShow(ins.startDate))
            .replace(/{Fecha_Final}/g, formatToShow(ins.endDate))
            .replace(/{fecha_final}/g, formatToShow(ins.endDate));
        };

        const subject = replaceAllPlaceholders(config.subjectTemplate);
        const body = replaceAllPlaceholders(config.bodyTemplate);

        const relevantLetters = sortLettersByLanguage(
          policyLetters.filter(l => l.policyId === (policy?.id || ins.policyId))
        );

        const pdfs: { filename: string, data: string }[] = [];
        const selectedLetters = relevantLetters.filter(l => config.selectedLanguages.includes(l.language));

        if (selectedLetters.length === 0) {
          if (config.fallbackToDefault) {
            const docObj: any = await generatePDF(ins, undefined, policies, settings?.logoUrl, true);
            const base64 = docObj.output('datauristring').split(',')[1];
            pdfs.push({
              filename: `Certificado_Seguro_${ins.lastName}.pdf`,
              data: base64
            });
          } else {
            failures.push({ name: fullName, error: 'No se encontraron cartas de los idiomas seleccionados para esta póliza.' });
            continue;
          }
        } else {
          for (const letter of selectedLetters) {
            const docObj: any = await generatePDF(ins, letter, policies, settings?.logoUrl, true);
            const base64 = docObj.output('datauristring').split(',')[1];
            pdfs.push({
              filename: `Certificado_${ins.lastName}_${letter.language}.pdf`,
              data: base64
            });
          }
        }

        const response = await fetch('/api/send-certificate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: [emailTo],
            cc: config.ccEmails,
            subject,
            body,
            pdfs
          }),
        });

         if (!response.ok) {
          let errMessage = 'Error de envío de correo en servidor';
          try {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const errData = await response.json();
              errMessage = errData.error || errMessage;
              if (errData.details) {
                errMessage += ` (Detalles: ${errData.details})`;
              }
            } else {
              const text = await response.text();
              if (text && text.length < 250) {
                errMessage = text;
              }
            }
          } catch (e) {}
          throw new Error(errMessage);
        }

        successes.push(fullName);
      } catch (err: any) {
        console.error(`Error sending bulk email for ${fullName}:`, err);
        failures.push({ name: fullName, error: err.message || 'Error desconocido' });
      }
    }

    setIsBulkSending(false);
    setBulkSendProgress(null);

    let summaryMessage = `Envío masivo finalizado.\n\n`;
    if (successes.length > 0) {
      summaryMessage += `✓ Enviado con éxito a ${successes.length} pasajeros:\n${successes.slice(0, 10).join(', ')}${successes.length > 10 ? ' y más...' : ''}\n\n`;
    }
    if (failures.length > 0) {
      summaryMessage += `✗ Fallas en ${failures.length} pasajeros:\n${failures.map(f => `- ${f.name}: ${f.error}`).join('\n')}\n`;
    }

    alert(summaryMessage);
    setSelectedInsuranceIds([]);
  };

  const handleBulkSendEmailsClick = () => {
    const selectedInsurancesList = insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
    if (selectedInsurancesList.length === 0) {
      alert('Por favor selecciona al menos una póliza para enviar por correo.');
      return;
    }
    setShowBulkEmailModal(true);
  };

  const handleDeleteSelectedInsurances = async () => {
    if (selectedInsuranceIds.length === 0) return;
    setIsDeletingSelected(true);
    try {
      let batches: any[] = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;

      const addOp = () => {
        opCount++;
        if (opCount >= 400) {
          batches.push(currentBatch);
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      };

      for (const id of selectedInsuranceIds) {
        currentBatch.delete(doc(db, 'insurances', id));
        addOp();
      }

      if (opCount > 0) {
        batches.push(currentBatch);
      }

      await Promise.all(batches.map(b => b.commit()));

      setSelectedInsuranceIds([]);
      setShowDeleteSelectedConfirm(false);
      alert('Las pólizas seleccionadas han sido eliminadas.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'insurances_selected');
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const handleDeleteInsurance = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'insurances', id));
      setInsuranceToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'insurances');
    }
  };

  const handleConfirmCommission = async (id: string) => {
    try {
      await updateDoc(doc(db, 'insurances', id), {
        commissionStatus: 'confirmed'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `insurances/${id}`);
    }
  };

  const handleConfirmPayments = async (insuranceId: string) => {
    try {
      const q = query(collection(db, 'payments'), where('insuranceId', '==', insuranceId), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      
      const batch = snap.docs.map(d => updateDoc(d.ref, { status: 'completed', date: new Date() }));
      await Promise.all(batch);
      
      const insRef = doc(db, 'insurances', insuranceId);
      const insSnap = await getDoc(insRef);
      if (insSnap.exists()) {
        const insData = insSnap.data() as InsuranceRequest;
        const totalPrice = insData.totalFinal || insData.totalPrice;
        
        const qAll = query(collection(db, 'payments'), where('insuranceId', '==', insuranceId), where('status', '==', 'completed'));
        const allSnap = await getDocs(qAll);
        const newTotalPaid = allSnap.docs.reduce((acc, d) => acc + (d.data().amount || 0), 0);
        
        let newStatus = insData.status;
        if (newTotalPaid >= totalPrice) {
          newStatus = 'paid';
        } else if (newTotalPaid > 0) {
          newStatus = 'partially_paid';
        }
        
        await updateDoc(insRef, {
          totalPaid: newTotalPaid,
          status: newStatus
        });

        // Trigger WhatsApp notifications based on status after payment confirmation
        try {
          const updatedIns = { ...insData, id: insuranceId, status: newStatus, totalPaid: newTotalPaid };
          if (newStatus === 'paid') {
            triggerWhatsAppNotification('estado_poliza', updatedIns);
          } else if (newStatus === 'partially_paid') {
            triggerWhatsAppNotification('recordatorio_pago', updatedIns);
          }
        } catch (waErr) {
          console.error("Error triggering WhatsApp from PoliciesManager:", waErr);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `payments for ${insuranceId}`);
    }
  };

  const getCountryCode = (countryName: string) => {
    const country = COUNTRIES.find(c => c.name === countryName);
    return country ? country.code : countryName;
  };

  const getPlanLabel = (plan: string) => {
    const mapping: Record<string, string> = {
      'U6': 'U6',
      'O70': 'O70',
      'Traveler': 'Traveller',
      'Student': 'Student'
    };
    return mapping[plan] || plan;
  };

  const getInsuranceTypeLabel = (policyId: string) => {
    // Extracting type and deductible info from policyId or common patterns
    let label = '';
    if (policyId.includes('Oro')) label = 'Oro';
    else if (policyId.includes('Plata')) label = 'Plata';
    else if (policyId.includes('Bronce')) label = 'Bronce';
    else return '-';

    if (policyId.toLowerCase().includes('sin')) label += ' sin deducible';
    else label += ' con deducible';
    
    return label;
  };

  const handleDownloadCertificate = async (insurance: InsuranceRequest) => {
    // Find the actual policy document to get its consistent ID
    // Some insurance records might have CodigoPoliza or name as policyId if imported/old
    const policy = policies.find(p => 
      p.id === insurance.policyId || 
      (p.CodigoPoliza && p.CodigoPoliza === insurance.policyId) ||
      p.name === insurance.policyId
    );

    const actualPolicyId = policy ? policy.id : insurance.policyId;
    const available = policyLetters.filter(l => l.policyId === actualPolicyId);
    
    if (available.length === 0) {
      // Fallback: If no letters found by direct ID, check if any letter is linked to a policy 
      // with the same name as the insurance's policyName
      const alternativeLetters = policyLetters.filter(l => {
        const letterPolicy = policies.find(p => p.id === l.policyId);
        return letterPolicy && (
          letterPolicy.name === insurance.policyName || 
          (letterPolicy.CodigoPoliza && letterPolicy.CodigoPoliza === insurance.policyId)
        );
      });

      if (alternativeLetters.length > 0) {
        const sortedAlt = sortLettersByLanguage(alternativeLetters);
        const preferredLangs = ['es', 'en', 'policy', 'covid'];
        const preselected = sortedAlt
          .map(l => l.language)
          .filter(lang => preferredLangs.includes(lang));
        setLanguageModal({
          isOpen: true,
          insurance,
          availableLetters: sortedAlt,
          selectedLanguages: preselected.length > 0 ? preselected : [sortedAlt[0].language]
        });
        return;
      }

      alert('No se encontraron cartas vinculadas a esta póliza en el catálogo. Se generará el formato por defecto.');
      await generatePDF(insurance, undefined, policies, settings?.logoUrl);
      return;
    }

    const sortedAvailable = sortLettersByLanguage(available);
    const preferredLangs = ['es', 'en', 'policy', 'covid'];
    const preselected = sortedAvailable
      .map(l => l.language)
      .filter(lang => preferredLangs.includes(lang));
    setLanguageModal({
      isOpen: true,
      insurance,
      availableLetters: sortedAvailable,
      selectedLanguages: preselected.length > 0 ? preselected : [sortedAvailable[0].language]
    });
  };

  const handleConfirmLanguages = async () => {
    if (!languageModal.insurance) return;

    if (languageModal.selectedLanguages.length > 1) {
      const pdfsForZip: { filename: string; data: any }[] = [];
      for (const lang of languageModal.selectedLanguages) {
        const template = languageModal.availableLetters.find(l => l.language === lang);
        const doc: any = await generatePDF(languageModal.insurance!, template, policies, settings?.logoUrl, true);
        const filename = `Carta_Seguro_${languageModal.insurance.firstName}_${languageModal.insurance.lastName}_${lang}.pdf`;
        pdfsForZip.push({ filename, data: doc.output('blob') });
      }
      const zipBlob = await createZipFromPdfs(pdfsForZip);
      downloadBlob(zipBlob, `Cartas_Seguro_${languageModal.insurance.firstName}_${languageModal.insurance.lastName}.zip`);
    } else {
      for (const lang of languageModal.selectedLanguages) {
        const template = languageModal.availableLetters.find(l => l.language === lang);
        await generatePDF(languageModal.insurance!, template, policies, settings?.logoUrl);
      }
    }

    setLanguageModal(prev => ({ ...prev, isOpen: false }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {tab === 'caremed' ? 'Exportación Caremed' : tab === 'invoices' ? 'Invoices CareMed' : 'Gestión de Pólizas'}
          </h1>
          <p className="text-gray-500">
            {tab === 'caremed' 
              ? 'Consulte y visualice de manera eficiente las pólizas exportadas' 
              : tab === 'invoices' 
                ? 'Historial de lotes con números de invoice Caremed asignados' 
                : 'Listado completo de seguros solicitados y emitidos'}
          </p>
        </div>
        {tab !== 'caremed' && tab !== 'invoices' && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadInsurances}
              disabled={filteredInsurances.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-xl font-bold border border-green-100 hover:bg-green-100 transition-all shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Descargar la lista de pólizas actual en formato CSV"
            >
              <Download className="w-4 h-4" />
              Descargar Pólizas
            </button>

            {isSuperAdminOrDirector && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAllCurrentPage}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 rounded-xl font-bold border border-gray-200 hover:bg-gray-100 transition-all shadow-sm text-xs"
                  title="Seleccionar o deseleccionar todas las pólizas de la página actual"
                >
                  {paginatedInsurances.map(i => i.id).filter((id): id is string => !!id).every(id => selectedInsuranceIds.includes(id)) 
                    ? 'Deseleccionar Página' 
                    : 'Seleccionar Página'
                  }
                </button>
                {selectedInsuranceIds.length > 0 && (
                  <>
                    <button
                      onClick={() => setSelectedInsuranceIds([])}
                      className="text-xs text-gray-500 hover:text-gray-700 font-bold px-2 py-2 transition-all"
                      title="Limpiar selección actual"
                    >
                      Limpiar ({selectedInsuranceIds.length})
                    </button>
                    {isSuperAdmin && (
                      <button
                        onClick={() => setShowDeleteSelectedConfirm(true)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 text-rose-600 rounded-xl font-bold border border-rose-100 hover:bg-rose-100 transition-all shadow-sm text-xs animate-in fade-in duration-200"
                        title="Eliminar pólizas seleccionadas"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Borrar ({selectedInsuranceIds.length})
                      </button>
                    )}
                    <button
                      onClick={handleDownloadCareMedCSV}
                      className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold border border-indigo-700 transition-all shadow-lg hover:shadow-xl shadow-indigo-100 hover:shadow-indigo-200 text-xs animate-in fade-in duration-200 cursor-pointer"
                      title="Registrar y exportar pólizas seleccionadas para CareMed"
                    >
                      <Download className="w-3.5 h-3.5" />
                      CareMed ({selectedInsuranceIds.length})
                    </button>
                    <button
                      onClick={handleBulkSendEmailsClick}
                      disabled={isBulkSending}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold border border-blue-700 transition-all shadow-lg hover:shadow-xl shadow-blue-100 hover:shadow-blue-200 text-xs animate-in fade-in duration-200 cursor-pointer disabled:opacity-50"
                      title="Enviar certificados por correo a todos los viajeros seleccionados"
                    >
                      {isBulkSending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      Envío Masivo ({selectedInsuranceIds.length})
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                title="Vista de Tarjetas"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                title="Vista de Listado"
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </header>

      {tab === 'caremed' ? (
        <div className="space-y-6">
          {/* Summary stats row for Caremed */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between animate-in fade-in duration-300">
              <div>
                <p className="text-2xl font-black text-gray-900">{caremedExports.length}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Exportaciones Totales</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <Upload className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between animate-in fade-in duration-300">
              <div>
                <p className="text-2xl font-black text-gray-900">
                  {caremedExports.reduce((sum, exp) => sum + exp.count, 0)}
                </p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pólizas Exportadas</p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <ShieldCheck className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between animate-in fade-in duration-300">
              <div>
                <p className="text-md font-bold text-gray-900 truncate max-w-[200px]">
                  {caremedExports.length > 0 
                    ? format(parseISO(caremedExports[0].exportDate.substring(0, 10)), "dd 'de' MMMM, yyyy", { locale: es })
                    : 'N/A'
                  }
                </p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">Última Exportación</p>
              </div>
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                <Calendar className="w-6 h-6" />
              </div>
            </div>
          </div>

          {allCaremedExports.length === 0 ? (
            <div className="bg-white p-16 rounded-2xl border border-gray-100 text-center text-gray-400 flex flex-col items-center gap-3">
              <div className="p-4 bg-gray-50 text-gray-450 rounded-full">
                <AlertTriangle className="w-12 h-12" />
              </div>
              <p className="text-lg font-bold text-gray-700">No hay exportaciones registradas</p>
              <p className="text-sm text-gray-400 max-w-md">
                Las pólizas que exporte a Caremed utilizando el botón "CareMed" en el listado de pólizas general aparecerán registradas aquí automáticamente.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Caremed Sub-Tabs Panel */}
              <div className="flex border-b border-gray-150 gap-6">
                <button
                  type="button"
                  onClick={() => setCaremedSubTab('pending')}
                  className={`pb-3 text-sm font-bold transition-all relative ${
                    caremedSubTab === 'pending'
                      ? 'text-indigo-600 border-b-2 border-indigo-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    Asignación de Invoices (Pendientes)
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setCaremedSubTab('history')}
                  className={`pb-3 text-sm font-bold transition-all relative ${
                    caremedSubTab === 'history'
                      ? 'text-indigo-600 border-b-2 border-indigo-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Historial Completo de Archivos (CSV)
                  </span>
                </button>
              </div>
              {/* Caremed Search Filters */}
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-5 items-end">
                <div className="flex-1 w-full space-y-1.5">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
                    Buscar Asegurado (Nombre, País o Cód. de Póliza)
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Ej. Juan Pérez, España, POL-1234..."
                      value={caremedInsuredSearch}
                      onChange={(e) => setCaremedInsuredSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs transition-all text-gray-800 placeholder-gray-400"
                    />
                    {caremedInsuredSearch && (
                      <button
                        onClick={() => setCaremedInsuredSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full hover:bg-gray-100/50"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="w-full md:w-64 space-y-1.5">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block">
                    Filtrar por Fecha de Exportación
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      type="date"
                      value={caremedDateFilter}
                      onChange={(e) => setCaremedDateFilter(e.target.value)}
                      className="w-full pl-9 pr-8 py-2.5 bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-xs transition-all text-gray-800 font-medium"
                    />
                    {caremedDateFilter && (
                      <button
                        onClick={() => setCaremedDateFilter('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full hover:bg-gray-100/50"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {(caremedInsuredSearch || caremedDateFilter) && (
                  <button
                    onClick={() => {
                      setCaremedInsuredSearch('');
                      setCaremedDateFilter('');
                    }}
                    className="w-full md:w-auto px-5 py-2.5 bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer hover:shadow-sm"
                  >
                    Restablecer Filtros
                  </button>
                )}
              </div>

              {caremedSubTab === 'pending' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: List of Export Batches */}
                <div className="lg:col-span-1 space-y-3">
                  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col h-full">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                      Historial de Lotes
                    </h3>
                    
                    {filteredCaremedExports.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 text-xs font-medium bg-gray-50/50 border border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-gray-400" />
                        <span>No hay lotes que coincidan con la búsqueda.</span>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1 flex-1">
                        {filteredCaremedExports.map((batch) => {
                          const isActive = selectedExportDate === batch.exportDate;
                          let displayDate = batch.exportDate;
                          try {
                            const parsedDate = parseISO(batch.exportDate.substring(0, 10));
                            displayDate = format(parsedDate, "dd 'de' MMM, yyyy", { locale: es });
                          } catch (e) {}

                          const displayTime = batch.exportDate.substring(11, 19);

                          return (
                            <div
                              key={batch.exportDate}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedExportDate(batch.exportDate);
                                setCaremedSearchTerm('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedExportDate(batch.exportDate);
                                  setCaremedSearchTerm('');
                                }
                              }}
                              className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative group cursor-pointer ${
                                isActive
                                  ? 'bg-indigo-50/75 border-indigo-200 ring-2 ring-indigo-50/20'
                                  : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                              }`}
                            >
                              {isActive && (
                                <div className="absolute right-3 top-3 w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />
                              )}
                              <div className="flex items-center gap-2">
                                <Calendar className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                                <span className="font-bold text-xs text-gray-800">{displayDate}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium pl-6 w-full mt-1">
                                <div className="flex flex-col gap-1">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                                    {displayTime}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] w-fit ${
                                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {batch.count} {batch.count === 1 ? 'póliza' : 'pólizas'}
                                  </span>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedBatchForDetail(batch);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 text-indigo-700 rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-sm"
                                  title="Ver lista de pólizas en vista de lectura"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver Detalle
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Policies inside active Export Batch */}
                <div className="lg:col-span-2 space-y-4 font-sans">
                  {(() => {
                    const activeBatch = filteredCaremedExports.find(b => b.exportDate === selectedExportDate);
                    if (!activeBatch) {
                      return (
                        <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
                          {filteredCaremedExports.length === 0 
                            ? 'No se encontraron lotes que coincidan con la búsqueda.'
                            : 'Selecciona un lote de exportación de la lista para visualizar las pólizas incluidas.'
                          }
                        </div>
                      );
                    }

                    const filteredBatchPolicies = activeBatch.policies.filter(ins => {
                      const search = caremedSearchTerm.toLowerCase();
                      const globalSearch = caremedInsuredSearch.toLowerCase();
                      
                      const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
                      const origin = (ins.originCountry || '').toLowerCase();
                      const dest = (ins.destinationCountry || '').toLowerCase();
                      const policyId = (ins.policyId || '').toLowerCase();
                      
                      if (search && !fullName.includes(search) && !origin.includes(search) && !dest.includes(search) && !policyId.includes(search)) {
                        return false;
                      }

                      if (globalSearch && !fullName.includes(globalSearch) && !origin.includes(globalSearch) && !dest.includes(globalSearch) && !policyId.includes(globalSearch)) {
                        return false;
                      }
                      
                      return true;
                    });

                    return (
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                        {/* Batch Details Header */}
                        <div className="p-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="text-gray-800 font-bold text-sm">
                              Pólizas Exportadas el {activeBatch.exportDate}
                            </div>
                            <div className="text-xs text-gray-500 mt-1 font-medium">
                              Total de pólizas en este lote: <span className="font-bold text-gray-800">{activeBatch.count}</span>
                              {filteredBatchPolicies.length !== activeBatch.count && (
                                <span className="ml-1.5 text-indigo-600 font-semibold">(Coinciden {filteredBatchPolicies.length})</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownloadSpecificCareMedCSV(activeBatch.exportDate, activeBatch.policies)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer w-fit"
                            title="Volver a descargar el archivo CSV original de esta exportación"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Descargar CSV
                          </button>
                        </div>

                        {/* Search Filter for the active batch */}
                        <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-white">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Filtro rápido dentro de este lote..."
                              value={caremedSearchTerm}
                              onChange={(e) => setCaremedSearchTerm(e.target.value)}
                              className="w-full pl-9 pr-8 py-2 bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-xs transition-all"
                            />
                            {caremedSearchTerm && (
                              <button
                                onClick={() => setCaremedSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold leading-none"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Policies Table */}
                        {/* Invoice Messages or Bulk Actions Banner */}
                        {(invoiceMessage || caremedSelectedIds.length > 0) && (
                          <div className="p-4 border-b border-gray-100 bg-gray-50 flex flex-col gap-3 font-sans transition-all">
                            {invoiceMessage && (
                              <div className={`p-2.5 rounded-xl text-xs font-bold ${
                                invoiceMessage.type === 'success' 
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                  : 'bg-rose-50 text-rose-700 border border-rose-100'
                              }`}>
                                {invoiceMessage.text}
                              </div>
                            )}
                            {caremedSelectedIds.length > 0 && (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/50 border border-indigo-100/60 p-3.5 rounded-xl animate-in translate-y-0.5 duration-200">
                                <div>
                                  <h4 className="text-xs font-bold text-indigo-905">
                                    Asignación Masiva de Invoices CareMed
                                  </h4>
                                  <p className="text-[10px] text-indigo-700 font-medium mt-0.5">
                                    Has seleccionado <span className="font-bold">{caremedSelectedIds.length}</span> {caremedSelectedIds.length === 1 ? 'póliza' : 'pólizas'} de este lote.
                                  </p>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    placeholder="Nº de Invoice (ej: CM-2026-001)"
                                    value={invoiceInput}
                                    onChange={(e) => setInvoiceInput(e.target.value)}
                                    className="px-3 py-1.5 bg-white border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-xs rounded-lg outline-none min-w-[200px] font-sans text-gray-800"
                                  />
                                  <button
                                    onClick={handleAssignInvoiceCaremed}
                                    disabled={invoiceSaving || !invoiceInput.trim()}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all shadow-sm shadow-indigo-100 cursor-pointer"
                                  >
                                    {invoiceSaving ? 'Guardando...' : 'Asignar Invoice'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="overflow-x-auto">
                          {filteredBatchPolicies.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 text-xs font-bold">
                              No hay pólizas que coincidan con la búsqueda en este lote.
                            </div>
                          ) : (
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-gray-50/50 text-[10px] uppercase font-bold text-gray-400 tracking-wider border-b border-gray-100">
                                  <th className="px-4 py-3 w-10">
                                    <input
                                      type="checkbox"
                                      checked={filteredBatchPolicies.length > 0 && filteredBatchPolicies.every(i => i.id && caremedSelectedIds.includes(i.id))}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          const allIds = filteredBatchPolicies.map(i => i.id).filter((id): id is string => !!id);
                                          setCaremedSelectedIds(allIds);
                                        } else {
                                          setCaremedSelectedIds([]);
                                        }
                                      }}
                                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                                    />
                                  </th>
                                  <th className="px-4 py-3">Asegurado</th>
                                  <th className="px-4 py-3">Asociación / Canal</th>
                                  <th className="px-4 py-3">Destino</th>
                                  <th className="px-4 py-3">Plan / Fechas</th>
                                  <th className="px-4 py-3 text-right">Acción</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {filteredBatchPolicies.map((i) => {
                                  const client = clients.find(c => c.id === i.clientId);
                                  const isIndividual = i.clientType === 'Individual' || (!i.clientType && (!i.clientId || i.clientId === 'Individual'));
                                  
                                  const clientLabel = i.clientType === 'Agent' ? 'Agente' : 'Corp';
                                  const clientName = client ? (client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim()) : 'Fal.';
                                  
                                  const subAgent = client?.linkedAgents?.find((la: any) => la.email === i.linkedAgentId || la.id === i.linkedAgentId);
                                  const subAgentName = subAgent ? subAgent.name : i.linkedAgentId;

                                  return (
                                    <tr key={i.id} className="hover:bg-gray-50/30 transition-all font-medium text-gray-750">
                                      <td className="px-4 py-3.5 w-10">
                                        <input
                                          type="checkbox"
                                          checked={!!i.id && caremedSelectedIds.includes(i.id)}
                                          onChange={(e) => {
                                            if (!i.id) return;
                                            if (e.target.checked) {
                                              setCaremedSelectedIds(prev => [...prev, i.id!]);
                                            } else {
                                              setCaremedSelectedIds(prev => prev.filter(id => id !== i.id));
                                            }
                                          }}
                                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                                        />
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="font-bold text-gray-900 text-xs">{i.firstName} {i.lastName}</span>
                                          <span className="text-[10px] text-gray-400">Nacimiento: {i.birthDate} ({i.age} años)</span>
                                          {i.InvoiceCaremed && (
                                            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 w-fit" title="Número de Invoice Caremed">
                                              Invoice: {i.InvoiceCaremed}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5">
                                        {isIndividual ? (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-200">
                                            <User className="w-2.5 h-2.5" /> Individual
                                          </span>
                                        ) : (
                                          <div className="flex flex-col text-[10px] leading-tight">
                                            <span className="font-semibold text-indigo-700 flex items-center gap-1">
                                              {i.clientType === 'Agent' ? <Users className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                                              {clientLabel}: {clientName}
                                            </span>
                                            {subAgentName && (
                                              <span className="text-[9px] text-gray-400 pl-4 mt-0.5">• Sub: {subAgentName}</span>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <div className="flex flex-col leading-none">
                                          <span className="font-semibold text-gray-800">{i.destinationCountry}</span>
                                          <span className="text-[9px] text-gray-400 mt-1">{i.originCountry} → {i.city || '-'}</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5">
                                        <div className="flex flex-col gap-0.5 text-[10px]">
                                          <span className="font-bold text-indigo-600 uppercase tracking-tighter">{i.plan}</span>
                                          <span className="text-[9px] font-sans text-gray-400">{i.startDate} al {i.endDate}</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5 text-right">
                                        <button
                                          onClick={() => setSelectedInsuranceForDetail(i)}
                                          className="inline-flex items-center gap-1.5 p-1.5 text-blue-600 hover:text-white hover:bg-blue-600 rounded-lg border border-blue-100 hover:border-blue-600 transition-all cursor-pointer"
                                          title="Ver detalles completos de la póliza"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col font-sans">
                  <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="text-sm font-bold text-gray-800">
                      Historial General de Archivos Generados
                    </h3>
                    <p className="text-xs text-gray-550 mt-1 font-medium">
                      Consulte todas las descargas/exportaciones CareMed históricas realizadas. Puede descargar nuevamente el archivo CSV original de cada lote o inspeccionar el detalle completo de los asegurados exportados en esa fecha (vista de lectura).
                    </p>
                  </div>

                  {filteredAllCaremedExports.length === 0 ? (
                    <div className="p-16 text-center text-gray-400 text-xs font-bold flex flex-col items-center justify-center gap-2">
                      <AlertTriangle className="w-8 h-8 text-gray-300" />
                      <span>No se encontraron archivos de exportación con los criterios de búsqueda.</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto font-medium">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-gray-50/50 text-[10px] uppercase font-bold text-gray-500 tracking-wider border-b border-gray-100">
                          <tr>
                            <th className="px-5 py-4">Fecha/Hora Exportación</th>
                            <th className="px-5 py-4">Nombre de archivo</th>
                            <th className="px-5 py-4">Cantidad Asegurados</th>
                            <th className="px-5 py-4">Estado Factura</th>
                            <th className="px-5 py-4 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-700">
                          {filteredAllCaremedExports.map((batch) => {
                            const ymd = batch.exportDate.substring(0, 10);
                            const hms = batch.exportDate.substring(11, 19);
                            
                            let parsedDate = parseISO(ymd);
                            if (!isValid(parsedDate)) {
                              parsedDate = new Date();
                            }
                            const formattedDateStr = format(parsedDate, "dd 'de' MMMM, yyyy", { locale: es });
                            const compactDateStr = batch.exportDate.replace(/[- :]/g, '');
                            const filename = `caremed_export_${compactDateStr.substring(0, 8)}_${compactDateStr.substring(8, 14)}.csv`;

                            // Calculate invoiced status
                            const invoicedCount = batch.policies.filter(i => !!i.InvoiceCaremed).length;
                            const isInvoicedComplete = invoicedCount === batch.count;

                            return (
                              <tr key={batch.exportDate} className="hover:bg-gray-50/50 transition-all font-medium">
                                <td className="px-5 py-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-bold text-gray-900 flex items-center gap-1.5">
                                      <Calendar className="w-3.5 h-3.5 text-gray-450" />
                                      {formattedDateStr}
                                    </span>
                                    <span className="text-[10px] text-gray-400 flex items-center gap-1 font-mono">
                                      <Clock className="w-3.5 h-3.5 text-gray-300" />
                                      {hms} HS
                                    </span>
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <span className="font-mono text-[10.5px] text-gray-500 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200">
                                    {filename}
                                  </span>
                                </td>
                                <td className="px-5 py-4 font-sans font-bold">
                                  <span className="inline-flex px-2.5 py-0.5 rounded-lg font-bold text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-sm">
                                    {batch.count} {batch.count === 1 ? 'afiliado' : 'afiliados'}
                                  </span>
                                </td>
                                <td className="px-5 py-4">
                                  {isInvoicedComplete ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[9px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 shadow-sm">
                                      <CheckCircle className="w-3 h-3 text-emerald-600" /> Facturado Completo
                                    </span>
                                  ) : invoicedCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-100 shadow-sm">
                                      {invoicedCount} de {batch.count} Facturadas (Incompleto)
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[9px] font-medium text-gray-500 bg-gray-50 border border-gray-200">
                                      Pendiente Factura
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => handleDownloadSpecificCareMedCSV(batch.exportDate, batch.policies)}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-[10.5px] font-bold transition-all shadow-sm cursor-pointer hover:border-gray-300"
                                      title="Descargar el archivo CSV original de esta exportación"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      Descargar CSV
                                    </button>
                                    <button
                                      onClick={() => setSelectedBatchForDetail(batch)}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10.5px] font-bold transition-all shadow-sm cursor-pointer hover:shadow-indigo-100"
                                      title="Ver detalle completo de los asegurados en modo lectura"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      Ver Asegurados
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : tab === 'invoices' ? (
        <div className="space-y-6">
          {/* Summary stats row for Invoiced */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-gray-900">{caremedInvoicesGrouped.length}</p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Invoices CareMed</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-gray-900">
                  {insurances.filter(ins => !!ins.Caremed && !!ins.InvoiceCaremed).length}
                </p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pólizas Asociadas</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <ShieldCheck className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-2xl font-black text-gray-900">
                  ${caremedInvoicesGrouped.reduce((sum, inv) => sum + inv.totalCalculatedCost, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Acumulado Calculado</p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <FileText className="w-6 h-6" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: List of Invoices */}
            <div className="space-y-4 font-sans">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-gray-800">Filtros de Invoices</h3>
                  <p className="text-xs text-gray-450">Busca por número de invoice o nombre del asegurado.</p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-440 uppercase tracking-wider block mb-1">Buscar Asegurado, Invoice...</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="ej: CM-2026 o Juan Pérez"
                        value={invoicedSearchTerm}
                        onChange={(e) => setInvoicedSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-8 py-1.5 bg-gray-50 border border-gray-200 focus:ring-2 focus:ring-indigo-550 rounded-xl outline-none text-xs transition-with text-gray-800"
                      />
                      {invoicedSearchTerm && (
                        <button
                          onClick={() => setInvoicedSearchTerm('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-450 hover:text-gray-650 text-xs font-bold leading-none"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-440 uppercase tracking-wider block mb-1">Filtrar por Fecha Exportación</label>
                    <input
                      type="date"
                      value={invoicedDateFilter}
                      onChange={(e) => setInvoicedDateFilter(e.target.value)}
                      className="w-full px-3 py-1.5 bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-600 transition-all cursor-pointer"
                    />
                    {invoicedDateFilter && (
                      <button
                        onClick={() => setInvoicedDateFilter('')}
                        className="text-[10px] font-semibold text-rose-500 hover:text-rose-650 mt-1 flex items-center gap-1 cursor-pointer"
                      >
                        Limpiar filtro de fecha
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Invoices Navigation Grid */}
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3 max-h-[500px] overflow-y-auto">
                <div className="text-xs font-bold text-gray-800 border-b border-gray-50 pb-2 flex items-center justify-between">
                  <span>Listado de Invoices ({filteredCaremedInvoices.length})</span>
                </div>

                {filteredCaremedInvoices.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-xs font-bold leading-relaxed">
                    No hay invoices que coincidan con los filtros.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredCaremedInvoices.map((inv) => {
                      const isActive = inv.invoiceNumber === selectedInvoiceNumber;
                      
                      const dbInv = caremedInvoices.find(
                        d => (d.invoiceNumber || '').toLowerCase().trim() === inv.invoiceNumber.toLowerCase().trim()
                      );

                      const totalCalculatedCost = inv.totalCalculatedCost;
                      const hasDbInvoice = !!dbInv;
                      const difference = hasDbInvoice ? (dbInv.amount - totalCalculatedCost) : 0;
                      const isExactMatch = hasDbInvoice && Math.abs(difference) < 0.01;

                      return (
                        <button
                          key={inv.invoiceNumber}
                          onClick={() => {
                            setSelectedInvoiceNumber(inv.invoiceNumber);
                          }}
                          className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative ${
                            isActive
                              ? 'bg-indigo-50/75 border-indigo-200 ring-2 ring-indigo-50/20'
                              : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                          }`}
                        >
                          {isActive && (
                            <div className="absolute right-3 top-3 w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />
                          )}
                          <div className="flex items-center gap-2">
                            <Receipt className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                            <span className="font-extrabold text-xs text-gray-800">Invoice: {inv.invoiceNumber}</span>
                          </div>
                          
                          <div className="text-[10px] text-gray-500 font-medium pl-6 leading-relaxed flex flex-col gap-1">
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <ShieldCheck className="w-3.5 h-3.5 text-gray-450" />
                              <span className="font-bold text-indigo-700">
                                {inv.count} {inv.count === 1 ? 'póliza' : 'pólizas'}
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 flex-wrap text-emerald-700 bg-emerald-50 border border-emerald-100/55 rounded px-1.5 py-0.5 font-bold w-fit mt-0.5">
                              Costo Sistema: ${totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>

                            {hasDbInvoice ? (
                              isExactMatch ? (
                                <span className="mt-1 flex items-center gap-1 text-[9px] text-emerald-850 bg-emerald-50 rounded px-1.5 py-0.5 border border-emerald-200 font-bold w-fit">
                                  ✓ Factura Correcta (${dbInv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                </span>
                              ) : (
                                <span className="mt-1 flex items-center gap-1 text-[9px] text-rose-855 bg-rose-50 rounded px-1.5 py-0.5 border border-rose-200 font-bold w-fit animate-pulse">
                                  ⚠️ Diferencia (${dbInv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} vs ${totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                </span>
                              )
                            ) : (
                              <span className="mt-1 flex items-center gap-1 text-[9px] text-amber-850 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-200 font-medium w-fit">
                                Sin Factura Adjunta
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Policies inside active Invoice */}
            <div className="lg:col-span-2 space-y-4">
              {(() => {
                const activeInvoice = filteredCaremedInvoices.find(inv => inv.invoiceNumber === selectedInvoiceNumber);
                if (!activeInvoice) {
                  return (
                    <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400 text-xs font-semibold">
                      {filteredCaremedInvoices.length === 0 
                        ? 'No se encontraron Invoices asignados.'
                        : 'Selecciona un Invoice de la lista para ver los asegurados y sus importes.'
                      }
                    </div>
                  );
                }

                // Filter batch policies matching search term
                const invoicedBatchPolicies = activeInvoice.policies.filter(ins => {
                  if (invoicedSearchTerm) {
                    const search = invoicedSearchTerm.toLowerCase();
                    const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
                    const policyId = (ins.policyId || '').toLowerCase();
                    return fullName.includes(search) || 
                           policyId.includes(search);
                  }
                  return true;
                });

                const batchInvoicesDb = caremedInvoices.filter(
                  inv => (inv.invoiceNumber || '').toLowerCase().trim() === activeInvoice.invoiceNumber.toLowerCase().trim()
                );

                return (
                  <div className="space-y-4">
                    {/* CareMed Invoices & AI Reconciliation Section */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-indigo-600" />
                            <h3 className="font-bold text-sm text-gray-800">Factura Digital Adjunta - Cotejo Automático</h3>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                            Sube el PDF original o una imagen de la Factura de CareMed para el Invoice <strong className="font-bold whitespace-nowrap">{activeInvoice.invoiceNumber}</strong>. La IA de Gemini leerá el monto total facturado de forma automática y lo cotejará con el costo a pagar calculado en el sistema.
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer ${
                            parsingInvoice ? 'bg-indigo-400 text-white cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          }`}>
                            {parsingInvoice ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Leyendo con IA...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="w-3.5 h-3.5" />
                                <span>Adjuntar Factura (IA)</span>
                              </>
                            )}
                            <input
                              type="file"
                              accept=".pdf,image/*"
                              className="hidden"
                              disabled={parsingInvoice}
                              onChange={(e) => handleInvoiceUpload(e, activeInvoice.exportDate, activeInvoice.invoiceNumber)}
                            />
                          </label>
                          <button
                            onClick={() => setShowManualForm(!showManualForm)}
                            className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                          >
                            {showManualForm ? 'Cancelar' : 'Manual'}
                          </button>
                        </div>
                      </div>

                      {/* Manual Invoice Entry Form */}
                      {showManualForm && (
                        <div className="p-4 bg-gray-50/50 border border-gray-200/80 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                          <h4 className="text-xs font-bold text-gray-700">Registrar Factura Manualmente</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Monto Total Factura USD ($)</label>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="ej: 1250.00"
                                value={manualInvoice.amount}
                                onChange={(e) => setManualInvoice(prev => ({ ...prev, amount: e.target.value }))}
                                className="w-full px-3 py-2 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Número de Invoice (Auto)</label>
                              <input
                                type="text"
                                disabled
                                value={activeInvoice.invoiceNumber}
                                className="w-full px-3 py-2 bg-gray-105 border border-gray-200 rounded-xl outline-none text-xs text-gray-500 font-bold cursor-not-allowed"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Notas / Comentario</label>
                              <input
                                type="text"
                                placeholder="ej: Factura deducibles"
                                value={manualInvoice.notes}
                                onChange={(e) => setManualInvoice(prev => ({ ...prev, notes: e.target.value }))}
                                className="w-full px-3 py-2 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => handleAddManualInvoice(activeInvoice.exportDate, activeInvoice.invoiceNumber)}
                              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                            >
                              Guardar Factura
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Attached Invoices Listing & Verification */}
                      <div className="space-y-3">
                        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                          Facturas CareMed Adjuntadas para {activeInvoice.invoiceNumber} ({batchInvoicesDb.length})
                        </h4>

                        {batchInvoicesDb.length === 0 ? (
                          <div className="p-8 border border-dashed border-gray-150 rounded-2xl text-center text-xs text-amber-700 bg-amber-50/20 font-bold">
                            ⚠️ Falta Adjuntar Factura: No se ha detectado ninguna factura digital/física adjunta para el Invoice <strong>{activeInvoice.invoiceNumber}</strong>. Sube el documento original (PDF/Imagen) o regístralo manualmente para que la IA realice el cotejo de costos automático.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3">
                            {batchInvoicesDb.map((inv) => {
                              const totalCalculatedCost = activeInvoice.totalCalculatedCost;
                              const difference = inv.amount - totalCalculatedCost;
                              const isExactMatch = Math.abs(difference) < 0.01;
                              const isEditing = editingInvoiceId === inv.id;

                              return (
                                <div key={inv.id} className="p-4 border border-gray-100 rounded-2xl bg-gray-50/20 hover:bg-gray-50/50 transition-all space-y-3">
                                  {isEditing ? (
                                    <div className="space-y-3 bg-white p-3 rounded-xl border border-gray-100">
                                      <h5 className="text-[10px] uppercase font-bold text-indigo-600">Editar Factura Adjunta</h5>
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div>
                                          <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Número Invoice</label>
                                          <input
                                            type="text"
                                            value={editInvoiceValues.number}
                                            onChange={(e) => setEditInvoiceValues(prev => ({ ...prev, number: e.target.value }))}
                                            className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Monto Total USD ($)</label>
                                          <input
                                            type="number"
                                            step="0.01"
                                            value={editInvoiceValues.amount}
                                            onChange={(e) => setEditInvoiceValues(prev => ({ ...prev, amount: e.target.value }))}
                                            className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Notas / Descripción</label>
                                          <input
                                            type="text"
                                            value={editInvoiceValues.notes}
                                            onChange={(e) => setEditInvoiceValues(prev => ({ ...prev, notes: e.target.value }))}
                                            className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2 pt-1">
                                        <button
                                          onClick={() => setEditingInvoiceId(null)}
                                          className="px-2.5 py-1 text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          onClick={() => handleSaveEditInvoice(inv.id)}
                                          className="px-3 py-1 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-xs font-bold"
                                        >
                                          Guardar Cambios
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex justify-between items-start gap-4">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-550/10 text-indigo-700 border border-indigo-100 animate-in duration-200">
                                            Invoice: <span className="font-extrabold">{inv.invoiceNumber}</span>
                                          </span>
                                          <span className="text-[10px] text-gray-450 font-semibold">
                                            {inv.fileName || 'Entrada Manual'} • {inv.fileSize ? `${Math.round(inv.fileSize / 1024)} KB` : 'Sin archivo físico'}
                                          </span>
                                          {inv.simulated && (
                                            <span className="px-1.5 py-0.2 bg-amber-50 text-amber-700 text-[8px] font-bold rounded border border-amber-200 animate-pulse">Test / Simulación IA</span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-600">
                                          Importe de factura subida: <span className="font-extrabold text-gray-900">${Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                          {inv.notes && (
                                            <p className="text-[10px] text-gray-400 mt-1 italic font-medium">Nota: "{inv.notes}"</p>
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          onClick={() => handleStartEditInvoice(inv)}
                                          className="p-1 px-2 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all"
                                        >
                                          Editar
                                        </button>
                                        <button
                                          onClick={() => handleDeleteCaremedInvoice(inv.id)}
                                          className="p-1 text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-lg transition-all"
                                          title="Eliminar factura"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Verification Cost comparison */}
                                  <div className="p-3 bg-white border border-gray-100 rounded-2xl space-y-2">
                                    <div className="flex items-center justify-between text-[11px] font-medium text-gray-500">
                                      <span>Costo calculado en sistema para el invoice <strong className="text-gray-700 font-bold">{inv.invoiceNumber}</strong>:</span>
                                      <span className="font-bold text-gray-900 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">${totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD ({activeInvoice.count} pólizas)</span>
                                    </div>

                                    <div className="flex items-center gap-2 pt-1">
                                      {isExactMatch ? (
                                        <div className="flex items-center gap-1.5 text-emerald-700 text-[10.5px] font-extrabold bg-emerald-50 border border-emerald-250 px-3 py-1.5 rounded-lg w-full">
                                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                          <span>✅ COTEJO PERFECTO: El importe de la factura adjunta coincide al 100% con el costo a pagar calculado en el sistema.</span>
                                        </div>
                                      ) : (
                                        <div className="flex flex-col gap-1 text-rose-700 text-[10.5px] bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg w-full font-semibold">
                                          <div className="flex items-center gap-1.5 font-extrabold text-rose-800">
                                            <AlertTriangle className="w-4 h-4 text-rose-600 animate-pulse shrink-0" />
                                            <span>⚠️ ALERTA DE DISCREPANCIA DETECTADA</span>
                                          </div>
                                          <p className="mt-1 font-medium">
                                            Existe una diferencia de <strong className="font-bold text-rose-900">${Math.abs(difference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong> entre el total facturado por CareMed y el costo calculado en el sistema.
                                          </p>
                                          <div className="grid grid-cols-2 gap-4 mt-2 max-w-sm bg-white/70 p-2.5 rounded-lg border border-rose-100 text-[10px]">
                                            <div>
                                              <span className="block text-[9px] text-rose-650 font-bold uppercase">Monto en Factura</span>
                                              <span className="font-extrabold text-xs text-gray-900">${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                            </div>
                                            <div>
                                              <span className="block text-[9px] text-rose-650 font-bold uppercase">Costo en Sistema</span>
                                              <span className="font-extrabold text-xs text-gray-900">${totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Progress track visual graph */}
                                    <div className="relative pt-1">
                                      <div className="overflow-hidden h-2 text-xs flex rounded bg-gray-100 border border-gray-100">
                                        <div
                                          style={{ width: `${Math.min(100, Math.max(5, (totalCalculatedCost / (inv.amount || 1)) * 100))}%` }}
                                          className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-300 ${
                                            isExactMatch ? 'bg-emerald-500' : 'bg-rose-500'
                                          }`}
                                        />
                                      </div>
                                      <div className="flex justify-between text-[9px] text-gray-400 font-bold mt-1 uppercase tracking-wider">
                                        <span>Costo Sistema (${totalCalculatedCost.toFixed(2)})</span>
                                        <span>Total Facturado (${Number(inv.amount).toFixed(2)})</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Original Policies Listing */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
                      {/* Batch Details Header */}
                      <div className="p-4 bg-gray-55 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="text-gray-800 font-bold text-sm">
                            Asegurados Facturados en Invoice: {activeInvoice.invoiceNumber}
                          </div>
                          <div className="text-xs text-gray-550 mt-1 font-semibold">
                            Total: <span className="font-bold text-indigo-700">{activeInvoice.count} pólizas</span> • Costo total a pagar calculado: <span className="font-bold text-emerald-700">${activeInvoice.totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownloadSpecificCareMedCSV(activeInvoice.exportDate, activeInvoice.policies)}
                          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer w-fit"
                          title="Descargar CSV solo para este Invoice"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Exportar CSV Invoice
                        </button>
                      </div>

                      {/* Policies Table */}
                      <div className="overflow-x-auto">
                        {invoicedBatchPolicies.length === 0 ? (
                          <div className="p-8 text-center text-gray-400 text-xs font-bold">
                            No hay pólizas que coincidan con la búsqueda en este invoice.
                          </div>
                        ) : (
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-50/50 text-[10px] uppercase font-bold text-gray-400 tracking-wider border-b border-gray-100">
                                <th className="px-4 py-3">Asegurado/Invoice</th>
                                <th className="px-4 py-3">Plan/Póliza</th>
                                <th className="px-4 py-3">Días</th>
                                <th className="px-4 py-3">Costo Día</th>
                                <th className="px-4 py-3">Costo Total</th>
                                <th className="px-4 py-3 text-right">Acción</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {invoicedBatchPolicies.map((i) => {
                                const policy = policies.find(p => p.id === i.policyId);
                                const policyName = i.policyName || policy?.name || '';
                                const dailyCost = i.days > 0 ? (i.totalCost || 0) / i.days : 0;

                                return (
                                  <tr key={i.id} className="hover:bg-gray-50/30 transition-all font-medium text-gray-750">
                                    <td className="px-4 py-3.5">
                                      <div className="flex flex-col gap-1">
                                        <span className="font-bold text-gray-900 text-xs">{i.firstName} {i.lastName}</span>
                                        <span className="text-[10px] text-gray-400">Nacimiento: {i.birthDate}</span>
                                        
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-100 shadow-sm">
                                            Invoice: {i.InvoiceCaremed || 'No asignado'}
                                          </span>
                                          {i.InvoiceCaremed && (
                                            <button
                                              onClick={() => {
                                                if(confirm(`¿Estás seguro de eliminar el Invoice "${i.InvoiceCaremed}" de esta póliza?`)) {
                                                  handleRemoveInvoiceCaremed(i.id!);
                                                }
                                              }}
                                              className="text-rose-500 hover:text-rose-700 transition-all p-0.5 hover:bg-rose-50 rounded cursor-pointer animate-in duration-100"
                                              title="Remover Invoice"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-bold text-indigo-600 uppercase tracking-tighter text-xs">{i.plan}{policyName ? ` - ${policyName}` : ''}</span>
                                        <span className="text-[10px] text-gray-500 font-semibold">Póliza: {i.policyId || i.policyNumber || '-'}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="flex flex-col">
                                        <span className="font-bold text-gray-800 text-xs">{i.days}</span>
                                        <span className="text-[10px] text-gray-400">días</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <span className="font-semibold text-gray-750">${dailyCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <span className="font-bold text-red-600">${(i.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                      <button
                                        onClick={() => setSelectedInsuranceForDetail(i)}
                                        className="inline-flex items-center gap-1.5 p-1.5 text-blue-600 hover:text-white hover:bg-blue-600 rounded-lg border border-blue-100 hover:border-blue-600 transition-all cursor-pointer"
                                        title="Ver detalles completos de la póliza"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-4">
        {/* Row 1: Search and dropdown filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[280px] md:min-w-[480px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por cliente, email o ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendientes</option>
              <option value="paid">Pagados</option>
              <option value="cancelled">Cancelados</option>
              <option value="partially_paid">Pago Parcial</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            <select
              value={clientTypeFilter}
              onChange={(e) => {
                setClientTypeFilter(e.target.value);
                setAgentFilter('all');
                setSubAgentFilter('all');
              }}
              className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">Todos los Clientes</option>
              <option value="Individual">Individual</option>
              <option value="Agent">Agente</option>
              <option value="Corporate">Corporativo</option>
            </select>
          </div>
          {clientTypeFilter !== 'all' && clientTypeFilter !== 'Individual' && (
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400" />
              <select
                value={agentFilter}
                onChange={(e) => {
                  setAgentFilter(e.target.value);
                  setSubAgentFilter('all');
                }}
                className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">Todos los {clientTypeFilter === 'Agent' ? 'Agentes' : 'Corporativos'}</option>
                {clients
                  .filter(c => c.type === clientTypeFilter)
                  .sort((a, b) => {
                    const nameA = (a.commercialName || a.legalName || `${a.firstName} ${a.lastName}`).trim().toLowerCase();
                    const nameB = (b.commercialName || b.legalName || `${b.firstName} ${b.lastName}`).trim().toLowerCase();
                    return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
                  })
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.commercialName || c.legalName || `${c.firstName} ${c.lastName}`}</option>
                  ))}
              </select>
            </div>
          )}
          {selectedClient && selectedClient.linkedAgents && selectedClient.linkedAgents.length > 0 && (
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-400" />
              <select
                value={subAgentFilter}
                onChange={(e) => setSubAgentFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="all">Todos los Integrantes</option>
                {[...(selectedClient.linkedAgents || [])]
                  .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'es', { sensitivity: 'base' }))
                  .map((la: any) => (
                    <option key={la.id} value={la.email}>{la.name} ({la.email})</option>
                  ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold text-gray-700"
            >
              <option value="all">Tipos de Acción (Todos)</option>
              {actionTypes.map(at => (
                <option key={at.action} value={at.action}>{at.action} - {at.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <select
              value={operationalStatusFilter}
              onChange={(e) => setOperationalStatusFilter(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold text-gray-700"
            >
              <option value="all">Todos (Estado vigencia)</option>
              <option value="Activo">Activo</option>
              <option value="Cancelado">Cancelado</option>
              <option value="Terminado">Terminado</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <select
              value={caremedExportedFilter}
              onChange={(e) => setCaremedExportedFilter(e.target.value)}
              className="bg-gray-50 border border-gray-205 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-750"
            >
              <option value="all">Exportado CareMed (Todos)</option>
              <option value="exported">Exportado</option>
              <option value="not_exported">No Exportado</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <select
              value={caremedInvoicedFilter}
              onChange={(e) => setCaremedInvoicedFilter(e.target.value)}
              className="bg-gray-50 border border-gray-205 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-750"
            >
              <option value="all">Invoice CareMed (Todos)</option>
              <option value="invoiced">Con Invoice</option>
              <option value="not_invoiced">Sin Invoice</option>
            </select>
          </div>
        </div>

        {/* Row 2: Date filters at the same level */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-4 md:gap-6">
            <div className="flex items-center gap-3 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Fecha Solicitud</span>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input 
                  type="date"
                  value={requestDateRange.start}
                  onChange={(e) => setRequestDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-white border border-gray-200 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
                <span className="text-gray-400">-</span>
                <input 
                  type="date"
                  value={requestDateRange.end}
                  onChange={(e) => setRequestDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-white border border-gray-200 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Vigencia Póliza</span>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input 
                  type="date"
                  value={validityRange.start}
                  onChange={(e) => setValidityRange(prev => ({ ...prev, start: e.target.value }))}
                  className="bg-white border border-gray-200 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
                <span className="text-gray-400">-</span>
                <input 
                  type="date"
                  value={validityRange.end}
                  onChange={(e) => setValidityRange(prev => ({ ...prev, end: e.target.value }))}
                  className="bg-white border border-gray-200 rounded-md px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-500 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          {(searchTerm || statusFilter !== 'all' || clientTypeFilter !== 'all' || agentFilter !== 'all' || subAgentFilter !== 'all' || actionTypeFilter !== 'all' || operationalStatusFilter !== 'all' || caremedExportedFilter !== 'all' || caremedInvoicedFilter !== 'all' || requestDateRange.start || requestDateRange.end || validityRange.start || validityRange.end) && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setPlanFilter('all');
                setPolicyTypeFilter('all');
                setClientTypeFilter('all');
                setAgentFilter('all');
                setSubAgentFilter('all');
                setActionTypeFilter('all');
                setOperationalStatusFilter('all');
                setCaremedExportedFilter('all');
                setCaremedInvoicedFilter('all');
                setDateRange({ start: '', end: '' });
                setRequestDateRange({ start: '', end: '' });
                setValidityRange({ start: '', end: '' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all cursor-pointer border border-gray-200 shadow-sm"
              title="Restablecer todos los filtros"
            >
              <XCircle className="w-3.5 h-3.5 text-gray-500" />
              Limpiar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Filtered Records KPI Dashboard */}
      {!loading && filteredInsurances.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Pólizas Filtradas</h4>
              <p className="text-2xl font-black text-gray-900">{summaryStats.count}</p>
              <p className="text-[9px] font-semibold text-gray-450">Bajo los criterios seleccionados</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Ventas Totales</h4>
              <p className="text-2xl font-black text-emerald-600">
                ${summaryStats.ventas.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] font-bold text-gray-400">USD</span>
              </p>
              <p className="text-[9px] font-semibold text-gray-450">Venta de prima neta cobrada</p>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>

          {profile?.role !== 'client' && (
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Costo de Prima</h4>
                <p className="text-2xl font-black text-rose-600">
                  ${summaryStats.costo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] font-bold text-gray-400">USD</span>
                </p>
                <p className="text-[9px] font-semibold text-gray-450">Neto del costo de proveedor</p>
              </div>
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
          )}

          {profile?.role !== 'client' && (
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center justify-between">
              <div className="space-y-1 text-left">
                <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Comisión</h4>
                <p className="text-2xl font-black text-indigo-600">
                  ${summaryStats.comisiones.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] font-bold text-gray-400">USD</span>
                </p>
                <p className="text-[9px] font-semibold text-gray-450">Comisiones de agencia totales</p>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            Cargando pólizas...
          </div>
        ) : filteredInsurances.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
            No se encontraron pólizas.
          </div>
        ) : (
          <>
            {viewMode === 'cards' ? (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {paginatedInsurances.map((i) => {
              const requestDate = i.createdAt?.toDate ? i.createdAt.toDate() : new Date(i.createdAt);
              const policy = policies.find(p => p.id === i.policyId);
              const plan = i.plan || policy?.plan || i.policyId.split('-')[0];
              const policyName = i.policyName || policy?.name || '';
              
              const mul = i.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
              const hasPendingPayments = (i.totalPaid || 0) < (i.totalFinal || i.totalPrice);
              const isCommissionPending = i.commissionStatus === 'pending' || !i.commissionStatus;

              return (
                <div key={i.id} className={`bg-white rounded-2xl border ${selectedInsuranceIds.includes(i.id || '') ? 'border-indigo-300 ring-2 ring-indigo-50/50 bg-indigo-50/10' : 'border-gray-100'} p-6 hover:shadow-md transition-all flex flex-col gap-6`}>
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {isSuperAdminOrDirector && (
                        <input
                          id={`select-card-${i.id}`}
                          type="checkbox"
                          checked={selectedInsuranceIds.includes(i.id || '')}
                          onChange={() => handleToggleSelectInsurance(i.id || '')}
                          className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer self-center accent-indigo-650"
                        />
                      )}
                      <div className="p-3 bg-blue-50 rounded-xl">
                        <User className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{i.firstName} {i.lastName}</p>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <Mail className="w-3 h-3" />
                          <span className="truncate max-w-[150px]">{i.email}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <Baby className="w-3 h-3" />
                          <span>Nacimiento: {i.birthDate} ({i.age} años) • {i.gender || '-'}</span>
                        </div>
                        {i.Caremed && (
                          <div className="mt-1" title="Fecha y Hora de la exportación a CareMed">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 font-mono">
                              CareMed: {i.Caremed}
                            </span>
                          </div>
                        )}
                        {(() => {
                          const isIndividual = i.clientType === 'Individual' || (!i.clientType && (!i.clientId || i.clientId === 'Individual'));
                          
                          if (isIndividual) {
                            return (
                              <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded w-fit">
                                <User className="w-3 h-3 text-gray-400" />
                                <span>Cliente Individual</span>
                              </div>
                            );
                          }

                          const client = clients.find(c => c.id === i.clientId);
                          const clientLabel = i.clientType === 'Agent' ? 'Agente' : 'Corporativo';
                          const clientName = client ? (client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim()) : 'Faltante';
                          
                          const subAgent = client?.linkedAgents?.find((la: any) => la.email === i.linkedAgentId || la.id === i.linkedAgentId);
                          const subAgentName = subAgent ? subAgent.name : i.linkedAgentId;

                          return (
                            <div className="mt-2 flex flex-col gap-1 bg-indigo-50/50 border border-indigo-100/60 p-2 rounded-lg max-w-[260px]">
                              <span className="text-[8px] uppercase tracking-wider text-indigo-500 font-bold">Venta Asociada</span>
                              <div className="flex flex-col gap-1 text-[10px] text-gray-700 font-semibold leading-tight">
                                <span className="flex items-center gap-1">
                                  {i.clientType === 'Agent' ? <Users className="w-3 h-3 text-indigo-500" /> : <Building2 className="w-3 h-3 text-indigo-500" />}
                                  {clientLabel}: {clientName}
                                </span>
                                {subAgentName && (
                                  <span className="flex items-center gap-1 text-gray-500 font-medium pl-4">
                                    • Subagente: {subAgentName}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                      <div className="flex flex-col items-end gap-2">
                        {(() => {
                          const today = format(new Date(), 'yyyy-MM-dd');
                          let opStatus = 'Activo';
                          if (i.actionType?.toUpperCase() === 'CAN' || i.actionType === 'Can' || i.status === 'cancelled') opStatus = 'Cancelado';
                          else if (today > i.endDate) opStatus = 'Terminado';

                          return (
                            <span className={`px-3 py-1 text-[8px] font-black rounded-full border ${
                              opStatus === 'Activo' ? 'bg-indigo-600 text-white border-indigo-700' :
                              opStatus === 'Cancelado' ? 'bg-red-600 text-white border-red-700' :
                              'bg-gray-600 text-white border-gray-700'
                            }`}>
                              {opStatus.toUpperCase()}
                            </span>
                          );
                        })()}
                        <span className={`px-3 py-1 text-[10px] font-black rounded-full border ${
                          i.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                          i.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                          i.status === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                          'bg-red-100 text-red-700 border-red-200'
                        }`}>
                          {i.status === 'paid' ? 'PAGADO' : 
                           i.status === 'pending' ? 'PENDIENTE' : 
                           i.status === 'partially_paid' ? 'PAGO PARCIAL' :
                           'CANCELADO'}
                        </span>
                        <p className="text-[10px] text-gray-400 font-mono">{i.id}</p>
                        {i.actionType && (
                          <div className="mt-1">
                            <span className="text-[9px] font-black bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded border border-orange-100 italic">
                              {i.actionType}
                            </span>
                          </div>
                        )}
                      </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4 border-y border-gray-50">
                    <div className="space-y-3">
                      <div>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter mb-1">Ruta y Fechas</p>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{getCountryCode(i.originCountry)}</span>
                          <ArrowRight className="w-3 h-3 text-gray-300" />
                          <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{getCountryCode(i.destinationCountry)}</span>
                        </div>
                        <div className="flex flex-col text-[10px] text-gray-500">
                          <span className="font-medium flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {i.startDate} al {i.endDate}
                          </span>
                          <span className="opacity-70 ml-4">
                            {i.days} días 
                            {i.days > 39 && ` (${Math.ceil(i.days / 30.4)} meses)`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter mb-1">Información Comercial</p>
                        <div className="flex flex-col gap-2">
                          <div>
                            <p className="text-[8px] text-gray-400 font-bold uppercase mb-0.5">Plan</p>
                            <span className="inline-flex px-2 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded uppercase border border-indigo-100 w-fit">
                              {getPlanLabel(plan)}
                            </span>
                          </div>
                          <div>
                            <p className="text-[8px] text-gray-400 font-bold uppercase mb-0.5">Tipo de Póliza</p>
                            <span className={`inline-flex px-2 py-1 text-[10px] font-bold rounded uppercase border w-fit ${
                              policyName.includes('Oro') ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              policyName.includes('Plata') ? 'bg-slate-100 text-slate-700 border-slate-200' :
                              policyName.includes('Bronce') ? 'bg-orange-50 text-orange-700 border-orange-100' :
                              'bg-gray-50 text-gray-600 border-gray-200'
                            }`}>
                              {policyName || getInsuranceTypeLabel(i.policyId)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter mb-1">Financiero</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase">Precio</p>
                          <p className="text-xs font-black text-gray-900">${((i.totalFinal || i.totalPrice) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase text-red-400">Costo</p>
                          <p className="text-xs font-black text-red-600">${((i.totalCost || 0) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase text-indigo-400">Comisión</p>
                          <p className="text-xs font-black text-indigo-600">${((i.agentCommission || 0) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase text-green-400">Pagado</p>
                          <p className="text-xs font-black text-green-600">${((i.totalPaid || 0) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleDownloadCertificate(i)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded-lg hover:bg-indigo-100 transition-all"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Carta
                      </button>
                      <button 
                        onClick={() => setSelectedInsuranceForEmail(i)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-lg hover:bg-blue-100 transition-all"
                        title="Enviar por Correo"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Email
                      </button>
                      <button 
                        onClick={() => setSelectedInsuranceForDetail(i)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-lg hover:bg-blue-100 transition-all"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Detalles
                      </button>
                      <button 
                        onClick={() => setSelectedInsuranceForTransactions(i.id || null)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-600 text-[10px] font-bold rounded-lg hover:bg-green-100 transition-all"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        Pagos
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasPendingPayments && (
                        <button 
                          onClick={() => handleConfirmPayments(i.id!)}
                          className="px-3 py-1.5 bg-green-600 text-white text-[10px] font-bold rounded-lg hover:bg-green-700 transition-all shadow-sm shadow-green-100"
                        >
                          Confirmar Pagos
                        </button>
                      )}
                      {isCommissionPending && (
                        <button 
                          onClick={() => handleConfirmCommission(i.id!)}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-100"
                        >
                          Confirmar Comisión
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button 
                          onClick={() => setInsuranceToDelete(i)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Borrar Póliza"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                  <tr>
                    {isSuperAdminOrDirector && (
                      <th className="px-4 py-4 font-bold text-center w-12">
                        <input
                          type="checkbox"
                          checked={paginatedInsurances.length > 0 && paginatedInsurances.map(i => i.id).filter((id): id is string => !!id).every(id => selectedInsuranceIds.includes(id))}
                          onChange={handleSelectAllCurrentPage}
                          className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer accent-indigo-650"
                          title="Seleccionar todo en esta página"
                        />
                      </th>
                    )}
                    <th 
                      className="px-6 py-4 font-bold cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => setSortConfig({ 
                        key: 'requestDate', 
                        direction: sortConfig.key === 'requestDate' && sortConfig.direction === 'desc' ? 'asc' : 'desc' 
                      })}
                    >
                      <div className="flex items-center gap-1">
                        Solicitud
                        {sortConfig.key === 'requestDate' && (
                          sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        )}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-4 font-bold cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => setSortConfig({ 
                        key: 'clientName', 
                        direction: sortConfig.key === 'clientName' && sortConfig.direction === 'asc' ? 'desc' : 'asc' 
                      })}
                    >
                      <div className="flex items-center gap-1">
                        Cliente
                        {sortConfig.key === 'clientName' && (
                          sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-4 font-bold">Nacimiento / Edad</th>
                    <th className="px-6 py-4 font-bold">Ruta</th>
                    <th className="px-6 py-4 font-bold">Fechas / Duración</th>
                    <th className="px-6 py-4 font-bold">Acción</th>
                    <th className="px-6 py-4 font-bold">Estado Vigencia</th>
                    <th className="px-6 py-4 font-bold">Información Comercial</th>
                    <th className="px-6 py-4 font-bold text-right">Precio</th>
                    <th className="px-6 py-4 font-bold text-right">Costo</th>
                    <th className="px-6 py-4 font-bold text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedInsurances.map((i) => {
                    const policy = policies.find(p => p.id === i.policyId);
                    const plan = i.plan || policy?.plan || i.policyId.split('-')[0];
                    const policyName = i.policyName || policy?.name || '';
                    
                    const mul = i.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
                    const isCommissionPending = i.commissionStatus === 'pending' || !i.commissionStatus;
                    const hasPendingPayments = (i.totalPaid || 0) < (i.totalFinal || i.totalPrice);

                    return (
                      <tr key={i.id} className={`hover:bg-gray-50 transition-colors ${selectedInsuranceIds.includes(i.id || '') ? 'bg-indigo-50/20 hover:bg-indigo-50/30' : ''}`}>
                        {isSuperAdminOrDirector && (
                          <td className="px-4 py-4 text-center">
                            <input
                              type="checkbox"
                              checked={selectedInsuranceIds.includes(i.id || '')}
                              onChange={() => handleToggleSelectInsurance(i.id || '')}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                            />
                          </td>
                        )}
                        <td className="px-6 py-4">
                          <span className="text-xs font-medium text-gray-600">
                            {i.requestDate ? format(parseISO(i.requestDate), 'dd/MM/yyyy') : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-900">{i.firstName} {i.lastName}</span>
                            <span className="text-[10px] text-gray-400">{i.email}</span>
                            {i.IDseg && (
                              <span className="inline-block w-max px-1 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono mt-0.5">
                                IDseg: {i.IDseg}
                              </span>
                            )}
                            {i.Caremed && (
                              <span className="inline-block w-max px-1 rounded text-[9px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 font-mono mt-0.5" title="Fecha y Hora de la exportación a CareMed">
                                CareMed: {i.Caremed}
                              </span>
                            )}
                            {(() => {
                              const isIndividual = i.clientType === 'Individual' || (!i.clientType && (!i.clientId || i.clientId === 'Individual'));
                              
                              if (isIndividual) {
                                return (
                                  <span className="inline-block w-max px-1.5 py-0.5 rounded text-[9px] font-bold text-gray-500 bg-gray-50 border border-gray-150 mt-1">
                                    Individual
                                  </span>
                                );
                              }

                              const client = clients.find(c => c.id === i.clientId);
                              const clientLabel = i.clientType === 'Agent' ? 'Agente' : 'Corp';
                              const clientName = client ? (client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim()) : 'Fal.';
                              
                              const subAgent = client?.linkedAgents?.find((la: any) => la.email === i.linkedAgentId || la.id === i.linkedAgentId);
                              const subAgentName = subAgent ? subAgent.name : i.linkedAgentId;

                              return (
                                <div className="mt-1.5 text-[9px] text-indigo-700 leading-tight bg-indigo-50/30 p-1.5 rounded border border-indigo-100/50 w-fit">
                                  <span className="font-semibold flex items-center gap-1">
                                    {i.clientType === 'Agent' ? <Users className="w-2.5 h-2.5" /> : <Building2 className="w-2.5 h-2.5" />}
                                    {clientLabel}: {clientName}
                                  </span>
                                  {subAgentName && (
                                    <span className="block text-gray-500 font-medium font-sans mt-0.5 pl-3.5">• Sub: {subAgentName}</span>
                                  )}
                                </div>
                              );
                            })()}
                            
                            {/* Action icons directly below email */}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <button 
                                onClick={() => handleDownloadCertificate(i)}
                                className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                                title="Descargar Carta"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => setSelectedInsuranceForEmail(i)}
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                title="Enviar por Correo"
                              >
                                <Mail className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => setSelectedInsuranceForDetail(i)}
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                title="Detalles"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => setSelectedInsuranceForTransactions(i.id || null)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded-md transition-all"
                                title="Pagos"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </button>
                              {hasPendingPayments && (
                                <button 
                                  onClick={() => handleConfirmPayments(i.id!)}
                                  className="p-1 text-green-600 hover:bg-green-55/10 rounded-md transition-all animate-pulse"
                                  title="Confirmar Pagos"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isCommissionPending && (
                                <button 
                                  onClick={() => handleConfirmCommission(i.id!)}
                                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                                  title="Confirmar Comisión"
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isSuperAdmin && (
                                <button 
                                  onClick={() => setInsuranceToDelete(i)}
                                  className="p-1 text-red-600 hover:bg-red-50 rounded-md transition-all"
                                  title="Borrar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-xs text-gray-600">{i.birthDate}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-bold text-blue-600">{i.age} años</span>
                              <span className="text-[10px] text-gray-400">•</span>
                              <span className="text-[10px] font-medium text-gray-500">{i.gender || '-'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold bg-gray-100 px-1.5 py-0.5 rounded">{getCountryCode(i.originCountry)}</span>
                            <ArrowRight className="w-3 h-3 text-gray-300" />
                            <span className="text-[10px] font-bold bg-gray-100 px-1.5 py-0.5 rounded">{getCountryCode(i.destinationCountry)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col text-[10px] text-gray-600">
                            <span>{i.startDate} al {i.endDate}</span>
                            <span className="font-bold text-blue-600">
                              {i.days} días 
                              {i.days > 39 && ` (${Math.ceil(i.days / 30.4)} meses)`}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {i.actionType ? (
                            <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                              {i.actionType}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {(() => {
                            const today = format(new Date(), 'yyyy-MM-dd');
                            let opStatus = 'Activo';
                            if (i.actionType?.toUpperCase() === 'CAN' || i.actionType === 'Can' || i.status === 'cancelled') opStatus = 'Cancelado';
                            else if (today > i.endDate) opStatus = 'Terminado';

                            return (
                              <div className="flex flex-col gap-1 items-center">
                                <span className={`px-2 py-0.5 text-[8px] font-black rounded-full border ${
                                  opStatus === 'Activo' ? 'bg-indigo-600 text-white border-indigo-700' :
                                  opStatus === 'Cancelado' ? 'bg-red-600 text-white border-red-700' :
                                  'bg-gray-600 text-white border-gray-700'
                                }`}>
                                  {opStatus.toUpperCase()}
                                </span>
                                <span className={`px-2 py-0.5 text-[8px] font-bold rounded-full border ${
                                  i.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                                  i.status === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                                  i.status === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                  'bg-red-100 text-red-700 border-red-200'
                                }`}>
                                  {i.status === 'paid' ? 'PAGADO' : 
                                   i.status === 'pending' ? 'PENDIENTE' : 
                                   i.status === 'partially_paid' ? 'PARCIAL' :
                                   'CANCELADO'}
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-col">
                              <span className="text-[7px] text-gray-400 font-bold uppercase leading-none">Plan</span>
                              <span className="text-[9px] font-bold text-indigo-600 uppercase">{getPlanLabel(plan)}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[7px] text-gray-400 font-bold uppercase leading-none">Tipo</span>
                              <span className="text-[9px] font-bold text-gray-500 uppercase">{policyName || getInsuranceTypeLabel(i.policyId)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-gray-900 text-sm">${((i.totalFinal || i.totalPrice) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-right font-bold text-red-600 text-sm">${((i.totalCost || 0) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4 text-right font-bold text-indigo-600 text-sm">${((i.agentCommission || 0) * mul).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
         {/* Pagination Controls */}
         {filteredInsurances.length > 0 && (
           <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white px-6 py-4 rounded-xl border border-gray-100 shadow-sm mt-4">
             <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
               <p className="text-sm text-gray-500">
                 Mostrando <span className="font-bold text-gray-900">{filteredInsurances.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, filteredInsurances.length)}</span> de <span className="font-bold text-gray-900">{filteredInsurances.length}</span> pólizas
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
        )}
      </div>
        </>
      )}

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

      <BatchDetailModal
        isOpen={!!selectedBatchForDetail}
        onClose={() => setSelectedBatchForDetail(null)}
        batch={selectedBatchForDetail}
        clients={clients}
        onViewInsuranceDetail={(ins) => setSelectedInsuranceForDetail(ins)}
      />

      <EmailModal
        isOpen={!!selectedInsuranceForEmail}
        onClose={() => setSelectedInsuranceForEmail(null)}
        insurance={selectedInsuranceForEmail}
        policies={policies}
        policyLetters={policyLetters}
        companySettings={settings}
      />

      <BulkEmailConfigModal
        isOpen={showBulkEmailModal}
        onClose={() => setShowBulkEmailModal(false)}
        selectedInsurances={insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id))}
        policies={policies}
        policyLetters={policyLetters}
        companySettings={settings}
        onConfirm={handleBulkSendEmails}
      />

      {languageModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Seleccionar Idioma de Carta</h3>
              <button onClick={() => setLanguageModal(prev => ({ ...prev, isOpen: false }))}>
                <XCircle className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-500">
                Selecciona los idiomas en los que deseas generar la carta para <strong>{languageModal.insurance?.firstName} {languageModal.insurance?.lastName}</strong>.
              </p>
              <div className="space-y-2">
                {languageModal.availableLetters.map(letter => (
                  <label key={letter.id} className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-all group">
                    <input
                      type="checkbox"
                      checked={languageModal.selectedLanguages.includes(letter.language)}
                      onChange={(e) => {
                        const langs = e.target.checked
                          ? [...languageModal.selectedLanguages, letter.language]
                          : languageModal.selectedLanguages.filter(l => l !== letter.language);
                        setLanguageModal(prev => ({ ...prev, selectedLanguages: langs }));
                      }}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 transition-all cursor-pointer"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-900">
                        {letter.language === 'es' ? 'Español' : 
                         letter.language === 'en' ? 'Inglés' : 
                         letter.language === 'de' ? 'Alemán' : 
                         letter.language === 'it' ? 'Italiano' : 
                         letter.language === 'fr' ? 'Francés' : 
                         letter.language === 'es_spain' ? 'España' : 
                         letter.language === 'covid' ? 'Coronavirus' : 
                         letter.language === 'policy' ? 'Policy' : 
                         letter.language.toUpperCase()}
                      </p>
                      <p className="text-xs text-gray-400 group-hover:text-gray-500 transition-colors">{letter.title}</p>
                    </div>
                    <Globe className="w-4 h-4 text-gray-300" />
                  </label>
                ))}
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button
                onClick={() => setLanguageModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 py-3 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmLanguages}
                disabled={languageModal.selectedLanguages.length === 0}
                className="flex-1 py-3 text-sm font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Descargar {languageModal.selectedLanguages.length > 1 ? `(${languageModal.selectedLanguages.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Send Email Progress Modal */}
      {isBulkSending && bulkSendProgress && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center space-y-5 animate-in zoom-in-95 duration-200 border border-gray-100">
            <div className="mx-auto w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-gray-900 tracking-tight">Enviando Correos Masivos</h3>
              <p className="text-sm text-gray-505 leading-relaxed text-gray-500">
                Por favor, mantén esta ventana abierta mientras se preparan y envían los certificados de seguro.
              </p>
            </div>
            
            <div className="space-y-2">
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden shadow-inner">
                <div 
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300 shadow" 
                  style={{ width: `${(bulkSendProgress.current / bulkSendProgress.total) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-bold text-gray-500 font-mono px-0.5">
                <span>{bulkSendProgress.current} ENVIADOS</span>
                <span>{bulkSendProgress.total} TOTAL</span>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-600 font-bold truncate">
                {bulkSendProgress.statusText}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Delete Selected Confirmation Modal */}
      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 text-red-600 mb-6">
              <div className="p-3 bg-red-50 rounded-2xl">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black tracking-tight">Confirmar Eliminación Masiva</h3>
            </div>
            <p className="text-gray-600 mb-8 leading-relaxed">
              ¿Estás seguro de que deseas eliminar las <span className="font-bold text-red-600">{selectedInsuranceIds.length} pólizas seleccionadas</span> del sistema? 
              Esta acción es irreversible y borrará permanentemente todos los registros de seguros seleccionados.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteSelectedConfirm(false)}
                className="flex-1 px-6 py-3 bg-gray-100 text-gray-500 font-bold rounded-xl hover:bg-gray-200 transition-all"
                disabled={isDeletingSelected}
              >
                Cancelar
              </button>
              <button 
                onClick={handleDeleteSelectedInsurances}
                className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2"
                disabled={isDeletingSelected}
              >
                {isDeletingSelected ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Borrando...
                  </>
                ) : (
                  'Sí, Borrar Seleccionadas'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {insuranceToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold">Confirmar Eliminación</h3>
            </div>
            <p className="text-gray-600 mb-6">
              ¿Estás seguro de que deseas eliminar la póliza de <span className="font-bold">{insuranceToDelete.firstName} {insuranceToDelete.lastName}</span>? 
              Esta acción no se puede deshacer y eliminará permanentemente el registro.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setInsuranceToDelete(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => handleDeleteInsurance(insuranceToDelete.id!)}
                className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors"
              >
                Eliminar Póliza
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
