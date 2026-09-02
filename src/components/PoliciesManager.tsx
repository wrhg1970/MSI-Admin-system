import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, getDocs, where, getDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, UserProfile, Payment, Policy, CustomRole, PolicyLetter } from '../types';
import { COUNTRIES } from '../constants';
import { ShieldCheck, Eye, Trash2, Edit2, CheckCircle, CheckCircle2, XCircle, DollarSign, FileText, FileSpreadsheet, Search, Filter, Receipt, Calendar, Clock, AlertTriangle, ArrowRight, User, Users, Mail, LayoutGrid, List, Baby, Upload, Download, Globe, Building2, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, TrendingUp, Send, Loader2, History, Plus, X, FolderArchive, ArrowUpDown, Scale, Copy, ChevronDown, ChevronUp, Layers, FileQuestion } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import TransactionModal from './TransactionModal';
import InsuranceDetailModal from './InsuranceDetailModal';
import EmailModal from './EmailModal';
import BulkEmailConfigModal from './BulkEmailConfigModal';
import BulkZipDownloadModal from './BulkZipDownloadModal';
import { generatePDF, generateMergedLettersPDF } from '../lib/pdfGenerator';
import { createZipFromPdfs, downloadBlob } from '../lib/zipUtils';
import { format, parseISO, parse, isValid, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { usePermissions } from '../hooks/usePermissions';
import Papa from 'papaparse';
import { useCompany } from '../App';
import { triggerWhatsAppNotification } from '../services/whatsapp';
import { getPolicyNumber, getAvailableLettersForInsurance, getNormalizedYYYYMMDD, formatDisplayDate, findPolicyPrioritized, findDuplicatePolicyGroups, getPolicyEffectiveCost } from '../lib/policyUtils';
import BatchDetailModal from './BatchDetailModal';
import DuplicatesModal from './DuplicatesModal';
import { logInsuranceActivity } from '../utils/activityLogger';

const LANGUAGE_ORDER = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid', 'fr', 'it', 'de'];

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

const formatPriceWithSign = (val: number, forceNeg: boolean = false) => {
  const isNeg = val < 0 || forceNeg || Object.is(val, -0);
  const formatted = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${isNeg ? '-' : ''}$${formatted}`;
};

export default function PoliciesManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const navigate = useNavigate();
  const userEmail = auth.currentUser?.email?.toLowerCase().trim() || '';
  const isSuperAdmin = profile?.role === 'super_admin' || 
    userEmail === 'ventas@misegurointernacional.com' || 
    userEmail === 'wrhg1970@gmail.com' || 
    auth.currentUser?.uid === 'VTuoortBNjVYkwVviYkbSlyUzNS2' || 
    false;
  const isSuperAdminOrDirector = isSuperAdmin || profile?.role === 'director';
  const canManageClosedState = isSuperAdmin || ['director', 'seguros', 'administracion', 'admin'].includes(profile?.role || 'none');

  const { hasPermission } = usePermissions(profile, rolePermissions);
  const { settings } = useCompany();
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);

  const handleDuplicatePolicy = (ins: InsuranceRequest) => {
    const isIndividual = ins.clientType === 'Individual' || (!ins.clientType && (!ins.clientId || ins.clientId === 'Individual'));
    const duplicatePayload = {
      clientType: isIndividual ? 'Individual' : (ins.clientType || 'Agent'),
      clientId: isIndividual ? '' : (ins.clientId || ''),
      linkedAgentId: ins.linkedAgentId || '',
      firstName: ins.firstName || '',
      lastName: ins.lastName || '',
      birthDate: ins.birthDate || '',
      gender: ins.gender || 'M',
      email: ins.email || '',
      originCountry: ins.originCountry || 'MX',
      destinationCountry: ins.destinationCountry || 'US',
      city: ins.city || ''
    };

    navigate('/request', { state: { duplicateData: duplicatePayload } });
  };
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
  const [countriesList, setCountriesList] = useState<any[]>([]);
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
  const [modalInitialAction, setModalInitialAction] = useState<'cancel' | 'correct' | 'extension' | null>(null);
  const [selectedInsuranceForEmail, setSelectedInsuranceForEmail] = useState<InsuranceRequest | null>(null);
  const [insuranceToDelete, setInsuranceToDelete] = useState<InsuranceRequest | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<{id: string, type: 'payment' | 'commission'} | null>(null);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  
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
  const [cotejoInvoiceStatusFilter, setCotejoInvoiceStatusFilter] = useState<'all' | 'pending' | 'incorrect' | 'no_invoice' | 'correct' | 'justified'>('all');

  const [selectedBatchForDetail, setSelectedBatchForDetail] = useState<{ exportDate: string; policies: InsuranceRequest[] } | null>(null);
  const [caremedSubTab, setCaremedSubTab] = useState<'pending' | 'history'>('pending');
  const [invoiceSubTab, setInvoiceSubTab] = useState<'cotejo' | 'list' | 'detailed'>('cotejo');

  // List sub-tab filters & sort states
  const [invoiceListDateRange, setInvoiceListDateRange] = useState({ start: '', end: '' });
  const [invoiceListPaidFilter, setInvoiceListPaidFilter] = useState<'all' | 'paid' | 'not_paid' | 'partial'>('all');
  const [invoiceListCorrectFilter, setInvoiceListCorrectFilter] = useState<'all' | 'pending' | 'incorrect' | 'no_invoice' | 'correct' | 'justified'>('all');
  const [invoiceListSortField, setInvoiceListSortField] = useState<'exportDate' | 'invoiceDate' | 'invoiceNumber' | 'policyCount' | 'totalCalculatedCost' | 'difference'>('exportDate');
  const [invoiceListSortOrder, setInvoiceListSortOrder] = useState<'asc' | 'desc'>('desc');

  // Detailed sub-tab (Detalle de Pólizas por Invoice) filters & sort states
  const [invoiceDetailViewMode, setInvoiceDetailViewMode] = useState<'concentrated' | 'detailed'>('concentrated');
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [invoiceDetailSearchTerm, setInvoiceDetailSearchTerm] = useState('');
  const [invoiceDetailDateRange, setInvoiceDetailDateRange] = useState({ start: '', end: '' });
  const [invoiceDetailAgentFilter, setInvoiceDetailAgentFilter] = useState('all'); // 'all' | 'agents' | 'corporates' | 'individuals' | clientId
  const [invoiceDetailCorrectFilter, setInvoiceDetailCorrectFilter] = useState<'all' | 'correct' | 'discrepancy' | 'no_invoice'>('all');
  const [invoiceDetailSortField, setInvoiceDetailSortField] = useState<'invoiceDate' | 'invoiceNumber' | 'policyNumber' | 'amount'>('invoiceDate');
  const [invoiceDetailSortOrder, setInvoiceDetailSortOrder] = useState<'asc' | 'desc'>('desc');

  // AI Invoice Scanning & Verification states
  const [parsingInvoice, setParsingInvoice] = useState(false);
  const [manualInvoice, setManualInvoice] = useState({ number: '', amount: '', notes: '', invoiceDate: '' });
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editInvoiceValues, setEditInvoiceValues] = useState({ number: '', amount: '', notes: '', invoiceDate: '' });

  // Export date editing states
  const [editingExportDate, setEditingExportDate] = useState<string | null>(null);
  const [newExportDateValue, setNewExportDateValue] = useState('');

  // Super Admin Invoice Difference Justification modal states
  const [justifyingInvoice, setJustifyingInvoice] = useState<{
    dbInvoiceId: string;
    invoiceNumber: string;
    invoiceAmount: number;
    totalCalculatedCost: number;
    difference: number;
    justificationText: string;
  } | null>(null);
  const [isSavingJustification, setIsSavingJustification] = useState(false);

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
      if (ins.InvoiceCaremed) {
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
      
      // Compute total systems calculated cost accounting for cancellations and cost signs (negative costs subtract, positive costs add)
      const totalCalculatedCost = items.reduce((sum, p) => {
        return sum + getPolicyEffectiveCost(p);
      }, 0);

      return {
        invoiceNumber,
        exportDate,
        count: items.length,
        policies: items,
        totalCalculatedCost
      };
    }).sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber));
  }, [insurances]);

  // Filter Caremed Invoices by search, date, and invoice status/difference filters
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
          // match found
        } else {
          const hasMatchingPolicy = inv.policies.some(ins => {
            const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
            const policyId = (ins.policyId || '').toLowerCase();
            return fullName.includes(search) || policyId.includes(search);
          });
          if (!hasMatchingPolicy) return false;
        }
      }

      // 3. Filter by Invoice Status / Discrepancy
      if (cotejoInvoiceStatusFilter !== 'all') {
        const dbInv = caremedInvoices.find(
          d => (d.invoiceNumber || '').toLowerCase().trim() === inv.invoiceNumber.toLowerCase().trim()
        );
        const hasAttachedInvoice = !!dbInv;
        const totalCalculatedCost = inv.totalCalculatedCost;
        const invoiceAmount = dbInv?.amount ?? 0;
        const difference = hasAttachedInvoice ? (invoiceAmount - totalCalculatedCost) : 0;
        const isExactMatch = hasAttachedInvoice && Math.abs(difference) < 0.05;
        const isJustified = !!dbInv?.differenceJustified || !!dbInv?.approved;
        const hasDifference = hasAttachedInvoice && !isExactMatch;

        if (cotejoInvoiceStatusFilter === 'pending') {
          // Sin factura o con diferencia no justificada
          if (hasAttachedInvoice && (isExactMatch || isJustified)) return false;
        } else if (cotejoInvoiceStatusFilter === 'incorrect') {
          // Solo con diferencia
          if (!hasDifference) return false;
        } else if (cotejoInvoiceStatusFilter === 'no_invoice') {
          // Solo sin factura adjunta
          if (hasAttachedInvoice) return false;
        } else if (cotejoInvoiceStatusFilter === 'correct') {
          // Solo facturas correctas
          if (!isExactMatch) return false;
        } else if (cotejoInvoiceStatusFilter === 'justified') {
          // Solo diferencias justificadas (OK)
          if (!hasDifference || !isJustified) return false;
        }
      }

      return true;
    });
  }, [caremedInvoicesGrouped, invoicedDateFilter, invoicedSearchTerm, cotejoInvoiceStatusFilter, caremedInvoices]);

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
      setStatusFilter('unpaid');
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
    let directFound = findPolicyPrioritized(ins.policyId, policies);
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
      // Group items by policy code
      const groups: { [key: string]: InsuranceRequest[] } = {};
      items.forEach(item => {
        const policy = findMatchingPolicy(item, policies);
        const code = item.policyNumber || getPolicyNumber(policy, item.age) || 'No_asignado';
        if (!groups[code]) {
          groups[code] = [];
        }
        groups[code].push(item);
      });

      // Format date for filename: dd-mm-yyyy
      let dateStr = format(new Date(), 'dd-MM-yyyy');
      if (exportDate && exportDate.length >= 10) {
        const parts = exportDate.substring(0, 10).split('-');
        if (parts.length === 3) {
          dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }

      // Export a file for each group, sorted by policy code
      Object.entries(groups)
        .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
        .forEach(([policyCode, groupItems]) => {
        // Sort items inside group alphabetically by last name and then first name
        const sortedItems = [...groupItems].sort((a, b) => {
          const lna = (a.lastName || '').localeCompare(b.lastName || '');
          if (lna !== 0) return lna;
          return (a.firstName || '').localeCompare(b.firstName || '');
        });

        const dataToExport = sortedItems.map(item => {
          const ins = item as any;
          const policy = findMatchingPolicy(ins, policies);

          return {
            'Sponsor_Code': policy?.SponsorCode || '',
            'Policy_Number': ins.policyNumber || getPolicyNumber(policy, ins.age) || '',
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
        link.download = `${dateStr} CareMed - ${policyCode}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      });
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
      
      let data: any = null;
      let lastErr: any = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch('/api/caremed/parse-invoice', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fileData: base64Data,
              fileName: file.name,
              fileType: file.type || 'application/pdf'
            })
          });

          const resText = await response.text();
          if (!resText || resText.trim().startsWith("<") || resText.includes("<!DOCTYPE") || resText.includes("<html")) {
            throw new Error("El servicio está inicializando o bajo alta demanda. Reintentando...");
          }

          let parsedData: any = {};
          try {
            parsedData = JSON.parse(resText);
          } catch {
            throw new Error(`El servidor devolvió una respuesta no válida (${response.status}). Intenta nuevamente.`);
          }

          if (!response.ok || parsedData.error) {
            throw new Error(parsedData.error || 'Error al procesar el archivo');
          }

          data = parsedData;
          break;
        } catch (err: any) {
          lastErr = err;
          const errMessage = String(err?.message || err);
          if (attempt === 0 && (errMessage.includes("demanda") || errMessage.includes("503") || errMessage.includes("instantes") || errMessage.includes("Failed to fetch"))) {
            await new Promise(r => setTimeout(r, 2500));
          } else {
            break;
          }
        }
      }

      if (!data) {
        throw lastErr || new Error("Error al procesar la factura.");
      }

      await addDoc(collection(db, 'caremedInvoices'), {
        exportDate,
        invoiceNumber: customInvoiceNumber || data.invoiceNumber || 'SIN_NÚMERO',
        amount: Number(data.amount) || 0,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        uploadedAt: new Date().toISOString(),
        notes: data.notes || '',
        simulated: data.simulated || false,
        invoiceDate: data.invoiceDate || new Date().toISOString().substring(0, 10)
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
        notes: manualInvoice.notes.trim(),
        invoiceDate: manualInvoice.invoiceDate || new Date().toISOString().substring(0, 10)
      });

      setManualInvoice({ number: '', amount: '', notes: '', invoiceDate: '' });
      setShowManualForm(false);
    } catch (err: any) {
      console.error("Error adding manual invoice:", err);
      alert("Fallo al guardar la factura: " + err.message);
    }
  };

  const handleDeleteCaremedInvoice = async (invoiceId: string) => {
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Administrador, Director o Super Administrador tiene autorización para eliminar facturas digitales adjuntas.");
      return;
    }

    const invToDelete = caremedInvoices.find(i => i.id === invoiceId);
    const invoiceNum = invToDelete?.invoiceNumber || '';
    const invoiceAmt = invToDelete?.amount ? `$${Number(invToDelete.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : '';

    if (!confirm(`¿Estás seguro de eliminar esta factura digital adjunta (${invoiceNum}${invoiceAmt ? ` - ${invoiceAmt}` : ''})?\n\nEsta acción eliminará el archivo/registro del comprobante y el cotejo automático de esta factura.`)) return;

    try {
      await deleteDoc(doc(db, 'caremedInvoices', invoiceId));

      try {
        await logInsuranceActivity({
          insuranceId: invoiceId,
          type: 'delete_invoice',
          description: `Eliminó la factura digital adjunta para el Invoice ${invoiceNum} (${invoiceAmt}).`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Admin'
        });
      } catch (logErr) {
        console.warn("No se pudo registrar en bitácora:", logErr);
      }

      alert("Factura digital eliminada con éxito.");
    } catch (err: any) {
      console.error("Error deleting invoice:", err);
      alert("Fallo al borrar la factura digital: " + err.message);
    }
  };

  const handleDeleteEntireInvoice = async (invoiceNumber: string) => {
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Administrador, Director o Super Administrador puede realizar esta acción.");
      return;
    }

    const targetPolicies = insurances.filter(ins => (ins.InvoiceCaremed || '').trim().toLowerCase() === invoiceNumber.trim().toLowerCase());

    if (!confirm(`¿Estás seguro de eliminar el invoice "${invoiceNumber}"?\n\nEsta acción:\n1. Desvinculará sus ${targetPolicies.length} pólizas asociadas.\n2. Eliminará cualquier factura digital adjunta de este invoice.\n3. Restablecerá el estado de las pólizas a pendiente de facturar.`)) return;

    try {
      setInvoiceSaving(true);
      const batch = writeBatch(db);

      // 1. Unlink policies
      targetPolicies.forEach(ins => {
        if (ins.id) {
          batch.update(doc(db, 'insurances', ins.id), {
            InvoiceCaremed: null,
            providerPaymentStatus: 'pending',
            providerPaymentMethod: null,
            providerPaymentDate: null,
            providerPaymentReceipt: null
          });
        }
      });

      // 2. Delete attached caremedInvoices
      const attachedInvs = caremedInvoices.filter(i => (i.invoiceNumber || '').trim().toLowerCase() === invoiceNumber.trim().toLowerCase());
      attachedInvs.forEach(inv => {
        batch.delete(doc(db, 'caremedInvoices', inv.id));
      });

      await batch.commit();

      try {
        await logInsuranceActivity({
          insuranceId: invoiceNumber,
          type: 'delete_invoice_group',
          description: `Eliminó el invoice completo ${invoiceNumber} (desvinculadas ${targetPolicies.length} pólizas y eliminadas ${attachedInvs.length} facturas adjuntas).`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Admin'
        });
      } catch (logErr) {
        console.warn("No se pudo registrar en bitácora:", logErr);
      }

      if (selectedInvoiceNumber === invoiceNumber) {
        setSelectedInvoiceNumber(null);
      }

      alert(`Invoice "${invoiceNumber}" y sus registros asociados han sido eliminados con éxito.`);
    } catch (err: any) {
      console.error("Error deleting entire invoice:", err);
      alert("Error al eliminar el invoice: " + err.message);
    } finally {
      setInvoiceSaving(false);
    }
  };

  const handleOpenJustifyModal = (item: any) => {
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Director o Super Administrador puede aprobar y justificar diferencias de invoice.");
      return;
    }

    const dbInv = item.dbInvoiceId 
      ? caremedInvoices.find(d => d.id === item.dbInvoiceId)
      : caremedInvoices.find(d => (d.invoiceNumber || '').toLowerCase().trim() === item.invoiceNumber.toLowerCase().trim());

    if (!dbInv) {
      alert("No se encontró la factura adjunta en la base de datos.");
      return;
    }

    setJustifyingInvoice({
      dbInvoiceId: dbInv.id,
      invoiceNumber: item.invoiceNumber,
      invoiceAmount: Number(item.invoiceAmount || dbInv.amount || 0),
      totalCalculatedCost: Number(item.totalCalculatedCost || 0),
      difference: Number(item.difference !== undefined ? item.difference : (dbInv.amount - (item.totalCalculatedCost || 0))),
      justificationText: dbInv.justification || ''
    });
  };

  const handleSaveJustification = async () => {
    if (!justifyingInvoice) return;
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Director o Super Administrador puede aprobar diferencias.");
      return;
    }
    if (!justifyingInvoice.justificationText.trim()) {
      alert("Por favor escribe la justificación de la diferencia antes de confirmar.");
      return;
    }

    try {
      setIsSavingJustification(true);
      await updateDoc(doc(db, 'caremedInvoices', justifyingInvoice.dbInvoiceId), {
        differenceJustified: true,
        approved: true,
        justification: justifyingInvoice.justificationText.trim(),
        approvedBy: auth.currentUser?.email || 'Admin/Director',
        approvedAt: new Date().toISOString()
      });

      try {
        await logInsuranceActivity({
          insuranceId: justifyingInvoice.dbInvoiceId,
          type: 'approve_invoice_difference',
          description: `Director/Super Admin aprobó la diferencia en el Invoice ${justifyingInvoice.invoiceNumber} (Dif: ${justifyingInvoice.difference > 0 ? '+' : ''}$${justifyingInvoice.difference.toFixed(2)} USD). Justificación: "${justifyingInvoice.justificationText.trim()}"`,
          date: new Date(),
          createdBy: auth.currentUser?.email || 'Director'
        });
      } catch (logErr) {
        console.warn("No se pudo registrar en bitácora:", logErr);
      }

      alert(`Diferencia del Invoice ${justifyingInvoice.invoiceNumber} aprobada y justificada exitosamente. El invoice ya no aparecerá en el listado de pendientes.`);
      setJustifyingInvoice(null);
    } catch (err: any) {
      console.error("Error saving justification:", err);
      alert("Error al guardar la justificación: " + err.message);
    } finally {
      setIsSavingJustification(false);
    }
  };

  const handleRevokeJustification = async (invoiceId: string, invoiceNumber: string) => {
    if (!isSuperAdminOrDirector) {
      alert("Acceso denegado: Solo el Director o Super Administrador puede modificar esta aprobación.");
      return;
    }
    if (!confirm(`¿Deseas revocar la aprobación de diferencia del Invoice ${invoiceNumber}? Volverá a mostrarse en el listado de pendientes.`)) return;

    try {
      await updateDoc(doc(db, 'caremedInvoices', invoiceId), {
        differenceJustified: false,
        approved: false,
        justification: '',
        approvedBy: '',
        approvedAt: ''
      });
      alert(`Aprobación revocada para el Invoice ${invoiceNumber}.`);
    } catch (err: any) {
      console.error("Error revoking justification:", err);
      alert("Error al revocar la aprobación: " + err.message);
    }
  };

  const handleStartEditInvoice = (inv: any) => {
    setEditingInvoiceId(inv.id);
    setEditInvoiceValues({
      number: inv.invoiceNumber,
      amount: String(inv.amount),
      notes: inv.notes || '',
      invoiceDate: inv.invoiceDate || (inv.uploadedAt ? inv.uploadedAt.substring(0, 10) : '')
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
        notes: editInvoiceValues.notes.trim(),
        invoiceDate: editInvoiceValues.invoiceDate || ''
      });
      setEditingInvoiceId(null);
    } catch (err: any) {
      console.error("Error editing invoice:", err);
      alert("Fallo al editar la factura.");
    }
  };

  const handleUpdateExportDate = async (oldExportDate: string, newYMD: string) => {
    if (!newYMD) return;
    
    let timePart = '12:00:00';
    if (oldExportDate && oldExportDate.length >= 19) {
      timePart = oldExportDate.substring(11, 19);
    }
    const newExportDateString = `${newYMD} ${timePart}`;

    if (newExportDateString === oldExportDate) {
      alert("La fecha seleccionada es la misma.");
      return;
    }

    try {
      setInvoiceSaving(true);

      const insurancesToUpdate = insurances.filter(ins => ins.Caremed === oldExportDate);
      
      const batchUpdate = writeBatch(db);
      insurancesToUpdate.forEach(ins => {
        if (ins.id) {
          batchUpdate.update(doc(db, 'insurances', ins.id), {
            Caremed: newExportDateString
          });
        }
      });

      const invoicesToUpdate = caremedInvoices.filter(inv => inv.exportDate === oldExportDate);
      invoicesToUpdate.forEach(inv => {
        batchUpdate.update(doc(db, 'caremedInvoices', inv.id), {
          exportDate: newExportDateString
        });
      });

      await batchUpdate.commit();

      if (selectedExportDate === oldExportDate) {
        setSelectedExportDate(newExportDateString);
      }
      if (selectedBatchForDetail && selectedBatchForDetail.exportDate === oldExportDate) {
        setSelectedBatchForDetail({
          exportDate: newExportDateString,
          policies: selectedBatchForDetail.policies.map(p => ({ ...p, Caremed: newExportDateString }))
        });
      }

      alert("Fecha de exportación actualizada correctamente.");
      setEditingExportDate(null);
    } catch (err: any) {
      console.error("Error updating export date:", err);
      alert("Hubo un error al actualizar la fecha de exportación: " + err.message);
    } finally {
      setInvoiceSaving(false);
    }
  };

  // Duplicates calculation based on the 8 fields: Tipo de acción, Nombre Completo, Fecha de nacimiento, Fecha de inicio, Origen, Destino, Plan, Póliza
  const duplicateGroups = useMemo(() => {
    return findDuplicatePolicyGroups(insurances, policies);
  }, [insurances, policies]);

  const duplicateCount = duplicateGroups.length;

  // Unexported policies to CareMed
  const unexportedInsurances = useMemo(() => {
    return insurances.filter(ins => !ins.Caremed);
  }, [insurances]);

  const unexportedCount = unexportedInsurances.length;

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
        handleFirestoreError(error, OperationType.GET, 'policies');
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
        handleFirestoreError(error, OperationType.GET, 'clients');
      }
    };
    fetchClients();

    const fetchCountries = async () => {
      try {
        const snap = await getDocs(collection(db, 'countries'));
        setCountriesList(snap.docs.map(doc => doc.data()));
      } catch (error) {
        console.error("Error fetching countries in PoliciesManager:", error);
      }
    };
    fetchCountries();

    const fetchActionTypes = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'actionTypes'), orderBy('action')));
        setActionTypes(snap.docs.map(doc => doc.data() as any));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'actionTypes');
      }
    };
    fetchActionTypes();

    const unsubInvoices = onSnapshot(collection(db, 'caremedInvoices'), (snapshot) => {
      setCaremedInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'caremedInvoices');
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

      const fullName = `${ins.firstName || ''} ${ins.lastName || ''}`.trim();
      const policy = policies.find(p => p.id === ins.policyId);
      const policyNum = getPolicyNumber(policy, ins.age || 0);
      
      const reqDateNorm = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      const reqDateDisp = formatDisplayDate(ins.requestDate || ins.createdAt);
      const startDateNorm = getNormalizedYYYYMMDD(ins.startDate);
      const startDateDisp = formatDisplayDate(ins.startDate);
      const endDateNorm = getNormalizedYYYYMMDD(ins.endDate);
      const endDateDisp = formatDisplayDate(ins.endDate);

      const searchTarget = `${fullName} ${ins.firstName || ''} ${ins.lastName || ''} ${ins.email || ''} ${ins.id || ''} ${ins.IDseg || ''} ${policyNum} ${clientName} ${subAgentName} ${subAgentEmail} ${ins.requestDate || ''} ${reqDateNorm} ${reqDateDisp} ${startDateNorm} ${startDateDisp} ${endDateNorm} ${endDateDisp}`.toLowerCase();
      const searchTokens = searchTerm.toLowerCase().trim().split(/\s+/);
      const matchesSearch = searchTokens.every(token => searchTarget.includes(token));
      
      let matchesStatus = statusFilter === 'all';
      if (statusFilter === 'unpaid') {
        const isCancelled = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
        const totalPrice = ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : (ins.totalPrice || 0);
        const totalPaid = ins.totalPaid || 0;
        const balance = totalPrice - totalPaid;
        matchesStatus = !isCancelled && !ins.closed && ins.status !== 'paid' && balance > 0.01;
      } else if (statusFilter !== 'all') {
        matchesStatus = ins.status === statusFilter;
      }
      
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
      const actualRequestDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
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
        valA = getNormalizedYYYYMMDD(a.requestDate) || getNormalizedYYYYMMDD(a.createdAt);
        valB = getNormalizedYYYYMMDD(b.requestDate) || getNormalizedYYYYMMDD(b.createdAt);
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
      const isCan = i.actionType?.toUpperCase() === 'CAN';
      const p = i.totalFinal || i.totalPrice || 0;
      const c = getPolicyEffectiveCost(i);
      const com = i.agentCommission || 0;
      ventas += isCan ? -Math.abs(p) : (p < 0 ? p : Math.abs(p));
      costo += c;
      comisiones += isCan ? -Math.abs(com) : (com < 0 ? com : Math.abs(com));
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

    const selectedInsurancesList = insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
    const alreadyExported = selectedInsurancesList.filter(ins => !!ins.Caremed);
    if (alreadyExported.length > 0) {
      alert(`No se puede exportar: se han seleccionado ${alreadyExported.length} póliza(s) que ya fueron exportadas a CareMed previamente.`);
      return;
    }

    try {
      const exportDateString = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

      // Update documents in Firestore with Caremed export date
      const updatePromises = selectedInsurancesList.map(async (ins) => {
        if (ins.id) {
          await updateDoc(doc(db, 'insurances', ins.id), {
            Caremed: exportDateString
          });
        }
      });
      await Promise.all(updatePromises);

      // Group items by policy code
      const groups: { [key: string]: InsuranceRequest[] } = {};
      selectedInsurancesList.forEach(item => {
        const policy = findMatchingPolicy(item, policies);
        const code = item.policyNumber || getPolicyNumber(policy, item.age) || 'No_asignado';
        if (!groups[code]) {
          groups[code] = [];
        }
        groups[code].push(item);
      });

      const dateStr = format(new Date(), 'dd-MM-yyyy');

      // Export a file for each group, sorted by policy code
      Object.entries(groups)
        .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
        .forEach(([policyCode, groupItems]) => {
        // Sort items inside group alphabetically by last name and then first name
        const sortedItems = [...groupItems].sort((a, b) => {
          const lna = (a.lastName || '').localeCompare(b.lastName || '');
          if (lna !== 0) return lna;
          return (a.firstName || '').localeCompare(b.firstName || '');
        });

        const dataToExport = sortedItems.map(item => {
          const ins = item as any;
          const policy = findMatchingPolicy(ins, policies);

          return {
            'Sponsor_Code': policy?.SponsorCode || '',
            'Policy_Number': ins.policyNumber || getPolicyNumber(policy, ins.age) || '',
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
        link.download = `${dateStr} CareMed - ${policyCode}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      });

      alert(`Se exportaron con éxito ${selectedInsurancesList.length} pólizas. Se generó un archivo por cada código de póliza.`);
    } catch (err: any) {
      console.error(err);
      alert('Ocurrió un error al exportar a CareMed: ' + err.message);
    }
  };

  const [selectedInsuranceIds, setSelectedInsuranceIds] = useState<string[]>([]);

  // Selected insurances analysis for CareMed export
  const selectedInsurancesList = useMemo(() => {
    if (selectedInsuranceIds.length === 0) return [];
    return insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
  }, [insurances, selectedInsuranceIds]);

  const selectedExportedCount = useMemo(() => {
    return selectedInsurancesList.filter(ins => !!ins.Caremed).length;
  }, [selectedInsurancesList]);

  const selectedUnexportedCount = useMemo(() => {
    return selectedInsurancesList.filter(ins => !ins.Caremed).length;
  }, [selectedInsurancesList]);

  const canExportToCareMed = selectedInsuranceIds.length > 0 && selectedExportedCount === 0 && selectedUnexportedCount > 0;
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkEditFields, setBulkEditFields] = useState({
    updatePrice: false,
    price: '',
    updateCommission: false,
    commission: '',
    updateDiscount: false,
    discount: '',
    updateAgent: false,
    agentClientId: '',
    agentSubAgentId: '',
    updateRequestDate: false,
    requestDate: '',
    updateStartDate: false,
    startDate: '',
    updateEndDate: false,
    endDate: '',
    updateOriginCountry: false,
    originCountry: 'MX',
    updateDestinationCountry: false,
    destinationCountry: 'US',
    updateInvoice: false,
    invoiceCaremed: '',
  });

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedInsuranceIds.length === 0) return;
    setBulkEditing(true);
    try {
      const selectedInsurancesList = insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id));
      
      const updatePromises = selectedInsurancesList.map(async (ins) => {
        const docRef = doc(db, 'insurances', ins.id!);
        const updatePayload: any = {};

        if (bulkEditFields.updatePrice) {
          updatePayload.totalPrice = parseFloat(bulkEditFields.price) || 0;
        }
        if (bulkEditFields.updateDiscount) {
          updatePayload.discount = parseFloat(bulkEditFields.discount) || 0;
        }

        if (bulkEditFields.updatePrice || bulkEditFields.updateDiscount) {
          const price = bulkEditFields.updatePrice ? (parseFloat(bulkEditFields.price) || 0) : (ins.totalPrice || 0);
          const disc = bulkEditFields.updateDiscount ? (parseFloat(bulkEditFields.discount) || 0) : (ins.discount || 0);
          updatePayload.totalFinal = Math.max(0, price - disc);
        }

        if (bulkEditFields.updateCommission) {
          updatePayload.agentCommission = parseFloat(bulkEditFields.commission) || 0;
        }

        if (bulkEditFields.updateAgent) {
          updatePayload.clientId = bulkEditFields.agentClientId;
          updatePayload.clientType = 'Agent';
          updatePayload.linkedAgentId = bulkEditFields.agentSubAgentId || '';
        }

        if (bulkEditFields.updateRequestDate) {
          updatePayload.requestDate = bulkEditFields.requestDate;
        }

        if (bulkEditFields.updateOriginCountry) {
          updatePayload.originCountry = bulkEditFields.originCountry;
        }

        if (bulkEditFields.updateDestinationCountry) {
          updatePayload.destinationCountry = bulkEditFields.destinationCountry;
        }

        if (bulkEditFields.updateInvoice) {
          updatePayload.InvoiceCaremed = bulkEditFields.invoiceCaremed.trim() ? bulkEditFields.invoiceCaremed.trim() : null;
        }

        const startDStr = bulkEditFields.updateStartDate ? bulkEditFields.startDate : ins.startDate;
        const endDStr = bulkEditFields.updateEndDate ? bulkEditFields.endDate : ins.endDate;

        if (bulkEditFields.updateStartDate) {
          updatePayload.startDate = bulkEditFields.startDate;
        }
        if (bulkEditFields.updateEndDate) {
          updatePayload.endDate = bulkEditFields.endDate;
        }

        if (bulkEditFields.updateStartDate || bulkEditFields.updateEndDate) {
          if (startDStr && endDStr) {
            const sD = parseISO(startDStr);
            const eD = parseISO(endDStr);
            if (isValid(sD) && isValid(eD)) {
              updatePayload.days = differenceInDays(eD, sD) + 1;
            }
          }
        }

        if (Object.keys(updatePayload).length > 0) {
          await updateDoc(docRef, updatePayload);
          
          await logInsuranceActivity({
            insuranceId: ins.id,
            type: 'manual',
            description: `Modificación masiva por Super Administrador`,
            updatedFields: Object.keys(updatePayload),
            createdAt: serverTimestamp()
          });
        }
      });

      await Promise.all(updatePromises);
      alert(`Se modificaron con éxito ${selectedInsurancesList.length} pólizas de manera masiva.`);
      setShowBulkEditModal(false);
      setSelectedInsuranceIds([]);
      setBulkEditFields({
        updatePrice: false,
        price: '',
        updateCommission: false,
        commission: '',
        updateDiscount: false,
        discount: '',
        updateAgent: false,
        agentClientId: '',
        agentSubAgentId: '',
        updateRequestDate: false,
        requestDate: '',
        updateStartDate: false,
        startDate: '',
        updateEndDate: false,
        endDate: '',
        updateOriginCountry: false,
        originCountry: 'MX',
        updateDestinationCountry: false,
        destinationCountry: 'US',
        updateInvoice: false,
        invoiceCaremed: '',
      });
    } catch (err: any) {
      console.error("Error bulk editing insurances:", err);
      alert("Hubo un error al realizar la modificación masiva: " + err.message);
    } finally {
      setBulkEditing(false);
    }
  };

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

  const handleSelectAllFiltered = () => {
    const allFilteredIds = filteredInsurances.map(i => i.id).filter((id): id is string => !!id);
    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedInsuranceIds.includes(id));
    if (allSelected) {
      setSelectedInsuranceIds([]);
    } else {
      setSelectedInsuranceIds(allFilteredIds);
    }
  };

  const handleFilterNonExported = () => {
    if (caremedExportedFilter === 'not_exported' && viewMode === 'list') {
      setCaremedExportedFilter('all');
    } else {
      setCaremedExportedFilter('not_exported');
      setViewMode('list');
      setCurrentPage(1);
    }
  };

  const [isBulkSending, setIsBulkSending] = useState(false);
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false);
  const [showBulkZipModal, setShowBulkZipModal] = useState(false);
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
    pdfMergeMode: 'separate' | 'merged';
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
        const policy = findPolicyPrioritized(ins.policyId, policies);
        const policyCode = ins.policyNumber || getPolicyNumber(policy, ins.age) || policy?.id || ins.policyId || '';
        const policyName = policy?.name || policy?.NombrePoliza || ins.policyName || '';
        const policyInfo = policyCode && policyName ? `${policyCode} - ${policyName}` : (policyCode || policyName || '');

        const formatToShow = (dateVal: any) => {
          if (!dateVal) return '';
          const formatted = formatDisplayDate(dateVal);
          return formatted === '-' ? '' : formatted;
        };

        const getCountryName = (code: string) => {
          if (!code) return '';
          const found = countriesList.find(c => c.code === code) || COUNTRIES.find(c => c.code === code);
          return found ? found.name : code;
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
            .replace(/{Pais Origen}/g, getCountryName(ins.originCountry) || 'México')
            .replace(/{origen}/g, getCountryName(ins.originCountry) || 'México')
            .replace(/{Pais Destino}/g, getCountryName(ins.destinationCountry) || '')
            .replace(/{destino}/g, getCountryName(ins.destinationCountry) || '')
            .replace(/{Fecha_inicio}/g, formatToShow(ins.startDate))
            .replace(/{fecha_inicio}/g, formatToShow(ins.startDate))
            .replace(/{Fecha_Final}/g, formatToShow(ins.endDate))
            .replace(/{fecha_final}/g, formatToShow(ins.endDate));
        };

        const subject = replaceAllPlaceholders(config.subjectTemplate);
        const body = replaceAllPlaceholders(config.bodyTemplate);

        const relevantLetters = sortLettersByLanguage(
          getAvailableLettersForInsurance(ins, policyLetters, policies)
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
        } else if (config.pdfMergeMode === 'merged' && selectedLetters.length > 1) {
          const docObj: any = await generateMergedLettersPDF(ins, selectedLetters, policies, settings?.logoUrl, true);
          const base64 = docObj.output('datauristring').split(',')[1];
          pdfs.push({
            filename: `Certificado_Integrado_${ins.firstName}_${ins.lastName}.pdf`,
            data: base64
          });
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

        // Log bulk email dispatch to policy's activity log (bitácora)
        try {
          const now = new Date();
          const userEmail = auth.currentUser?.email || 'Sistema';
          const isMerged = config.pdfMergeMode === 'merged' && selectedLetters.length > 1;
          const attachDesc = isMerged
            ? `(${selectedLetters.length} cartas integradas en 1 solo PDF)`
            : selectedLetters.length > 1
              ? `(${selectedLetters.length} cartas en PDFs separados)`
              : '';

          await logInsuranceActivity({
            insuranceId: ins.id,
            type: 'automatic',
            description: `Póliza de seguro enviada por correo electrónico (Envío masivo) a: ${emailTo} ${attachDesc}. Enviado el día ${format(now, 'dd/MM/yyyy')} a las ${format(now, 'HH:mm:ss')} por el usuario ${userEmail}.`,
            date: now,
            createdBy: userEmail
          });
        } catch (logErr) {
          console.error("Error logging bulk email sending to bitacora:", logErr);
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

  const handleDeleteMultipleInsurances = async (ids: string[]) => {
    if (ids.length === 0) return;
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

      for (const id of ids) {
        currentBatch.delete(doc(db, 'insurances', id));
        addOp();
      }

      if (opCount > 0) {
        batches.push(currentBatch);
      }

      await Promise.all(batches.map(b => b.commit()));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'insurances_duplicates_bulk');
      throw error;
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
        if ((totalPrice - newTotalPaid) < 2) {
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
    const available = getAvailableLettersForInsurance(insurance, policyLetters, policies);
    
    if (available.length === 0) {
      alert('No se encontraron cartas vinculadas a esta póliza en el catálogo. Se generará el formato por defecto.');
      await generatePDF(insurance, undefined, policies, settings?.logoUrl);
      return;
    }

    const sortedAvailable = sortLettersByLanguage(available);
    const preferredLangs = ['es', 'en', 'es_spain', 'embajada_spain', 'policy', 'covid'];
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

  const invoiceTableData = useMemo(() => {
    return caremedInvoicesGrouped
      .map(inv => {
        const dbInv = caremedInvoices.find(
          d => (d.invoiceNumber || '').toLowerCase().trim() === inv.invoiceNumber.toLowerCase().trim()
        );

        const exportDate = inv.exportDate || '-';
        const invoiceDate = dbInv?.invoiceDate || '-';
        const invoiceNumber = inv.invoiceNumber;
        const policyCount = inv.count;
        const totalCalculatedCost = inv.totalCalculatedCost;
        const invoiceAmount = dbInv?.amount;
        const dbInvoiceId = dbInv?.id || null;

        // Factura correcta
        let isCorrect = 'No';
        let hasAttachedInvoice = false;
        let difference = 0;
        const isJustified = !!dbInv?.differenceJustified || !!dbInv?.approved;
        const justification = dbInv?.justification || '';
        const approvedBy = dbInv?.approvedBy || '';
        const approvedAt = dbInv?.approvedAt || '';

        if (dbInv) {
          hasAttachedInvoice = true;
          difference = dbInv.amount - totalCalculatedCost;
          if (Math.abs(difference) < 0.05) {
            isCorrect = 'Sí';
          } else {
            isCorrect = 'No';
          }
        }

        // Pagada a Caremed (si/no)
        const totalPolicies = inv.policies.length;
        const paidPolicies = inv.policies.filter(p => p.providerPaymentStatus === 'paid').length;

        let isPaid = 'No';
        if (totalPolicies > 0) {
          if (paidPolicies === totalPolicies) {
            isPaid = 'Sí';
          } else if (paidPolicies > 0) {
            isPaid = 'Parcial';
          }
        }

        // Payment Date
        const paymentDates = inv.policies
          .map(p => p.providerPaymentDate)
          .filter((d): d is string => !!d);
        const paymentDate = paymentDates.length > 0 ? paymentDates[0] : '-';

        return {
          id: invoiceNumber,
          dbInvoiceId,
          exportDate,
          invoiceDate,
          invoiceNumber,
          policyCount,
          totalCalculatedCost,
          invoiceAmount,
          hasAttachedInvoice,
          isCorrect,
          difference,
          isJustified,
          justification,
          approvedBy,
          approvedAt,
          isPaid,
          paymentDate,
          rawGroup: inv
        };
      });
  }, [caremedInvoicesGrouped, caremedInvoices]);

  const filteredAndSortedInvoiceList = useMemo(() => {
    return invoiceTableData
      .filter(item => {
        if (invoicedSearchTerm) {
          const term = invoicedSearchTerm.toLowerCase();
          const matchNum = item.invoiceNumber.toLowerCase().includes(term);
          const matchDate = item.invoiceDate.toLowerCase().includes(term);
          const matchExpDate = item.exportDate.toLowerCase().includes(term);
          if (!matchNum && !matchDate && !matchExpDate) return false;
        }

        if (invoiceListDateRange.start) {
          if (item.invoiceDate === '-' || item.invoiceDate < invoiceListDateRange.start) {
            return false;
          }
        }
        if (invoiceListDateRange.end) {
          if (item.invoiceDate === '-' || item.invoiceDate > invoiceListDateRange.end) {
            return false;
          }
        }

        if (invoiceListPaidFilter === 'paid' && item.isPaid !== 'Sí') return false;
        if (invoiceListPaidFilter === 'not_paid' && item.isPaid !== 'No') return false;
        if (invoiceListPaidFilter === 'partial' && item.isPaid !== 'Parcial') return false;

        // Filtro de Estado de Factura / Diferencia
        if (invoiceListCorrectFilter === 'pending') {
          // Pendientes: Sin factura O con diferencia que NO ha sido justificada
          if (item.hasAttachedInvoice && (item.isCorrect === 'Sí' || item.isJustified)) {
            return false;
          }
        } else if (invoiceListCorrectFilter === 'incorrect') {
          // Solo los que tienen diferencia de importe
          if (!item.hasAttachedInvoice || item.isCorrect === 'Sí') {
            return false;
          }
        } else if (invoiceListCorrectFilter === 'no_invoice') {
          // Solo los que no tienen factura adjunta
          if (item.hasAttachedInvoice) {
            return false;
          }
        } else if (invoiceListCorrectFilter === 'correct') {
          // Solo los que tienen factura correcta (sin diferencia)
          if (!item.hasAttachedInvoice || item.isCorrect !== 'Sí') {
            return false;
          }
        } else if (invoiceListCorrectFilter === 'justified') {
          // Solo diferencias justificadas (aprobadas con OK)
          if (!item.hasAttachedInvoice || !item.isJustified) {
            return false;
          }
        }
        // if invoiceListCorrectFilter === 'all', todos se muestran

        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (invoiceListSortField === 'exportDate') {
          const dateA = a.exportDate === '-' ? '' : a.exportDate;
          const dateB = b.exportDate === '-' ? '' : b.exportDate;
          comparison = dateA.localeCompare(dateB);
        } else if (invoiceListSortField === 'invoiceDate') {
          const dateA = a.invoiceDate === '-' ? '' : a.invoiceDate;
          const dateB = b.invoiceDate === '-' ? '' : b.invoiceDate;
          comparison = dateA.localeCompare(dateB);
        } else if (invoiceListSortField === 'invoiceNumber') {
          comparison = a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true, sensitivity: 'base' });
        } else if (invoiceListSortField === 'policyCount') {
          comparison = a.policyCount - b.policyCount;
        } else if (invoiceListSortField === 'totalCalculatedCost') {
          comparison = a.totalCalculatedCost - b.totalCalculatedCost;
        } else if (invoiceListSortField === 'difference') {
          comparison = a.difference - b.difference;
        }

        return invoiceListSortOrder === 'asc' ? comparison : -comparison;
      });
  }, [
    invoiceTableData,
    invoicedSearchTerm,
    invoiceListDateRange,
    invoiceListPaidFilter,
    invoiceListCorrectFilter,
    invoiceListSortField,
    invoiceListSortOrder
  ]);

  const invoiceListMetrics = useMemo(() => {
    const dataset = filteredAndSortedInvoiceList;
    const numInvoices = dataset.length;
    const numPolicies = dataset.reduce((sum, item) => sum + item.policyCount, 0);
    const totalSystem = dataset.reduce((sum, item) => sum + item.totalCalculatedCost, 0);
    const totalInvoiced = dataset.reduce((sum, item) => sum + (item.hasAttachedInvoice ? (item.invoiceAmount || 0) : 0), 0);
    const totalDiff = dataset.reduce((sum, item) => sum + (item.hasAttachedInvoice ? item.difference : 0), 0);

    let unpaidCount = 0;
    let unpaidAmount = 0;

    dataset.forEach(item => {
      if (item.isPaid !== 'Sí') {
        unpaidCount++;
      }
      item.rawGroup.policies.forEach(p => {
        if (p.providerPaymentStatus !== 'paid') {
          const total = getPolicyEffectiveCost(p);
          unpaidAmount += total;
        }
      });
    });

    return {
      numInvoices,
      numPolicies,
      totalSystem,
      totalInvoiced,
      totalDiff,
      unpaidCount,
      unpaidAmount
    };
  }, [filteredAndSortedInvoiceList]);

  // Statistics for Cotejo Automático sub-tab
  const cotejoMetrics = useMemo(() => {
    let correctCount = 0;
    let differenceCount = 0;
    let noInvoiceCount = 0;
    let justifiedCount = 0;

    caremedInvoicesGrouped.forEach(inv => {
      const dbInv = caremedInvoices.find(
        d => (d.invoiceNumber || '').toLowerCase().trim() === inv.invoiceNumber.toLowerCase().trim()
      );
      if (!dbInv) {
        noInvoiceCount++;
      } else {
        const isExactMatch = Math.abs(dbInv.amount - inv.totalCalculatedCost) < 0.05;
        const isJustified = !!dbInv.differenceJustified || !!dbInv.approved;
        if (isExactMatch) {
          correctCount++;
        } else {
          differenceCount++;
          if (isJustified) {
            justifiedCount++;
          }
        }
      }
    });

    return {
      total: caremedInvoicesGrouped.length,
      correct: correctCount,
      difference: differenceCount,
      noInvoice: noInvoiceCount,
      justified: justifiedCount
    };
  }, [caremedInvoicesGrouped, caremedInvoices]);

  // Detailed policies per CareMed invoice list (Sub-tab 'detailed')
  const detailedInvoicedPolicies = useMemo(() => {
    // Precompute total calculated costs and count per invoice key
    const invoiceSums: { [key: string]: { totalCost: number; count: number } } = {};
    insurances.forEach(ins => {
      if (ins.InvoiceCaremed) {
        const k = ins.InvoiceCaremed.trim();
        if (!invoiceSums[k]) invoiceSums[k] = { totalCost: 0, count: 0 };
        invoiceSums[k].totalCost += getPolicyEffectiveCost(ins);
        invoiceSums[k].count += 1;
      }
    });

    const list = insurances
      .filter(ins => !!ins.InvoiceCaremed)
      .map(ins => {
        const invoiceNumber = (ins.InvoiceCaremed || '').trim();
        const dbInv = caremedInvoices.find(
          d => (d.invoiceNumber || '').trim().toLowerCase() === invoiceNumber.toLowerCase()
        );

        const invoiceSumInfo = invoiceSums[invoiceNumber] || { totalCost: ins.totalCost || 0, count: 1 };
        const totalInvoiceCost = invoiceSumInfo.totalCost;
        const hasDbInvoice = !!dbInv;
        const difference = hasDbInvoice ? (dbInv.amount - totalInvoiceCost) : 0;
        const isExactMatch = hasDbInvoice && Math.abs(difference) < 0.05;

        let correctnessStatus: 'correct' | 'discrepancy' | 'no_invoice' = 'no_invoice';
        if (hasDbInvoice) {
          correctnessStatus = isExactMatch ? 'correct' : 'discrepancy';
        }

        // Determine date: DB invoice date > Caremed export date > requestDate
        let rawInvoiceDate = dbInv?.invoiceDate || '';
        if (!rawInvoiceDate && ins.Caremed) {
          rawInvoiceDate = ins.Caremed.substring(0, 10);
        }
        if (!rawInvoiceDate && ins.requestDate) {
          rawInvoiceDate = ins.requestDate;
        }

        const client = clients.find(c => c.id === ins.clientId);
        const policy = policies.find(p => p.id === ins.policyId);

        // Determine effective age to assign the exact CareMed master policy code
        let effectiveAge = ins.age;
        if ((effectiveAge === undefined || effectiveAge === null || isNaN(effectiveAge)) && ins.birthDate) {
          const birthDate = new Date(ins.birthDate);
          if (!isNaN(birthDate.getTime())) {
            const today = new Date();
            let calcAge = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
              calcAge--;
            }
            effectiveAge = calcAge;
          }
        }

        // Strictly categorize into one of the two official CareMed policy codes:
        // 26 CC015653-UNDER25 (age < 25) or 26 CC015653-OVER25 (age >= 25)
        const isUnder25 = (effectiveAge !== undefined && effectiveAge !== null && !isNaN(effectiveAge) && effectiveAge < 25) ||
          (ins.policyNumber && ins.policyNumber.toUpperCase().includes('UNDER25')) ||
          (ins.plan && ins.plan.toUpperCase().includes('UNDER25'));

        const standardCareMedCode = isUnder25 ? '26 CC015653-UNDER25' : '26 CC015653-OVER25';
        const policyNum = standardCareMedCode;

        const clientName = client ? (client.name || client.company || 'Agente / Corp') : (ins.clientType === 'Individual' ? 'Individual' : 'Directo');
        const isCan = ins.actionType?.toUpperCase() === 'CAN';
        const policyAmount = getPolicyEffectiveCost(ins);

        return {
          insurance: ins,
          id: ins.id,
          invoiceNumber,
          invoiceDate: rawInvoiceDate,
          dbInvoiceDate: dbInv?.invoiceDate || '',
          dbInvoiceAmount: dbInv?.amount || 0,
          policyNumber: policyNum,
          clientName,
          clientType: ins.clientType || (client?.type) || 'Individual',
          clientId: ins.clientId,
          insuredFullName: `${ins.firstName || ''} ${ins.lastName || ''}`.trim(),
          amount: policyAmount,
          isCancellation: isCan,
          hasDbInvoice,
          difference,
          isExactMatch,
          isJustified: !!dbInv?.differenceJustified || !!dbInv?.approved,
          justification: dbInv?.justification || '',
          correctnessStatus,
          totalInvoiceCost,
        };
      });

    // Apply filters
    const filtered = list.filter(item => {
      // 1. Search query
      if (invoiceDetailSearchTerm) {
        const q = invoiceDetailSearchTerm.toLowerCase().trim();
        const matchInv = item.invoiceNumber.toLowerCase().includes(q);
        const matchPol = item.policyNumber.toLowerCase().includes(q) || 
                         (item.insurance.IDseg || '').toLowerCase().includes(q) || 
                         (item.insurance.policyId || '').toLowerCase().includes(q);
        const matchName = item.insuredFullName.toLowerCase().includes(q);
        const matchClient = item.clientName.toLowerCase().includes(q);
        if (!matchInv && !matchPol && !matchName && !matchClient) return false;
      }

      // 2. Date filter (Invoice Date)
      if (invoiceDetailDateRange.start) {
        if (!item.invoiceDate || item.invoiceDate < invoiceDetailDateRange.start) return false;
      }
      if (invoiceDetailDateRange.end) {
        if (!item.invoiceDate || item.invoiceDate > invoiceDetailDateRange.end) return false;
      }

      // 3. Agent / Corporate filter
      if (invoiceDetailAgentFilter !== 'all') {
        if (invoiceDetailAgentFilter === 'agents') {
          if (item.clientType !== 'Agent' && item.clientType !== 'SubAgent') return false;
        } else if (invoiceDetailAgentFilter === 'corporates') {
          if (item.clientType !== 'Corporate') return false;
        } else if (invoiceDetailAgentFilter === 'individuals') {
          if (item.clientType !== 'Individual' && item.clientType) return false;
        } else {
          if (item.clientId !== invoiceDetailAgentFilter) return false;
        }
      }

      // 4. Correctness filter
      if (invoiceDetailCorrectFilter !== 'all') {
        if (item.correctnessStatus !== invoiceDetailCorrectFilter) return false;
      }

      return true;
    });

    // Apply sorting
    filtered.sort((a, b) => {
      let comp = 0;
      if (invoiceDetailSortField === 'invoiceDate') {
        comp = (a.invoiceDate || '').localeCompare(b.invoiceDate || '');
      } else if (invoiceDetailSortField === 'invoiceNumber') {
        comp = a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true, sensitivity: 'base' });
      } else if (invoiceDetailSortField === 'policyNumber') {
        comp = a.policyNumber.localeCompare(b.policyNumber, undefined, { numeric: true });
      } else if (invoiceDetailSortField === 'amount') {
        comp = a.amount - b.amount;
      }
      return invoiceDetailSortOrder === 'asc' ? comp : -comp;
    });

    return filtered;
  }, [
    insurances,
    caremedInvoices,
    clients,
    invoiceDetailSearchTerm,
    invoiceDetailDateRange,
    invoiceDetailAgentFilter,
    invoiceDetailCorrectFilter,
    invoiceDetailSortField,
    invoiceDetailSortOrder
  ]);

  const detailedMetrics = useMemo(() => {
    const totalPolicies = detailedInvoicedPolicies.length;
    const uniqueInvoices = new Set(detailedInvoicedPolicies.map(i => i.invoiceNumber)).size;
    const totalAmount = detailedInvoicedPolicies.reduce((sum, i) => sum + i.amount, 0);
    const correctCount = detailedInvoicedPolicies.filter(i => i.correctnessStatus === 'correct').length;
    const discrepancyCount = detailedInvoicedPolicies.filter(i => i.correctnessStatus === 'discrepancy').length;
    const noInvoiceCount = detailedInvoicedPolicies.filter(i => i.correctnessStatus === 'no_invoice').length;

    return {
      totalPolicies,
      uniqueInvoices,
      totalAmount,
      correctCount,
      discrepancyCount,
      noInvoiceCount,
      correctPercent: totalPolicies > 0 ? Math.round((correctCount / totalPolicies) * 100) : 0,
    };
  }, [detailedInvoicedPolicies]);

  // Concentrated policies data grouped by (Invoice Number, Policy Code)
  const concentratedPoliciesData = useMemo(() => {
    const groups: { [key: string]: {
      key: string;
      invoiceNumber: string;
      invoiceDate: string;
      policyCode: string;
      policyCount: number;
      amount: number;
      invoiceSystemTotal: number;
      hasAttachedInvoice: boolean;
      invoiceAmount?: number;
      invoiceDifference: number;
      hasDifference: boolean;
      isJustified: boolean;
      justification: string;
      policies: typeof detailedInvoicedPolicies;
    } } = {};

    detailedInvoicedPolicies.forEach(item => {
      const invNum = item.invoiceNumber || '-';
      const invDate = item.invoiceDate || '';
      const polCode = item.policyNumber || '26 CC015653-OVER25';
      const key = `${invNum}___${polCode}`;

      const dbInv = caremedInvoices.find(
        d => (d.invoiceNumber || '').toLowerCase().trim() === invNum.toLowerCase().trim()
      );
      const invoiceGroup = caremedInvoicesGrouped.find(
        g => g.invoiceNumber.toLowerCase().trim() === invNum.toLowerCase().trim()
      );
      const invoiceSystemTotal = invoiceGroup ? invoiceGroup.totalCalculatedCost : 0;
      const invoiceAmount = dbInv?.amount;
      const hasAttachedInvoice = !!dbInv;
      const invoiceDifference = dbInv ? (dbInv.amount - invoiceSystemTotal) : 0;
      const hasDifference = hasAttachedInvoice && Math.abs(invoiceDifference) >= 0.05;
      const isJustified = !!dbInv?.differenceJustified || !!dbInv?.approved;
      const justification = dbInv?.justification || '';

      if (!groups[key]) {
        groups[key] = {
          key,
          invoiceNumber: invNum,
          invoiceDate: invDate,
          policyCode: polCode,
          policyCount: 0,
          amount: 0,
          invoiceSystemTotal,
          hasAttachedInvoice,
          invoiceAmount,
          invoiceDifference,
          hasDifference,
          isJustified,
          justification,
          policies: []
        };
      } else {
        if (!groups[key].invoiceDate && invDate) {
          groups[key].invoiceDate = invDate;
        }
      }

      groups[key].policyCount += 1;
      groups[key].amount += item.amount;
      groups[key].policies.push(item);
    });

    const result = Object.values(groups);

    result.sort((a, b) => {
      let comp = 0;
      if (invoiceDetailSortField === 'invoiceDate') {
        comp = (a.invoiceDate || '').localeCompare(b.invoiceDate || '');
      } else if (invoiceDetailSortField === 'invoiceNumber') {
        comp = a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true, sensitivity: 'base' });
      } else if (invoiceDetailSortField === 'policyNumber') {
        comp = a.policyCode.localeCompare(b.policyCode, undefined, { numeric: true });
      } else if (invoiceDetailSortField === 'amount') {
        comp = a.amount - b.amount;
      }
      return invoiceDetailSortOrder === 'asc' ? comp : -comp;
    });

    return result;
  }, [detailedInvoicedPolicies, invoiceDetailSortField, invoiceDetailSortOrder, caremedInvoices, caremedInvoicesGrouped]);

  const toggleGroupExpand = (key: string) => {
    setExpandedGroupKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleDetailSort = (field: 'invoiceDate' | 'invoiceNumber' | 'policyNumber' | 'amount') => {
    if (invoiceDetailSortField === field) {
      setInvoiceDetailSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setInvoiceDetailSortField(field);
      setInvoiceDetailSortOrder(field === 'invoiceDate' ? 'desc' : 'asc');
    }
  };

  const handleExportInvoiceDetailPDF = async () => {
    if (concentratedPoliciesData.length === 0) {
      alert('No hay registros para exportar con los filtros actuales.');
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter'
    });

    // Load logo if configured
    let loadedLogo: { url: string; width: number; height: number } | null = null;
    const logoUrl = settings?.logoUrl;
    if (logoUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = logoUrl;
        await new Promise((resolve) => {
          img.onload = () => resolve(null);
          img.onerror = () => resolve(null);
          if (img.complete) resolve(null);
        });
        if (img.width > 0 && img.height > 0) {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            loadedLogo = {
              url: canvas.toDataURL('image/png'),
              width: img.width,
              height: img.height
            };
          }
        }
      } catch (e) {
        console.warn('Logo load in PDF export:', e);
      }
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Top Header Background
    doc.setFillColor(26, 33, 56); // Deep Navy
    doc.rect(0, 0, pageWidth, 28, 'F');

    // Accent line
    doc.setFillColor(79, 70, 229); // Indigo-600
    doc.rect(0, 28, pageWidth, 2, 'F');

    // Title & Subtitle
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('REPORTE CONCENTRADO DE INVOICES CAREMED', 14, 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(200, 210, 235);
    doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')} | Total Pólizas: ${detailedMetrics.totalPolicies} | Invoices: ${detailedMetrics.uniqueInvoices} | Monto Total: $${detailedMetrics.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, 14, 21);

    // Draw logo if available
    if (loadedLogo) {
      try {
        const maxH = 18;
        const maxW = 45;
        let w = loadedLogo.width;
        let h = loadedLogo.height;
        const ratio = Math.min(maxW / w, maxH / h);
        w = w * ratio;
        h = h * ratio;
        doc.addImage(loadedLogo.url, 'PNG', pageWidth - w - 14, 5, w, h);
      } catch (err) {
        console.warn('Error drawing logo in PDF:', err);
      }
    }

    // Filter summary pill box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, 33, pageWidth - 28, 14, 2, 2, 'FD');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);

    let filterDesc = 'Filtros aplicados: ';
    const filterParts: string[] = [];
    if (invoiceDetailDateRange.start || invoiceDetailDateRange.end) {
      filterParts.push(`Fecha: ${invoiceDetailDateRange.start || 'Inicio'} al ${invoiceDetailDateRange.end || 'Fin'}`);
    }
    if (invoiceDetailAgentFilter !== 'all') {
      if (invoiceDetailAgentFilter === 'agents') filterParts.push('Tipo: Solo Agentes');
      else if (invoiceDetailAgentFilter === 'corporates') filterParts.push('Tipo: Solo Corporativos');
      else if (invoiceDetailAgentFilter === 'individuals') filterParts.push('Tipo: Solo Individuales');
      else {
        const cl = clients.find(c => c.id === invoiceDetailAgentFilter);
        filterParts.push(`Cliente: ${cl?.name || cl?.company || invoiceDetailAgentFilter}`);
      }
    }
    if (invoiceDetailCorrectFilter !== 'all') {
      if (invoiceDetailCorrectFilter === 'correct') filterParts.push('Factura: Solo Correctas');
      else if (invoiceDetailCorrectFilter === 'discrepancy') filterParts.push('Factura: Con Diferencia');
      else if (invoiceDetailCorrectFilter === 'no_invoice') filterParts.push('Factura: Sin Factura Adjunta');
    }
    if (invoiceDetailSearchTerm) {
      filterParts.push(`Búsqueda: "${invoiceDetailSearchTerm}"`);
    }
    filterDesc += filterParts.length > 0 ? filterParts.join(' | ') : 'Todas las pólizas facturadas';

    doc.text(filterDesc, 18, 39.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Concentrado: ${concentratedPoliciesData.length} registros | ${detailedMetrics.totalPolicies} pólizas acumuladas`, 18, 44.5);

    // Table Content - EXACT 5 COLUMNS REQUESTED BY USER
    const tableHeaders = [
      'Numero Invoice',
      'Fecha',
      'Codigo Poliza',
      'Numero de Polizas',
      'Cantidad'
    ];

    const tableRows = concentratedPoliciesData.map(item => {
      const diffNote = item.hasDifference
        ? `\n[Diferencia: ${item.invoiceDifference > 0 ? '+' : ''}$${item.invoiceDifference.toFixed(2)}]`
        : (!item.hasAttachedInvoice ? '\n(Sin Factura)' : '');

      return [
        (item.invoiceNumber || '-') + diffNote,
        item.invoiceDate ? formatDisplayDate(item.invoiceDate) : '-',
        item.policyCode || '-',
        item.policyCount.toString(),
        `$${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      ];
    });

    autoTable(doc, {
      startY: 50,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        cellPadding: 2,
        halign: 'left'
      },
      columnStyles: {
        0: { fontStyle: 'bold', halign: 'left', cellWidth: 40 },
        1: { halign: 'center', cellWidth: 32 },
        2: { fontStyle: 'bold', halign: 'left' },
        3: { halign: 'center', fontStyle: 'bold', cellWidth: 38 },
        4: { halign: 'right', fontStyle: 'bold', cellWidth: 45 },
      },
      styles: {
        fontSize: 6.5,
        cellPadding: 1.8,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.2
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      foot: [[
        'TOTAL GENERAL',
        '',
        '',
        `${detailedMetrics.totalPolicies}`,
        `$${detailedMetrics.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      ]],
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 7,
        cellPadding: 2
      },
      margin: { left: 14, right: 14, bottom: 15 },
      didDrawPage: (data) => {
        const str = `Página ${data.pageNumber} de ${doc.internal.pages.length - 1}`;
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(str, pageWidth - 14, pageHeight - 8, { align: 'right' });
        doc.text('MSI Seguros Internacionales - Sistema de Gestión', 14, pageHeight - 8);
      }
    });

    const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
    doc.save(`reporte_concentrado_invoices_caremed_${timestamp}.pdf`);
  };

  const handleExportInvoiceDetailCSV = () => {
    if (concentratedPoliciesData.length === 0) {
      alert('No hay registros para exportar.');
      return;
    }

    const csvRows = concentratedPoliciesData.map(item => ({
      'Numero Invoice': item.invoiceNumber || '',
      'Fecha': item.invoiceDate || '',
      'Codigo Poliza': item.policyCode || '',
      'Numero de Polizas': item.policyCount,
      'Cantidad': item.amount.toFixed(2),
      'Estado Factura': item.hasDifference
        ? `Con Diferencia (${item.invoiceDifference > 0 ? '+' : ''}${item.invoiceDifference.toFixed(2)} USD)`
        : (item.hasAttachedInvoice ? 'Factura Correcta' : 'Sin Factura Adjunta')
    }));

    const csv = Papa.unparse(csvRows);
    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const timestamp = format(new Date(), 'yyyyMMdd_HHmm');
    link.setAttribute('download', `reporte_concentrado_invoices_caremed_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
          <div className="flex flex-col items-start lg:items-end gap-2.5">
            {/* Fila Superior: Controles de Selección, Limpieza y Edición Masiva */}
            {(isSuperAdminOrDirector || canManageClosedState) && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Seleccionar / Deseleccionar Página */}
                <button
                  onClick={handleSelectAllCurrentPage}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 hover:bg-gray-50 rounded-xl font-bold border border-gray-200 transition-all shadow-xs text-xs cursor-pointer"
                  title="Seleccionar o deseleccionar todas las pólizas de la página actual"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-gray-500" />
                  {paginatedInsurances.length > 0 && paginatedInsurances.map(i => i.id).filter((id): id is string => !!id).every(id => selectedInsuranceIds.includes(id)) 
                    ? 'Deseleccionar Página' 
                    : 'Seleccionar Página'
                  }
                </button>

                {/* Seleccionar / Deseleccionar Todo */}
                {filteredInsurances.length > 0 && (
                  <button
                    onClick={handleSelectAllFiltered}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl font-bold border border-blue-200 transition-all shadow-xs text-xs cursor-pointer"
                    title="Seleccionar o deseleccionar todas las pólizas encontradas"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-blue-600" />
                    {filteredInsurances.map(i => i.id).filter((id): id is string => !!id).every(id => selectedInsuranceIds.includes(id))
                      ? 'Deseleccionar Todo'
                      : `Seleccionar Todo (${filteredInsurances.length})`
                    }
                  </button>
                )}

                {/* Limpiar Selección */}
                {selectedInsuranceIds.length > 0 && (
                  <button
                    onClick={() => setSelectedInsuranceIds([])}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 font-bold hover:bg-gray-100 rounded-xl transition-all cursor-pointer"
                    title="Limpiar selección actual"
                  >
                    <X className="w-3.5 h-3.5" />
                    Limpiar ({selectedInsuranceIds.length})
                  </button>
                )}

                {/* Borrar Masivo */}
                {isSuperAdminOrDirector && selectedInsuranceIds.length > 0 && (
                  <button
                    onClick={() => setShowDeleteSelectedConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-xl font-bold border border-rose-200 hover:bg-rose-100 transition-all shadow-xs text-xs animate-in fade-in duration-200 cursor-pointer"
                    title="Eliminar pólizas seleccionadas"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Borrar ({selectedInsuranceIds.length})
                  </button>
                )}

                {/* Editar Masivo */}
                {isSuperAdminOrDirector && selectedInsuranceIds.length > 0 && (
                  <button
                    onClick={() => setShowBulkEditModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-xl font-bold hover:bg-amber-100 transition-all shadow-xs text-xs animate-in fade-in duration-200 cursor-pointer"
                    title="Modificar masivamente pólizas seleccionadas"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar Masivo ({selectedInsuranceIds.length})
                  </button>
                )}
              </div>
            )}

            {/* Fila Inferior: Descargas, Filtros rápidos, Acciones Masivas y Vistas */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Descargar Pólizas */}
              <button
                onClick={handleDownloadInsurances}
                disabled={filteredInsurances.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold border border-emerald-200 hover:bg-emerald-100 transition-all shadow-xs text-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Descargar la lista de pólizas actual en formato CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar Pólizas
              </button>

              {/* No Exportadas */}
              {unexportedCount > 0 && (
                <button
                  onClick={handleFilterNonExported}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold border transition-all shadow-xs text-xs cursor-pointer ${
                    caremedExportedFilter === 'not_exported' && viewMode === 'list'
                      ? 'bg-blue-600 text-white border-blue-700 shadow-blue-200 ring-2 ring-blue-400/40'
                      : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  }`}
                  title="Filtrar y listar pólizas pendientes de exportación a CareMed en vista de filas"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  No Exportadas ({unexportedCount})
                </button>
              )}

              {/* Duplicados */}
              {isSuperAdminOrDirector && duplicateCount > 0 && (
                <button
                  onClick={() => setShowDuplicatesModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 text-amber-800 rounded-xl font-bold border border-amber-200 hover:bg-amber-100 transition-all shadow-xs text-xs cursor-pointer"
                  title="Identificar y gestionar pólizas duplicadas"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Duplicados ({duplicateCount})
                </button>
              )}

              {/* CareMed (Visible solo cuando la selección contiene únicamente pólizas NO exportadas) */}
              {canExportToCareMed && (
                <button
                  onClick={handleDownloadCareMedCSV}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold border border-indigo-700 transition-all shadow-md shadow-indigo-100 hover:shadow-indigo-200 text-xs animate-in fade-in duration-200 cursor-pointer active:scale-95"
                  title="Registrar y exportar pólizas seleccionadas para CareMed"
                >
                  <Download className="w-3.5 h-3.5" />
                  CareMed ({selectedInsuranceIds.length})
                </button>
              )}

              {/* Aviso si la selección contiene pólizas ya exportadas */}
              {selectedInsuranceIds.length > 0 && selectedExportedCount > 0 && (
                <div
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-semibold shadow-xs animate-in fade-in duration-200"
                  title={`La selección contiene ${selectedExportedCount} póliza(s) ya exportada(s). Por esta razón no se muestra el botón de CareMed.`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    {selectedExportedCount === selectedInsuranceIds.length
                      ? 'Pólizas ya exportadas (CareMed oculto)'
                      : `Hay ${selectedExportedCount} ${selectedExportedCount === 1 ? 'póliza ya exportada' : 'pólizas ya exportadas'} (CareMed oculto)`
                    }
                  </span>
                </div>
              )}

              {/* Descargar ZIP */}
              {selectedInsuranceIds.length > 0 && (
                <button
                  onClick={() => setShowBulkZipModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold border border-amber-700 transition-all shadow-md shadow-amber-100 hover:shadow-amber-200 text-xs animate-in fade-in duration-200 cursor-pointer active:scale-95"
                  title="Descargar cartas seleccionadas de los seguros en un archivo .ZIP"
                >
                  <FolderArchive className="w-3.5 h-3.5" />
                  Descargar ZIP ({selectedInsuranceIds.length})
                </button>
              )}

              {/* Envío Masivo */}
              {selectedInsuranceIds.length > 0 && (
                <button
                  onClick={handleBulkSendEmailsClick}
                  disabled={isBulkSending}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold border border-blue-700 transition-all shadow-md shadow-blue-100 hover:shadow-blue-200 text-xs animate-in fade-in duration-200 cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Enviar certificados por correo a todos los viajeros seleccionados"
                >
                  {isBulkSending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Envío Masivo ({selectedInsuranceIds.length})
                </button>
              )}

              {/* Switch Vista Tarjetas / Listado */}
              <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200 ml-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'cards' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400 hover:text-gray-600'}`}
                  title="Vista de Tarjetas"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-xs' : 'text-gray-400 hover:text-gray-600'}`}
                  title="Vista de Listado"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
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
                            <div className="text-gray-800 font-bold text-sm flex items-center gap-2">
                              <span>Pólizas Exportadas el {activeBatch.exportDate}</span>
                              <button
                                onClick={() => {
                                  setEditingExportDate(activeBatch.exportDate);
                                  setNewExportDateValue(activeBatch.exportDate.substring(0, 10));
                                }}
                                className="text-[10px] text-indigo-650 hover:text-indigo-800 underline font-bold bg-indigo-50 px-2 py-0.5 rounded cursor-pointer transition-all"
                                title="Editar la fecha de exportación de este lote"
                              >
                                Editar fecha
                              </button>
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
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-bold text-gray-900 text-xs">{i.firstName} {i.lastName}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDuplicatePolicy(i);
                                              }}
                                              className="p-0.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all cursor-pointer inline-flex items-center"
                                              title="Duplicar datos básicos a nueva póliza (Agente/Corporativo/Individual, Nombre, Apellido, Fecha de nacimiento)"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          </div>
                                          <span className="text-[10px] text-gray-400">Nacimiento: {formatDisplayDate(i.birthDate)} ({i.age} años)</span>
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
                                          <span className="text-[9px] font-sans text-gray-400">{formatDisplayDate(i.startDate)} al {formatDisplayDate(i.endDate)}</span>
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
          <div className="flex border-b border-gray-150 gap-6 mb-2">
            <button
              type="button"
              onClick={() => setInvoiceSubTab('cotejo')}
              className={`pb-3 text-sm font-bold transition-all relative ${
                invoiceSubTab === 'cotejo'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Cotejo Automático
              </span>
            </button>
            <button
              type="button"
              onClick={() => setInvoiceSubTab('list')}
              className={`pb-3 text-sm font-bold transition-all relative ${
                invoiceSubTab === 'list'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Listado de Invoices CareMed
              </span>
            </button>
            <button
              type="button"
              onClick={() => setInvoiceSubTab('detailed')}
              className={`pb-3 text-sm font-bold transition-all relative ${
                invoiceSubTab === 'detailed'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <span className="flex items-center gap-2">
                <List className="w-4 h-4" />
                Detalle de Pólizas e Invoices
              </span>
            </button>
          </div>

          {invoiceSubTab === 'cotejo' ? (
            <>
              {/* Summary stats & interactive filter cards row for Cotejo Automático */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* 1. Todos los Invoices */}
                <button
                  type="button"
                  onClick={() => setCotejoInvoiceStatusFilter('all')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    cotejoInvoiceStatusFilter === 'all'
                      ? 'bg-indigo-50/70 border-indigo-200 ring-2 ring-indigo-500/20 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Todos</span>
                    <span className="text-[10px] bg-gray-100 text-gray-700 font-black px-2 py-0.5 rounded-full">
                      {cotejoMetrics.total}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-gray-900 mt-2">
                    {cotejoMetrics.total}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1 font-sans">
                    Total Invoices registrados
                  </p>
                </button>

                {/* 2. Facturas Correctas */}
                <button
                  type="button"
                  onClick={() => setCotejoInvoiceStatusFilter('correct')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    cotejoInvoiceStatusFilter === 'correct'
                      ? 'bg-emerald-50/70 border-emerald-200 ring-2 ring-emerald-500/20 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Coincidentes</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-full">
                      {cotejoMetrics.correct}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-emerald-600 mt-2 flex items-center gap-1.5">
                    <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                    {cotejoMetrics.correct}
                  </p>
                  <p className="text-[10px] text-emerald-600/80 mt-1 font-sans">
                    Factura = Costo calculado
                  </p>
                </button>

                {/* 3. Con Diferencia */}
                <button
                  type="button"
                  onClick={() => setCotejoInvoiceStatusFilter('incorrect')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    cotejoInvoiceStatusFilter === 'incorrect'
                      ? 'bg-amber-50/70 border-amber-200 ring-2 ring-amber-500/20 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Con Diferencia</span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-full">
                      {cotejoMetrics.difference}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-amber-600 mt-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                    {cotejoMetrics.difference}
                  </p>
                  <p className="text-[10px] text-amber-600/80 mt-1 font-sans">
                    Discrepancia detectada
                  </p>
                </button>

                {/* 4. Sin Factura Adjunta */}
                <button
                  type="button"
                  onClick={() => setCotejoInvoiceStatusFilter('no_invoice')}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    cotejoInvoiceStatusFilter === 'no_invoice'
                      ? 'bg-purple-50/70 border-purple-200 ring-2 ring-purple-500/20 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Sin Factura</span>
                    <span className="text-[10px] bg-purple-100 text-purple-800 font-black px-2 py-0.5 rounded-full">
                      {cotejoMetrics.noInvoice}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-purple-600 mt-2 flex items-center gap-1.5">
                    <FileQuestion className="w-5 h-5 text-purple-500 shrink-0" />
                    {cotejoMetrics.noInvoice}
                  </p>
                  <p className="text-[10px] text-purple-500 mt-1 font-sans">
                    Falta adjuntar factura digital
                  </p>
                </button>
              </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: List of Invoices */}
            <div className="space-y-4 font-sans">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-800">Filtros de Invoices</h3>
                    {(invoicedSearchTerm || invoicedDateFilter || cotejoInvoiceStatusFilter !== 'all') && (
                      <button
                        onClick={() => {
                          setInvoicedSearchTerm('');
                          setInvoicedDateFilter('');
                          setCotejoInvoiceStatusFilter('all');
                        }}
                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                        title="Limpiar todos los filtros"
                      >
                        <X className="w-3 h-3" /> Limpiar
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-450">Busca por número de invoice, nombre del asegurado o estado.</p>
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

                  {/* Quick Filter Pill Buttons */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-440 uppercase tracking-wider block mb-1.5">Filtro Rápido</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCotejoInvoiceStatusFilter('all')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                          cotejoInvoiceStatusFilter === 'all'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                      >
                        Todos ({cotejoMetrics.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCotejoInvoiceStatusFilter('incorrect')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                          cotejoInvoiceStatusFilter === 'incorrect'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Con Diferencia ({cotejoMetrics.difference})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCotejoInvoiceStatusFilter('no_invoice')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                          cotejoInvoiceStatusFilter === 'no_invoice'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200'
                        }`}
                      >
                        <FileQuestion className="w-2.5 h-2.5" />
                        Sin Factura ({cotejoMetrics.noInvoice})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCotejoInvoiceStatusFilter('correct')}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                          cotejoInvoiceStatusFilter === 'correct'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        <CheckCircle className="w-2.5 h-2.5" />
                        Correctas ({cotejoMetrics.correct})
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-440 uppercase tracking-wider block mb-1">Filtrar por Estado / Diferencia</label>
                    <select
                      value={cotejoInvoiceStatusFilter}
                      onChange={(e) => setCotejoInvoiceStatusFilter(e.target.value as any)}
                      className="w-full px-3 py-1.5 bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800 font-semibold transition-all cursor-pointer"
                    >
                      <option value="all">Todos los Invoices</option>
                      <option value="pending">Solo Pendientes (Sin Factura o Con Diferencia)</option>
                      <option value="incorrect">Solo con Diferencia</option>
                      <option value="no_invoice">Solo Sin Factura Adjunta</option>
                      <option value="correct">Solo Facturas Correctas (Sin Diferencia)</option>
                      <option value="justified">Solo Diferencias Justificadas (OK)</option>
                    </select>
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
                    No hay invoices que coincidan con los filtros seleccionados.
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
                      const isJustified = !!dbInv?.differenceJustified || !!dbInv?.approved;

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
                                <span className="mt-1 flex items-center gap-1 text-[9px] text-emerald-800 bg-emerald-50 rounded px-1.5 py-0.5 border border-emerald-200 font-bold w-fit">
                                  ✓ Factura Correcta (${dbInv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                </span>
                              ) : isJustified ? (
                                <span
                                  className="mt-1 flex items-center gap-1 text-[9px] text-emerald-800 bg-emerald-50 rounded px-1.5 py-0.5 border border-emerald-200 font-bold w-fit"
                                  title={`Aprobado por Super Admin. Justificación: ${dbInv.justification || 'Sin justificación'}`}
                                >
                                  ✓ OK Justificado (${dbInv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                </span>
                              ) : (
                                <span className="mt-1 flex items-center gap-1 text-[9px] text-rose-800 bg-rose-50 rounded px-1.5 py-0.5 border border-rose-200 font-bold w-fit animate-pulse">
                                  ⚠️ Diferencia (${dbInv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} vs ${totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                                </span>
                              )
                            ) : (
                              <span className="mt-1 flex items-center gap-1 text-[9px] text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-200 font-medium w-fit">
                                Sin Factura Adjunta
                              </span>
                            )}
                            {hasDbInvoice && dbInv.invoiceDate && (
                              <span className="mt-1 flex items-center gap-1.5 text-[9px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 border border-gray-200 font-semibold w-fit">
                                <Calendar className="w-2.5 h-2.5 text-gray-400" /> F. Invoice: {dbInv.invoiceDate}
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
                          {isSuperAdminOrDirector && (
                            <button
                              onClick={() => handleDeleteEntireInvoice(activeInvoice.invoiceNumber)}
                              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1.5"
                              title="Eliminar este invoice completo y desvincular sus pólizas"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Eliminar Invoice</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Manual Invoice Entry Form */}
                      {showManualForm && (
                        <div className="p-4 bg-gray-50/50 border border-gray-200/80 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                          <h4 className="text-xs font-bold text-gray-700">Registrar Factura Manualmente</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                              <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Fecha Invoice</label>
                              <input
                                type="date"
                                value={manualInvoice.invoiceDate}
                                onChange={(e) => setManualInvoice(prev => ({ ...prev, invoiceDate: e.target.value }))}
                                className="w-full px-3 py-2 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800 font-medium"
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
                                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
                                          <label className="block text-[9px] uppercase font-bold text-gray-400 mb-1">Fecha Invoice</label>
                                          <input
                                            type="date"
                                            value={editInvoiceValues.invoiceDate}
                                            onChange={(e) => setEditInvoiceValues(prev => ({ ...prev, invoiceDate: e.target.value }))}
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
                                          {inv.invoiceDate && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-750 border border-gray-200 flex items-center gap-1">
                                              <Calendar className="w-3 h-3 text-gray-400" /> Fecha: {inv.invoiceDate}
                                            </span>
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
                                          className="p-1 px-2 text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-lg font-bold transition-all cursor-pointer"
                                        >
                                          Editar
                                        </button>
                                        {isSuperAdminOrDirector && (
                                          <button
                                            onClick={() => handleDeleteCaremedInvoice(inv.id)}
                                            className="p-1 px-2 text-[10px] text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg font-bold transition-all shadow-2xs cursor-pointer inline-flex items-center gap-1"
                                            title="Eliminar factura digital"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">Borrar</span>
                                          </button>
                                        )}
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
                                        <div className="flex items-center gap-1.5 text-emerald-700 text-[10.5px] font-extrabold bg-emerald-50 border border-emerald-255 px-3 py-1.5 rounded-lg w-full">
                                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                          <span>✅ COTEJO PERFECTO: El importe de la factura adjunta coincide al 100% con el costo a pagar calculado en el sistema.</span>
                                        </div>
                                      ) : inv.differenceJustified || inv.approved ? (
                                        <div className="flex flex-col gap-2 text-emerald-850 text-[10.5px] bg-emerald-50 border border-emerald-250 px-3 py-2.5 rounded-lg w-full font-semibold">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 font-extrabold text-emerald-800">
                                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                              <span>✅ DIFERENCIA APROBADA (OK) POR ADMINISTRACIÓN</span>
                                            </div>
                                            {isSuperAdminOrDirector && (
                                              <div className="flex items-center gap-2">
                                                <button
                                                  onClick={() => handleOpenJustifyModal({
                                                    dbInvoiceId: inv.id,
                                                    invoiceNumber: inv.invoiceNumber,
                                                    invoiceAmount: inv.amount,
                                                    totalCalculatedCost,
                                                    difference,
                                                    justification: inv.justification
                                                  })}
                                                  className="text-[10px] text-emerald-700 underline font-bold hover:text-emerald-900 cursor-pointer"
                                                >
                                                  Editar Justificación
                                                </button>
                                                <button
                                                  onClick={() => handleRevokeJustification(inv.id, inv.invoiceNumber)}
                                                  className="text-[10px] text-rose-600 underline font-bold hover:text-rose-800 cursor-pointer ml-1"
                                                >
                                                  Deshacer OK
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                          <div className="bg-white/80 p-2.5 rounded-lg border border-emerald-200 text-xs text-gray-700 font-normal space-y-1">
                                            <div className="flex items-center justify-between">
                                              <span className="font-bold text-gray-900 text-[10px] uppercase text-emerald-800">Justificación:</span>
                                              <span className="text-[10px] font-mono font-bold text-amber-850 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                                Dif: {difference > 0 ? '+' : ''}${difference.toFixed(2)} USD
                                              </span>
                                            </div>
                                            <p className="italic text-gray-800 font-medium">"{inv.justification || 'Aprobada sin comentarios adicionales'}"</p>
                                            {inv.approvedBy && (
                                              <span className="text-[9px] text-gray-400 block pt-0.5">Aprobado por {inv.approvedBy} {inv.approvedAt ? `el ${new Date(inv.approvedAt).toLocaleDateString()}` : ''}</span>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex flex-col gap-1 text-rose-700 text-[10.5px] bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg w-full font-semibold">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 font-extrabold text-rose-800">
                                              <AlertTriangle className="w-4 h-4 text-rose-600 animate-pulse shrink-0" />
                                              <span>⚠️ ALERTA DE DISCREPANCIA DETECTADA</span>
                                            </div>
                                            {isSuperAdminOrDirector && (
                                              <button
                                                onClick={() => handleOpenJustifyModal({
                                                  dbInvoiceId: inv.id,
                                                  invoiceNumber: inv.invoiceNumber,
                                                  invoiceAmount: inv.amount,
                                                  totalCalculatedCost,
                                                  difference,
                                                  justification: inv.justification || ''
                                                })}
                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5 hover:scale-105"
                                                title="Aprobar diferencia con justificación"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                <span>Aprobar (OK)</span>
                                              </button>
                                            )}
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
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-bold text-gray-900 text-xs">{i.firstName} {i.lastName}</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDuplicatePolicy(i);
                                            }}
                                            className="p-0.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-all cursor-pointer inline-flex items-center"
                                            title="Duplicar datos básicos a nueva póliza (Agente/Corporativo/Individual, Nombre, Apellido, Fecha de nacimiento)"
                                          >
                                            <Copy className="w-3 h-3" />
                                          </button>
                                        </div>
                                        <span className="text-[10px] text-gray-400">Nacimiento: {formatDisplayDate(i.birthDate)}</span>
                                        
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
                                      <span className="font-bold text-red-600">{formatPriceWithSign(i.totalCost || 0, i.actionType?.toUpperCase() === 'CAN')} USD</span>
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
          </>
          ) : invoiceSubTab === 'list' ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Indicadores de Negocio (Clickable Filter Cards) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                {/* 1. Número de Invoices */}
                <button
                  type="button"
                  onClick={() => setInvoiceListCorrectFilter('all')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceListCorrectFilter === 'all'
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/30'
                      : 'border-gray-100 hover:border-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-indigo-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Invoices</span>
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-gray-900">{invoiceListMetrics.numInvoices}</p>
                </button>

                {/* 2. Número de Pólizas */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-blue-200 transition-all">
                  <div className="flex items-center justify-between text-blue-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Número de Pólizas</span>
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-gray-900">{invoiceListMetrics.numPolicies}</p>
                </div>

                {/* 3. Cantidad (sistema) */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-emerald-200 transition-all">
                  <div className="flex items-center justify-between text-emerald-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Cantidad (Sistema)</span>
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-emerald-700">
                    ${invoiceListMetrics.totalSystem.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* 4. Cantidad (facturado) */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-purple-200 transition-all">
                  <div className="flex items-center justify-between text-purple-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Cantidad (Facturado)</span>
                    <Receipt className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-purple-800">
                    ${invoiceListMetrics.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* 5. Diferencia (Clickable filter) */}
                <button
                  type="button"
                  onClick={() => setInvoiceListCorrectFilter(prev => prev === 'incorrect' ? 'all' : 'incorrect')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceListCorrectFilter === 'incorrect'
                      ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/40'
                      : 'border-gray-100 hover:border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-amber-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Diferencia</span>
                    <Scale className="w-4 h-4" />
                  </div>
                  <p className={`text-xl font-black ${
                    Math.abs(invoiceListMetrics.totalDiff) < 0.05
                      ? 'text-gray-900'
                      : invoiceListMetrics.totalDiff > 0
                      ? 'text-amber-600'
                      : 'text-rose-600'
                  }`}>
                    {invoiceListMetrics.totalDiff > 0 ? '+' : ''}
                    ${invoiceListMetrics.totalDiff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </button>

                {/* 6. Invoices por Pagar */}
                <button
                  type="button"
                  onClick={() => setInvoiceListPaidFilter(prev => prev === 'not_paid' ? 'all' : 'not_paid')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceListPaidFilter === 'not_paid'
                      ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/40'
                      : 'border-gray-100 hover:border-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-rose-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Invoices por Pagar</span>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-rose-700">{invoiceListMetrics.unpaidCount}</p>
                </button>

                {/* 7. Cantidad por pagar */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-rose-200 transition-all">
                  <div className="flex items-center justify-between text-rose-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Cantidad por Pagar</span>
                    <Clock className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-rose-800">
                    ${invoiceListMetrics.unpaidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Contenedor de Filtros y Tabla */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Table Header Controls & Filter Bar */}
                <div className="p-5 border-b border-gray-100 bg-gray-50/40 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h3 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                        Listado de Invoices CareMed
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {invoiceListCorrectFilter === 'all' && 'Mostrando todos los invoices registrados en el sistema.'}
                        {invoiceListCorrectFilter === 'pending' && 'Mostrando únicamente facturas pendientes (sin factura digital o con diferencia no justificada).'}
                        {invoiceListCorrectFilter === 'incorrect' && 'Mostrando únicamente facturas con diferencia de importe.'}
                        {invoiceListCorrectFilter === 'no_invoice' && 'Mostrando únicamente pólizas e invoices sin factura adjunta.'}
                        {invoiceListCorrectFilter === 'correct' && 'Mostrando únicamente facturas 100% coincidentes con el sistema.'}
                        {invoiceListCorrectFilter === 'justified' && 'Mostrando facturas con diferencias justificadas y aprobadas.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setInvoicedSearchTerm('');
                          setInvoiceListDateRange({ start: '', end: '' });
                          setInvoiceListPaidFilter('all');
                          setInvoiceListCorrectFilter('all');
                          setInvoiceListSortField('exportDate');
                          setInvoiceListSortOrder('desc');
                        }}
                        className="text-xs font-bold text-gray-500 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Resetear Filtros
                      </button>
                    </div>
                  </div>

                  {/* Quick Pill Filter Buttons Bar */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200/60">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mr-1">Filtro Rápido:</span>
                    <button
                      type="button"
                      onClick={() => setInvoiceListCorrectFilter('all')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        invoiceListCorrectFilter === 'all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvoiceListCorrectFilter('incorrect')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        invoiceListCorrectFilter === 'incorrect'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Solo con Diferencia
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvoiceListCorrectFilter('no_invoice')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        invoiceListCorrectFilter === 'no_invoice'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-purple-50 border border-purple-200 text-purple-800 hover:bg-purple-100'
                      }`}
                    >
                      <FileQuestion className="w-3 h-3" />
                      Sin Factura Adjunta
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvoiceListCorrectFilter('correct')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        invoiceListCorrectFilter === 'correct'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                      }`}
                    >
                      <CheckCircle className="w-3 h-3" />
                      Facturas Coincidentes
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvoiceListCorrectFilter('justified')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        invoiceListCorrectFilter === 'justified'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100'
                      }`}
                    >
                      <CheckCircle className="w-3 h-3" />
                      Justificadas (OK)
                    </button>
                  </div>

                  {/* Filter and Sort controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-2 border-t border-gray-200/60">
                    {/* Search Input */}
                    <div className="lg:col-span-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Buscar Invoice</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="No. Invoice..."
                          value={invoicedSearchTerm}
                          onChange={(e) => setInvoicedSearchTerm(e.target.value)}
                          className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800"
                        />
                        {invoicedSearchTerm && (
                          <button
                            onClick={() => setInvoicedSearchTerm('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Rango de Fechas */}
                    <div className="lg:col-span-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Fecha Invoice (Desde - Hasta)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={invoiceListDateRange.start}
                          onChange={(e) => setInvoiceListDateRange(prev => ({ ...prev, start: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800"
                        />
                        <span className="text-gray-400 text-xs font-bold">-</span>
                        <input
                          type="date"
                          value={invoiceListDateRange.end}
                          onChange={(e) => setInvoiceListDateRange(prev => ({ ...prev, end: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800"
                        />
                      </div>
                    </div>

                    {/* Pagada a Caremed */}
                    <div className="lg:col-span-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Pagada a CareMed</label>
                      <select
                        value={invoiceListPaidFilter}
                        onChange={(e) => setInvoiceListPaidFilter(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800 font-semibold"
                      >
                        <option value="all">Todas</option>
                        <option value="paid">Sí (Pagadas)</option>
                        <option value="not_paid">No (Sin Pagar)</option>
                        <option value="partial">Parcial</option>
                      </select>
                    </div>

                    {/* Factura Correcta / Discrepancia Filter */}
                    <div className="lg:col-span-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Filtro de Factura</label>
                      <select
                        value={invoiceListCorrectFilter}
                        onChange={(e) => setInvoiceListCorrectFilter(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800 font-semibold"
                      >
                        <option value="all">Todos los Invoices</option>
                        <option value="pending">Solo Pendientes (Acción requerida)</option>
                        <option value="incorrect">Solo con Diferencia</option>
                        <option value="no_invoice">Solo Sin Factura Adjunta</option>
                        <option value="correct">Solo Facturas Correctas</option>
                        <option value="justified">Solo Justificadas (OK)</option>
                      </select>
                    </div>

                    {/* Ordenar Por */}
                    <div className="lg:col-span-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Ordenar Por</label>
                      <div className="flex items-center gap-1">
                        <select
                          value={invoiceListSortField}
                          onChange={(e) => setInvoiceListSortField(e.target.value as any)}
                          className="w-full px-2 py-1.5 bg-white border border-gray-200 focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none text-xs text-gray-800 font-semibold"
                        >
                          <option value="exportDate">Fecha Exportación</option>
                          <option value="invoiceDate">Fecha Invoice</option>
                          <option value="invoiceNumber">Número Invoice</option>
                          <option value="policyCount">No. Pólizas</option>
                          <option value="totalCalculatedCost">Monto Sistema</option>
                          <option value="difference">Diferencia</option>
                        </select>
                        <button
                          onClick={() => setInvoiceListSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                          title={`Orden: ${invoiceListSortOrder === 'asc' ? 'Ascendente' : 'Descendente'}`}
                          className="p-1.5 bg-white border border-gray-200 hover:bg-gray-100 rounded-xl text-gray-600 transition-colors"
                        >
                          {invoiceListSortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500 tracking-wider border-b border-gray-150 select-none">
                        {/* Header: Fecha de Exportación */}
                        <th
                          onClick={() => {
                            if (invoiceListSortField === 'exportDate') {
                              setInvoiceListSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setInvoiceListSortField('exportDate');
                              setInvoiceListSortOrder('desc');
                            }
                          }}
                          className="px-6 py-4 cursor-pointer hover:bg-gray-100/60 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Fecha de Exportación</span>
                            {invoiceListSortField === 'exportDate' ? (
                              invoiceListSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-gray-300" />
                            )}
                          </div>
                        </th>

                        {/* Header: Fecha Invoice */}
                        <th
                          onClick={() => {
                            if (invoiceListSortField === 'invoiceDate') {
                              setInvoiceListSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setInvoiceListSortField('invoiceDate');
                              setInvoiceListSortOrder('desc');
                            }
                          }}
                          className="px-6 py-4 cursor-pointer hover:bg-gray-100/60 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Fecha Invoice</span>
                            {invoiceListSortField === 'invoiceDate' ? (
                              invoiceListSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-gray-300" />
                            )}
                          </div>
                        </th>

                        {/* Header: Número de Invoice */}
                        <th
                          onClick={() => {
                            if (invoiceListSortField === 'invoiceNumber') {
                              setInvoiceListSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setInvoiceListSortField('invoiceNumber');
                              setInvoiceListSortOrder('asc');
                            }
                          }}
                          className="px-6 py-4 cursor-pointer hover:bg-gray-100/60 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Número de Invoice</span>
                            {invoiceListSortField === 'invoiceNumber' ? (
                              invoiceListSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-gray-300" />
                            )}
                          </div>
                        </th>

                        {/* Header: Número de Pólizas */}
                        <th
                          onClick={() => {
                            if (invoiceListSortField === 'policyCount') {
                              setInvoiceListSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setInvoiceListSortField('policyCount');
                              setInvoiceListSortOrder('desc');
                            }
                          }}
                          className="px-6 py-4 text-center cursor-pointer hover:bg-gray-100/60 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>Número de Pólizas</span>
                            {invoiceListSortField === 'policyCount' ? (
                              invoiceListSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-gray-300" />
                            )}
                          </div>
                        </th>

                        <th className="px-6 py-4 text-right">Cantidad (Sistema)</th>
                        <th className="px-6 py-4 text-right">Cantidad (Facturado)</th>
                        <th className="px-6 py-4 text-center">Factura Correcta</th>
                        <th className="px-6 py-4 text-center">Diferencia</th>
                        <th className="px-6 py-4 text-center">Pagada a CareMed</th>
                        <th className="px-6 py-4 text-center">Fecha de Pago</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredAndSortedInvoiceList.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-6 py-12 text-center text-gray-400 font-medium">
                            No se encontraron invoices con los criterios o filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        filteredAndSortedInvoiceList.map((item) => {
                          const diffAbs = Math.abs(item.difference);
                          return (
                            <tr key={item.id} className="hover:bg-gray-50/40 transition-colors font-medium text-gray-700">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="flex items-center gap-1.5 font-bold text-gray-900">
                                  <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                  {item.exportDate}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="flex items-center gap-1.5">
                                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                  {item.invoiceDate}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-mono font-bold text-gray-900 text-sm">
                                <button
                                  onClick={() => {
                                    setSelectedInvoiceNumber(item.invoiceNumber);
                                    setInvoiceSubTab('cotejo');
                                  }}
                                  className="hover:text-indigo-600 hover:underline flex items-center gap-1.5 text-indigo-700 font-black transition-colors text-left group"
                                  title="Ver / Editar este invoice"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-indigo-500 group-hover:scale-110 transition-transform" />
                                  {item.invoiceNumber}
                                </button>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="inline-block px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-full">
                                  {item.policyCount}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-gray-900">
                                ${item.totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-gray-900">
                                {item.hasAttachedInvoice ? (
                                  `$${item.invoiceAmount?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                ) : (
                                  <span className="text-gray-400 italic">No adjuntada</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center whitespace-nowrap">
                                {!item.hasAttachedInvoice ? (
                                  <button
                                    onClick={() => {
                                      setSelectedInvoiceNumber(item.invoiceNumber);
                                      setInvoiceSubTab('cotejo');
                                    }}
                                    className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors inline-flex items-center gap-1"
                                    title="Click para adjuntar o ingresar datos de factura"
                                  >
                                    <Plus className="w-2.5 h-2.5" /> Sin Factura
                                  </button>
                                ) : item.isCorrect === 'Sí' ? (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100">
                                    Sí
                                  </span>
                                ) : item.isJustified ? (
                                  <span
                                    className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1 cursor-help"
                                    title={`Aprobado por Super Admin. Justificación: ${item.justification || 'Sin justificación'}`}
                                  >
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> OK Justificado
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-100">
                                    No
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center font-bold font-mono">
                                {!item.hasAttachedInvoice ? (
                                  <span className="text-gray-400">-</span>
                                ) : diffAbs < 0.05 ? (
                                  <span className="text-emerald-600">$0.00</span>
                                ) : (
                                  <span
                                    className={item.difference > 0 ? 'text-amber-600' : 'text-rose-600'}
                                    title={item.isJustified ? `Justificado: ${item.justification}` : undefined}
                                  >
                                    {item.difference > 0 ? '+' : ''}${item.difference.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {item.isPaid === 'Sí' ? (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100">
                                    Sí
                                  </span>
                                ) : item.isPaid === 'Parcial' ? (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-100">
                                    Parcial
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-100">
                                    No
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {item.isPaid === 'Sí' || item.isPaid === 'Parcial' ? (
                                  <span className="font-semibold text-gray-800">{item.paymentDate}</span>
                                ) : (
                                  <span className="text-gray-400 italic">-</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5 justify-center">
                                  {isSuperAdminOrDirector && item.hasAttachedInvoice && item.isCorrect === 'No' && !item.isJustified && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenJustifyModal(item);
                                      }}
                                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-xs cursor-pointer inline-flex items-center gap-1.5 hover:scale-105"
                                      title="Aprobar diferencia con justificación (Super Administrador) para retirar del listado de pendientes"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>OK</span>
                                    </button>
                                  )}

                                  {isSuperAdminOrDirector && item.hasAttachedInvoice && item.isJustified && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenJustifyModal(item);
                                      }}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer inline-flex items-center gap-1"
                                      title={`Justificación: "${item.justification}". Clic para ver o editar`}
                                    >
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Ver OK</span>
                                    </button>
                                  )}

                                  <button
                                    onClick={() => {
                                      setSelectedInvoiceNumber(item.invoiceNumber);
                                      setInvoiceSubTab('cotejo');
                                    }}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all inline-flex items-center justify-center gap-1.5 shadow-xs ${
                                      !item.hasAttachedInvoice
                                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                        : 'bg-gray-100 hover:bg-indigo-50 hover:text-indigo-700 text-gray-700 border border-gray-200'
                                    }`}
                                  >
                                    {!item.hasAttachedInvoice ? (
                                      <>
                                        <Plus className="w-3.5 h-3.5" />
                                        <span>Adjuntar Factura</span>
                                      </>
                                    ) : (
                                      <>
                                        <Edit2 className="w-3.5 h-3.5 text-indigo-500" />
                                        <span>Ver / Editar</span>
                                      </>
                                    )}
                                  </button>

                                  {isSuperAdminOrDirector && (
                                    <>
                                      {item.hasAttachedInvoice && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const attachedInvs = caremedInvoices.filter(i => (i.invoiceNumber || '').toLowerCase().trim() === item.invoiceNumber.toLowerCase().trim());
                                            if (attachedInvs.length > 0) {
                                              handleDeleteCaremedInvoice(attachedInvs[0].id);
                                            }
                                          }}
                                          className="p-1.5 px-2 text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer inline-flex items-center gap-1"
                                          title="Borrar comprobante digital adjunto de esta factura"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                          <span className="hidden sm:inline">Quitar Doc</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteEntireInvoice(item.invoiceNumber);
                                        }}
                                        className="p-1.5 px-2 text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer inline-flex items-center gap-1"
                                        title="Eliminar invoice completo y desvincular pólizas"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">Borrar Invoice</span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* 1. Dynamic Business Indicators (Clickable Filter Cards) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {/* Total Pólizas */}
                <button
                  type="button"
                  onClick={() => setInvoiceDetailCorrectFilter('all')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceDetailCorrectFilter === 'all'
                      ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/30'
                      : 'border-gray-100 hover:border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-blue-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Pólizas</span>
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-gray-900">{detailedMetrics.totalPolicies}</p>
                </button>

                {/* Invoices Únicos */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-indigo-200 transition-all">
                  <div className="flex items-center justify-between text-indigo-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Invoices Únicos</span>
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-gray-900">{detailedMetrics.uniqueInvoices}</p>
                </div>

                {/* Cantidad Total (USD) */}
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between hover:border-emerald-200 transition-all">
                  <div className="flex items-center justify-between text-emerald-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Cantidad Total (USD)</span>
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-emerald-700">
                    ${detailedMetrics.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {/* Facturas Correctas */}
                <button
                  type="button"
                  onClick={() => setInvoiceDetailCorrectFilter(prev => prev === 'correct' ? 'all' : 'correct')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceDetailCorrectFilter === 'correct'
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/40'
                      : 'border-gray-100 hover:border-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-emerald-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Factura Correcta</span>
                    <CheckCircle className="w-4 h-4" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-xl font-black text-emerald-700">{detailedMetrics.correctCount}</p>
                    <span className="text-xs font-bold text-emerald-600">({detailedMetrics.correctPercent}%)</span>
                  </div>
                </button>

                {/* Con Diferencia */}
                <button
                  type="button"
                  onClick={() => setInvoiceDetailCorrectFilter(prev => prev === 'discrepancy' ? 'all' : 'discrepancy')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceDetailCorrectFilter === 'discrepancy'
                      ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/40'
                      : 'border-gray-100 hover:border-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-rose-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Con Diferencia</span>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-rose-700">{detailedMetrics.discrepancyCount}</p>
                </button>

                {/* Sin Factura Adjunta */}
                <button
                  type="button"
                  onClick={() => setInvoiceDetailCorrectFilter(prev => prev === 'no_invoice' ? 'all' : 'no_invoice')}
                  className={`bg-white rounded-2xl p-4 border text-left shadow-sm flex flex-col justify-between transition-all ${
                    invoiceDetailCorrectFilter === 'no_invoice'
                      ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-50/40'
                      : 'border-gray-100 hover:border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-amber-600 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Sin Factura Adjunta</span>
                    <Clock className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-black text-amber-700">{detailedMetrics.noInvoiceCount}</p>
                </button>
              </div>

              {/* 2. Main Container with Filter Toolbar & Detailed Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Header and Action Controls */}
                <div className="p-5 border-b border-gray-100 bg-gray-50/40 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h3 className="font-black text-base text-gray-900 flex items-center gap-2">
                        <List className="w-5 h-5 text-indigo-600" />
                        Detalle de Pólizas por Invoice CareMed
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Reporte y listado concentrado de pólizas e invoices con fechas, códigos de póliza, recuento e importes.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* View Mode Toggle: Concentrado vs Detallado */}
                      <div className="inline-flex bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-bold mr-2">
                        <button
                          type="button"
                          onClick={() => setInvoiceDetailViewMode('concentrated')}
                          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                            invoiceDetailViewMode === 'concentrated'
                              ? 'bg-white text-indigo-700 shadow-2xs'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Concentrado ({concentratedPoliciesData.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvoiceDetailViewMode('detailed')}
                          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                            invoiceDetailViewMode === 'detailed'
                              ? 'bg-white text-indigo-700 shadow-2xs'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          <List className="w-3.5 h-3.5" />
                          <span>Detallado ({detailedInvoicedPolicies.length})</span>
                        </button>
                      </div>

                      <button
                        onClick={handleExportInvoiceDetailPDF}
                        disabled={concentratedPoliciesData.length === 0}
                        className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                        title="Exportar reporte concentrado en PDF (5 columnas)"
                      >
                        <FileText className="w-4 h-4" />
                        <span>Exportar Reporte PDF</span>
                      </button>

                      <button
                        onClick={handleExportInvoiceDetailCSV}
                        disabled={concentratedPoliciesData.length === 0}
                        className="px-3.5 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
                        title="Exportar datos concentrados en CSV (5 columnas)"
                      >
                        <Download className="w-4 h-4 text-emerald-600" />
                        <span>Exportar CSV</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Toolbar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
                    {/* Búsqueda */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Buscar Invoice, Póliza, Asegurado..."
                        value={invoiceDetailSearchTerm}
                        onChange={(e) => setInvoiceDetailSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      />
                      {invoiceDetailSearchTerm && (
                        <button
                          onClick={() => setInvoiceDetailSearchTerm('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Filtro por Fecha Invoice (Desde - Hasta) */}
                    <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-2 py-1">
                      <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-1" />
                      <input
                        type="date"
                        value={invoiceDetailDateRange.start}
                        onChange={(e) => setInvoiceDetailDateRange(prev => ({ ...prev, start: e.target.value }))}
                        className="w-full text-[11px] bg-transparent outline-none text-gray-700"
                        title="Fecha Invoice Desde"
                      />
                      <span className="text-gray-300 text-xs">-</span>
                      <input
                        type="date"
                        value={invoiceDetailDateRange.end}
                        onChange={(e) => setInvoiceDetailDateRange(prev => ({ ...prev, end: e.target.value }))}
                        className="w-full text-[11px] bg-transparent outline-none text-gray-700"
                        title="Fecha Invoice Hasta"
                      />
                      {(invoiceDetailDateRange.start || invoiceDetailDateRange.end) && (
                        <button
                          onClick={() => setInvoiceDetailDateRange({ start: '', end: '' })}
                          className="text-gray-400 hover:text-gray-600 p-0.5"
                          title="Limpiar fechas"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Filtro por Agente / Corporativo */}
                    <div>
                      <select
                        value={invoiceDetailAgentFilter}
                        onChange={(e) => setInvoiceDetailAgentFilter(e.target.value)}
                        className="w-full py-2 px-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer"
                      >
                        <option value="all">Todos los Agentes y Corporativos</option>
                        <option value="agents">Solo Agentes / Subagentes</option>
                        <option value="corporates">Solo Corporativos</option>
                        <option value="individuals">Solo Individuales</option>
                        {clients && clients.length > 0 && (
                          <optgroup label="Agentes y Empresas Específicos">
                            {[...clients]
                              .sort((a, b) => (a.name || a.company || '').localeCompare(b.name || b.company || ''))
                              .map(cl => (
                                <option key={cl.id} value={cl.id}>
                                  {cl.name || cl.company || 'Sin nombre'} ({cl.type || 'Cliente'})
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {/* Filtro por Factura Correcta */}
                    <div>
                      <select
                        value={invoiceDetailCorrectFilter}
                        onChange={(e) => setInvoiceDetailCorrectFilter(e.target.value as any)}
                        className="w-full py-2 px-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer"
                      >
                        <option value="all">Factura Correcta: Todos</option>
                        <option value="correct">✓ Factura Correcta</option>
                        <option value="discrepancy">⚠️ Con Diferencia</option>
                        <option value="no_invoice">Sin Factura Adjunta</option>
                      </select>
                    </div>

                    {/* Selector de Ordenamiento y Reset */}
                    <div className="flex items-center gap-2">
                      <select
                        value={`${invoiceDetailSortField}_${invoiceDetailSortOrder}`}
                        onChange={(e) => {
                          const [field, order] = e.target.value.split('_') as [any, 'asc' | 'desc'];
                          setInvoiceDetailSortField(field);
                          setInvoiceDetailSortOrder(order);
                        }}
                        className="w-full py-2 px-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all cursor-pointer"
                      >
                        <option value="invoiceDate_desc">Fecha Invoice (Más reciente)</option>
                        <option value="invoiceDate_asc">Fecha Invoice (Más antigua)</option>
                        <option value="invoiceNumber_asc">Nº Invoice (A - Z)</option>
                        <option value="invoiceNumber_desc">Nº Invoice (Z - A)</option>
                        <option value="amount_desc">Cantidad (Mayor a menor)</option>
                        <option value="amount_asc">Cantidad (Menor a mayor)</option>
                        <option value="policyNumber_asc">Código Póliza (A - Z)</option>
                      </select>

                      {(invoiceDetailSearchTerm || invoiceDetailDateRange.start || invoiceDetailDateRange.end || invoiceDetailAgentFilter !== 'all' || invoiceDetailCorrectFilter !== 'all') && (
                        <button
                          onClick={() => {
                            setInvoiceDetailSearchTerm('');
                            setInvoiceDetailDateRange({ start: '', end: '' });
                            setInvoiceDetailAgentFilter('all');
                            setInvoiceDetailCorrectFilter('all');
                          }}
                          className="px-2.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-xs font-bold transition-all shrink-0"
                          title="Limpiar todos los filtros"
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Table View: Concentrated or Detailed */}
                <div className="overflow-x-auto">
                  {invoiceDetailViewMode === 'concentrated' ? (
                    /* CONCENTRATED TABLE VIEW */
                    <table className="w-full text-left text-[10px] border-collapse">
                      <thead>
                        <tr className="border-b border-gray-150 bg-gray-50/70 text-gray-500 font-extrabold text-[9px] uppercase tracking-wider select-none">
                          {/* 1. Numero Invoice */}
                          <th
                            onClick={() => toggleDetailSort('invoiceNumber')}
                            className="px-3 py-2 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1">
                              <span>Numero Invoice</span>
                              {invoiceDetailSortField === 'invoiceNumber' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-2.5 h-2.5 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 2. Fecha */}
                          <th
                            onClick={() => toggleDetailSort('invoiceDate')}
                            className="px-3 py-2 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1">
                              <span>Fecha</span>
                              {invoiceDetailSortField === 'invoiceDate' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-2.5 h-2.5 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 3. Codigo Poliza */}
                          <th
                            onClick={() => toggleDetailSort('policyNumber')}
                            className="px-3 py-2 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1">
                              <span>Codigo Poliza</span>
                              {invoiceDetailSortField === 'policyNumber' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-2.5 h-2.5 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 4. Numero de Polizas */}
                          <th className="px-3 py-2 text-center">
                            <span>Numero de Polizas</span>
                          </th>

                          {/* 5. Cantidad */}
                          <th
                            onClick={() => toggleDetailSort('amount')}
                            className="px-3 py-2 text-right cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>Cantidad</span>
                              {invoiceDetailSortField === 'amount' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-2.5 h-2.5 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 6. Desglose */}
                          <th className="px-3 py-2 text-center">
                            <span>Desglose</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {concentratedPoliciesData.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                              <div className="flex flex-col items-center justify-center gap-1.5">
                                <FileSpreadsheet className="w-6 h-6 text-gray-300" />
                                <p className="font-bold text-gray-600 text-xs">No se encontraron registros con los filtros seleccionados.</p>
                                <p className="text-[10px] text-gray-400">Intenta ajustar o limpiar los filtros de búsqueda y fechas.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          concentratedPoliciesData.map((group) => {
                            const isExpanded = expandedGroupKeys.includes(group.key);

                            return (
                              <React.Fragment key={group.key}>
                                <tr className={`transition-colors ${group.hasDifference ? 'bg-amber-50/20 hover:bg-amber-50/40' : 'hover:bg-indigo-50/30'}`}>
                                  {/* 1. Numero Invoice */}
                                  <td className="px-3 py-1.5 font-mono font-bold text-gray-900 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <button
                                        onClick={() => {
                                          setSelectedInvoiceNumber(group.invoiceNumber);
                                          setInvoiceSubTab('cotejo');
                                        }}
                                        className="font-mono font-black text-[10px] text-indigo-700 hover:text-indigo-900 hover:underline inline-flex items-center gap-1 group"
                                        title="Ir a Cotejo Automático de este Invoice"
                                      >
                                        <Receipt className="w-3 h-3 text-indigo-500 group-hover:scale-110 transition-transform" />
                                        <span>{group.invoiceNumber}</span>
                                      </button>

                                      {group.isJustified ? (
                                        <span
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[8.5px] font-black bg-blue-100 text-blue-900 border border-blue-300 shadow-2xs cursor-help"
                                          title={`Diferencia aprobada por Super Admin:\n"${group.justification}" (Facturado: $${(group.invoiceAmount || 0).toFixed(2)} USD vs Sistema Total: $${group.invoiceSystemTotal.toFixed(2)} USD)`}
                                        >
                                          <CheckCircle className="w-2.5 h-2.5 text-blue-700 shrink-0" />
                                          <span>✓ OK Justificado</span>
                                        </span>
                                      ) : group.hasDifference ? (
                                        <span
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[8.5px] font-black bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                                          title={`Invoice con discrepancia: Facturado $${(group.invoiceAmount || 0).toFixed(2)} USD vs Sistema Total $${group.invoiceSystemTotal.toFixed(2)} USD (Diferencia de ${group.invoiceDifference > 0 ? '+' : ''}$${group.invoiceDifference.toFixed(2)} USD)`}
                                        >
                                          <AlertTriangle className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                          <span>Dif: {group.invoiceDifference > 0 ? '+' : ''}${group.invoiceDifference.toFixed(2)}</span>
                                        </span>
                                      ) : !group.hasAttachedInvoice ? (
                                        <span
                                          className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[8px] font-semibold bg-gray-100 text-gray-500 border border-gray-200"
                                          title="Invoice sin factura adjunta en el sistema"
                                        >
                                          Sin Factura
                                        </span>
                                      ) : (
                                        <span
                                          className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[8.5px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
                                          title={`Factura correcta: $${(group.invoiceAmount || 0).toFixed(2)} USD coincide con el sistema`}
                                        >
                                          <CheckCircle className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                          <span>✓ Coincide</span>
                                        </span>
                                      )}
                                    </div>
                                    {Math.abs(group.invoiceSystemTotal - group.amount) > 0.01 && (
                                      <div className="text-[8.5px] font-normal text-gray-400 mt-0.5" title={`Total del Invoice completo (todos los códigos): $${group.invoiceSystemTotal.toFixed(2)} USD`}>
                                        Total Invoice: <span className="font-semibold text-gray-600">${group.invoiceSystemTotal.toFixed(2)} USD</span>
                                      </div>
                                    )}
                                  </td>

                                  {/* 2. Fecha */}
                                  <td className="px-3 py-1.5 whitespace-nowrap">
                                    <div className="flex items-center gap-1 text-gray-700 font-medium text-[10px]">
                                      <Calendar className="w-3 h-3 text-gray-400 shrink-0" />
                                      <span>{group.invoiceDate ? formatDisplayDate(group.invoiceDate) : '-'}</span>
                                    </div>
                                  </td>

                                  {/* 3. Codigo Poliza */}
                                  <td className="px-3 py-1.5">
                                    <span className="font-mono font-bold text-[10px] text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                      {group.policyCode}
                                    </span>
                                  </td>

                                  {/* 4. Numero de Polizas */}
                                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                      <Users className="w-2.5 h-2.5" />
                                      <span>{group.policyCount} {group.policyCount === 1 ? 'póliza' : 'pólizas'}</span>
                                    </span>
                                  </td>

                                  {/* 5. Cantidad */}
                                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                    <div className="flex items-baseline justify-end gap-1">
                                      <span className="font-mono font-black text-[11px] text-emerald-700">
                                        ${group.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                      <span className="text-[9px] text-gray-400 font-medium">USD</span>
                                    </div>
                                  </td>

                                  {/* 6. Desglose / Expandir */}
                                  <td className="px-3 py-1.5 text-center whitespace-nowrap">
                                    <button
                                      onClick={() => toggleGroupExpand(group.key)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all inline-flex items-center gap-1 ${
                                        isExpanded
                                          ? 'bg-indigo-600 text-white border-indigo-600'
                                          : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-200'
                                      }`}
                                      title={isExpanded ? 'Ocultar desglose' : 'Ver desglose de asegurados'}
                                    >
                                      <span>{isExpanded ? 'Ocultar' : 'Ver Pólizas'}</span>
                                      {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                                    </button>
                                  </td>
                                </tr>

                                {/* Expanded Inner Rows */}
                                {isExpanded && (
                                  <tr className="bg-indigo-50/20 border-y border-indigo-100">
                                    <td colSpan={6} className="px-4 py-2">
                                      <div className="bg-white rounded-lg border border-indigo-100 shadow-2xs p-2.5 space-y-1.5">
                                        <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
                                          <span className="text-[9px] font-black text-gray-700 uppercase tracking-wide">
                                            Pólizas individuales en Invoice {group.invoiceNumber} - Código {group.policyCode} ({group.policies.length})
                                          </span>
                                        </div>
                                        <div className="divide-y divide-gray-100 text-[10px]">
                                          {group.policies.map((pItem) => {
                                            const pIns = pItem.insurance;
                                            const isPcan = pIns.actionType?.toUpperCase() === 'CAN';
                                            return (
                                              <div key={pItem.id} className="py-1 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-mono font-bold text-gray-800">{pItem.policyNumber}</span>
                                                  {isPcan && (
                                                    <span className="px-1 py-0.2 rounded text-[8px] font-black bg-rose-100 text-rose-700">CAN</span>
                                                  )}
                                                  <span className="font-semibold text-gray-900">{pItem.insuredFullName}</span>
                                                  <span className="text-gray-400 text-[9px]">• {pItem.clientName}</span>
                                                  {pIns.IDseg && pIns.IDseg !== pItem.policyNumber && (
                                                    <span className="text-indigo-600 font-mono text-[9px]">ID Seg: {pIns.IDseg}</span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className={`font-mono font-bold ${isPcan ? 'text-rose-600' : 'text-emerald-700'}`}>
                                                    ${Math.abs(pItem.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                                                  </span>
                                                  <button
                                                    onClick={() => setSelectedInsuranceForDetail(pIns)}
                                                    className="p-0.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                                    title="Ver póliza"
                                                  >
                                                    <Eye className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    /* DETAILED TABLE VIEW */
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-gray-150 bg-gray-50/70 text-gray-500 font-extrabold select-none">
                          {/* 1. Numero Invoice */}
                          <th
                            onClick={() => toggleDetailSort('invoiceNumber')}
                            className="px-5 py-3.5 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Numero Invoice</span>
                              {invoiceDetailSortField === 'invoiceNumber' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 2. Fecha Invoice */}
                          <th
                            onClick={() => toggleDetailSort('invoiceDate')}
                            className="px-5 py-3.5 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Fecha Invoice</span>
                              {invoiceDetailSortField === 'invoiceDate' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 3. Policy Number */}
                          <th
                            onClick={() => toggleDetailSort('policyNumber')}
                            className="px-5 py-3.5 cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              <span>Policy Number</span>
                              {invoiceDetailSortField === 'policyNumber' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 4. Cantidad */}
                          <th
                            onClick={() => toggleDetailSort('amount')}
                            className="px-5 py-3.5 text-right cursor-pointer hover:bg-gray-100/70 transition-colors"
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              <span>Cantidad</span>
                              {invoiceDetailSortField === 'amount' ? (
                                invoiceDetailSortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-gray-300" />
                              )}
                            </div>
                          </th>

                          {/* 5. Factura Correcta */}
                          <th className="px-5 py-3.5 text-center">
                            <span>Factura Correcta</span>
                          </th>

                          {/* 6. Acciones */}
                          <th className="px-5 py-3.5 text-center">
                            <span>Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detailedInvoicedPolicies.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                              <div className="flex flex-col items-center justify-center gap-2">
                                <FileSpreadsheet className="w-8 h-8 text-gray-300" />
                                <p className="font-bold text-gray-600 text-sm">No se encontraron pólizas con los filtros seleccionados.</p>
                                <p className="text-xs text-gray-400">Intenta ajustar o limpiar los filtros de búsqueda y fechas.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          detailedInvoicedPolicies.map((item) => {
                            const ins = item.insurance;
                            const isCan = ins.actionType?.toUpperCase() === 'CAN';

                            return (
                              <tr key={item.id} className="hover:bg-indigo-50/30 transition-colors">
                                {/* 1. Numero Invoice */}
                                <td className="px-5 py-3.5 font-mono font-bold text-gray-900 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => {
                                        setSelectedInvoiceNumber(item.invoiceNumber);
                                        setInvoiceSubTab('cotejo');
                                      }}
                                      className="font-mono font-black text-indigo-700 hover:text-indigo-900 hover:underline inline-flex items-center gap-1.5 group"
                                      title="Ir a Cotejo Automático de este Invoice"
                                    >
                                      <Receipt className="w-3.5 h-3.5 text-indigo-500 group-hover:scale-110 transition-transform" />
                                      <span>{item.invoiceNumber}</span>
                                    </button>
                                  </div>
                                </td>

                                {/* 2. Fecha Invoice */}
                                <td className="px-5 py-3.5 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5 text-gray-700 font-medium">
                                    <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    <span>{item.invoiceDate ? formatDisplayDate(item.invoiceDate) : '-'}</span>
                                  </div>
                                </td>

                                {/* 3. Policy Number */}
                                <td className="px-5 py-3.5">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono font-bold text-gray-900">{item.policyNumber}</span>
                                      {isCan && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-rose-100 text-rose-700 border border-rose-200">
                                          CAN
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs font-semibold text-gray-800">
                                      {item.insuredFullName || 'Sin nombre'}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                      <span>{item.clientName}</span>
                                      {ins.IDseg && ins.IDseg !== item.policyNumber && (
                                        <span className="text-indigo-600 font-mono font-medium">ID Seg: {ins.IDseg}</span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                {/* 4. Cantidad */}
                                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                  <div className="flex flex-col items-end">
                                    <span className={`font-mono font-extrabold text-sm ${isCan ? 'text-rose-600' : 'text-emerald-700'}`}>
                                      {item.amount < 0 ? '-' : ''}${Math.abs(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-medium">USD</span>
                                  </div>
                                </td>

                                {/* 5. Factura Correcta */}
                                <td className="px-5 py-3.5 text-center whitespace-nowrap">
                                  {item.isJustified ? (
                                    <div className="inline-flex flex-col items-center">
                                      <span
                                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-900 border border-blue-300 shadow-2xs cursor-help"
                                        title={`Diferencia justificada y aprobada por Super Admin:\n"${item.justification}"\n(Factura: $${item.dbInvoiceAmount.toFixed(2)} vs Total Sistema: $${item.totalInvoiceCost.toFixed(2)})`}
                                      >
                                        <CheckCircle className="w-3 h-3 text-blue-700" />
                                        <span>✓ OK Justificado</span>
                                      </span>
                                      <span className="text-[9px] font-mono font-bold text-blue-700 mt-0.5">
                                        {item.difference > 0 ? '+' : ''}${item.difference.toFixed(2)} USD
                                      </span>
                                    </div>
                                  ) : item.correctnessStatus === 'correct' ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                                      <span>✓ Correcta</span>
                                    </span>
                                  ) : item.correctnessStatus === 'discrepancy' ? (
                                    <div className="inline-flex flex-col items-center">
                                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                                        <span>⚠️ Diferencia</span>
                                      </span>
                                      <span className="text-[9px] font-mono font-bold text-rose-600 mt-0.5">
                                        {item.difference > 0 ? '+' : ''}${item.difference.toFixed(2)} USD
                                      </span>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setSelectedInvoiceNumber(item.invoiceNumber);
                                        setInvoiceSubTab('cotejo');
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors"
                                      title="Click para adjuntar factura en Cotejo Automático"
                                    >
                                      <Clock className="w-3 h-3 text-amber-600" />
                                      <span>Sin Factura Adjunta</span>
                                    </button>
                                  )}
                                </td>

                                {/* 6. Acciones */}
                                <td className="px-5 py-3.5 text-center whitespace-nowrap">
                                  <button
                                    onClick={() => setSelectedInsuranceForDetail(ins)}
                                    className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 border border-gray-200 rounded-lg transition-all"
                                    title="Ver detalle completo de la póliza"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Table Footer with Summary Counts */}
                <div className="p-4 bg-gray-50/70 border-t border-gray-150 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    {invoiceDetailViewMode === 'concentrated' ? (
                      <span className="font-bold text-gray-700">
                        Mostrando {concentratedPoliciesData.length} registros concentrados ({detailedMetrics.totalPolicies} pólizas en {detailedMetrics.uniqueInvoices} invoices)
                      </span>
                    ) : (
                      <span className="font-bold text-gray-700">
                        Mostrando {detailedInvoicedPolicies.length} de {insurances.filter(i => !!i.InvoiceCaremed).length} pólizas facturadas ({detailedMetrics.uniqueInvoices} invoices distintos)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 font-mono font-bold text-gray-800">
                    <span>Total Sumado: <strong className="text-emerald-700">${detailedMetrics.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</strong></span>
                  </div>
                </div>
              </div>
            </div>
          )}
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
              <option value="unpaid">Con Saldo Deudor (Sin Pagar)</option>
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

          {profile?.role !== 'client' && profile?.role !== 'agent' && (
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

      {/* Non-Exported CareMed Helper Banner */}
      {caremedExportedFilter === 'not_exported' && !loading && (
        <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-blue-950">
                  Pólizas Pendientes de Exportación CareMed
                </h4>
                <span className="px-2 py-0.5 bg-blue-200 text-blue-800 text-[10px] font-black rounded-full uppercase">
                  {filteredInsurances.length} pendientes
                </span>
              </div>
              <p className="text-xs text-blue-700 font-medium mt-0.5">
                Seleccione en las filas las pólizas que desea exportar y haga clic en <strong>Exportar CareMed</strong> para generar el archivo y registrarlas.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
            <button
              onClick={handleSelectAllFiltered}
              className="px-3 py-1.5 bg-white text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              {filteredInsurances.length > 0 && filteredInsurances.map(i => i.id).filter((id): id is string => !!id).every(id => selectedInsuranceIds.includes(id))
                ? 'Deseleccionar Todos'
                : `Seleccionar Todos (${filteredInsurances.length})`}
            </button>
            {canExportToCareMed && (
              <button
                onClick={handleDownloadCareMedCSV}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CareMed ({selectedInsuranceIds.length})
              </button>
            )}
            {selectedInsuranceIds.length > 0 && selectedExportedCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100/90 text-amber-900 border border-amber-300 rounded-xl text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {selectedExportedCount === selectedInsuranceIds.length
                    ? 'Pólizas ya exportadas (botón CareMed oculto)'
                    : `${selectedExportedCount} ${selectedExportedCount === 1 ? 'póliza ya exportada' : 'pólizas ya exportadas'} seleccionada(s) (CareMed oculto)`
                  }
                </span>
              </div>
            )}
            <button
              onClick={() => setCaremedExportedFilter('all')}
              className="px-3 py-1.5 text-xs text-blue-600 hover:text-blue-900 font-bold hover:bg-blue-100 rounded-xl transition-all cursor-pointer"
              title="Restablecer filtro a todas las pólizas"
            >
              Ver Todas
            </button>
          </div>
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
              
              const mul = 1;
              const totalPrice = i.totalFinal || i.totalPrice || 0;
              const totalPaid = i.totalPaid || 0;
              const balanceToPay = totalPrice - totalPaid;
              const isPaidStatus = i.status === 'paid' || (balanceToPay < 2 && i.status !== 'cancelled');
              const displayStatus = isPaidStatus ? 'paid' : i.status;

              const hasPendingPayments = !isPaidStatus && balanceToPay >= 2;
              const isCommissionPending = (i.commissionStatus === 'pending' || !i.commissionStatus) && (i.agentCommission || 0) > 0;

              return (
                <div key={i.id} className={`bg-white rounded-2xl border ${selectedInsuranceIds.includes(i.id || '') ? 'border-indigo-300 ring-2 ring-indigo-50/50 bg-indigo-50/10' : 'border-gray-100'} p-6 hover:shadow-md transition-all flex flex-col gap-6`}>
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {(isSuperAdminOrDirector || canManageClosedState) && (
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
                        <p className="text-sm font-bold text-gray-900 flex items-center flex-wrap gap-1.5">
                          <span>{i.firstName} {i.lastName}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicatePolicy(i);
                            }}
                            className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all cursor-pointer inline-flex items-center"
                            title="Duplicar datos básicos a nueva póliza (Agente/Corporativo/Individual, Nombre, Apellido, Fecha de nacimiento)"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {i.isCorrected && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black bg-rose-100 text-rose-800 border border-rose-200 uppercase select-none align-middle tracking-wider">
                              CORREGIDO
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <Mail className="w-3 h-3" />
                          <span className="truncate max-w-[150px]">{i.email}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5">
                          <Baby className="w-3 h-3" />
                          <span>Nacimiento: {formatDisplayDate(i.birthDate)} ({i.age} años) • {i.gender || '-'}</span>
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
                          displayStatus === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                          displayStatus === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                          displayStatus === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                          'bg-red-100 text-red-700 border-red-200'
                        }`}>
                          {displayStatus === 'paid' ? 'PAGADO' : 
                           displayStatus === 'pending' ? 'PENDIENTE' : 
                           displayStatus === 'partially_paid' ? 'PAGO PARCIAL' :
                           'CANCELADO'}
                        </span>
                        <p className="text-[10px] text-gray-400 font-mono">{i.id}</p>
                        {i.actionType && (
                          <div className="mt-1">
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border uppercase ${
                              i.actionType.toUpperCase() === 'NEW' ? 'bg-green-50 text-green-700 border-green-200' :
                              i.actionType.toUpperCase() === 'COR' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                              i.actionType.toUpperCase() === 'CAN' ? 'bg-red-50 text-red-700 border-red-200' :
                              i.actionType.toUpperCase() === 'EXT' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>
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
                            {formatDisplayDate(i.startDate)} al {formatDisplayDate(i.endDate)}
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
                          <p className="text-xs font-black text-gray-900">{formatPriceWithSign(i.totalFinal || i.totalPrice || 0, i.actionType?.toUpperCase() === 'CAN')}</p>
                        </div>
                        {profile?.role !== 'agent' && (
                          <div>
                            <p className="text-[8px] text-gray-400 font-bold uppercase text-red-400">Costo</p>
                            <p className="text-xs font-black text-red-600">{formatPriceWithSign(i.totalCost || 0, i.actionType?.toUpperCase() === 'CAN')}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase text-indigo-400">Comisión</p>
                          <p className="text-xs font-black text-indigo-600">{formatPriceWithSign(i.agentCommission || 0, i.actionType?.toUpperCase() === 'CAN')}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-gray-400 font-bold uppercase text-green-400">Pagado</p>
                          <p className="text-xs font-black text-green-600">{formatPriceWithSign(i.totalPaid || 0, i.actionType?.toUpperCase() === 'CAN')}</p>
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
                      {canManageClosedState && i.actionType !== 'CAN' && !i.isCorrected && (i as any).Caremed && (
                        <>
                          <button 
                            onClick={() => {
                              setSelectedInsuranceForDetail(i);
                              setModalInitialAction('cancel');
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg hover:bg-red-100 transition-all cursor-pointer"
                            title="Cancelar Seguro"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Cancelar
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedInsuranceForDetail(i);
                              setModalInitialAction('correct');
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-600 text-[10px] font-bold rounded-lg hover:bg-amber-100 transition-all cursor-pointer"
                            title="Corregir Seguro"
                          >
                            <History className="w-3.5 h-3.5" />
                            Corregir
                          </button>
                          <button 
                            onClick={() => {
                              setSelectedInsuranceForDetail(i);
                              setModalInitialAction('extension');
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-lg hover:bg-blue-100 transition-all cursor-pointer"
                            title="Extensión del Seguro"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Extension
                          </button>
                        </>
                      )}
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
                      {isSuperAdminOrDirector && (
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
                    {(isSuperAdminOrDirector || canManageClosedState) && (
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
                    {profile?.role !== 'agent' && <th className="px-6 py-4 font-bold text-right">Costo</th>}
                    <th className="px-6 py-4 font-bold text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedInsurances.map((i) => {
                    const policy = policies.find(p => p.id === i.policyId);
                    const plan = i.plan || policy?.plan || i.policyId.split('-')[0];
                    const policyName = i.policyName || policy?.name || '';
                    
                    const mul = 1;
                    const totalPrice = i.totalFinal || i.totalPrice || 0;
                    const totalPaid = i.totalPaid || 0;
                    const balanceToPay = totalPrice - totalPaid;
                    const isPaidStatus = i.status === 'paid' || (balanceToPay < 2 && i.status !== 'cancelled');
                    const displayStatus = isPaidStatus ? 'paid' : i.status;

                    const isCommissionPending = (i.commissionStatus === 'pending' || !i.commissionStatus) && (i.agentCommission || 0) > 0;
                    const hasPendingPayments = !isPaidStatus && balanceToPay >= 2;

                    return (
                      <tr key={i.id} className={`hover:bg-gray-50 transition-colors ${selectedInsuranceIds.includes(i.id || '') ? 'bg-indigo-50/20 hover:bg-indigo-50/30' : ''}`}>
                        {(isSuperAdminOrDirector || canManageClosedState) && (
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
                            {formatDisplayDate(i.requestDate || i.createdAt)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-900 flex items-center flex-wrap gap-1.5">
                              <span>{i.firstName} {i.lastName}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDuplicatePolicy(i);
                                }}
                                className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all cursor-pointer inline-flex items-center"
                                title="Duplicar datos básicos a nueva póliza (Agente/Corporativo/Individual, Nombre, Apellido, Fecha de nacimiento)"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              {i.isCorrected && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black bg-rose-100 text-rose-800 border border-rose-200 uppercase select-none align-middle tracking-wider">
                                  CORREGIDO
                                </span>
                              )}
                            </span>
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
                              {canManageClosedState && i.actionType !== 'CAN' && !i.isCorrected && (i as any).Caremed && (
                                <>
                                  <button 
                                    onClick={() => {
                                      setSelectedInsuranceForDetail(i);
                                      setModalInitialAction('cancel');
                                    }}
                                    className="p-1 text-red-600 hover:bg-red-50 rounded-md transition-all cursor-pointer"
                                    title="Cancelar Seguro"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setSelectedInsuranceForDetail(i);
                                      setModalInitialAction('correct');
                                    }}
                                    className="p-1 text-amber-600 hover:bg-amber-50 rounded-md transition-all cursor-pointer"
                                    title="Corregir Seguro"
                                  >
                                    <History className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setSelectedInsuranceForDetail(i);
                                      setModalInitialAction('extension');
                                    }}
                                    className="p-1 text-blue-600 hover:bg-blue-50 rounded-md transition-all cursor-pointer"
                                    title="Extensión del Seguro"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              {isSuperAdminOrDirector && (
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
                            <span className="text-xs text-gray-600">{formatDisplayDate(i.birthDate)}</span>
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
                            <span>{formatDisplayDate(i.startDate)} al {formatDisplayDate(i.endDate)}</span>
                            <span className="font-bold text-blue-600">
                              {i.days} días 
                              {i.days > 39 && ` (${Math.ceil(i.days / 30.4)} meses)`}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {i.actionType ? (
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${
                              i.actionType.toUpperCase() === 'NEW' ? 'bg-green-50 text-green-700 border-green-200' :
                              i.actionType.toUpperCase() === 'COR' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                              i.actionType.toUpperCase() === 'CAN' ? 'bg-red-50 text-red-700 border-red-200' :
                              i.actionType.toUpperCase() === 'EXT' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                              'bg-gray-50 text-gray-700 border-gray-200'
                            }`}>
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
                            if (i.actionType?.toUpperCase() === 'CAN' || i.actionType === 'Can' || displayStatus === 'cancelled' || i.status === 'cancelled') opStatus = 'Cancelado';
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
                                  displayStatus === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 
                                  displayStatus === 'pending' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                                  displayStatus === 'partially_paid' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                  'bg-red-100 text-red-700 border-red-200'
                                }`}>
                                  {displayStatus === 'paid' ? 'PAGADO' : 
                                   displayStatus === 'pending' ? 'PENDIENTE' : 
                                   displayStatus === 'partially_paid' ? 'PARCIAL' :
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
                        <td className="px-6 py-4 text-right font-bold text-gray-900 text-sm">{formatPriceWithSign(i.totalFinal || i.totalPrice || 0, i.actionType?.toUpperCase() === 'CAN')}</td>
                        {profile?.role !== 'agent' && (
                          <td className="px-6 py-4 text-right font-bold text-red-600 text-sm">{formatPriceWithSign(i.totalCost || 0, i.actionType?.toUpperCase() === 'CAN')}</td>
                        )}
                        <td className="px-6 py-4 text-right font-bold text-indigo-600 text-sm">{formatPriceWithSign(i.agentCommission || 0, i.actionType?.toUpperCase() === 'CAN')}</td>
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
        onClose={() => {
          setSelectedInsuranceForDetail(null);
          setModalInitialAction(null);
        }}
        insurance={selectedInsuranceForDetail}
        initialAction={modalInitialAction || undefined}
        onUpdateInsurance={(newIns) => setSelectedInsuranceForDetail(newIns)}
      />

      <BatchDetailModal
        isOpen={!!selectedBatchForDetail}
        onClose={() => setSelectedBatchForDetail(null)}
        batch={selectedBatchForDetail}
        clients={clients}
        onViewInsuranceDetail={(ins) => setSelectedInsuranceForDetail(ins)}
        onUpdateExportDate={handleUpdateExportDate}
      />

      {/* Edit Export Date Modal */}
      {editingExportDate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[210] p-4 font-sans animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-indigo-600 p-5 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-white" />
                <h3 className="text-base font-bold">Editar Fecha de Exportación</h3>
              </div>
              <button onClick={() => setEditingExportDate(null)} className="p-2 hover:bg-white/10 rounded-xl transition-all cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Nueva Fecha</label>
                <input 
                  type="date"
                  value={newExportDateValue}
                  onChange={(e) => setNewExportDateValue(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none font-bold text-sm transition-all text-gray-850"
                  required
                />
              </div>
              <p className="text-[11px] text-gray-450 leading-relaxed font-medium">
                Se actualizarán todas las pólizas vinculadas a este lote y las facturas adjuntas asociadas de manera automática en la base de datos.
              </p>
              <div className="flex gap-3 pt-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingExportDate(null)}
                  className="px-5 py-2.5 border border-gray-250 text-gray-600 font-bold text-xs rounded-xl hover:bg-gray-100 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateExportDate(editingExportDate, newExportDateValue)}
                  disabled={invoiceSaving}
                  className="px-5 py-2.5 bg-indigo-600 text-white font-black text-xs rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200 disabled:opacity-50 cursor-pointer"
                >
                  {invoiceSaving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EmailModal
        isOpen={!!selectedInsuranceForEmail}
        onClose={() => setSelectedInsuranceForEmail(null)}
        insurance={selectedInsuranceForEmail}
        policies={policies}
        policyLetters={policyLetters}
        companySettings={settings}
      />

      <DuplicatesModal
        isOpen={showDuplicatesModal}
        onClose={() => setShowDuplicatesModal(false)}
        insurances={insurances}
        policies={policies}
        isSuperAdmin={isSuperAdmin}
        onViewInsuranceDetail={(ins) => setSelectedInsuranceForDetail(ins)}
        onDeleteInsurance={handleDeleteInsurance}
        onDeleteMultipleInsurances={handleDeleteMultipleInsurances}
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

      <BulkZipDownloadModal
        isOpen={showBulkZipModal}
        onClose={() => setShowBulkZipModal(false)}
        selectedInsurances={insurances.filter(ins => ins.id && selectedInsuranceIds.includes(ins.id))}
        policies={policies}
        policyLetters={policyLetters}
        companySettings={settings}
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
                         letter.language === 'embajada_spain' ? 'Embajada España' : 
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

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full my-8 overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-100 flex flex-col max-h-[90vh]">
            <div className="bg-amber-600 p-6 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3 text-left">
                <Edit2 className="w-6 h-6 text-white" />
                <div>
                  <h3 className="text-lg font-black tracking-tight">Modificación Masiva de Pólizas</h3>
                  <p className="text-xs text-amber-100 font-semibold mt-0.5">Modificando {selectedInsuranceIds.length} pólizas seleccionadas</p>
                </div>
              </div>
              <button 
                onClick={() => setShowBulkEditModal(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-all cursor-pointer"
                type="button"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <form onSubmit={handleBulkEditSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              <p className="text-xs text-gray-500 font-semibold leading-relaxed text-left">
                Selecciona las casillas de los campos que deseas actualizar masivamente en las pólizas seleccionadas. Los campos que no estén seleccionados permanecerán sin cambios.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                {/* PRECIO */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updatePrice}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updatePrice: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Precio (USD)</span>
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    placeholder="Nuevo precio base"
                    value={bulkEditFields.price}
                    onChange={(e) => setBulkEditFields(prev => ({ ...prev, price: e.target.value }))}
                    disabled={!bulkEditFields.updatePrice}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50"
                  />
                </div>

                {/* DESCUENTO */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updateDiscount}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateDiscount: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Descuento (USD)</span>
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    placeholder="Nuevo descuento"
                    value={bulkEditFields.discount}
                    onChange={(e) => setBulkEditFields(prev => ({ ...prev, discount: e.target.value }))}
                    disabled={!bulkEditFields.updateDiscount}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50"
                  />
                </div>

                {/* COMISION */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-3 col-span-1 md:col-span-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updateCommission}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateCommission: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Comisión Agente (USD)</span>
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    placeholder="Nueva comisión"
                    value={bulkEditFields.commission}
                    onChange={(e) => setBulkEditFields(prev => ({ ...prev, commission: e.target.value }))}
                    disabled={!bulkEditFields.updateCommission}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50"
                  />
                </div>

                {/* AGENTE */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-4 col-span-1 md:col-span-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updateAgent}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateAgent: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Agente</span>
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 tracking-wider">Agente Principal</label>
                      <select 
                        value={bulkEditFields.agentClientId}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, agentClientId: e.target.value, agentSubAgentId: '' }))}
                        disabled={!bulkEditFields.updateAgent}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50"
                      >
                        <option value="">Seleccione agente...</option>
                        {clients
                          .filter((c: any) => c.type === 'Agent')
                          .sort((a, b) => {
                            const nameA = a.commercialName || a.legalName || `${a.firstName || ''} ${a.lastName || ''}`.trim();
                            const nameB = b.commercialName || b.legalName || `${b.firstName || ''} ${b.lastName || ''}`.trim();
                            return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
                          })
                          .map((c: any) => {
                            const name = c.commercialName || c.legalName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
                            return (
                              <option key={c.id} value={c.id}>{name}</option>
                            );
                          })
                        }
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 tracking-wider">Subagente (Opcional)</label>
                      <select 
                        value={bulkEditFields.agentSubAgentId}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, agentSubAgentId: e.target.value }))}
                        disabled={!bulkEditFields.updateAgent || !bulkEditFields.agentClientId}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-medium focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50"
                      >
                        <option value="">Seleccione subagente...</option>
                        {(() => {
                          const selectedClientObj = clients.find(c => c.id === bulkEditFields.agentClientId);
                          if (selectedClientObj && selectedClientObj.linkedAgents) {
                            return [...selectedClientObj.linkedAgents]
                              .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                              .map((la: any) => (
                                <option key={la.id || la.email} value={la.email}>
                                  {la.name} ({la.email})
                                </option>
                              ));
                          }
                          return null;
                        })()}
                      </select>
                    </div>
                  </div>
                </div>

                {/* FECHA SOLICITUD */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updateRequestDate}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateRequestDate: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Fecha de Solicitud</span>
                  </label>
                  <input 
                    type="date"
                    value={bulkEditFields.requestDate}
                    onChange={(e) => setBulkEditFields(prev => ({ ...prev, requestDate: e.target.value }))}
                    disabled={!bulkEditFields.updateRequestDate}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                  />
                </div>

                {/* FECHAS DE VIAJE */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-4 col-span-1 md:col-span-2">
                  <span className="text-xs font-black text-gray-700 uppercase tracking-wider block">Fechas de Inicio y Fin</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={bulkEditFields.updateStartDate}
                          onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateStartDate: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                        />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Modificar Fecha de Inicio</span>
                      </label>
                      <input 
                        type="date"
                        value={bulkEditFields.startDate}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, startDate: e.target.value }))}
                        disabled={!bulkEditFields.updateStartDate}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={bulkEditFields.updateEndDate}
                          onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateEndDate: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                        />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Modificar Fecha Final</span>
                      </label>
                      <input 
                        type="date"
                        value={bulkEditFields.endDate}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, endDate: e.target.value }))}
                        disabled={!bulkEditFields.updateEndDate}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                      />
                    </div>
                  </div>
                </div>

                {/* PAÍS ORIGEN Y DESTINO */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-4 col-span-1 md:col-span-2">
                  <span className="text-xs font-black text-gray-700 uppercase tracking-wider block">País de Origen y Destino</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={bulkEditFields.updateOriginCountry}
                          onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateOriginCountry: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                        />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Modificar País de Origen</span>
                      </label>
                      <select 
                        value={bulkEditFields.originCountry}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, originCountry: e.target.value }))}
                        disabled={!bulkEditFields.updateOriginCountry}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                      >
                        {Array.from(new Map((countriesList.length > 0 ? countriesList : COUNTRIES).map((c: any) => [c.code, c])).values())
                          .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                          .map((c: any) => (
                            <option key={c.code} value={c.code}>{c.name}</option>
                          ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox"
                          checked={bulkEditFields.updateDestinationCountry}
                          onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateDestinationCountry: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                        />
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Modificar País de Destino</span>
                      </label>
                      <select 
                        value={bulkEditFields.destinationCountry}
                        onChange={(e) => setBulkEditFields(prev => ({ ...prev, destinationCountry: e.target.value }))}
                        disabled={!bulkEditFields.updateDestinationCountry}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                      >
                        {Array.from(new Map((countriesList.length > 0 ? countriesList : COUNTRIES).map((c: any) => [c.code, c])).values())
                          .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
                          .map((c: any) => (
                            <option key={c.code} value={c.code}>{c.name}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* INVOICE CAREMED */}
                <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 space-y-3 col-span-1 md:col-span-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={bulkEditFields.updateInvoice}
                      onChange={(e) => setBulkEditFields(prev => ({ ...prev, updateInvoice: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 accent-amber-600"
                    />
                    <span className="text-xs font-black text-gray-700 uppercase tracking-wider">Modificar Invoice CareMed</span>
                  </label>
                  <input 
                    type="text"
                    placeholder="Número de Invoice (dejar vacío para remover Invoice)"
                    value={bulkEditFields.invoiceCaremed}
                    onChange={(e) => setBulkEditFields(prev => ({ ...prev, invoiceCaremed: e.target.value }))}
                    disabled={!bulkEditFields.updateInvoice}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-gray-100/50 text-gray-850"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-100 shrink-0">
                <button 
                  onClick={() => setShowBulkEditModal(false)}
                  type="button"
                  className="flex-1 px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold rounded-2xl transition-all font-sans"
                  disabled={bulkEditing}
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-6 py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-amber-100 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer font-sans"
                  disabled={bulkEditing || (!bulkEditFields.updatePrice && !bulkEditFields.updateDiscount && !bulkEditFields.updateCommission && !bulkEditFields.updateAgent && !bulkEditFields.updateRequestDate && !bulkEditFields.updateStartDate && !bulkEditFields.updateEndDate && !bulkEditFields.updateOriginCountry && !bulkEditFields.updateDestinationCountry && !bulkEditFields.updateInvoice)}
                >
                  {bulkEditing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Aplicando Cambios...
                    </>
                  ) : (
                    'Guardar Cambios Masivos'
                  )}
                </button>
              </div>
            </form>
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

      {/* Super Admin Difference Justification Modal */}
      {justifyingInvoice && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base leading-tight">Aprobar Diferencia de Invoice (OK)</h3>
                    <p className="text-emerald-100 text-xs mt-0.5 font-medium">Exclusivo para Super Administrador</p>
                  </div>
                </div>
                <button
                  onClick={() => setJustifyingInvoice(null)}
                  className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-150 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                  <span className="text-xs font-semibold text-gray-500">Invoice:</span>
                  <span className="font-mono font-black text-sm text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                    {justifyingInvoice.invoiceNumber}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-400 font-bold block uppercase">Costo Sistema</span>
                    <span className="font-black text-gray-800 text-xs">${justifyingInvoice.totalCalculatedCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-gray-100">
                    <span className="text-[10px] text-gray-400 font-bold block uppercase">Facturado</span>
                    <span className="font-black text-gray-800 text-xs">${justifyingInvoice.invoiceAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    <span className="text-[10px] text-amber-700 font-bold block uppercase">Diferencia</span>
                    <span className="font-black text-amber-900 text-xs">
                      {justifyingInvoice.difference > 0 ? '+' : ''}${justifyingInvoice.difference.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Escribe la Justificación de la Diferencia <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={justifyingInvoice.justificationText}
                  onChange={(e) => setJustifyingInvoice(prev => prev ? { ...prev, justificationText: e.target.value } : null)}
                  placeholder="Ej. Recargo autorizado por extensión / Descuento acordado / Ajuste por tipo de cambio / Comisión de emisión..."
                  rows={4}
                  className="w-full text-xs p-3 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-hidden resize-none transition-all placeholder:text-gray-400 bg-white"
                  autoFocus
                />
                <p className="text-[10.5px] text-gray-400 mt-1.5 leading-relaxed">
                  Al confirmar, esta factura quedará marcada como <strong>Aprobada con Justificación</strong> y dejará de aparecer en el <strong>Listado de Invoices</strong> de forma inmediata.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setJustifyingInvoice(null)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-150 rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingJustification || !justifyingInvoice.justificationText.trim()}
                onClick={handleSaveJustification}
                className="px-5 py-2.5 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-2"
              >
                {isSavingJustification ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guardar y Aprobar (OK)</span>
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
