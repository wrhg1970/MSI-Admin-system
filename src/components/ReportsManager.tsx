import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  Download, 
  Filter, 
  Calendar, 
  Search, 
  ChevronDown, 
  FileText, 
  FileSpreadsheet,
  ArrowUpRight,
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  Check,
  X,
  CreditCard,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  CalendarCheck
} from 'lucide-react';
import { collection, query, getDocs, where, orderBy, updateDoc, doc, getDocsFromServer, getDocsFromCache } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { InsuranceRequest, Client, ClientType, UserProfile, CustomRole, Policy, Payment, Category, Subcategory, ExchangeRate } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { format, parseISO, subDays } from 'date-fns';
import { getNormalizedYYYYMMDD, getPolicyEffectiveCost } from '../lib/policyUtils';
import { useFirestoreData } from '../context/FirestoreDataContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawVectorLogo } from '../lib/pdfGenerator';
import { useCompany } from '../App';
import MonthlyClosingModal from './MonthlyClosingModal';
import MonthlyReportModal from './MonthlyReportModal';
import { getInsuranceExpectedAmount, getInsurancePaymentBalance, isInsuranceDeudor } from '../utils/paymentUtils';

const formatMonthsDays = (days: number): string => {
  if (!days || days <= 0) return '0 días';
  if (days < 40) {
    return `${days} Días`;
  }
  const calculatedMonths = Math.floor(days / 30.4);
  const additionalDays = Math.max(0, days - Math.round(calculatedMonths * 30.4));
  let billedMonths = calculatedMonths;
  let billedDays = additionalDays;
  if (additionalDays > 15) {
    billedMonths = calculatedMonths + 1;
    billedDays = 0;
  }
  
  if (billedMonths > 0 && billedDays > 0) {
    return `${billedMonths} m / ${billedDays} d`;
  } else if (billedMonths > 0) {
    return `${billedMonths} m`;
  } else {
    return `${days} d`;
  }
};

/** Same Ventas Totales rule as Gestión de Pólizas (summaryStats). */
const getPolicySalesAmount = (ins: InsuranceRequest): number => {
  const isCan = ins.actionType?.toUpperCase() === 'CAN';
  const p = ins.totalFinal || ins.totalPrice || 0;
  return isCan ? -Math.abs(p) : (p < 0 ? p : Math.abs(p));
};

/** Same Comisión rule as Gestión de Pólizas (summaryStats). */
const getPolicyCommissionAmount = (ins: InsuranceRequest): number => {
  const isCan = ins.actionType?.toUpperCase() === 'CAN';
  const com = ins.agentCommission || 0;
  return isCan ? -Math.abs(com) : (com < 0 ? com : Math.abs(com));
};

/** Same expected amount and deudor rule as Inicio / Cuentas por Cobrar. */
const getPolicyExpectedAmount = (ins: InsuranceRequest): number => {
  return getInsuranceExpectedAmount(ins);
};

const getPolicyReceivableBalance = (ins: InsuranceRequest): number => {
  return getInsurancePaymentBalance(ins);
};

const isPolicyDeudor = (ins: InsuranceRequest): boolean => {
  return isInsuranceDeudor(ins);
};

type PayableInvoiceGroup = {
  invoice: string;
  count: number;
  pendingAmount: number;
  invoiceDate: string;
  exportDate: string;
  status: 'paid' | 'pending' | 'partial';
  insurances: InsuranceRequest[];
};

/** Same invoice grouping and Monto por Pagar as Cuentas por Pagar (AdminPanel). */
const buildPayableInvoiceGroups = (
  sourceInsurances: InsuranceRequest[],
  paymentsList: Payment[],
  caremedInvoicesList: { invoiceNumber?: string; amount?: any; invoiceDate?: string }[],
  dateStart: string,
  dateEnd: string
): PayableInvoiceGroup[] => {
  const providerPaid = new Map<string, number>();
  paymentsList.forEach(p => {
    if (p.type === 'provider_payment' && p.insuranceId) {
      providerPaid.set(p.insuranceId, (providerPaid.get(p.insuranceId) || 0) + (Number(p.amount) || 0));
    }
  });

  const groups: Record<string, {
    invoice: string;
    insurances: InsuranceRequest[];
    totalCost: number;
    paidAmount: number;
  }> = {};

  sourceInsurances.forEach(ins => {
    if (!ins.InvoiceCaremed) return;
    const invKey = ins.InvoiceCaremed.trim();
    if (!invKey) return;
    if (!groups[invKey]) {
      groups[invKey] = { invoice: invKey, insurances: [], totalCost: 0, paidAmount: 0 };
    }
    const g = groups[invKey];
    g.insurances.push(ins);
    const currentCost = getPolicyEffectiveCost(ins);
    g.totalCost += currentCost;
    let paid = providerPaid.get(ins.id || '') || 0;
    if (ins.providerPaymentStatus === 'paid') {
      paid = currentCost;
    }
    g.paidAmount += paid;
  });

  return Object.values(groups).map(g => {
    const dbInv = caremedInvoicesList.find(
      d => (d.invoiceNumber || '').toLowerCase().trim() === g.invoice.toLowerCase().trim()
    );
    const dbInvoiceAmount = dbInv
      ? (typeof dbInv.amount === 'number' ? dbInv.amount : parseFloat(String(dbInv.amount)) || 0)
      : null;

    const allPoliciesPaid = g.insurances.length > 0 && g.insurances.every(ins => ins.providerPaymentStatus === 'paid');
    const payableBase = dbInvoiceAmount !== null ? dbInvoiceAmount : g.totalCost;
    const rawPending = payableBase - g.paidAmount;
    const settledAgainstPayable = Math.abs(rawPending) <= 0.01 && (g.paidAmount !== 0 || payableBase === 0);
    const markedPaidWithoutInvoice = allPoliciesPaid && dbInvoiceAmount === null;

    let pendingAmount = 0;
    let status: 'paid' | 'pending' | 'partial' = 'pending';
    if (settledAgainstPayable || markedPaidWithoutInvoice) {
      pendingAmount = 0;
      status = 'paid';
    } else {
      pendingAmount = rawPending;
      status = Math.abs(g.paidAmount) > 0.01 ? 'partial' : 'pending';
    }

    const sortedInsurances = [...g.insurances].sort((a, b) => ((b as any).Caremed || '').localeCompare((a as any).Caremed || ''));
    const exportDate = (sortedInsurances[0] as any)?.Caremed ? String((sortedInsurances[0] as any).Caremed).substring(0, 10) : '';
    const rawInvoiceDate = dbInv?.invoiceDate || '';
    const invoiceDate = rawInvoiceDate ? String(rawInvoiceDate).substring(0, 10) : (exportDate || '');

    return {
      invoice: g.invoice,
      count: g.insurances.length,
      pendingAmount,
      invoiceDate,
      exportDate,
      status,
      insurances: g.insurances
    };
  }).filter(g => {
    if (g.status === 'paid' && Math.abs(g.pendingAmount) <= 0.01) return false;
    const invDate = (g.invoiceDate || g.exportDate || '').substring(0, 10);
    if (!invDate) return false;
    if (dateStart && invDate < dateStart) return false;
    if (dateEnd && invDate > dateEnd) return false;
    return true;
  });
};

const getRequestDateString = (ins: InsuranceRequest): string => {
  if (ins.requestDate) return ins.requestDate;
  if (ins.createdAt) {
    if (typeof ins.createdAt.toDate === 'function') {
      return format(ins.createdAt.toDate(), 'yyyy-MM-dd');
    } else {
      try {
        return format(new Date(ins.createdAt), 'yyyy-MM-dd');
      } catch (_) {
        return '';
      }
    }
  }
  return '';
};

const getExchangeRateForRequestDate = (ins: InsuranceRequest, rates: ExchangeRate[]): number => {
  const reqDate = getRequestDateString(ins);
  if (!reqDate) {
    return ins.exchangeRate || 17.55;
  }
  
  // Find exchange rate for exact date
  const found = rates.find(r => r.date === reqDate);
  if (found) {
    return found.rate;
  }
  
  // Find the closest rate on or before the requestDate
  const sorted = [...rates].sort((a, b) => b.date.localeCompare(a.date));
  const beforeOrOn = sorted.find(r => r.date <= reqDate);
  if (beforeOrOn) {
    return beforeOrOn.rate;
  }
  
  if (sorted.length > 0) {
    return sorted[0].rate;
  }
  
  return ins.exchangeRate || 17.55;
};

const sortInsurances = (list: InsuranceRequest[], sortBy: 'requestDate' | 'name' | 'startDate'): InsuranceRequest[] => {
  return [...list].sort((a, b) => {
    if (sortBy === 'requestDate') {
      const dateA = getRequestDateString(a);
      const dateB = getRequestDateString(b);
      return dateA.localeCompare(dateB);
    } else if (sortBy === 'startDate') {
      const dateA = a.startDate || '';
      const dateB = b.startDate || '';
      return dateA.localeCompare(dateB);
    } else { // 'name'
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    }
  });
};

export default function ReportsManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { settings: companySettings } = useCompany();
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const { insurances: contextInsurances, payments: contextPayments } = useFirestoreData();
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [caremedInvoices, setCaremedInvoices] = useState<any[]>([]);
  const [liveReportInsurances, setLiveReportInsurances] = useState<InsuranceRequest[]>([]);
  const [liveReportPayments, setLiveReportPayments] = useState<Payment[]>([]);
  const [liveReportCaremed, setLiveReportCaremed] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Quick Reports Modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [showMonthlyClosingModal, setShowMonthlyClosingModal] = useState(false);
  const [showMonthlyReportModal, setShowMonthlyReportModal] = useState(false);
  const [reportType, setReportType] = useState<'altas' | 'to_collect' | 'to_pay' | 'commissions' | 'income_statement'>('altas');
  const [reportFormat, setReportFormat] = useState<'detailed' | 'consolidated'>('detailed');
  const [reportGrouping, setReportGrouping] = useState<'all' | 'Agent' | 'Corporate' | 'Individual' | 'policy'>('all');
  const [reportDates, setReportDates] = useState({
    start: format(new Date(), 'yyyy-MM-01'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [reportClientId, setReportClientId] = useState<string>('All');
  const [reportSortBy, setReportSortBy] = useState<'requestDate' | 'name' | 'startDate'>('requestDate');
  
  // Filters
  const [clientTypeFilter, setClientTypeFilter] = useState<ClientType | 'All'>('All');
  const [clientIdFilter, setClientIdFilter] = useState<string>('All');
  const [planTypeFilter, setPlanTypeFilter] = useState<string>('All');
  const [policyNameFilter, setPolicyNameFilter] = useState<string>('All');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [commissionStatusFilter, setCommissionStatusFilter] = useState<string>('All');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('All');
  const [providerPaymentStatusFilter, setProviderPaymentStatusFilter] = useState<string>('All');

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    date: new Date().toISOString().split('T')[0],
    method: 'Transferencia',
    receipt: ''
  });
  const [processing, setProcessing] = useState(false);
  const [limitToCurrentMonth, setLimitToCurrentMonth] = useState(true);

  useEffect(() => {
    const startOfCurrentMonth = new Date();
    startOfCurrentMonth.setDate(1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);

    if (startDateFilter) {
      const filterDate = new Date(startDateFilter + 'T00:00:00');
      if (filterDate < startOfCurrentMonth) {
        setLimitToCurrentMonth(false);
      }
    }

    if (reportDates.start) {
      const filterDate = new Date(reportDates.start + 'T00:00:00');
      if (filterDate < startOfCurrentMonth) {
        setLimitToCurrentMonth(false);
      }
    }
  }, [startDateFilter, reportDates.start]);

  useEffect(() => {
    const getDocsFromServerOrCache = async (q: any) => {
      try {
        return await getDocsFromServer(q);
      } catch (error: any) {
        console.warn('Failed to fetch from server, trying local cache...', error);
        try {
          return await getDocsFromCache(q);
        } catch (cacheError) {
          throw error; // Rethrow original server error if cache is also empty or fails
        }
      }
    };

    const fetchData = async () => {
      setLoading(true);
      try {
        const startOfCurrentMonth = new Date();
        startOfCurrentMonth.setDate(1);
        startOfCurrentMonth.setHours(0, 0, 0, 0);

        const qInsurances = limitToCurrentMonth
          ? query(collection(db, 'insurances'), where('createdAt', '>=', startOfCurrentMonth), orderBy('createdAt', 'desc'))
          : query(collection(db, 'insurances'), orderBy('createdAt', 'desc'));

        const qPayments = limitToCurrentMonth
          ? query(collection(db, 'payments'), where('createdAt', '>=', startOfCurrentMonth))
          : collection(db, 'payments');

        const qExchangeRates = query(collection(db, 'exchangeRates'), orderBy('date', 'desc'));

        const [insurancesSnap, clientsSnap, policiesSnap, paymentsSnap, categoriesSnap, subcategoriesSnap, exchangeRatesSnap, caremedInvoicesSnap] = await Promise.all([
          getDocsFromServerOrCache(qInsurances),
          getDocsFromServerOrCache(collection(db, 'clients')),
          getDocsFromServerOrCache(collection(db, 'policies')),
          getDocsFromServerOrCache(qPayments),
          getDocsFromServerOrCache(collection(db, 'categories')),
          getDocsFromServerOrCache(collection(db, 'subcategories')),
          getDocsFromServerOrCache(qExchangeRates),
          getDocsFromServerOrCache(collection(db, 'caremedInvoices'))
        ]);

        setInsurances(insurancesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as InsuranceRequest)));
        setClients(clientsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Client)));
        setPolicies(policiesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Policy)));
        setPayments(paymentsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Payment)));
        setCategories(categoriesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Category)));
        setSubcategories(subcategoriesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Subcategory)));
        setExchangeRates(exchangeRatesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as ExchangeRate)));
        setCaremedInvoices(caremedInvoicesSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'reports data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [limitToCurrentMonth]);

  const fetchLiveMonthlyReportData = async (): Promise<{
    insurances: InsuranceRequest[];
    payments: Payment[];
    caremedInvoices: any[];
  }> => {
    const [insSnap, paySnap, invSnap] = await Promise.all([
      getDocsFromServer(collection(db, 'insurances')),
      getDocsFromServer(collection(db, 'payments')),
      getDocsFromServer(collection(db, 'caremedInvoices'))
    ]);
    const liveInsurances = insSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as InsuranceRequest));
    const livePayments = paySnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Payment));
    const liveCaremed = invSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    setLiveReportInsurances(liveInsurances);
    setLiveReportPayments(livePayments);
    setLiveReportCaremed(liveCaremed);
    return { insurances: liveInsurances, payments: livePayments, caremedInvoices: liveCaremed };
  };

  useEffect(() => {
    if (!showReportModal) return;
    fetchLiveMonthlyReportData().catch((error) => {
      console.warn('No se pudo refrescar el reporte mensual en tiempo real:', error);
    });
  }, [showReportModal]);

  const filteredInsurances = useMemo(() => {
    return insurances.filter(ins => {
      const matchesClientType = clientTypeFilter === 'All' || ins.clientType === clientTypeFilter;
      const matchesClient = clientIdFilter === 'All' || ins.clientId === clientIdFilter;
      const matchesPlan = planTypeFilter === 'All' || ins.plan === planTypeFilter;
      const matchesPolicy = policyNameFilter === 'All' || ins.policyName === policyNameFilter;
      const matchesCommission = commissionStatusFilter === 'All' || ins.commissionStatus === commissionStatusFilter;
      const matchesPayment = paymentStatusFilter === 'All' || ins.status === paymentStatusFilter;
      const matchesProviderPayment = providerPaymentStatusFilter === 'All' || 
        (providerPaymentStatusFilter === 'pending' ? !ins.providerPaymentStatus || ins.providerPaymentStatus === 'pending' : ins.providerPaymentStatus === 'paid');
      
      const getSafeDateStr = (val: any) => {
        if (!val) return '';
        if (typeof val.toDate === 'function') {
          return val.toDate().toISOString().split('T')[0];
        }
        try {
          const d = new Date(val);
          return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
        } catch (_) {
          return '';
        }
      };
      const insDate = getSafeDateStr(ins.createdAt);
      const matchesStartDate = !startDateFilter || insDate >= startDateFilter;
      const matchesEndDate = !endDateFilter || insDate <= endDateFilter;

      return matchesClientType && matchesClient && matchesPlan && matchesPolicy && 
             matchesCommission && matchesPayment && matchesProviderPayment && matchesStartDate && matchesEndDate;
    });
  }, [insurances, clientTypeFilter, clientIdFilter, planTypeFilter, policyNameFilter, commissionStatusFilter, paymentStatusFilter, providerPaymentStatusFilter, startDateFilter, endDateFilter]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const filtered = filteredInsurances;
    
    return {
      count: filtered.length,
      totalSales: filtered.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0),
      pendingCommissions: filtered
        .filter(ins => ins.commissionStatus === 'confirmed')
        .reduce((acc, curr) => acc + (curr.agentCommission || 0), 0),
      pendingPayments: filtered
        .filter(ins => ins.status === 'pending')
        .reduce((acc, curr) => acc + ((curr.totalFinal || 0) - (curr.totalPaid || 0)), 0),
      pendingToProvider: filtered
        .filter(ins => ins.status !== 'cancelled')
        .reduce((acc, curr) => acc + (curr.totalCost || 0), 0),
      totalMargin: filtered.reduce((acc, curr) => acc + ((curr.totalFinal || 0) - (curr.totalCost || 0)), 0),
      todaySales: insurances
        .filter(ins => {
          const insDate = ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '';
          return insDate === today;
        })
        .reduce((acc, curr) => acc + (curr.totalFinal || 0), 0)
    };
  }, [filteredInsurances, insurances]);

  const uniquePlans = useMemo(() => Array.from(new Set(insurances.map(ins => ins.plan).filter(Boolean))), [insurances]);
  const uniquePolicies = useMemo(() => Array.from(new Set(insurances.map(ins => ins.policyName).filter(Boolean))), [insurances]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setCurrentPage(1);
  }, [filteredInsurances]);

  const paginatedInsurances = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredInsurances.slice(startIndex, startIndex + pageSize);
  }, [filteredInsurances, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredInsurances.length / pageSize);

  const exportToCSV = () => {
    const headers = ['ID', 'Cliente', 'Tipo Cliente', 'Plan', 'Póliza', 'Fecha', 'Total', 'Costo', 'Margen', 'Comisión', 'Estado Pago'];
    const rows = filteredInsurances.map(ins => [
      ins.id,
      `${ins.firstName} ${ins.lastName}`,
      ins.clientType,
      ins.plan || '',
      ins.policyName || '',
      ins.createdAt?.toDate ? ins.createdAt.toDate().toLocaleDateString() : '',
      ins.totalFinal,
      ins.totalCost,
      (ins.totalFinal || 0) - (ins.totalCost || 0),
      ins.agentCommission,
      ins.status
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_msi_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateCSVForAltas = () => {
    const rawFiltered = insurances.filter(ins => {
      const insDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      const matchesDate = insDate >= reportDates.start && insDate <= reportDates.end;
      const matchesClient = reportClientId === 'All' || ins.clientId === reportClientId;
      return matchesDate && matchesClient;
    });
    const filtered = sortInsurances(rawFiltered, reportSortBy);

    const headers = [
      'Fecha de solicitud',
      'Tipo Acción',
      'Nombre',
      'Apellido',
      'Fecha Nac.',
      'Cód Origen',
      'Fecha Salida',
      'Cód Dest.',
      'Fecha Regreso',
      'Meses/Días',
      'Precio USD',
      'Descuento USD',
      'Comisión USD',
      'Precio Total USD'
    ];

    const rows = filtered.map(ins => [
      getRequestDateString(ins),
      ins.actionType || '',
      ins.firstName || '',
      ins.lastName || '',
      ins.birthDate || '',
      ins.originCountry || '',
      ins.startDate || '',
      ins.destinationCountry || '',
      ins.endDate || '',
      formatMonthsDays(ins.days || 0),
      (ins.totalPrice || 0).toFixed(2),
      (ins.discount || 0).toFixed(2),
      (ins.agentCommission || 0).toFixed(2),
      (ins.totalFinal || 0).toFixed(2)
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_altas_${reportDates.start}_a_${reportDates.end}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateCSVForToCollect = () => {
    const reportData = getFilteredReportData() as {
      filtered: InsuranceRequest[];
      totalSales: number;
      totalPaid: number;
      totalPending: number;
      totalDiscounts?: number;
      totalCommissions?: number;
      count: number;
    };
    const toCollect = reportData.filtered;

    const headers = [
      'Tipo Acción',
      'Nombre',
      'Apellido',
      'Fecha Nac.',
      'Cód Origen',
      'Fecha Salida',
      'Cód Dest.',
      'Fecha Regreso',
      'Meses/Días',
      'Precio USD',
      'Descuento USD',
      'Precio Total USD',
      'Comisión USD'
    ];

    const rows = toCollect.map(ins => [
      ins.actionType || '',
      ins.firstName || '',
      ins.lastName || '',
      ins.birthDate || '',
      ins.originCountry || '',
      ins.startDate || '',
      ins.destinationCountry || '',
      ins.endDate || '',
      formatMonthsDays(ins.days || 0),
      (ins.totalPrice || 0).toFixed(2),
      (ins.discount || 0).toFixed(2),
      (ins.totalFinal || 0).toFixed(2),
      (ins.agentCommission || 0).toFixed(2)
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_seguros_por_cobrar_${reportDates.start || 'inicio'}_a_${reportDates.end || 'hoy'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFilteredReportData = (
    liveInsurances?: InsuranceRequest[],
    livePayments?: Payment[],
    liveCaremedInvoices?: any[]
  ) => {
    const reportSource = (liveInsurances && liveInsurances.length > 0)
      ? liveInsurances
      : (liveReportInsurances.length > 0
        ? liveReportInsurances
        : (contextInsurances.length > 0 ? contextInsurances : insurances));
    const paymentsSource = (livePayments && livePayments.length > 0)
      ? livePayments
      : (liveReportPayments.length > 0
        ? liveReportPayments
        : (contextPayments.length > 0 ? contextPayments : payments));
    const caremedSource = (liveCaremedInvoices && liveCaremedInvoices.length > 0)
      ? liveCaremedInvoices
      : (liveReportCaremed.length > 0 ? liveReportCaremed : caremedInvoices);
    const rawFiltered = reportSource.filter(ins => {
      const insDate = getRequestDateString(ins) || getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt) || getNormalizedYYYYMMDD(ins.startDate);
      const matchesDate = (() => {
        if (!reportDates.start && !reportDates.end) return true;
        if (!insDate) return false;
        if (reportDates.start && reportDates.end) {
          return insDate >= reportDates.start && insDate <= reportDates.end;
        }
        if (reportDates.start) {
          return insDate >= reportDates.start;
        }
        if (reportDates.end) {
          return insDate <= reportDates.end;
        }
        return true;
      })();
      const matchesClient = reportClientId === 'All' || ins.clientId === reportClientId;
      return matchesDate && matchesClient;
    });

    const filtered = sortInsurances(rawFiltered, reportSortBy);

    if (reportType === 'altas') {
      const totalSales = filtered.reduce((acc, curr) => acc + getPolicySalesAmount(curr), 0);
      
      const getClientName = (clientId?: string) => {
        if (!clientId) return 'Individual/Otros';
        const c = clients.find(cl => cl.id === clientId);
        return c ? (c.commercialName || c.legalName || `${c.firstName} ${c.lastName}`) : 'Individual/Otros';
      };

      let groupedData: {
        title: string;
        items: {
          groupKey: string;
          groupName: string;
          count: number;
          total: number;
          insurances: InsuranceRequest[];
        }[];
      } = { title: '', items: [] };

      if (reportGrouping === 'all') {
        groupedData.title = 'Por Tipo de Cliente';
        const types: ClientType[] = ['Agent', 'Corporate', 'Individual'];
        const labelMap: Record<ClientType, string> = {
          Agent: 'Agentes',
          Corporate: 'Corporativos',
          Individual: 'Individuales'
        };
        groupedData.items = types.map(t => {
          const list = filtered.filter(ins => ins.clientType === t);
          return {
            groupKey: t,
            groupName: labelMap[t] || t,
            count: list.length,
            total: list.reduce((sum, i) => sum + getPolicySalesAmount(i), 0),
            insurances: list
          };
        });
      } else if (reportGrouping === 'policy') {
        groupedData.title = 'Por Tipo de Seguro';
        const groups: Record<string, InsuranceRequest[]> = {};
        filtered.forEach(ins => {
          const key = ins.policyName || ins.policyId || 'Sin Póliza';
          if (!groups[key]) groups[key] = [];
          groups[key].push(ins);
        });

        groupedData.items = Object.entries(groups).map(([policyName, list]) => {
          return {
            groupKey: policyName,
            groupName: policyName,
            count: list.length,
            total: list.reduce((sum, i) => sum + getPolicySalesAmount(i), 0),
            insurances: list
          };
        }).sort((a, b) => b.total - a.total);
      } else {
        const filteredByGroup = filtered.filter(ins => ins.clientType === reportGrouping);
        groupedData.title = reportGrouping === 'Agent' ? 'Por Agente' : reportGrouping === 'Corporate' ? 'Por Corporativo' : 'Por Individual';
        
        const groups: Record<string, InsuranceRequest[]> = {};
        filteredByGroup.forEach(ins => {
          const key = ins.clientId || 'Individual/Otros';
          if (!groups[key]) groups[key] = [];
          groups[key].push(ins);
        });

        groupedData.items = Object.entries(groups).map(([clientId, list]) => {
          const name = clientId === 'Individual/Otros' ? 'Individual/Otros' : getClientName(clientId);
          return {
            groupKey: clientId,
            groupName: name,
            count: list.length,
            total: list.reduce((sum, i) => sum + getPolicySalesAmount(i), 0),
            insurances: list
          };
        }).sort((a, b) => b.total - a.total);
      }

      return {
        filtered,
        totalSales,
        count: filtered.length,
        groupedData
      };
    } else if (reportType === 'to_collect') {
      const toCollect = filtered.filter(isPolicyDeudor);
      const totalSales = toCollect.reduce((acc, curr) => acc + getPolicyExpectedAmount(curr), 0);
      const totalPaid = toCollect.reduce((acc, curr) => acc + (curr.totalPaid || 0), 0);
      const totalPending = toCollect.reduce((acc, curr) => acc + getPolicyReceivableBalance(curr), 0);

      const getClientName = (clientId?: string) => {
        if (!clientId) return 'Individual/Otros';
        const c = clients.find(cl => cl.id === clientId);
        return c ? (c.commercialName || c.legalName || `${c.firstName} ${c.lastName}`) : 'Individual/Otros';
      };

      let groupedData: {
        title: string;
        items: {
          groupKey: string;
          groupName: string;
          count: number;
          total: number;
          totalPaid: number;
          totalPending: number;
          insurances: InsuranceRequest[];
        }[];
      } = { title: '', items: [] };

      if (reportGrouping === 'all') {
        groupedData.title = 'Por Tipo de Cliente';
        const types: ClientType[] = ['Agent', 'Corporate', 'Individual'];
        const labelMap: Record<ClientType, string> = {
          Agent: 'Agentes',
          Corporate: 'Corporativos',
          Individual: 'Individuales'
        };
        groupedData.items = types.map(t => {
          const list = toCollect.filter(ins => ins.clientType === t);
          const tTotal = list.reduce((sum, i) => sum + getPolicyExpectedAmount(i), 0);
          const tPaid = list.reduce((sum, i) => sum + (i.totalPaid || 0), 0);
          return {
            groupKey: t,
            groupName: labelMap[t] || t,
            count: list.length,
            total: tTotal,
            totalPaid: tPaid,
            totalPending: list.reduce((sum, i) => sum + getPolicyReceivableBalance(i), 0),
            insurances: list
          };
        });
      } else if (reportGrouping === 'policy') {
        groupedData.title = 'Por Tipo de Seguro';
        const groups: Record<string, InsuranceRequest[]> = {};
        toCollect.forEach(ins => {
          const key = ins.policyName || ins.policyId || 'Sin Póliza';
          if (!groups[key]) groups[key] = [];
          groups[key].push(ins);
        });

        groupedData.items = Object.entries(groups).map(([policyName, list]) => {
          const tTotal = list.reduce((sum, i) => sum + getPolicyExpectedAmount(i), 0);
          const tPaid = list.reduce((sum, i) => sum + (i.totalPaid || 0), 0);
          return {
            groupKey: policyName,
            groupName: policyName,
            count: list.length,
            total: tTotal,
            totalPaid: tPaid,
            totalPending: list.reduce((sum, i) => sum + getPolicyReceivableBalance(i), 0),
            insurances: list
          };
        }).sort((a, b) => b.totalPending - a.totalPending);
      } else {
        const filteredByGroup = toCollect.filter(ins => ins.clientType === reportGrouping);
        groupedData.title = reportGrouping === 'Agent' ? 'Por Agente' : reportGrouping === 'Corporate' ? 'Por Corporativo' : 'Por Individual';
        
        const groups: Record<string, InsuranceRequest[]> = {};
        filteredByGroup.forEach(ins => {
          const key = ins.clientId || 'Individual/Otros';
          if (!groups[key]) groups[key] = [];
          groups[key].push(ins);
        });

        groupedData.items = Object.entries(groups).map(([clientId, list]) => {
          const name = clientId === 'Individual/Otros' ? 'Individual/Otros' : getClientName(clientId);
          const tTotal = list.reduce((sum, i) => sum + getPolicyExpectedAmount(i), 0);
          const tPaid = list.reduce((sum, i) => sum + (i.totalPaid || 0), 0);
          return {
            groupKey: clientId,
            groupName: name,
            count: list.length,
            total: tTotal,
            totalPaid: tPaid,
            totalPending: list.reduce((sum, i) => sum + getPolicyReceivableBalance(i), 0),
            insurances: list
          };
        }).sort((a, b) => b.totalPending - a.totalPending);
      }

      groupedData.items = groupedData.items.filter(item => item.count > 0 && item.totalPending > 0.01);

      const totalDiscounts = toCollect.reduce((acc, curr) => acc + (curr.discount || 0), 0);
      const totalCommissions = toCollect.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

      return {
        filtered: toCollect,
        totalSales,
        totalPaid,
        totalPending,
        totalDiscounts,
        totalCommissions,
        count: toCollect.length,
        groupedData
      };
    } else if (reportType === 'to_pay') {
      const clientScoped = reportClientId === 'All'
        ? reportSource
        : reportSource.filter(ins => ins.clientId === reportClientId);
      const invoiceGroups = buildPayableInvoiceGroups(
        clientScoped,
        paymentsSource,
        caremedSource,
        reportDates.start,
        reportDates.end
      );
      const toPay = invoiceGroups.flatMap(g => g.insurances);
      const totalCost = invoiceGroups.reduce((acc, g) => acc + g.pendingAmount, 0);
      return {
        filtered: toPay,
        totalCost,
        count: invoiceGroups.length,
        invoiceGroups
      };
    } else if (reportType === 'commissions') {
      const totalSales = filtered.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      const totalCommissions = filtered.reduce((acc, curr) => acc + getPolicyCommissionAmount(curr), 0);
      const totalDiscounts = filtered.reduce((acc, curr) => acc + (curr.discount || 0), 0);
      return {
        filtered,
        totalSales,
        totalCommissions,
        totalDiscounts,
        count: filtered.length
      };
    } else if (reportType === 'income_statement') {
      const getPaymentDateStr = (pDate: any) => {
        if (!pDate) return '';
        if (typeof pDate === 'string') return pDate.split('T')[0];
        if (pDate.toDate) return pDate.toDate().toISOString().split('T')[0];
        if (pDate instanceof Date) return pDate.toISOString().split('T')[0];
        return '';
      };

      const rangeInsurances = reportSource.filter(ins => {
        const insDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
        return insDate >= reportDates.start && insDate <= reportDates.end;
      });

      const rangePayments = paymentsSource.filter(p => {
        const pDate = getPaymentDateStr(p.date);
        return pDate >= reportDates.start && pDate <= reportDates.end;
      });

      const grossIncome = rangeInsurances.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      
      const findCategoryId = (name: string) => categories.find(c => String(c.name || '').toLowerCase().includes(name.toLowerCase()))?.id;
      
      const catPagoServiciosId = findCategoryId('Pago Servicios') || findCategoryId('Servicios');
      const pagoServicios = rangePayments
        .filter(p => p.type === 'provider_payment' && (p.categoryId === catPagoServiciosId || String(p.notes || '').toLowerCase().includes('pago servicios')))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      const commissionAmount = rangeInsurances.reduce((acc, curr) => acc + (Number(curr.agentCommission) || 0), 0);
      const catGastosVentaId = findCategoryId('Gastos de Venta') || findCategoryId('Venta');
      const extraGastosVenta = rangePayments
        .filter(p => (p.type === 'agent_commission' || p.categoryId === catGastosVentaId) && !p.insuranceId)
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const totalGastosVenta = commissionAmount + extraGastosVenta;

      const catReembolsosId = findCategoryId('Reembolsos');
      const reembolsos = rangePayments
        .filter(p => p.categoryId === catReembolsosId || String(p.notes || '').toLowerCase().includes('reembolso'))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      const margenUtilidad = grossIncome - pagoServicios - totalGastosVenta - reembolsos;

      const findPaymentsByCat = (name: string) => {
        const id = findCategoryId(name);
        return rangePayments
          .filter(p => p.categoryId === id || String(p.notes || '').toLowerCase().includes(name.toLowerCase()))
          .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      };

      const gastosOperativos = findPaymentsByCat('Gastos Operativos') || findPaymentsByCat('Operativo');
      const gastosAdministrativos = findPaymentsByCat('Gastos Administrativos') || findPaymentsByCat('Administrativo');
      const sueldosSalarios = findPaymentsByCat('Sueldos') || findPaymentsByCat('Salarios') || findPaymentsByCat('Nomina');
      const otrosGastos = findPaymentsByCat('Otros Gastos');
      const subtotalGastos = gastosOperativos + gastosAdministrativos + sueldosSalarios + otrosGastos;

      const utilidadBruta = margenUtilidad - subtotalGastos;

      const impuestos = findPaymentsByCat('Impuestos') || findPaymentsByCat('SAT') || findPaymentsByCat('Tax');

      const utilidadNeta = utilidadBruta - impuestos;
      const rentabilidad = grossIncome > 0 ? (utilidadNeta / grossIncome) * 100 : 0;

      return {
        grossIncome,
        pagoServicios,
        totalGastosVenta,
        reembolsos,
        margenUtilidad,
        gastosOperativos,
        gastosAdministrativos,
        sueldosSalarios,
        otrosGastos,
        subtotalGastos,
        utilidadBruta,
        impuestos,
        utilidadNeta,
        rentabilidad
      };
    }

    return { filtered: [] };
  };

  const generatePDF = async () => {
    let liveIns = liveReportInsurances.length > 0 ? liveReportInsurances : (contextInsurances.length > 0 ? contextInsurances : insurances);
    let livePays = liveReportPayments.length > 0 ? liveReportPayments : (contextPayments.length > 0 ? contextPayments : payments);
    let liveInv = liveReportCaremed.length > 0 ? liveReportCaremed : caremedInvoices;
    try {
      const fresh = await fetchLiveMonthlyReportData();
      liveIns = fresh.insurances;
      livePays = fresh.payments;
      liveInv = fresh.caremedInvoices;
    } catch (error) {
      console.warn('No se pudo refrescar el reporte mensual en tiempo real:', error);
    }

    const isDetailed = (reportType === 'altas' || reportType === 'to_collect') && reportFormat === 'detailed';
    const doc = new jsPDF({
      orientation: isDetailed ? 'landscape' : 'portrait'
    });

    // Load active company logo image
    let loadedLogo: { url: string; width: number; height: number } | null = null;
    const logoUrl = companySettings?.logoUrl;
    if (logoUrl) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = logoUrl;
        await new Promise((resolve) => {
          img.onload = () => resolve(null);
          img.onerror = (e) => {
            console.error("Image load error in reports logo loader:", e);
            resolve(null);
          };
          if (img.complete) {
            resolve(null);
          }
        });

        if (img.width > 0 && img.height > 0) {
          const maxDim = 500;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            loadedLogo = {
              url: canvas.toDataURL('image/png'),
              width: w,
              height: h
            };
          }
        }
      } catch (error) {
        console.error('Error loading logo for reports:', error);
      }
    }

    const drawTopRightLogo = (pdfDoc: jsPDF, isLandscape: boolean = false) => {
      const pageMetrics = pdfDoc.internal.pageSize;
      const pageWidth = pageMetrics.width || (pdfDoc.internal.pageSize.getWidth ? pdfDoc.internal.pageSize.getWidth() : (isLandscape ? 297 : 210));
      const marginFromRight = 14;

      if (loadedLogo) {
        const ratio = loadedLogo.width / loadedLogo.height;
        const maxHeight = 14;
        const maxWidth = 45;
        let renderWidth = maxHeight * ratio;
        let renderHeight = maxHeight;

        if (renderWidth > maxWidth) {
          renderWidth = maxWidth;
          renderHeight = maxWidth / ratio;
        }

        const x = pageWidth - marginFromRight - renderWidth;
        const y = 10;
        pdfDoc.addImage(loadedLogo.url, 'PNG', x, y, renderWidth, renderHeight);
      } else {
        const scale = 0.8;
        const x = pageWidth - marginFromRight - 55;
        const y = 12;
        drawVectorLogo(pdfDoc, x, y, scale, false);
      }
    };

    const rawFiltered = liveIns.filter(ins => {
      const insDate = getRequestDateString(ins) || getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt) || getNormalizedYYYYMMDD(ins.startDate);
      const matchesDate = (() => {
        if (!reportDates.start && !reportDates.end) return true;
        if (!insDate) return false;
        if (reportDates.start && reportDates.end) {
          return insDate >= reportDates.start && insDate <= reportDates.end;
        }
        if (reportDates.start) {
          return insDate >= reportDates.start;
        }
        if (reportDates.end) {
          return insDate <= reportDates.end;
        }
        return true;
      })();
      const matchesClient = reportClientId === 'All' || ins.clientId === reportClientId;
      return matchesDate && matchesClient;
    });
    const filtered = sortInsurances(rawFiltered, reportSortBy);

    let title = '';
    let headers: string[] = [];
    let data: any[][] = [];

    if (reportType === 'altas') {
      const reportData = getFilteredReportData(liveIns, livePays, liveInv) as {
        filtered: InsuranceRequest[];
        totalSales: number;
        count: number;
        groupedData: {
          title: string;
          items: {
            groupKey: string;
            groupName: string;
            count: number;
            total: number;
            insurances: InsuranceRequest[];
          }[];
        };
      };

      const { totalSales, count, groupedData } = reportData;

      if (reportFormat === 'consolidated') {
        title = `Reporte Consolidado de Altas de Seguros (${groupedData.title})`;
        headers = ['Grupo / Cliente', 'Cantidad de Pólizas', 'Venta Total'];
        const bodyData = groupedData.items.map(item => [
          item.groupName,
          item.count.toString(),
          `$${item.total.toFixed(2)}`
        ]);

        bodyData.push([
          'TOTAL GENERAL',
          count.toString(),
          `$${totalSales.toFixed(2)}`
        ]);

        doc.setFontSize(16);
        doc.text(title, 14, 22);
        drawTopRightLogo(doc, false);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 42,
          head: [headers],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [147, 51, 234] }, // purple-600
          margin: { top: 45 },
        });
      } else {
        title = `Reporte Detallado de Altas de Seguros (${groupedData.title})`;
        
        doc.setFontSize(16);
        doc.text(title, 14, 22);
        drawTopRightLogo(doc, true);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        let currentY = 42;

        groupedData.items.forEach((group) => {
          if (group.insurances.length === 0) return;

          if (currentY > 150) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(17, 24, 39);
          doc.text(`${group.groupName} (${group.count} pólizas, Total: $${group.total.toFixed(2)})`, 14, currentY + 6);
          
          const groupHeaders = [
            'Fecha Sol.',
            'Tipo Acción',
            'Nombre',
            'Apellido',
            'Fecha Nac.',
            'Cód Origen',
            'Fecha Salida',
            'Cód Dest.',
            'Fecha Regreso',
            'Meses/Días',
            'Precio USD',
            'Descuento USD',
            'Comisión USD',
            'Precio Total USD'
          ];
          const groupBody = group.insurances.map(ins => [
            getRequestDateString(ins),
            ins.actionType || '',
            ins.firstName || '',
            ins.lastName || '',
            ins.birthDate || '',
            ins.originCountry || '',
            ins.startDate || '',
            ins.destinationCountry || '',
            ins.endDate || '',
            formatMonthsDays(ins.days || 0),
            `$${(ins.totalPrice || 0).toFixed(2)}`,
            `$${(ins.discount || 0).toFixed(2)}`,
            `$${(ins.agentCommission || 0).toFixed(2)}`,
            `$${(ins.totalFinal || 0).toFixed(2)}`
          ]);

          autoTable(doc, {
            startY: currentY + 10,
            head: [groupHeaders],
            body: groupBody,
            theme: 'striped',
            headStyles: { fillColor: [147, 51, 234] }, // purple-600
            styles: { fontSize: 7, cellPadding: 1.5 },
            margin: { top: 45, left: 14, right: 14 }
          });

          currentY = (doc as any).lastAutoTable.finalY + 10;
        });

        if (currentY > 165) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(17, 24, 39);
        doc.text(`VENTA TOTAL GENERAL: $${totalSales.toFixed(2)} (${count} Pólizas)`, 14, currentY + 8);
      }
    } else if (reportType === 'to_collect') {
      const reportData = getFilteredReportData(liveIns, livePays, liveInv) as {
        filtered: InsuranceRequest[];
        totalSales: number;
        totalPaid: number;
        totalPending: number;
        totalDiscounts?: number;
        totalCommissions?: number;
        count: number;
        groupedData: {
          title: string;
          items: {
            groupKey: string;
            groupName: string;
            count: number;
            total: number;
            totalPaid: number;
            totalPending: number;
            insurances: InsuranceRequest[];
          }[];
        };
      };

      const { totalSales, totalPaid, totalPending, totalDiscounts = 0, totalCommissions = 0, count, groupedData } = reportData;

      const selectedClient = reportClientId !== 'All' ? clients.find(cl => cl.id === reportClientId) : null;
      const clientName = selectedClient ? (selectedClient.commercialName || selectedClient.legalName || `${selectedClient.firstName} ${selectedClient.lastName}`) : '';

      const reportDayRate = exchangeRates[0]?.rate || 17.55;
      const totalSalesMXP = reportData.filtered.reduce((sum, ins) => sum + (ins.totalFinal || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);
      const totalDiscountsMXP = reportData.filtered.reduce((sum, ins) => sum + (ins.discount || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);
      const totalCommissionsMXP = reportData.filtered.reduce((sum, ins) => sum + (ins.agentCommission || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);

      // Draw Logo of Mi Seguro Internacional in top right
      const pageMetrics = doc.internal.pageSize;
      const pageWidth = pageMetrics.width || (doc.internal.pageSize.getWidth ? doc.internal.pageSize.getWidth() : 210);
      const pageHeight = pageMetrics.height || (doc.internal.pageSize.getHeight ? doc.internal.pageSize.getHeight() : 297);
      drawTopRightLogo(doc, isDetailed);

      const drawSummaryBlock = (pdfDoc: any, y: number) => {
        const pW = pdfDoc.internal.pageSize.width || (pdfDoc.internal.pageSize.getWidth ? pdfDoc.internal.pageSize.getWidth() : 210);
        const sW = pW - 28;
        const sH = 22;
        pdfDoc.setFillColor(249, 250, 251); // gray-50
        pdfDoc.setDrawColor(229, 231, 235); // gray-200
        pdfDoc.roundedRect(14, y, sW, sH, 3, 3, 'FD');

        const cW = sW / 4;

        // 1. Total de seguros
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(107, 114, 128); // gray-500
        pdfDoc.text("TOTAL DE SEGUROS", 14 + 6, y + 5);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(10);
        pdfDoc.setTextColor(17, 24, 39); // gray-900
        pdfDoc.text(`${count}`, 14 + 6, y + 11);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(79, 70, 229); // indigo-600
        pdfDoc.text(`T.C.: $${reportDayRate.toFixed(4)}`, 14 + 6, y + 17);

        // 2. Ventas Totales
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(107, 114, 128);
        pdfDoc.text("VENTAS TOTALES", 14 + cW + 6, y + 5);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(10);
        pdfDoc.setTextColor(17, 24, 39);
        pdfDoc.text(`$${totalSales.toFixed(2)} USD`, 14 + cW + 6, y + 11);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(16, 185, 129); // emerald-600
        pdfDoc.text(`$${totalSalesMXP.toFixed(2)} MXP`, 14 + cW + 6, y + 17);

        // 3. Descuentos Totales
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(107, 114, 128);
        pdfDoc.text("DESCUENTOS TOTALES", 14 + cW * 2 + 6, y + 5);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(10);
        pdfDoc.setTextColor(17, 24, 39);
        pdfDoc.text(`$${totalDiscounts.toFixed(2)} USD`, 14 + cW * 2 + 6, y + 11);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(239, 68, 68); // red-500
        pdfDoc.text(`$${totalDiscountsMXP.toFixed(2)} MXP`, 14 + cW * 2 + 6, y + 17);

        // 4. Comisiones Totales
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(107, 114, 128);
        pdfDoc.text("COMISIONES TOTALES", 14 + cW * 3 + 6, y + 5);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(10);
        pdfDoc.setTextColor(17, 24, 39);
        pdfDoc.text(`$${totalCommissions.toFixed(2)} USD`, 14 + cW * 3 + 6, y + 11);
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(217, 119, 6); // amber-600
        pdfDoc.text(`$${totalCommissionsMXP.toFixed(2)} MXP`, 14 + cW * 3 + 6, y + 17);
      };

      // Draw dynamic consolidation block at the start (under title / info)
      const summaryY = 38;
      drawSummaryBlock(doc, summaryY);

      if (reportFormat === 'consolidated') {
        title = `Reporte Consolidado de Seguros por Cobrar (${groupedData.title})`;
        headers = ['Grupo / Cliente', 'Cantidad de Pólizas', 'Saldo Deudor Total'];
        const bodyData = groupedData.items.map(item => [
          item.groupName,
          item.count.toString(),
          `$${item.totalPending.toFixed(2)}`
        ]);

        bodyData.push([
          'TOTAL GENERAL',
          count.toString(),
          `$${totalPending.toFixed(2)}`
        ]);

        doc.setFontSize(14);
        doc.text(title, 14, 20);
        doc.setFontSize(9);
        doc.setTextColor(100);
        if (selectedClient) {
          doc.text(`Agente/Corporativo: ${clientName}`, 14, 26);
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end} | Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 31);
        } else {
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end} | Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 29);
        }

        autoTable(doc, {
          startY: 68,
          head: [headers],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [225, 29, 72] }, // rose-600
          margin: { top: 45 },
        });

        const finalY = (doc as any).lastAutoTable.finalY + 10;
        if (finalY + 30 > pageHeight) {
          doc.addPage();
          drawSummaryBlock(doc, 20);
        } else {
          drawSummaryBlock(doc, finalY);
        }
      } else {
        title = `Reporte Detallado de Seguros por Cobrar (${groupedData.title})`;
        
        doc.setFontSize(14);
        doc.text(title, 14, 20);
        doc.setFontSize(9);
        doc.setTextColor(100);
        if (selectedClient) {
          doc.text(`Agente/Corporativo: ${clientName}`, 14, 26);
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end} | Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 31);
        } else {
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end} | Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 29);
        }

        let currentY = 68;

        groupedData.items.forEach((group) => {
          if (group.insurances.length === 0) return;

          if (currentY + 40 > pageHeight) {
            doc.addPage();
            currentY = 20;
          }

          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(17, 24, 39);
          doc.text(`${group.groupName} (${group.count} pólizas, Saldo Deudor: $${group.totalPending.toFixed(2)})`, 14, currentY + 6);
          
          const groupHeaders = [
            'Tipo Acción',
            'Nombre',
            'Apellido',
            'Fecha Nac.',
            'Cód Origen',
            'Fecha Salida',
            'Cód Dest.',
            'Fecha Regreso',
            'Meses/Días',
            'Precio USD',
            'Descuento USD',
            'Precio Total USD',
            'Comisión USD'
          ];
          const groupBody = group.insurances.map(ins => [
            ins.actionType || '',
            ins.firstName || '',
            ins.lastName || '',
            ins.birthDate || '',
            ins.originCountry || '',
            ins.startDate || '',
            ins.destinationCountry || '',
            ins.endDate || '',
            formatMonthsDays(ins.days || 0),
            `$${(ins.totalPrice || 0).toFixed(2)}`,
            `$${(ins.discount || 0).toFixed(2)}`,
            `$${(ins.totalFinal || 0).toFixed(2)}`,
            `$${(ins.agentCommission || 0).toFixed(2)}`
          ]);

          autoTable(doc, {
            startY: currentY + 10,
            head: [groupHeaders],
            body: groupBody,
            theme: 'striped',
            headStyles: { fillColor: [225, 29, 72] }, // rose-600
            styles: { fontSize: 7, cellPadding: 1.5 },
            margin: { top: 45, left: 14, right: 14 }
          });

          currentY = (doc as any).lastAutoTable.finalY + 10;
        });

        if (currentY + 35 > pageHeight) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(17, 24, 39);
        doc.text(`SALDO DEUDOR GENERAL: $${totalPending.toFixed(2)} / VENTA TOTAL GENERAL: $${totalSales.toFixed(2)} (${count} Pólizas)`, 14, currentY + 6);
        
        drawSummaryBlock(doc, currentY + 11);
      }
    } else if (reportType === 'to_pay') {
      title = 'Reporte de Seguros por Pagar (Proveedores)';
      const payData = getFilteredReportData(liveIns, livePays, liveInv) as {
        filtered: InsuranceRequest[];
        totalCost: number;
        count: number;
        invoiceGroups: PayableInvoiceGroup[];
      };
      const invoiceGroups = payData.invoiceGroups || [];
      const totalCostSum = payData.totalCost || 0;

      if (reportFormat === 'consolidated') {
        const bodyData = invoiceGroups.map(g => [
          g.invoice,
          g.count.toString(),
          `$${g.pendingAmount.toFixed(2)}`
        ]);

        bodyData.push([
          'TOTALES',
          invoiceGroups.reduce((acc, g) => acc + g.count, 0).toString(),
          `$${totalCostSum.toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text('Reporte Consolidado de Seguros por Pagar (Proveedores)', 14, 22);
        drawTopRightLogo(doc, false);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Invoice', 'Número de Seguros', 'Monto por Pagar']],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [5, 150, 105] }, // emerald-600
          margin: { top: 45 },
        });
      } else {
        headers = ['Invoice', 'Asegurado', 'Póliza', 'Fecha Invoice', 'Monto por Pagar'];
        data = invoiceGroups.flatMap(g =>
          g.insurances.map((ins, idx) => [
            g.invoice,
            `${ins.firstName} ${ins.lastName}`,
            ins.policyName || ins.policyId,
            g.invoiceDate || '',
            idx === 0 ? `$${g.pendingAmount.toFixed(2)}` : ''
          ])
        );

        data.push([
          'TOTALES',
          '',
          '',
          `${payData.count} invoices`,
          `$${totalCostSum.toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text(title, 14, 22);
        drawTopRightLogo(doc, false);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [headers],
          body: data,
          theme: 'striped',
          headStyles: { fillColor: [5, 150, 105] }, // emerald-600
          margin: { top: 45 },
        });
      }
    } else if (reportType === 'commissions') {
      const commData = getFilteredReportData(liveIns, livePays, liveInv) as {
        filtered: InsuranceRequest[];
        totalSales: number;
        totalCommissions: number;
        totalDiscounts: number;
        count: number;
      };
      const pending = commData.filtered;
      const totalInsurances = commData.count;
      const totalSales = commData.totalSales;
      const totalCommissions = commData.totalCommissions;
      const totalDiscounts = commData.totalDiscounts;

      const policyCounts: { [key: string]: number } = {};
      pending.forEach(ins => {
        const pName = ins.policyName || ins.policyId || 'Sin Póliza';
        policyCounts[pName] = (policyCounts[pName] || 0) + 1;
      });

      // Create landscape PDF to accommodate 18 columns!
      const landscapeDoc = new jsPDF('l', 'mm', 'a4');

      // Page 1: Executive Consolidated Summary
      landscapeDoc.setFontSize(20);
      landscapeDoc.text('Reporte de Comisiones Pendientes', 14, 22);
      drawTopRightLogo(landscapeDoc, true);
      landscapeDoc.setFontSize(11);
      landscapeDoc.setTextColor(100);
      landscapeDoc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
      landscapeDoc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

      // Section 1: Consolidado
      autoTable(landscapeDoc, {
        startY: 45,
        head: [['Consolidado de Comisiones Pendientes', 'Valor']],
        body: [
          ['Total de seguros', totalInsurances.toString()],
          ['Ventas Totales', `$${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`],
          ['Descuentos Totales', `$${totalDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`],
          ['Comisiones Totales', `$${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`],
        ],
        theme: 'grid',
        headStyles: { fillColor: [217, 119, 6] }, // amber-600
        styles: { fontSize: 10, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 50 } }
      });

      // Section 2: breakdown by policy type (number of insurances)
      autoTable(landscapeDoc, {
        startY: (landscapeDoc as any).lastAutoTable.finalY + 12,
        head: [['Tipo de Póliza', 'Número de Seguros']],
        body: Object.entries(policyCounts).map(([p, c]) => [p, c.toString()]),
        theme: 'grid',
        headStyles: { fillColor: [100, 100, 100] },
        styles: { fontSize: 10 },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 50 } }
      });

      // Page 2+: Detailed Table of those commissions matching the 18 columns in exact order
      landscapeDoc.addPage();
      landscapeDoc.setFontSize(16);
      landscapeDoc.setTextColor(0);
      landscapeDoc.text('Detalle de Comisiones Pendientes', 14, 20);
      drawTopRightLogo(landscapeDoc, true);
      landscapeDoc.setFontSize(9);
      landscapeDoc.setTextColor(100);
      landscapeDoc.text(`Página 2 - Listado de Registros`, 14, 26);

      const detailedHeaders = [
        'Fecha Sol.',
        'Tipo Accion',
        'Nombre',
        'Apellido',
        'F. Nac.',
        'Cód Origen',
        'F. Salida',
        'Cód Dest.',
        'F. Regreso',
        'Meses/Dias',
        'Prec. USD',
        'Desc. USD',
        'Com. USD',
        'Tot. USD',
        'T.C.',
        'Prec. MXP',
        'Desc. MXP',
        'Com. MXP',
        'Tot. MXP'
      ];

      const detailedRows = pending.map(ins => {
        const tc = getExchangeRateForRequestDate(ins, exchangeRates);
        const precioUSD = ins.totalPrice || 0;
        const descuentoUSD = ins.discount || 0;
        const comisionUSD = getPolicyCommissionAmount(ins);
        const totalUSD = ins.totalFinal || 0;

        const precioMXP = precioUSD * tc;
        const descuentoMXP = descuentoUSD * tc;
        const comisionMXP = comisionUSD * tc;
        const totalMXP = totalUSD * tc;

        const durationStr = formatMonthsDays(ins.days || 0);
        const reqDateStr = getRequestDateString(ins);

        return [
          reqDateStr,
          ins.actionType || '',
          ins.firstName || '',
          ins.lastName || '',
          ins.birthDate || '',
          ins.originCountry || '',
          ins.startDate || '',
          ins.destinationCountry || '',
          ins.endDate || '',
          durationStr,
          `$${precioUSD.toFixed(2)}`,
          `$${descuentoUSD.toFixed(2)}`,
          `$${comisionUSD.toFixed(2)}`,
          `$${totalUSD.toFixed(2)}`,
          tc.toFixed(4),
          `$${precioMXP.toFixed(2)}`,
          `$${descuentoMXP.toFixed(2)}`,
          `$${comisionMXP.toFixed(2)}`,
          `$${totalMXP.toFixed(2)}`
        ];
      });

      // Compute overall sums for detailed table footer
      const sumPrecioUSD = pending.reduce((acc, curr) => acc + (curr.totalPrice || 0), 0);
      const sumDescuentoUSD = pending.reduce((acc, curr) => acc + (curr.discount || 0), 0);
      const sumComisionUSD = pending.reduce((acc, curr) => acc + getPolicyCommissionAmount(curr), 0);
      const sumTotalUSD = pending.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);

      const sumPrecioMXP = pending.reduce((acc, curr) => acc + ((curr.totalPrice || 0) * getExchangeRateForRequestDate(curr, exchangeRates)), 0);
      const sumDescuentoMXP = pending.reduce((acc, curr) => acc + ((curr.discount || 0) * getExchangeRateForRequestDate(curr, exchangeRates)), 0);
      const sumComisionMXP = pending.reduce((acc, curr) => acc + (getPolicyCommissionAmount(curr) * getExchangeRateForRequestDate(curr, exchangeRates)), 0);
      const sumTotalMXP = pending.reduce((acc, curr) => acc + ((curr.totalFinal || 0) * getExchangeRateForRequestDate(curr, exchangeRates)), 0);

      detailedRows.push([
        'TOTALES',
        '', '', '', '', '', '', '', '', '',
        `$${sumPrecioUSD.toFixed(2)}`,
        `$${sumDescuentoUSD.toFixed(2)}`,
        `$${sumComisionUSD.toFixed(2)}`,
        `$${sumTotalUSD.toFixed(2)}`,
        '',
        `$${sumPrecioMXP.toFixed(2)}`,
        `$${sumDescuentoMXP.toFixed(2)}`,
        `$${sumComisionMXP.toFixed(2)}`,
        `$${sumTotalMXP.toFixed(2)}`
      ]);

      autoTable(landscapeDoc, {
        startY: 32,
        head: [detailedHeaders],
        body: detailedRows,
        theme: 'striped',
        headStyles: { fillColor: [217, 119, 6] }, // amber-600
        styles: { fontSize: 6.5, cellPadding: 1.5 },
        margin: { top: 32 },
      });

      landscapeDoc.save(`reporte_comisiones_${reportDates.start}_${reportDates.end}.pdf`);
      setShowReportModal(false);
      return;
    } else if (reportType === 'income_statement') {
      title = 'Estado de Resultados';
      
      // Helper to get date string from payment date
      const getPaymentDateStr = (pDate: any) => {
        if (!pDate) return '';
        if (typeof pDate === 'string') return pDate.split('T')[0];
        if (pDate.toDate) return pDate.toDate().toISOString().split('T')[0];
        if (pDate instanceof Date) return pDate.toISOString().split('T')[0];
        return '';
      };

      // Filter insurances in range
      const rangeInsurances = liveIns.filter(ins => {
        const insDate = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '');
        return insDate >= reportDates.start && insDate <= reportDates.end;
      });

      // Filter payments in range
      const rangePayments = livePays.filter(p => {
        const pDate = getPaymentDateStr(p.date);
        return pDate >= reportDates.start && pDate <= reportDates.end;
      });

      // 1. Ingresos y Costos Directos
      const grossIncome = rangeInsurances.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      
      // We need to identify categories by name since we don't have static IDs
      const findCategoryId = (name: string) => categories.find(c => String(c.name || '').toLowerCase().includes(name.toLowerCase()))?.id;
      
      // Pago Servicios
      const catPagoServiciosId = findCategoryId('Pago Servicios') || findCategoryId('Servicios');
      const pagoServicios = rangePayments
        .filter(p => p.type === 'provider_payment' && (p.categoryId === catPagoServiciosId || String(p.notes || '').toLowerCase().includes('pago servicios')))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      // Gastos de Venta (Commissions)
      const commissionAmount = rangeInsurances.reduce((acc, curr) => acc + (Number(curr.agentCommission) || 0), 0);
      const catGastosVentaId = findCategoryId('Gastos de Venta') || findCategoryId('Venta');
      const extraGastosVenta = rangePayments
        .filter(p => (p.type === 'agent_commission' || p.categoryId === catGastosVentaId) && !p.insuranceId) // Avoid double counting if linked to insurance
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const totalGastosVenta = commissionAmount + extraGastosVenta;

      // Reembolsos
      const catReembolsosId = findCategoryId('Reembolsos');
      const reembolsos = rangePayments
        .filter(p => p.categoryId === catReembolsosId || String(p.notes || '').toLowerCase().includes('reembolso'))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      const margenUtilidad = grossIncome - pagoServicios - totalGastosVenta - reembolsos;

      // 2. Gastos Generales
      const findPaymentsByCat = (name: string) => {
        const id = findCategoryId(name);
        return rangePayments
          .filter(p => p.categoryId === id || String(p.notes || '').toLowerCase().includes(name.toLowerCase()))
          .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      };

      const gastosOperativos = findPaymentsByCat('Gastos Operativos') || findPaymentsByCat('Operativo');
      const gastosAdministrativos = findPaymentsByCat('Gastos Administrativos') || findPaymentsByCat('Administrativo');
      const sueldosSalarios = findPaymentsByCat('Sueldos') || findPaymentsByCat('Salarios') || findPaymentsByCat('Nomina');
      const otrosGastos = findPaymentsByCat('Otros Gastos');
      const subtotalGastos = gastosOperativos + gastosAdministrativos + sueldosSalarios + otrosGastos;

      const utilidadBruta = margenUtilidad - subtotalGastos;

      // 3. Impuestos
      const impuestos = findPaymentsByCat('Impuestos') || findPaymentsByCat('SAT') || findPaymentsByCat('Tax');

      const utilidadNeta = utilidadBruta - impuestos;
      const rentabilidad = grossIncome > 0 ? (utilidadNeta / grossIncome) * 100 : 0;

      // PDF Rendering
      doc.setFontSize(18);
      doc.text(title, 14, 22);
      drawTopRightLogo(doc, false);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
      doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

      const tableBody: any[][] = [
        [{ content: 'Ingresos y Costos Directos', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }],
        ['+ Ingresos', `$${grossIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Pago Servicios', `$${pagoServicios.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Gastos de Venta', `$${totalGastosVenta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Reembolsos', `$${reembolsos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        [{ content: '= Margen Utilidad', styles: { fontStyle: 'bold' } }, { content: `$${margenUtilidad.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { fontStyle: 'bold' } }],
        
        ['', ''], // Spacer
        
        [{ content: 'Gastos Generales', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }],
        ['- Gastos Operativos', `$${gastosOperativos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Gastos Administrativos', `$${gastosAdministrativos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Sueldos y salarios', `$${sueldosSalarios.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Otros Gastos', `$${otrosGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        [{ content: '= Subtotal Gastos', styles: { fontStyle: 'bold' } }, { content: `$${subtotalGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { fontStyle: 'bold' } }],
        
        ['', ''], // Spacer

        ['+ Margen de Utilidad', `$${margenUtilidad.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['- Subtotal Gastos', `$${subtotalGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        [{ content: '= Utilidad Bruta', styles: { fontStyle: 'bold' } }, { content: `$${utilidadBruta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { fontStyle: 'bold' } }],
        
        ['', ''], // Spacer

        ['- Impuestos', `$${impuestos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        
        ['', ''], // Spacer

        [{ content: '= Utilidad Neta', styles: { fontStyle: 'bold', fillColor: [37, 99, 235], textColor: [255, 255, 255] } }, { content: `$${utilidadNeta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { fontStyle: 'bold', fillColor: [37, 99, 235], textColor: [255, 255, 255] } }],
        [{ content: '% rentabilidad sobre ingresos', styles: { fontStyle: 'italic', textColor: [100, 100, 100] } }, { content: `${rentabilidad.toFixed(2)}%`, styles: { fontStyle: 'italic', textColor: [100, 100, 100] } }],
      ];

      autoTable(doc, {
        startY: 45,
        body: tableBody,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: { 
          0: { cellWidth: 100 }, 
          1: { cellWidth: 50, halign: 'right' } 
        },
      });
    }

    doc.save(`${reportType}_${reportDates.start}_${reportDates.end}.pdf`);
    setShowReportModal(false);
  };

  const applyQuickReport = (type: 'today' | 'commissions' | 'to_pay' | 'to_collect') => {
    // Reset filters first
    setClientTypeFilter('All');
    setClientIdFilter('All');
    setPlanTypeFilter('All');
    setPolicyNameFilter('All');
    setStartDateFilter('');
    setEndDateFilter('');
    setCommissionStatusFilter('All');
    setPaymentStatusFilter('All');

    const today = new Date().toISOString().split('T')[0];
    if (type === 'today') {
      setStartDateFilter(today);
      setEndDateFilter(today);
    } else if (type === 'commissions') {
      setCommissionStatusFilter('confirmed');
    } else if (type === 'to_collect') {
      setPaymentStatusFilter('pending');
    } else if (type === 'to_pay') {
      setProviderPaymentStatusFilter('pending');
      setPaymentStatusFilter('paid');
    }
  };

  const handleBulkPayment = async () => {
    if (selectedIds.length === 0) return;
    setProcessing(true);
    try {
      const promises = selectedIds.map(id => 
        updateDoc(doc(db, 'insurances', id), {
          providerPaymentStatus: 'paid',
          providerPaymentDate: paymentForm.date,
          providerPaymentMethod: paymentForm.method,
          providerPaymentReceipt: paymentForm.receipt
        })
      );
      await Promise.all(promises);
      
      // Update local state
      setInsurances(prev => prev.map(ins => 
        selectedIds.includes(ins.id!) 
          ? { 
              ...ins, 
              providerPaymentStatus: 'paid',
              providerPaymentDate: paymentForm.date,
              providerPaymentMethod: paymentForm.method,
              providerPaymentReceipt: paymentForm.receipt
            } 
          : ins
      ));
      
      setSelectedIds([]);
      setShowPaymentModal(false);
      setPaymentForm({
        date: new Date().toISOString().split('T')[0],
        method: 'Transferencia',
        receipt: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'bulk provider payment');
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredInsurances.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredInsurances.map(ins => ins.id!));
    }
  };

  const totalToPaySelected = filteredInsurances
    .filter(ins => selectedIds.includes(ins.id!))
    .reduce((acc, curr) => acc + (curr.totalCost || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {limitToCurrentMonth && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-l-4 border-amber-500 p-4 rounded-r-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 animate-in fade-in duration-500">
          <div className="flex gap-3">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-950">
                Visualizando Mes Actual Solamente
              </p>
              <p className="text-xs text-amber-700">
                Para optimizar la velocidad y el consumo de base de datos, solo se han cargado los datos del mes en curso. Si deseas ver reportes de periodos anteriores, activa el historial completo o simplemente selecciona una fecha de inicio anterior.
              </p>
            </div>
          </div>
          <button
            onClick={() => setLimitToCurrentMonth(false)}
            className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all whitespace-nowrap"
          >
            Activar Historial Completo
          </button>
        </div>
      )}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes y Estadísticas</h1>
          <p className="text-gray-500">Visualiza el rendimiento y genera informes detallados</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {selectedIds.length > 0 && (
            <button 
              onClick={() => setShowPaymentModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100 animate-in fade-in slide-in-from-right-4"
            >
              <CreditCard className="w-4 h-4" />
              Pagar Seleccionados ({selectedIds.length})
            </button>
          )}

          <button 
            onClick={() => {
              setLimitToCurrentMonth(false);
              setShowMonthlyClosingModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-indigo-200 cursor-pointer"
            title="Generar auditoría y PDF de Cierre de Mes"
          >
            <CalendarCheck className="w-4 h-4" />
            Cierre de Mes
          </button>

          <button 
            onClick={() => {
              setLimitToCurrentMonth(false);
              setShowMonthlyReportModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-slate-800 hover:from-blue-700 hover:to-slate-900 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-blue-200 cursor-pointer"
            title="Generar reporte mensual consolidado (números finales)"
          >
            <BarChart3 className="w-4 h-4" />
            Reporte Mensual
          </button>

          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 font-bold text-sm rounded-xl border border-gray-200 transition-all shadow-sm cursor-pointer"
          >
            <Download className="w-4 h-4 text-gray-500" />
            Exportar CSV
          </button>
        </div>
      </header>

      {/* Filters Section */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
        <div className="flex items-center gap-2 text-gray-900 font-bold mb-2">
          <Filter className="w-5 h-5 text-blue-600" />
          <h2>Filtros de Reporte</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Cliente</label>
            <select 
              value={clientTypeFilter}
              onChange={(e) => setClientTypeFilter(e.target.value as any)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos los tipos</option>
              <option value="Individual">Individual</option>
              <option value="Agent">Agencia</option>
              <option value="Corporate">Empresa</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Cliente / Agencia</label>
            <select 
              value={clientIdFilter}
              onChange={(e) => setClientIdFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos los clientes</option>
              {[...clients].sort((a, b) => {
                const nameA = (a.commercialName || a.legalName || `${a.firstName} ${a.lastName}`).trim().toLowerCase();
                const nameB = (b.commercialName || b.legalName || `${b.firstName} ${b.lastName}`).trim().toLowerCase();
                return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
              }).map(c => (
                <option key={c.id} value={c.id}>{c.commercialName || c.legalName || `${c.firstName} ${c.lastName}`}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Plan</label>
            <select 
              value={planTypeFilter}
              onChange={(e) => setPlanTypeFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos los planes</option>
              {uniquePlans.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Tipo de Póliza</label>
            <select 
              value={policyNameFilter}
              onChange={(e) => setPolicyNameFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todas las pólizas</option>
              {uniquePolicies.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha Inicio</label>
            <input 
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Fecha Fin</label>
            <input 
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Estado Pago</label>
            <select 
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="partially_paid">Pago Parcial</option>
              <option value="paid">Pagado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Pago a Proveedor</label>
            <select 
              value={providerPaymentStatusFilter}
              onChange={(e) => setProviderPaymentStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos</option>
              <option value="pending">Pendiente de Pago</option>
              <option value="paid">Pagado a Proveedor</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Estado Comisión</label>
            <select 
              value={commissionStatusFilter}
              onChange={(e) => setCommissionStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
            >
              <option value="All">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="confirmed">Confirmada</option>
              <option value="paid">Pagada</option>
            </select>
          </div>

          <div className="flex items-end">
            <button 
              onClick={() => {
                setClientTypeFilter('All');
                setClientIdFilter('All');
                setPlanTypeFilter('All');
                setPolicyNameFilter('All');
                setStartDateFilter('');
                setEndDateFilter('');
                setCommissionStatusFilter('All');
                setPaymentStatusFilter('All');
              }}
              className="w-full px-4 py-2.5 text-gray-500 font-bold text-sm hover:bg-gray-50 rounded-xl transition-all"
            >
              Limpiar Filtros
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-bold text-gray-900">Total Seguros</h3>
          </div>
          <p className="text-xl font-black text-gray-900">{stats.count} registros</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            En el rango seleccionado
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 rounded-xl">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-bold text-gray-900">Ventas (Filtro)</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            Total bruto
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-50 rounded-xl">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="font-bold text-gray-900">Ventas del Día</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.todaySales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            {new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 rounded-xl">
              <ArrowUpRight className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-bold text-gray-900">Seguros por Pagar</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.pendingToProvider.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            A proveedores
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-violet-50 rounded-xl">
              <BarChart3 className="w-5 h-5 text-violet-600" />
            </div>
            <h3 className="font-bold text-gray-900">Margen Total</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.totalMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            Utilidad bruta
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-50 rounded-xl">
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="font-bold text-gray-900">Comisiones Pend.</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.pendingCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            Por pagar agentes
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-rose-50 rounded-xl">
              <Clock className="w-5 h-5 text-rose-600" />
            </div>
            <h3 className="font-bold text-gray-900">Seguros por Cobrar</h3>
          </div>
          <p className="text-xl font-black text-gray-900">${stats.pendingPayments.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter mt-1">
            Saldos clientes
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">Resultados del Reporte</h3>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
              {filteredInsurances.length} registros
            </span>
          </div>
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 w-10">
                    <input 
                      type="checkbox" 
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedIds.length === filteredInsurances.length && filteredInsurances.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-6 py-4">Cliente</th>
                  <th className="px-6 py-4">Plan / Póliza</th>
                  <th className="px-6 py-4">Fecha</th>
                  <th className="px-6 py-4 text-right">Costo</th>
                  <th className="px-6 py-4 text-right">Total</th>
                  <th className="px-6 py-4 text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedInsurances.map((ins, i) => (
                  <tr key={i} className={`hover:bg-gray-50/50 transition-colors ${selectedIds.includes(ins.id!) ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-6 py-4">
                      <input 
                        type="checkbox" 
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedIds.includes(ins.id!)}
                        onChange={() => toggleSelection(ins.id!)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-gray-900">{ins.firstName} {ins.lastName}</p>
                      <p className="text-[10px] text-gray-400 font-medium">{ins.clientType}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-700 font-medium">{ins.plan}</p>
                      <p className="text-[10px] text-gray-400">{ins.policyName}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {ins.createdAt?.toDate ? ins.createdAt.toDate().toLocaleDateString() : 'S/F'}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-rose-600">
                      ${(ins.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-black text-gray-900">
                      ${(ins.totalFinal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">
                      ${((ins.totalFinal || 0) - (ins.totalCost || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {filteredInsurances.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50 px-6 py-4 border-t border-gray-100">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="text-sm text-gray-500">
                  Mostrando <span className="font-bold text-gray-900">{filteredInsurances.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(currentPage * pageSize, filteredInsurances.length)}</span> de <span className="font-bold text-gray-900">{filteredInsurances.length}</span> registros
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
                        className={`min-w-[32px] h-8 rounded-lg text-xs font-bold transition-all ${
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

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-50 rounded-xl">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
            </div>
            <h3 className="font-bold text-gray-900">Reportes Rápidos</h3>
          </div>
          <div className="space-y-3">
            <button 
              onClick={() => {
                setLimitToCurrentMonth(false);
                setShowMonthlyClosingModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-indigo-50/70 hover:bg-indigo-100/70 rounded-2xl transition-all group border border-indigo-200/80 shadow-sm cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <CalendarCheck className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold text-indigo-950">Cierre de Mes</div>
                  <div className="text-[10px] text-indigo-600 font-medium">Exportaciones, Invoices y Facturas SAT</div>
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-indigo-400 group-hover:text-indigo-700 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setLimitToCurrentMonth(false);
                setShowMonthlyReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-blue-50/70 hover:bg-blue-100/70 rounded-2xl transition-all group border border-blue-200/80 shadow-sm cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center shadow-sm">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold text-blue-950">Reporte Mensual</div>
                  <div className="text-[10px] text-blue-600 font-medium">Consolidado final (Canal, CxC, CxP, Comisiones)</div>
                </div>
              </div>
              <ArrowUpRight className="w-4 h-4 text-blue-400 group-hover:text-blue-700 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setReportType('income_statement');
                setReportFormat('detailed');
                setShowReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-blue-50 rounded-2xl transition-all group border border-transparent hover:border-blue-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-sm font-bold text-gray-700">Estado de Resultados</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setReportType('altas');
                setReportFormat('detailed');
                setShowReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-purple-50 rounded-2xl transition-all group border border-transparent hover:border-purple-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <FileText className="w-4 h-4 text-purple-600" />
                </div>
                <span className="text-sm font-bold text-gray-700">Altas Seguros</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-purple-600 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setReportType('to_collect');
                setReportFormat('detailed');
                setShowReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-rose-50 rounded-2xl transition-all group border border-transparent hover:border-rose-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <Clock className="w-4 h-4 text-rose-600" />
                </div>
                <span className="text-sm font-bold text-gray-700">Seguros por Cobrar</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-rose-600 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setReportType('to_pay');
                setReportFormat('detailed');
                setShowReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-emerald-50 rounded-2xl transition-all group border border-transparent hover:border-emerald-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-sm font-bold text-gray-700">Seguros por Pagar</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-600 transition-colors" />
            </button>

            <button 
              onClick={() => {
                setReportType('commissions');
                setReportFormat('detailed');
                setShowReportModal(true);
              }}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-amber-50 rounded-2xl transition-all group border border-transparent hover:border-amber-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                </div>
                <span className="text-sm font-bold text-gray-700">Comisiones Pendientes</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-amber-600 transition-colors" />
            </button>
          </div>

          <div className="mt-8 p-4 bg-blue-600 rounded-2xl text-white">
            <h4 className="font-bold mb-1">Tip de Reportes</h4>
            <p className="text-[10px] opacity-80 leading-relaxed">
              Utiliza los filtros superiores para refinar los resultados. Puedes exportar cualquier vista filtrada a formato CSV para análisis externo.
            </p>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-gray-50">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-50 rounded-2xl">
                    <CreditCard className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 tracking-tight">Pagar a Proveedor</h2>
                    <p className="text-sm text-gray-500 font-medium">{selectedIds.length} seguros seleccionados</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPaymentModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 mb-8">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Total a Pagar</p>
                <p className="text-3xl font-black text-emerald-700">${totalToPaySelected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-bold opacity-60">USD</span></p>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Fecha de Pago</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input 
                      type="date"
                      value={paymentForm.date}
                      onChange={(e) => setPaymentForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Forma de Pago</label>
                  <select 
                    value={paymentForm.method}
                    onChange={(e) => setPaymentForm(prev => ({ ...prev, method: e.target.value }))}
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-medium appearance-none"
                  >
                    <option value="Transferencia">Transferencia</option>
                    <option value="Tarjeta">Tarjeta</option>
                    <option value="Efectivo">Efectivo</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Descuento comision">Descuento comisión</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Comprobante / Referencia</label>
                  <input 
                    type="text"
                    placeholder="Número de rastreo o referencia"
                    value={paymentForm.receipt}
                    onChange={(e) => setPaymentForm(prev => ({ ...prev, receipt: e.target.value }))}
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="p-8 bg-gray-50/50 flex gap-3">
              <button 
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 px-6 py-4 bg-white text-gray-500 font-bold rounded-2xl hover:bg-gray-100 transition-all border border-gray-200"
              >
                Cancelar
              </button>
              <button 
                onClick={handleBulkPayment}
                disabled={processing}
                className="flex-1 px-6 py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {processing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Check className="w-5 h-5" />
                    Confirmar Pago
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Reports Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] w-full max-w-5xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${
                    reportType === 'altas' ? 'bg-purple-50' :
                    reportType === 'to_collect' ? 'bg-rose-50' :
                    reportType === 'to_pay' ? 'bg-emerald-50' : 
                    reportType === 'income_statement' ? 'bg-blue-50' : 'bg-amber-50'
                  }`}>
                    <FileText className={`w-6 h-6 ${
                      reportType === 'altas' ? 'text-purple-600' :
                      reportType === 'to_collect' ? 'text-rose-600' :
                      reportType === 'to_pay' ? 'text-emerald-600' : 
                      reportType === 'income_statement' ? 'text-blue-600' : 'text-amber-600'
                    }`} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-gray-900 tracking-tight">
                      {reportType === 'altas' ? 'Reporte Altas Seguros' :
                       reportType === 'to_collect' ? 'Reporte Seguros por Cobrar' :
                       reportType === 'to_pay' ? 'Reporte Seguros por Pagar' : 
                       reportType === 'income_statement' ? 'Estado de Resultados' : 'Reporte Comisiones Pendientes'}
                    </h2>
                    <p className="text-sm text-gray-500 font-medium">Visualiza los datos del reporte en tiempo real y expórtalos</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowReportModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Controls */}
                <div className="space-y-5 lg:border-r lg:border-gray-100 lg:pr-8">
                  <h3 className="text-xs font-black text-gray-400 tracking-widest uppercase mb-1">Configuración</h3>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Fecha Inicio</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="date"
                        value={reportDates.start}
                        onChange={(e) => setReportDates(prev => ({ ...prev, start: e.target.value }))}
                        className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Fecha Fin</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="date"
                        value={reportDates.end}
                        onChange={(e) => setReportDates(prev => ({ ...prev, end: e.target.value }))}
                        className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium"
                      />
                    </div>
                  </div>

                  {/* Quick Date Presets */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setReportDates({ start: format(new Date(), 'yyyy-MM-01'), end: format(new Date(), 'yyyy-MM-dd') })}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
                    >
                      Este Mes
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportDates({ start: format(subDays(new Date(), 90), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') })}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
                    >
                      Últimos 90 Días
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportDates({ start: format(new Date(), 'yyyy-01-01'), end: format(new Date(), 'yyyy-MM-dd') })}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
                    >
                      Año Actual
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportDates({ start: '', end: '' })}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
                    >
                      Todo
                    </button>
                  </div>

                  {(reportType === 'to_collect' || reportType === 'commissions') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Agente / Corporativo</label>
                      <select 
                        value={reportClientId}
                        onChange={(e) => setReportClientId(e.target.value)}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                      >
                        <option value="All">Todos los agentes/corporativos</option>
                        {clients
                          .filter(c => c.type === 'Agent' || c.type === 'Corporate')
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

                  {(reportType === 'altas' || reportType === 'to_collect') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Agrupar por</label>
                      <select 
                        value={reportGrouping}
                        onChange={(e) => setReportGrouping(e.target.value as 'all' | 'Agent' | 'Corporate' | 'Individual' | 'policy')}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                      >
                        <option value="all">Tipo de Cliente (Agente, Corporativo o Individual)</option>
                        <option value="Agent">Por Agente</option>
                        <option value="policy">Por Tipo de Seguro (Póliza)</option>
                        <option value="Corporate">Por Corporativos</option>
                        <option value="Individual">Por Individuales</option>
                      </select>
                    </div>
                  )}

                  {(reportType === 'altas' || reportType === 'to_collect' || reportType === 'to_pay' || reportType === 'commissions') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Formato de Reporte</label>
                      <select 
                        value={reportFormat}
                        onChange={(e) => setReportFormat(e.target.value as 'detailed' | 'consolidated')}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                      >
                        <option value="detailed">Detallado (Estándar)</option>
                        <option value="consolidated">Consolidado (Resumen)</option>
                      </select>
                    </div>
                  )}

                  {(reportType === 'altas' || reportType === 'to_collect' || reportType === 'to_pay' || reportType === 'commissions') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 ml-1">Ordenar por</label>
                      <select 
                        value={reportSortBy}
                        onChange={(e) => setReportSortBy(e.target.value as 'requestDate' | 'name' | 'startDate')}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium appearance-none"
                      >
                        <option value="requestDate">Fecha de Solicitud</option>
                        <option value="name">Nombre de Asegurado</option>
                        <option value="startDate">Fecha de Inicio de Vigencia</option>
                      </select>
                    </div>
                  )}

                  <div className="pt-4 flex flex-col gap-3">
                    <button 
                      onClick={generatePDF}
                      className={`w-full px-6 py-4 text-white font-bold rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 ${
                        reportType === 'altas' ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-100' :
                        reportType === 'to_collect' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-100' :
                        reportType === 'to_pay' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' :
                        reportType === 'income_statement' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100' :
                        'bg-amber-600 hover:bg-amber-700 shadow-amber-100'
                      }`}
                    >
                      <Download className="w-5 h-5" />
                      Exportar a PDF
                    </button>
                    {reportType === 'altas' && (
                      <button 
                        onClick={generateCSVForAltas}
                        className="w-full px-6 py-4 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 border border-purple-200"
                      >
                        <FileSpreadsheet className="w-5 h-5" />
                        Exportar a CSV
                      </button>
                    )}
                    {reportType === 'to_collect' && (
                      <button 
                        onClick={generateCSVForToCollect}
                        className="w-full px-6 py-4 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 border border-rose-200"
                      >
                        <FileSpreadsheet className="w-5 h-5" />
                        Exportar a CSV
                      </button>
                    )}
                    <button 
                      onClick={() => setShowReportModal(false)}
                      className="w-full px-6 py-3 bg-white text-gray-500 font-bold rounded-xl hover:bg-gray-100 transition-all border border-gray-200 text-sm"
                    >
                      Cerrar diálogo
                    </button>
                  </div>
                </div>

                {/* Right Column: Dynamic Live Preview */}
                <div className="col-span-1 lg:col-span-2 flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Vista Previa</h3>
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-black uppercase tracking-wider">Muestra en Vivo</span>
                  </div>

                  <div className="border border-gray-100 rounded-3xl p-6 bg-gray-50/50 max-h-[440px] overflow-y-auto">
                    {(() => {
                      const data = getFilteredReportData();
                      
                      if (reportType === 'altas') {
                        const { filtered, totalSales, count, groupedData } = data as {
                          filtered: InsuranceRequest[];
                          totalSales: number;
                          count: number;
                          groupedData: {
                            title: string;
                            items: {
                              groupKey: string;
                              groupName: string;
                              count: number;
                              total: number;
                              insurances: InsuranceRequest[];
                            }[];
                          };
                        };

                        return (
                          <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Total de Altas</p>
                                <p className="text-xl font-black text-purple-600 mt-1">{count}</p>
                              </div>
                              <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase font-bold">Venta Total</p>
                                <p className="text-xl font-black text-gray-900 mt-1">${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            {reportFormat === 'consolidated' ? (
                              <div className="space-y-4">
                                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Resumen Consolidado ({groupedData.title})</h4>
                                <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider pb-2">
                                        <th className="pb-2">Grupo / Cliente</th>
                                        <th className="pb-2 text-center">Pólizas</th>
                                        <th className="pb-2 text-right">Venta Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-xs">
                                      {groupedData.items.length === 0 ? (
                                        <tr>
                                          <td colSpan={3} className="py-6 text-center text-gray-400 italic">No hay datos para agrupar.</td>
                                        </tr>
                                      ) : (
                                        groupedData.items.map((item, idx) => (
                                          <tr key={item.groupKey || idx} className="hover:bg-gray-50/50">
                                            <td className="py-2.5 font-bold text-gray-700">{item.groupName}</td>
                                            <td className="py-2.5 text-center text-gray-500 font-semibold">{item.count}</td>
                                            <td className="py-2.5 text-right font-bold text-gray-900">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Detalle de Altas ({groupedData.title})</h4>
                                {groupedData.items.length === 0 ? (
                                  <div className="py-8 text-center text-gray-400 italic bg-white rounded-2xl border border-gray-100">No hay registros en el rango de fechas.</div>
                                ) : (
                                  groupedData.items.map((item, idx) => {
                                    if (item.insurances.length === 0) return null;
                                    return (
                                      <div key={item.groupKey || idx} className="space-y-2">
                                        <div className="flex justify-between items-center bg-purple-50/50 px-4 py-2 rounded-xl border border-purple-100/50">
                                          <span className="text-xs font-bold text-purple-900">{item.groupName}</span>
                                          <span className="text-[10px] font-black text-purple-700 bg-white px-2 py-0.5 rounded-md border border-purple-100">{item.count} pólizas • ${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
                                          <table className="w-full text-left border-collapse">
                                            <thead>
                                              <tr className="border-b border-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-wider pb-1">
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Sol.</th>
                                                <th className="pb-1.5 whitespace-nowrap">Tipo Acción</th>
                                                <th className="pb-1.5 whitespace-nowrap">Nombre</th>
                                                <th className="pb-1.5 whitespace-nowrap">Apellido</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Nac.</th>
                                                <th className="pb-1.5 whitespace-nowrap">Cód Origen</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Salida</th>
                                                <th className="pb-1.5 whitespace-nowrap">Cód Dest.</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Regreso</th>
                                                <th className="pb-1.5 whitespace-nowrap">Meses/Días</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Precio USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Descuento USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Comisión USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Precio Total USD</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50 text-[11px]">
                                              {item.insurances.map((ins, iIdx) => (
                                                <tr key={ins.id || iIdx} className="hover:bg-gray-50/50">
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{getRequestDateString(ins)}</td>
                                                  <td className="py-2 pr-3 text-gray-600 font-bold whitespace-nowrap">{ins.actionType || ''}</td>
                                                  <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">{ins.firstName || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-800 whitespace-nowrap">{ins.lastName || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.birthDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.originCountry || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.startDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.destinationCountry || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.endDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-600 font-semibold whitespace-nowrap">{formatMonthsDays(ins.days || 0)}</td>
                                                  <td className="py-2 pr-3 text-right text-gray-600 whitespace-nowrap">${(ins.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 pr-3 text-right text-gray-600 whitespace-nowrap">${(ins.discount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 pr-3 text-right text-gray-600 whitespace-nowrap">${(ins.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 text-right font-bold text-gray-950 whitespace-nowrap">${(ins.totalFinal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (reportType === 'to_collect') {
                        const { filtered, totalSales, totalPaid, totalPending, totalDiscounts = 0, totalCommissions = 0, count, groupedData } = data as {
                          filtered: InsuranceRequest[];
                          totalSales: number;
                          totalPaid: number;
                          totalPending: number;
                          totalDiscounts?: number;
                          totalCommissions?: number;
                          count: number;
                          groupedData: {
                            title: string;
                            items: {
                              groupKey: string;
                              groupName: string;
                              count: number;
                              total: number;
                              totalPaid: number;
                              totalPending: number;
                              insurances: InsuranceRequest[];
                            }[];
                          };
                        };

                        const reportDayRate = exchangeRates[0]?.rate || 17.55;
                        const totalSalesMXP = filtered.reduce((sum, ins) => sum + (ins.totalFinal || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);
                        const totalDiscountsMXP = filtered.reduce((sum, ins) => sum + (ins.discount || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);
                        const totalCommissionsMXP = filtered.reduce((sum, ins) => sum + (ins.agentCommission || 0) * getExchangeRateForRequestDate(ins, exchangeRates), 0);

                        const renderScreenSummary = () => (
                          <div className="grid grid-cols-4 gap-3">
                            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                              <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Total de seguros</p>
                                <p className="text-base font-black text-gray-900 mt-1">{count}</p>
                              </div>
                              <p className="text-[10px] font-bold text-indigo-600 mt-1.5 pt-1.5 border-t border-gray-50">T.C.: ${reportDayRate.toFixed(4)}</p>
                            </div>
                            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                              <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Ventas Totales</p>
                                <p className="text-base font-black text-rose-600 mt-1">${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                              </div>
                              <p className="text-[10px] font-bold text-emerald-600 mt-1.5 pt-1.5 border-t border-gray-50">${totalSalesMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</p>
                            </div>
                            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                              <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Descuentos Totales</p>
                                <p className="text-base font-black text-amber-500 mt-1">${totalDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                              </div>
                              <p className="text-[10px] font-bold text-red-500 mt-1.5 pt-1.5 border-t border-gray-50">${totalDiscountsMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</p>
                            </div>
                            <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                              <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Comisiones Totales</p>
                                <p className="text-base font-black text-emerald-600 mt-1">${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                              </div>
                              <p className="text-[10px] font-bold text-amber-600 mt-1.5 pt-1.5 border-t border-gray-50">${totalCommissionsMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP</p>
                            </div>
                          </div>
                        );

                        return (
                          <div className="space-y-6">
                            {renderScreenSummary()}

                            {reportFormat === 'consolidated' ? (
                              <div className="space-y-4">
                                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Resumen Consolidado ({groupedData.title})</h4>
                                <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider pb-2">
                                        <th className="pb-2">Grupo / Cliente</th>
                                        <th className="pb-2 text-center">Pólizas</th>
                                        <th className="pb-2 text-right">Venta Total</th>
                                        <th className="pb-2 text-right">Cobrado</th>
                                        <th className="pb-2 text-right">Saldo Deudor</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-xs">
                                      {groupedData.items.length === 0 ? (
                                        <tr>
                                          <td colSpan={5} className="py-6 text-center text-gray-400 italic">No hay datos para agrupar.</td>
                                        </tr>
                                      ) : (
                                        groupedData.items.map((item, idx) => (
                                          <tr key={item.groupKey || idx} className="hover:bg-gray-50/50">
                                            <td className="py-2.5 font-bold text-gray-700">{item.groupName}</td>
                                            <td className="py-2.5 text-center text-gray-500 font-semibold">{item.count}</td>
                                            <td className="py-2.5 text-right font-medium text-gray-600">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td className="py-2.5 text-right font-medium text-emerald-600">${item.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td className="py-2.5 text-right font-bold text-rose-600">${item.totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Detalle de Cobros ({groupedData.title})</h4>
                                {groupedData.items.length === 0 ? (
                                  <div className="py-8 text-center text-gray-400 italic bg-white rounded-2xl border border-gray-100">No hay registros de cobros en el rango de fechas.</div>
                                ) : (
                                  groupedData.items.map((item, idx) => {
                                    if (item.insurances.length === 0) return null;
                                    return (
                                      <div key={item.groupKey || idx} className="space-y-2">
                                        <div className="flex justify-between items-center bg-rose-50/50 px-4 py-2 rounded-xl border border-rose-100/50">
                                          <span className="text-xs font-bold text-rose-900">{item.groupName}</span>
                                          <span className="text-[10px] font-black text-rose-700 bg-white px-2 py-0.5 rounded-md border border-rose-100">
                                            {item.count} pólizas • Saldo: ${item.totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                        <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
                                          <table className="w-full text-left border-collapse">
                                            <thead>
                                              <tr className="border-b border-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-wider pb-1">
                                                <th className="pb-1.5 whitespace-nowrap">Tipo Acción</th>
                                                <th className="pb-1.5 whitespace-nowrap">Nombre</th>
                                                <th className="pb-1.5 whitespace-nowrap">Apellido</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Nac.</th>
                                                <th className="pb-1.5 whitespace-nowrap">Cód Origen</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Salida</th>
                                                <th className="pb-1.5 whitespace-nowrap">Cód Dest.</th>
                                                <th className="pb-1.5 whitespace-nowrap">Fecha Regreso</th>
                                                <th className="pb-1.5 whitespace-nowrap">Meses/Días</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Precio USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Descuento USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Precio Total USD</th>
                                                <th className="pb-1.5 whitespace-nowrap text-right">Comisión USD</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50 text-[11px]">
                                              {item.insurances.map((ins, iIdx) => (
                                                <tr key={ins.id || iIdx} className="hover:bg-gray-50/50">
                                                  <td className="py-2 pr-3 text-gray-600 font-bold whitespace-nowrap">{ins.actionType || ''}</td>
                                                  <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">{ins.firstName || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-800 whitespace-nowrap">{ins.lastName || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.birthDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.originCountry || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.startDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.destinationCountry || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{ins.endDate || ''}</td>
                                                  <td className="py-2 pr-3 text-gray-600 font-semibold whitespace-nowrap">{formatMonthsDays(ins.days || 0)}</td>
                                                  <td className="py-2 pr-3 text-right text-gray-600 whitespace-nowrap">${(ins.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 pr-3 text-right text-gray-600 whitespace-nowrap">${(ins.discount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 pr-3 text-right font-bold text-gray-950 whitespace-nowrap">${(ins.totalFinal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td className="py-2 text-right text-gray-600 whitespace-nowrap">${(ins.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}

                            <div className="pt-6 mt-6 border-t border-gray-100 space-y-4">
                              <h4 className="text-xs font-black text-gray-400 uppercase tracking-wider">Resumen de Cobros (Final)</h4>
                              {renderScreenSummary()}
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'to_pay') {
                        const { totalCost, count, invoiceGroups = [] } = data as {
                          filtered: InsuranceRequest[];
                          totalCost: number;
                          count: number;
                          invoiceGroups?: PayableInvoiceGroup[];
                        };
                        
                        if (reportFormat === 'consolidated') {
                          return (
                            <div className="space-y-6">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Invoices por Pagar</p>
                                  <p className="text-xl font-black text-emerald-600 mt-1">{count}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Monto por Pagar Total</p>
                                  <p className="text-xl font-black text-gray-900 mt-1">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <th className="pb-2">Invoice</th>
                                      <th className="pb-2 text-center">Número de Seguros</th>
                                      <th className="pb-2 text-right">Monto por Pagar</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 text-xs">
                                    {invoiceGroups.length === 0 ? (
                                      <tr>
                                        <td colSpan={3} className="py-8 text-center text-gray-400 italic">No hay seguros por pagar.</td>
                                      </tr>
                                    ) : (
                                      invoiceGroups.map((g, idx) => (
                                        <tr key={g.invoice || idx}>
                                          <td className="py-2 font-semibold text-gray-800">{g.invoice}</td>
                                          <td className="py-2 text-center font-medium text-gray-600">{g.count}</td>
                                          <td className="py-2 text-right font-bold text-emerald-600">${g.pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Invoices por Pagar</p>
                                <p className="text-xl font-black text-emerald-600 mt-1">{count}</p>
                              </div>
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Monto por Pagar Total</p>
                                <p className="text-xl font-black text-gray-900 mt-1">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <th className="pb-2">Invoice</th>
                                    <th className="pb-2">Asegurado</th>
                                    <th className="pb-2">Póliza</th>
                                    <th className="pb-2">Fecha Invoice</th>
                                    <th className="pb-2 text-right">Monto por Pagar</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-xs">
                                  {invoiceGroups.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="py-8 text-center text-gray-400 italic">No hay seguros por pagar a proveedores.</td>
                                    </tr>
                                  ) : (
                                    invoiceGroups.flatMap((g) =>
                                      g.insurances.map((ins, idx) => (
                                        <tr key={`${g.invoice}-${ins.id || idx}`}>
                                          <td className="py-2 font-semibold text-gray-800">{idx === 0 ? g.invoice : ''}</td>
                                          <td className="py-2 font-medium">{ins.firstName} {ins.lastName}</td>
                                          <td className="py-2 text-gray-600 font-bold">{ins.policyName || ins.policyId}</td>
                                          <td className="py-2 text-gray-500">{idx === 0 ? (g.invoiceDate || '') : ''}</td>
                                          <td className="py-2 text-right font-bold text-emerald-600">{idx === 0 ? `$${g.pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}</td>
                                        </tr>
                                      ))
                                    )
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'commissions') {
                        const { filtered, totalSales, totalCommissions, totalDiscounts, count } = data as { 
                          filtered: InsuranceRequest[], 
                          totalSales: number, 
                          totalCommissions: number, 
                          totalDiscounts: number, 
                          count: number 
                        };

                        // Calculate number of insurances per policy type
                        const policyCounts: { [key: string]: number } = {};
                        filtered.forEach(ins => {
                          const pName = ins.policyName || ins.policyId || 'Sin Póliza';
                          policyCounts[pName] = (policyCounts[pName] || 0) + 1;
                        });

                        return (
                          <div className="space-y-6">
                            {/* Consolidated / Executive Summary */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">Consolidado de Comisiones Pendientes</h4>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Total de Seguros</p>
                                  <p className="text-lg font-black text-amber-600 mt-1">{count}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Ventas Totales</p>
                                  <p className="text-lg font-black text-gray-900 mt-1">${(totalSales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase font-bold">Descuentos Totales</p>
                                  <p className="text-lg font-black text-red-600 mt-1">${(totalDiscounts || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase font-bold">Comisiones Totales</p>
                                  <p className="text-lg font-black text-emerald-600 mt-1">${(totalCommissions || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                              </div>
                            </div>

                            {/* Insurances by Policy Type */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">Seguros por Tipo de Póliza</h4>
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                  {Object.entries(policyCounts).map(([policyName, countVal], idx) => (
                                    <div key={idx} className="flex items-center justify-between p-2 bg-gray-50/50 rounded-xl border border-gray-100/40">
                                      <span className="text-xs font-semibold text-gray-700 truncate mr-2" title={policyName}>{policyName}</span>
                                      <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg">{countVal}</span>
                                    </div>
                                  ))}
                                  {Object.keys(policyCounts).length === 0 && (
                                    <p className="col-span-full text-center text-xs text-gray-400 italic py-2">No hay datos por póliza.</p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Detailed 18-column Table */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">Detalle del Reporte</h4>
                              <div className="overflow-x-auto border border-gray-100 rounded-2xl shadow-sm bg-white p-1">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/80">
                                      <th className="p-3 whitespace-nowrap">Fecha Sol.</th>
                                      <th className="p-3 whitespace-nowrap">Tipo Accion</th>
                                      <th className="p-3 whitespace-nowrap">Nombre</th>
                                      <th className="p-3 whitespace-nowrap">Apellido</th>
                                      <th className="p-3 whitespace-nowrap">Fecha Nac.</th>
                                      <th className="p-3 whitespace-nowrap">Cód Origen</th>
                                      <th className="p-3 whitespace-nowrap">Fecha Salida</th>
                                      <th className="p-3 whitespace-nowrap">Cód Destino</th>
                                      <th className="p-3 whitespace-nowrap">Fecha Regreso</th>
                                      <th className="p-3 whitespace-nowrap">Meses/Dias</th>
                                      <th className="p-3 whitespace-nowrap text-right">Precio USD</th>
                                      <th className="p-3 whitespace-nowrap text-right">Descuento USD</th>
                                      <th className="p-3 whitespace-nowrap text-right">Comisión USD</th>
                                      <th className="p-3 whitespace-nowrap text-right">Precio Total USD</th>
                                      <th className="p-3 whitespace-nowrap text-right">T.C.</th>
                                      <th className="p-3 whitespace-nowrap text-right">Precio MXP</th>
                                      <th className="p-3 whitespace-nowrap text-right">Descuento MXP</th>
                                      <th className="p-3 whitespace-nowrap text-right">Comisión MXP</th>
                                      <th className="p-3 whitespace-nowrap text-right">Precio Total MXP</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 text-xs">
                                    {filtered.length === 0 ? (
                                      <tr>
                                        <td colSpan={19} className="py-8 text-center text-gray-400 italic">No hay comisiones de agente pendientes.</td>
                                      </tr>
                                    ) : (
                                      filtered.map((ins, idx) => {
                                        const tc = getExchangeRateForRequestDate(ins, exchangeRates);
                                        const precioUSD = ins.totalPrice || 0;
                                        const descuentoUSD = ins.discount || 0;
                                        const comisionUSD = getPolicyCommissionAmount(ins);
                                        const totalUSD = ins.totalFinal || 0;

                                        const precioMXP = precioUSD * tc;
                                        const descuentoMXP = descuentoUSD * tc;
                                        const comisionMXP = comisionUSD * tc;
                                        const totalMXP = totalUSD * tc;

                                        const durationStr = formatMonthsDays(ins.days || 0);
                                        const reqDateStr = getRequestDateString(ins);

                                        return (
                                          <tr key={ins.id || idx} className="hover:bg-gray-50/50">
                                            <td className="p-3 whitespace-nowrap font-medium text-gray-500">{reqDateStr}</td>
                                            <td className="p-3 whitespace-nowrap font-medium text-gray-700">{ins.actionType || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-600">{ins.firstName || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-600">{ins.lastName || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500">{ins.birthDate || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500">{ins.originCountry || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500">{ins.startDate || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500">{ins.destinationCountry || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500">{ins.endDate || ''}</td>
                                            <td className="p-3 whitespace-nowrap text-gray-500 font-semibold">{durationStr}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-gray-600">${precioUSD.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-red-600">-${descuentoUSD.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-emerald-600">${comisionUSD.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right font-bold text-gray-900">${totalUSD.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-blue-600 font-bold">{tc.toFixed(4)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-gray-500">${precioMXP.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-red-500">-${descuentoMXP.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right text-emerald-500">${comisionMXP.toFixed(2)}</td>
                                            <td className="p-3 whitespace-nowrap text-right font-bold text-gray-800">${totalMXP.toFixed(2)}</td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'income_statement') {
                        const {
                          grossIncome,
                          pagoServicios,
                          totalGastosVenta,
                          reembolsos,
                          margenUtilidad,
                          gastosOperativos,
                          gastosAdministrativos,
                          sueldosSalarios,
                          otrosGastos,
                          subtotalGastos,
                          utilidadBruta,
                          impuestos,
                          utilidadNeta,
                          rentabilidad
                        } = data as any;
                        
                        return (
                          <div className="space-y-4 text-xs font-semibold">
                            <div className="space-y-1.5">
                              <div className="bg-gray-200/60 px-2 py-1.5 rounded-lg text-[10px] font-black uppercase text-gray-700 tracking-wider">Ingresos y Costos Directos</div>
                              <div className="flex justify-between px-2 pt-0.5"><span className="text-gray-500">+ Ingresos Brutos</span><span className="font-bold text-gray-800">${grossIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Pago Servicios</span><span className="font-bold text-gray-800">${pagoServicios.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Gastos de Venta</span><span className="font-bold text-gray-800">${totalGastosVenta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Reembolsos</span><span className="font-bold text-gray-800">${reembolsos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2 border-t border-gray-200 pt-1.5 font-bold text-gray-900 bg-white shadow-sm p-1 rounded-xl"><span>= Margen de Utilidad</span><span>${margenUtilidad.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                            </div>

                            <div className="space-y-1.5 mt-3">
                              <div className="bg-gray-200/60 px-2 py-1.5 rounded-lg text-[10px] font-black uppercase text-gray-700 tracking-wider">Gastos Generales</div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Gastos Operativos</span><span className="font-bold text-gray-800">${gastosOperativos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Gastos Administrativos</span><span className="font-bold text-gray-800">${gastosAdministrativos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Sueldos y Salarios</span><span className="font-bold text-gray-800">${sueldosSalarios.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Otros Gastos</span><span className="font-bold text-gray-800">${otrosGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2 border-t border-gray-200 pt-1.5 font-bold text-gray-900 bg-white shadow-sm p-1 rounded-xl"><span>= Subtotal Gastos</span><span>${subtotalGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                            </div>

                            <div className="space-y-1.5 mt-3">
                              <div className="bg-gray-200/60 px-2 py-1.5 rounded-lg text-[10px] font-black uppercase text-gray-700 tracking-wider">Utilidad Bruta</div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">+ Margen de Utilidad</span><span className="font-bold text-gray-800">${margenUtilidad.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Subtotal Gastos</span><span className="font-bold text-gray-800">${subtotalGastos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2 border-t border-gray-200 pt-1.5 font-bold text-gray-900 bg-white shadow-sm p-1 rounded-xl"><span>= Utilidad Bruta</span><span>${utilidadBruta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                            </div>

                            <div className="space-y-1.5 mt-3">
                              <div className="bg-gray-200/60 px-2 py-1.5 rounded-lg text-[10px] font-black uppercase text-gray-700 tracking-wider">Impuestos y Neto</div>
                              <div className="flex justify-between px-2"><span className="text-gray-500">- Impuestos</span><span className="font-bold text-gray-800">${impuestos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2 border-t-2 border-blue-200 pt-2 font-black text-blue-600 bg-blue-50/70 p-2 rounded-2xl shadow-inner text-sm"><span>= UTILIDAD NETA</span><span>${utilidadNeta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                              <div className="flex justify-between px-2 text-[10px] italic text-gray-500"><span>% Rentabilidad sobre ingresos</span><span>{rentabilidad.toFixed(2)}%</span></div>
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Closing Audit Modal & PDF */}
      <MonthlyClosingModal
        isOpen={showMonthlyClosingModal}
        onClose={() => setShowMonthlyClosingModal(false)}
        insurances={insurances}
        clients={clients}
        policies={policies}
        companySettings={companySettings}
        profile={profile}
        onEnsureFullHistory={() => setLimitToCurrentMonth(false)}
      />

      {/* Monthly Consolidated Report Modal & PDF */}
      <MonthlyReportModal
        isOpen={showMonthlyReportModal}
        onClose={() => setShowMonthlyReportModal(false)}
        insurances={insurances}
        clients={clients}
        policies={policies}
        companySettings={companySettings}
        profile={profile}
        onEnsureFullHistory={() => setLimitToCurrentMonth(false)}
      />
    </div>
  );
}
