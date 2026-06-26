import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, onSnapshot, addDoc, getDoc, doc, updateDoc, deleteDoc, orderBy, limit, getDocs, where, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { InsuranceRequest, Payment, Country, UserProfile, ExchangeRate, CustomRole, Category, Subcategory, Client, Provider, Policy, PlanType } from '../types';
import { COUNTRIES } from '../constants';
import { CheckCircle, XCircle, X, ShieldCheck, Eye, AlertCircle, Download, BarChart3, TrendingUp, Users, DollarSign, Calendar, Filter, Settings, Building2, Shield, Users2, FileText, Upload, Database, Search, Receipt, Trash2, Edit2, ArrowRightLeft, CheckSquare, Square, Plus, AlertTriangle, Percent, ChevronLeft, ChevronRight, ChevronDown, Coins, ArrowUpDown, Sliders, Scale, RefreshCw, CreditCard, Link2, Copy, Mail, MessageSquare } from 'lucide-react';
import TransactionModal from './TransactionModal';
import ConfirmModal from './ConfirmModal';
import StatementOCRManager from './StatementOCRManager';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, subMonths } from 'date-fns';
import Papa from 'papaparse';
import { usePermissions } from '../hooks/usePermissions';
import BulkImportModal from './BulkImportModal';
import { useCompany } from '../App';
import { APP_LOGO } from '../constants';

import { useSearchParams } from 'react-router-dom';
import { triggerWhatsAppNotification } from '../services/whatsapp';

export const isInsuranceClosed = (insurance: any) => {
  if (!insurance) return false;
  if (insurance.closed === false) return false;
  
  const totalFinal = insurance.totalFinal !== undefined && insurance.totalFinal !== null 
    ? insurance.totalFinal 
    : (insurance.totalPrice || 0);
  const totalPaid = insurance.totalPaid || 0;
  const balance = totalFinal - totalPaid;
  
  const balanceIsSmall = Math.abs(balance) < 5;
  const isCommissionPaid = !insurance.agentCommission || insurance.agentCommission <= 0 || insurance.commissionStatus === 'paid';
  
  return balanceIsSmall && isCommissionPaid;
};

export const isAlreadyLoaded = (insurance: any) => {
  if (!insurance) return true;
  if (!insurance.createdAt) return true;
  const createdDate = insurance.createdAt.toDate ? insurance.createdAt.toDate() : new Date(insurance.createdAt);
  const cutoffDate = new Date('2026-06-19T17:55:00Z');
  return createdDate < cutoffDate;
};

export default function AdminPanel({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const isSuperAdmin = profile?.role === 'super_admin';
  const isSuperAdminOrDirector = profile?.role === 'super_admin' || profile?.role === 'director';
  const canManageClosedState = !!(profile?.role && ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role));
  const { settings: companySettings } = useCompany();
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [insuranceTypes, setInsuranceTypes] = useState<{name: string, minAge: number, maxAge: number}[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditData, setBulkEditData] = useState<{
    status?: string;
    paymentMethod?: string;
    date?: string;
    categoryId?: string;
    subcategoryId?: string;
  }>({});
  const [activeTab, setActiveTab] = useState<'incomes' | 'expenses' | 'commissions' | 'accounts_payable' | 'accounts_receivable' | 'dashboard' | 'reconciliation' | 'comparison' | 'cash_flow' | 'income_statement'>((searchParams.get('tab') as any) || 'dashboard');
  const [incomeCurrencyTab, setIncomeCurrencyTab] = useState<'USD' | 'MXP'>('USD');
  const [expenseCurrencyTab, setExpenseCurrencyTab] = useState<'USD' | 'MXP'>('USD');
  const [exchangeRate, setExchangeRate] = useState<number>(17.5);
  const [comparisonFilters, setComparisonFilters] = useState({
    periodA: {
      startDate: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
    },
    periodB: {
      startDate: format(startOfMonth(subMonths(new Date(), 2)), 'yyyy-MM-dd'),
      endDate: format(endOfMonth(subMonths(new Date(), 2)), 'yyyy-MM-dd'),
    },
    type: 'sales' as 'sales' | 'type' | 'client'
  });

  const getComparisonData = (startDate: string, endDate: string) => {
    const filtered = insurances.filter(ins => {
      // Use requestDate if available, otherwise fall back to createdAt
      const dateStr = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString() : new Date(ins.createdAt).toISOString());
      const date = parseISO(dateStr.split('T')[0]); // Ensure we only have date part for string comparison if needed, or just parseISO
      
      return isWithinInterval(date, {
        start: parseISO(startDate),
        end: parseISO(endDate)
      });
    });

    const totalSales = filtered.reduce((sum, ins) => sum + (ins.totalFinal || ins.totalPrice || 0), 0);
    const count = filtered.length;

    const byType: Record<string, number> = {};
    const byClient: Record<string, number> = {};

    filtered.forEach(ins => {
      const type = ins.policyName || ins.policyId || 'Otros';
      byType[type] = (byType[type] || 0) + (ins.totalFinal || ins.totalPrice || 0);

      const client = `${ins.firstName} ${ins.lastName}`;
      byClient[client] = (byClient[client] || 0) + (ins.totalFinal || ins.totalPrice || 0);
    });

    return {
      totalSales,
      count,
      byType: Object.entries(byType).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byClient: Object.entries(byClient).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
    };
  };

  const comparisonData = useMemo(() => {
    const dataA = getComparisonData(comparisonFilters.periodA.startDate, comparisonFilters.periodA.endDate);
    const dataB = getComparisonData(comparisonFilters.periodB.startDate, comparisonFilters.periodB.endDate);

    return { dataA, dataB };
  }, [insurances, comparisonFilters]);

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['dashboard', 'incomes', 'expenses', 'commissions', 'accounts_payable', 'accounts_receivable', 'reconciliation', 'comparison', 'cash_flow', 'income_statement'].includes(tab)) {
      setActiveTab(tab as any);
    }
  }, [searchParams]);

  // Handle Stripe callback status
  useEffect(() => {
    const stripeStatus = searchParams.get('stripe_status');
    const insId = searchParams.get('insuranceId');
    if (stripeStatus === 'success') {
      alert(`¡Pago con Stripe Recibido con Éxito!\n\nEl abono para la póliza se ha procesado de forma segura y se ha conciliado automáticamente en el sistema.`);
      // Clean up params
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('stripe_status');
      newParams.delete('insuranceId');
      newParams.delete('session_id');
      setSearchParams(newParams);
    } else if (stripeStatus === 'cancel') {
      alert('El pago con Stripe fue cancelado por el usuario o se interrumpió la transacción.');
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('stripe_status');
      newParams.delete('insuranceId');
      setSearchParams(newParams);
    }
  }, [searchParams]);

  // Clear selected payment IDs when switching tabs or currencies
  useEffect(() => {
    setSelectedPaymentIds([]);
  }, [activeTab, incomeCurrencyTab, expenseCurrencyTab]);

  const handleTabChange = (tab: 'dashboard' | 'incomes' | 'expenses' | 'commissions' | 'accounts_payable' | 'accounts_receivable' | 'reconciliation' | 'comparison' | 'cash_flow' | 'income_statement') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Dashboard Filters
  const [dashboardFilters, setDashboardFilters] = useState({
    startDate: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    plan: 'all',
    clientType: 'all',
    policyId: 'all',
    clientId: 'all',
    operationalStatus: 'all'
  });

  const isAdmin = profile?.role && ['super_admin', 'director', 'seguros', 'administracion', 'admin'].includes(profile.role);
  const canManagePolicies = profile?.role && ['super_admin', 'director', 'seguros'].includes(profile.role);
  const canManagePayments = profile?.role && ['super_admin', 'director', 'administracion'].includes(profile.role);
  
  const [selectedInsurance, setSelectedInsurance] = useState<InsuranceRequest | null>(null);
  const [modalTab, setModalTab] = useState<'details' | 'payments' | 'commissions'>('details');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [depositAccount, setDepositAccount] = useState('');
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'MXP'>('USD');
  const [paymentExchangeRate, setPaymentExchangeRate] = useState<number>(0);
  const [paymentAmountMXP, setPaymentAmountMXP] = useState<number>(0);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [editingCommission, setEditingCommission] = useState<number>(0);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selectedInsuranceForTransactions, setSelectedInsuranceForTransactions] = useState<string | null>(null);
  const [showDiscountCommissionModal, setShowDiscountCommissionModal] = useState(false);
  const [discountCommissionAmount, setDiscountCommissionAmount] = useState<string>('');
  const [discountCommissionNotes, setDiscountCommissionNotes] = useState<string>('');
  const [isSavingDiscountCommission, setIsSavingDiscountCommission] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripePaymentUrl, setStripePaymentUrl] = useState<string | null>(null);
  const [stripeCopied, setStripeCopied] = useState(false);
  const [stripeEmailSending, setStripeEmailSending] = useState(false);
  const [stripeEmailSent, setStripeEmailSent] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string | null>(null);
  const [selectedPayableIds, setSelectedPayableIds] = useState<string[]>([]);
  const [selectedInvoiceKeys, setSelectedInvoiceKeys] = useState<string[]>([]);
  const [expandedInvoices, setExpandedInvoices] = useState<Record<string, boolean>>({});
  const [payableFilter, setPayableFilter] = useState<'pending' | 'all'>('pending');
  const [payableValidationFilter, setPayableValidationFilter] = useState<'all' | 'valid' | 'invalid' | 'uncotejado'>('all');
  const [invoicePaymentDate, setInvoicePaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState('');
  const [invoiceDepositAccount, setInvoiceDepositAccount] = useState('');
  const [showInvoicePrompt, setShowInvoicePrompt] = useState(false);
  const [differenceModalOpen, setDifferenceModalOpen] = useState(false);
  const [selectedDifferenceGroup, setSelectedDifferenceGroup] = useState<any>(null);
  const [selectedAmountType, setSelectedAmountType] = useState<'registered' | 'expected' | 'custom'>('registered');
  const [customPaymentAmount, setCustomPaymentAmount] = useState<string>('');
  const [bulkInvoiceNumber, setBulkInvoiceNumber] = useState('');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState<Partial<Payment>>({
    type: 'provider_payment',
    currency: 'USD',
    status: 'completed',
    date: new Date().toISOString().split('T')[0],
    amount: 0,
    exchangeRate: 17.5,
    amountMXP: 0
  });

  // Incomes filters, sorting, and pagination state variables
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [incomeFilters, setIncomeFilters] = useState({
    startDate: '',
    endDate: '',
    paymentMethod: 'all',
    account: 'all',
    status: 'all',
    clientId: 'all',
    agentId: 'all',
  });
  const [incomeSortOrder, setIncomeSortOrder] = useState<'desc' | 'asc'>('desc');
  const [incomePage, setIncomePage] = useState(1);
  const [incomePageSize, setIncomePageSize] = useState(20);

  // Cash Flow Filters and Pagination States
  const [cashFlowFilters, setCashFlowFilters] = useState({
    startDate: '',
    endDate: '',
    type: 'all' as 'all' | 'income' | 'expense',
    account: 'all',
    status: 'completed' as 'all' | 'completed' | 'pending'
  });
  const [cashFlowPage, setCashFlowPage] = useState(1);
  const [cashFlowPageSize, setCashFlowPageSize] = useState(20);

  // Helper to get agent name for insurance request
  const getAgentName = (c: any) => {
    if (c.clientId) {
      const client = clients.find(cl => cl.id === c.clientId);
      if (client) {
        if (client.type === 'Agent') {
          return client.commercialName || client.legalName || c.linkedAgentId || 'Agente';
        }
        if (c.linkedAgentId) {
          const agent = client.linkedAgents?.find((a: any) => a.email === c.linkedAgentId);
          if (agent) return agent.name;
        }
      }
    }
    return c.linkedAgentId || 'Directo';
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

  const getInsuranceTypeLabel = (policyId: string, insuranceName?: string) => {
    const policy = policies.find(p => p.id === policyId);
    if (insuranceName) return insuranceName;
    if (policy) return policy.name;

    let label = '';
    if (policyId.includes('Oro')) label = 'Oro';
    else if (policyId.includes('Plata')) label = 'Plata';
    else if (policyId.includes('Bronce')) label = 'Bronce';
    else return '-';

    if (policyId.toLowerCase().includes('sin')) label += ' sin deducible';
    else label += ' con deducible';
    
    return label;
  };

  // Accounts Receivable Filters and Pagination States
  const [accountsReceivableFilters, setAccountsReceivableFilters] = useState({
    search: '',
    type: 'all' as 'all' | 'deudor' | 'overpaid',
    policyId: 'all',
    status: 'all' as 'all' | 'active' | 'cancelled' | 'pending' | 'partially_paid' | 'paid',
    requestDateStart: '',
    requestDateEnd: '',
    agentName: 'all'
  });
  const [accountsReceivablePage, setAccountsReceivablePage] = useState(1);
  const [accountsReceivablePageSize, setAccountsReceivablePageSize] = useState(20);

  // Accounts Receivable Sorting States
  const [arSortField, setArSortField] = useState<'requestDate' | 'createdAt' | 'name' | 'policyId' | 'startDate' | 'expected' | 'totalPaid' | 'balance' | 'status' | 'agentCommission'>('requestDate');
  const [arSortDirection, setArSortDirection] = useState<'desc' | 'asc'>('desc');

  const [arSortFieldSecondary, setArSortFieldSecondary] = useState<'requestDate' | 'createdAt' | 'name' | 'policyId' | 'startDate' | 'expected' | 'totalPaid' | 'balance' | 'status' | 'agentCommission' | 'none'>('name');
  const [arSortDirectionSecondary, setArSortDirectionSecondary] = useState<'asc' | 'desc'>('asc');

  const handleArSort = (field: typeof arSortField) => {
    if (arSortField === field) {
      setArSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setArSortField(field);
      setArSortDirection('asc');
    }
  };

  // Financial Editing States for Super Admin / Director
  const [editDiscount, setEditDiscount] = useState<number>(0);
  const [editAdjustment, setEditAdjustment] = useState<number>(0);
  const [isEditingFinancials, setIsEditingFinancials] = useState(false);
  const [isSavingFinancials, setIsSavingFinancials] = useState(false);

  // States for inline adjustment editing in Cuentas por Cobrar
  const [editingArAdjustmentId, setEditingArAdjustmentId] = useState<string | null>(null);
  const [inlineArAdjustmentVal, setInlineArAdjustmentVal] = useState<string>('');
  const [isSavingInlineAr, setIsSavingInlineAr] = useState<string | null>(null);
  const [selectedArIds, setSelectedArIds] = useState<string[]>([]);
  const [isBulkSavingAr, setIsBulkSavingAr] = useState(false);

  const [confirmModalState, setConfirmModalState] = useState<{
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

  useEffect(() => {
    if (selectedInsurance) {
      setEditingCommission(selectedInsurance.agentCommission || 0);
      setPaymentMethod(selectedInsurance.paymentMethod || '');
      setPaymentCurrency('USD');
      setPaymentExchangeRate(exchangeRate);
      const total = selectedInsurance.totalFinal || selectedInsurance.totalPrice;
      const paid = selectedInsurance.totalPaid || 0;
      const balance = total - paid;
      setPaymentAmount(balance > 0 ? balance : 0);
      setPaymentAmountMXP((balance > 0 ? balance : 0) * exchangeRate);
      
      // Initialize edit values
      setEditDiscount(selectedInsurance.discount || 0);
      setEditAdjustment(selectedInsurance.adjustment || 0);
      setIsEditingFinancials(false);
    }
  }, [selectedInsurance, exchangeRate]);

  // Fetch exchange rate for selected date
  useEffect(() => {
    const fetchRateForDate = async () => {
      const q = query(collection(db, 'exchangeRates'), where('date', '==', paymentDate), limit(1));
      const snap = await getDocs(q);
      let rate = exchangeRate;
      if (!snap.empty) {
        rate = (snap.docs[0].data() as ExchangeRate).rate;
      }
      
      setPaymentExchangeRate(rate);
      
      if (selectedInsurance) {
        if (paymentCurrency === 'USD') {
          setPaymentAmountMXP(paymentAmount * rate);
        } else {
          setPaymentAmount(paymentAmountMXP / (rate || 1));
        }
      }
    };
    fetchRateForDate();
  }, [paymentDate, exchangeRate, selectedInsurance, paymentCurrency]);

  // Handle manual exchange rate changes
  useEffect(() => {
    if (selectedInsurance) {
      if (paymentCurrency === 'USD') {
        setPaymentAmountMXP(paymentAmount * paymentExchangeRate);
      } else {
        // If we are in MXP mode and change the rate, update the USD equivalent
        setPaymentAmount(paymentAmountMXP / (paymentExchangeRate || 1));
      }
    }
  }, [paymentExchangeRate]);

  const handleSaveFinancials = async () => {
    if (!selectedInsurance || !selectedInsurance.id) return;
    if (isInsuranceClosed(selectedInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    setIsSavingFinancials(true);
    try {
      const originalTotalPrice = selectedInsurance.totalPrice || 0;
      const originalDiscount = selectedInsurance.discount || 0;
      const originalAdjustment = selectedInsurance.adjustment || 0;
      const originalTotalFinal = selectedInsurance.totalFinal !== undefined && selectedInsurance.totalFinal !== null 
        ? selectedInsurance.totalFinal 
        : (originalTotalPrice - originalDiscount - originalAdjustment);
      const originalCommission = selectedInsurance.agentCommission || 0;
      const cardComision = selectedInsurance.comision || 0;

      const newTotalFinal = (selectedInsurance.totalPrice || 0) - editDiscount - editAdjustment + cardComision;
      
      let newCommission = originalCommission;
      if (originalTotalFinal > 0) {
        const commissionRate = originalCommission / originalTotalFinal;
        newCommission = Math.round((newTotalFinal * commissionRate) * 100) / 100;
      }
      
      const totalPaid = selectedInsurance.totalPaid || 0;
      const newBalance = newTotalFinal - totalPaid;
      // Close automatically if within +/- 5 difference
      const shouldClose = -5 < newBalance && newBalance < 5;

      const updateDocData: any = {
        discount: editDiscount,
        adjustment: editAdjustment,
        totalFinal: newTotalFinal,
        agentCommission: newCommission
      };

      if (shouldClose) {
        updateDocData.closed = true;
      }

      // Update in Firestore
      await updateDoc(doc(db, 'insurances', selectedInsurance.id), updateDocData);

      // Find and update pending agent_commission payment if any exists
      const pendingCommissionPayment = payments.find(p => 
        p.insuranceId === selectedInsurance.id && 
        p.type === 'agent_commission' && 
        p.status === 'pending'
      );
      if (pendingCommissionPayment && pendingCommissionPayment.id) {
        await updateDoc(doc(db, 'payments', pendingCommissionPayment.id), {
          amount: newCommission
        });
      }

      // Update local state is done automatically by the onSnapshot listener, but let's update selectedInsurance locally too
      setSelectedInsurance(prev => prev ? {
        ...prev,
        discount: editDiscount,
        adjustment: editAdjustment,
        totalFinal: newTotalFinal,
        agentCommission: newCommission,
        closed: shouldClose ? true : prev.closed
      } : null);

      setIsEditingFinancials(false);
    } catch (err) {
      console.error('Error updating insurance financials:', err);
      alert('Error al guardar los cambios: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingFinancials(false);
    }
  };

  const handleSaveInlineAdjustment = async (item: InsuranceRequest, newAdjustment: number) => {
    if (!item || !item.id) return;
    if (isInsuranceClosed(item)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    setIsSavingInlineAr(item.id);
    try {
      const originalTotalPrice = item.totalPrice || 0;
      const originalDiscount = item.discount || 0;
      const originalAdjustment = item.adjustment || 0;
      const originalTotalFinal = item.totalFinal !== undefined && item.totalFinal !== null 
        ? item.totalFinal 
        : (originalTotalPrice - originalDiscount - originalAdjustment);
      const originalCommission = item.agentCommission || 0;

      const newTotalFinal = originalTotalPrice - originalDiscount - newAdjustment;
      
      let newCommission = originalCommission;
      if (originalTotalFinal > 0) {
        const commissionRate = originalCommission / originalTotalFinal;
        newCommission = Math.round((newTotalFinal * commissionRate) * 100) / 100;
      }
      
      const totalPaid = item.totalPaid || 0;
      const newBalance = newTotalFinal - totalPaid;
      // Close automatically if within +/- 5 difference
      const shouldClose = -5 < newBalance && newBalance < 5;

      const updateDocData: any = {
        adjustment: newAdjustment,
        totalFinal: newTotalFinal,
        agentCommission: newCommission
      };

      if (shouldClose) {
        updateDocData.closed = true;
      }

      // Update in Firestore
      await updateDoc(doc(db, 'insurances', item.id), updateDocData);

      // Find and update pending agent_commission payment if any exists
      const pendingCommissionPayment = payments.find(p => 
        p.insuranceId === item.id && 
        p.type === 'agent_commission' && 
        p.status === 'pending'
      );
      if (pendingCommissionPayment && pendingCommissionPayment.id) {
        await updateDoc(doc(db, 'payments', pendingCommissionPayment.id), {
          amount: newCommission
        });
      }

      setEditingArAdjustmentId(null);
    } catch (err) {
      console.error('Error updating insurance adjustment inline:', err);
      alert('Error al guardar el ajuste: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingInlineAr(null);
    }
  };

  const handleBulkAutoAdjustBalance = async () => {
    if (selectedArIds.length === 0) return;
    
    confirmAction(
      'Auto-Ajustar Balances en Masa',
      `¿Estás seguro de que deseas aplicar el auto-ajuste automático para las ${selectedArIds.length} pólizas seleccionadas? Esto cuadrará sus balances a $0.00 mediante ajustes individuales.`,
      async () => {
        setIsBulkSavingAr(true);
        let successCount = 0;
        let failCount = 0;
        
        try {
          // Process updates
          for (const id of selectedArIds) {
            const item = accountsReceivableData.items.find(i => i.id === id);
            if (!item || isInsuranceClosed(item)) {
              failCount++;
              continue;
            }
            
            const diff = item.balance || 0;
            if (Math.abs(diff) < 0.01) {
              // already balanced
              successCount++;
              continue;
            }
            
            const newAdjustment = Number(((item.adjustment || 0) + diff).toFixed(2));
            
            const originalTotalPrice = item.totalPrice || 0;
            const originalDiscount = item.discount || 0;
            const originalAdjustment = item.adjustment || 0;
            const originalTotalFinal = item.totalFinal !== undefined && item.totalFinal !== null 
              ? item.totalFinal 
              : (originalTotalPrice - originalDiscount - originalAdjustment);
            const originalCommission = item.agentCommission || 0;

            const newTotalFinal = originalTotalPrice - originalDiscount - newAdjustment;
            
            let newCommission = originalCommission;
            if (originalTotalFinal > 0) {
              const commissionRate = originalCommission / originalTotalFinal;
              newCommission = Math.round((newTotalFinal * commissionRate) * 100) / 100;
            }
            
            const totalPaid = item.totalPaid || 0;
            const newBalance = newTotalFinal - totalPaid;
            const shouldClose = -5 < newBalance && newBalance < 5;

            const updateDocData: any = {
              adjustment: newAdjustment,
              totalFinal: newTotalFinal,
              agentCommission: newCommission
            };

            if (shouldClose) {
              updateDocData.closed = true;
            }

            // Update insurance in Firestore
            await updateDoc(doc(db, 'insurances', item.id), updateDocData);

            // Find and update pending agent_commission payment if any exists
            const pendingCommissionPayment = payments.find(p => 
              p.insuranceId === item.id && 
              p.type === 'agent_commission' && 
              p.status === 'pending'
            );
            if (pendingCommissionPayment && pendingCommissionPayment.id) {
              await updateDoc(doc(db, 'payments', pendingCommissionPayment.id), {
                amount: newCommission
              });
            }
            
            successCount++;
          }
          
          setSelectedArIds([]);
          alert(`Auto-ajuste masivo completado. Éxito: ${successCount}, Errores: ${failCount}`);
        } catch (err) {
          console.error('Error in bulk auto-adjust:', err);
          alert('Ocurrió un error al realizar el ajuste masivo: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setIsBulkSavingAr(false);
        }
      }
    );
  };

  useEffect(() => {
    if (!profile || !hasPermission('admin')) return;

    const unsubInsurances = onSnapshot(collection(db, 'insurances'), (snap) => {
      setInsurances(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insurances');
    });
    const unsubPayments = onSnapshot(collection(db, 'payments'), (snap) => {
      setPayments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'payments');
    });

    const unsubRate = onSnapshot(query(collection(db, 'exchangeRates'), orderBy('date', 'desc'), limit(1)), (snap) => {
      if (!snap.empty) {
        const latestRate = snap.docs[0].data() as ExchangeRate;
        setExchangeRate(latestRate.rate);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'exchangeRates');
    });

    const unsubCats = onSnapshot(query(collection(db, 'categories'), orderBy('name', 'asc')), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'categories');
    });

    const unsubSubs = onSnapshot(query(collection(db, 'subcategories'), orderBy('name', 'asc')), (snap) => {
      setSubcategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'subcategories');
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'clients');
    });

    const unsubProviders = onSnapshot(collection(db, 'providers'), (snap) => {
      setProviders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Provider)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'providers');
    });

    const unsubPolicies = onSnapshot(collection(db, 'policies'), (snap) => {
      setPolicies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'policies');
    });

    const unsubCountries = onSnapshot(collection(db, 'countries'), (snap) => {
      setCountries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Country)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'countries');
    });

    const unsubTypes = onSnapshot(collection(db, 'insuranceTypes'), (snap) => {
      setInsuranceTypes(snap.docs.map(doc => doc.data() as any));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'insuranceTypes');
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    const unsubPaymentMethods = onSnapshot(collection(db, 'paymentMethods'), (snap) => {
      setPaymentMethods(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'paymentMethods');
    });

    return () => {
      unsubInsurances();
      unsubPayments();
      unsubRate();
      unsubCats();
      unsubSubs();
      unsubClients();
      unsubProviders();
      unsubPolicies();
      unsubCountries();
      unsubTypes();
      unsubUsers();
      unsubPaymentMethods();
    };
  }, []);

  const handleDownloadDashboardReport = () => {
    const doc = new jsPDF();
    const { kpis } = dashboardData;

    // Header
    doc.setFillColor(37, 99, 235); // Blue-600
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text('REPORTE DE VENTAS', 105, 25, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Fecha de Reporte: ${new Date().toLocaleDateString()}`, 150, 50);
    doc.text(`Periodo: ${dashboardFilters.startDate} al ${dashboardFilters.endDate}`, 20, 50);

    // KPI Summary
    doc.setFontSize(16);
    doc.text('Resumen Ejecutivo', 20, 70);
    doc.line(20, 72, 80, 72);
    
    doc.setFontSize(12);
    doc.text(`Ventas Totales: $${kpis.totalSales.toLocaleString()} USD`, 20, 85);
    doc.text(`Total Recaudado: $${kpis.totalPaid.toLocaleString()} USD`, 20, 95);
    doc.text(`Saldo Pendiente: $${kpis.pendingBalance.toLocaleString()} USD`, 20, 105);
    doc.text(`Costo de Seguros: $${kpis.totalCost.toLocaleString()} USD`, 20, 115);
    doc.text(`Comisiones Agentes: $${kpis.totalCommissions.toLocaleString()} USD`, 20, 125);
    doc.text(`Pólizas Emitidas: ${kpis.count}`, 20, 135);
    doc.text(`Utilidad Neta: $${kpis.netProfit.toLocaleString()} USD`, 20, 145);

    // Detailed Table
    doc.setFontSize(16);
    doc.text('Detalle de Seguros', 20, 165);
    
    const tableData = insurances.filter(ins => {
      const date = ins.createdAt?.toDate ? ins.createdAt.toDate() : new Date(ins.createdAt);
      const inRange = isWithinInterval(date, {
        start: parseISO(dashboardFilters.startDate),
        end: parseISO(dashboardFilters.endDate)
      });
      const matchesPlan = dashboardFilters.plan === 'all' || ins.policyId.includes(dashboardFilters.plan);
      const matchesClientType = dashboardFilters.clientType === 'all' || ins.clientType === dashboardFilters.clientType;
      const matchesPolicy = dashboardFilters.policyId === 'all' || ins.policyId === dashboardFilters.policyId;
      const matchesClient = dashboardFilters.clientId === 'all' || ins.email === dashboardFilters.clientId;
      return inRange && matchesPlan && matchesClientType && matchesPolicy && matchesClient;
    }).map(ins => [
      ins.createdAt?.toDate ? format(ins.createdAt.toDate(), 'yyyy-MM-dd') : format(new Date(ins.createdAt), 'yyyy-MM-dd'),
      `${ins.firstName} ${ins.lastName}`,
      ins.policyId,
      ins.clientType,
      `$${(ins.totalFinal || ins.totalPrice).toLocaleString()}`,
      ins.status
    ]);

    autoTable(doc, {
      startY: 170,
      head: [['Fecha', 'Cliente', 'Póliza', 'Tipo', 'Monto', 'Estado']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] }
    });

    doc.save(`Reporte_Ventas_${dashboardFilters.startDate}_${dashboardFilters.endDate}.pdf`);
  };

  const handleDownloadARReportPDF = () => {
    const doc = new jsPDF();
    const items = accountsReceivableData.items;
    const { totalDeuda, totalSobrepago, netoAR } = accountsReceivableData.kpis;

    // Header
    doc.setFillColor(37, 99, 235); // Blue-600
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('REPORTE DE CUENTAS POR COBRAR', 105, 25, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Fecha de Reporte: ${new Date().toLocaleDateString()}`, 150, 50);
    
    // Period / Filter text
    let periodText = 'Todas las fechas';
    if (accountsReceivableFilters.requestDateStart && accountsReceivableFilters.requestDateEnd) {
      periodText = `${accountsReceivableFilters.requestDateStart} al ${accountsReceivableFilters.requestDateEnd}`;
    } else if (accountsReceivableFilters.requestDateStart) {
      periodText = `Desde ${accountsReceivableFilters.requestDateStart}`;
    } else if (accountsReceivableFilters.requestDateEnd) {
      periodText = `Hasta ${accountsReceivableFilters.requestDateEnd}`;
    }
    doc.text(`Filtro Fecha Solicitud: ${periodText}`, 20, 50);
    doc.text(`Filtro Tipo: ${accountsReceivableFilters.type === 'deudor' ? 'Solo Deudores' : accountsReceivableFilters.type === 'overpaid' ? 'Solo Sobrepagos' : 'Todos'}`, 20, 56);

    // KPI Summary Cards in PDF
    doc.setFontSize(14);
    doc.text('Resumen de Saldos', 20, 72);
    doc.line(20, 74, 80, 74);
    
    doc.setFontSize(11);
    doc.text(`Total Cartera Pendiente (Deudores): $${totalDeuda.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD`, 20, 84);
    doc.text(`Total Sobrepagos (Clientes con saldo a favor): $${totalSobrepago.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD`, 20, 92);
    doc.text(`Balance Neto por Cobrar: $${netoAR.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD`, 20, 100);
    
    doc.setFontSize(14);
    doc.text('Detalle de Cuentas', 20, 115);

    const tableData = items.map(item => {
      // Format Request Date
      let reqDateStr = 'N/A';
      if (item.requestDate) {
        reqDateStr = item.requestDate;
      } else if (item.createdAt) {
        try {
          const rawDate = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
          reqDateStr = format(rawDate, 'yyyy-MM-dd');
        } catch (e) {
          reqDateStr = 'N/A';
        }
      }

      const clientName = `${item.firstName} ${item.lastName}`;
      const policyDetails = `${item.policyId || 'S/N'}\n(${item.IDseg || 'S/F'})`;
      const expectedStr = `$${item.expected.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const totalPaidStr = `$${item.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const balanceStr = `$${item.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      
      let statusDesc = item.status === 'cancelled' || item.actionType?.toUpperCase() === 'CAN' ? 'Cancelado' : 'Activo';
      const today = format(new Date(), 'yyyy-MM-dd');
      if (statusDesc === 'Activo' && today > item.endDate) {
        statusDesc = 'Vencido';
      }

      return [
        reqDateStr,
        clientName,
        policyDetails,
        expectedStr,
        totalPaidStr,
        balanceStr,
        statusDesc
      ];
    });

    autoTable(doc, {
      startY: 120,
      head: [['F. Solicitud', 'Asegurado / Cliente', 'Póliza / IDseg', 'Cotizado (USD)', 'Pagado (USD)', 'Balance (USD)', 'Estado']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' }
      }
    });

    doc.save(`Reporte_Cuentas_Cobrar_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleUpdateStatus = async (id: string, status: 'paid' | 'cancelled' | 'partially_paid', extraData: any = {}) => {
    try {
      const insurance = insurances.find(ins => ins.id === id);
      if (!insurance) return;

      if (isInsuranceClosed(insurance)) {
        alert('Este registro está cerrado y no se puede modificar.');
        return;
      }

      const newTotalPaid = (insurance.totalPaid || 0) + (extraData.amountPaid || 0);
      const totalFinal = insurance.totalFinal || insurance.totalPrice;
      
      let finalStatus = status;
      if (status !== 'cancelled') {
        finalStatus = newTotalPaid >= totalFinal ? 'paid' : 'partially_paid';
      }

      const newBalance = totalFinal - newTotalPaid;
      const shouldClose = -5 < newBalance && newBalance < 5;

      const updateFields: any = { 
        status: finalStatus, 
        totalPaid: newTotalPaid,
        ...extraData 
      };

      if (shouldClose) {
        updateFields.closed = true;
      }

      await updateDoc(doc(db, 'insurances', id), updateFields);

      // Trigger automatic WhatsApp notifications based on status
      try {
        const fullInsObj = { ...insurance, id, status: finalStatus, totalPaid: newTotalPaid, ...extraData };
        if (finalStatus === 'paid') {
          triggerWhatsAppNotification('estado_poliza', fullInsObj);
        } else if (finalStatus === 'partially_paid') {
          triggerWhatsAppNotification('recordatorio_pago', fullInsObj);
        } else if (finalStatus === 'cancelled') {
          triggerWhatsAppNotification('estado_poliza', fullInsObj);
        }
      } catch (waErr) {
        console.error("Error triggering WhatsApp status notification:", waErr);
      }

      if (extraData.amountPaid > 0) {
        // Record payment
        await addDoc(collection(db, 'payments'), {
          insuranceId: id,
          amount: extraData.amountPaid,
          currency: extraData.paymentCurrency || 'USD',
          exchangeRate: extraData.paymentExchangeRate || 1,
          amountMXP: extraData.paymentAmountMXP || 0,
          type: 'client_payment',
          paymentMethod: extraData.paymentMethod || 'N/A',
          depositAccount: extraData.depositAccount || '',
          status: 'completed',
          date: extraData.paymentDate ? new Date(extraData.paymentDate) : new Date(),
          notes: `Recibo: ${extraData.receiptNumber}`
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `insurances/${id}`);
    }
  };

  const handleConfirmCommission = async () => {
    if (!selectedInsurance) return;
    if (isInsuranceClosed(selectedInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    confirmAction(
      'Confirmar Comisión',
      '¿Estás seguro de confirmar esta comisión para pago? Se registrará un egreso pendiente.',
      async () => {
        setSubmitting(true);
        try {
          // Update insurance status
          await updateDoc(doc(db, 'insurances', selectedInsurance.id!), {
            commissionStatus: 'confirmed',
            agentCommission: editingCommission
          });

          // Create payment record
          await addDoc(collection(db, 'payments'), {
            insuranceId: selectedInsurance.id,
            amount: editingCommission,
            currency: 'USD',
            type: 'agent_commission',
            status: 'pending',
            date: serverTimestamp(),
            notes: `Comisión confirmada para ${selectedInsurance.firstName} ${selectedInsurance.lastName}`,
            createdAt: serverTimestamp()
          });

          setSelectedInsurance(prev => prev ? { ...prev, agentCommission: editingCommission, commissionStatus: 'confirmed' } : null);
          alert('Comisión confirmada correctamente.');
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'insurances');
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleEmitReceipt = async () => {
    if (!selectedInsurance || !paymentMethod || paymentAmount <= 0) return;
    if (isInsuranceClosed(selectedInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }
    confirmAction(
      'Emitir Recibo',
      '¿Estás seguro de registrar este pago y emitir el recibo?',
      async () => {
        setSubmitting(true);
        try {
          const isCard = paymentMethod === 'Tarjeta AMEX' || paymentMethod === 'Tarjeta VISA/MC';
          const isNewIns = !isAlreadyLoaded(selectedInsurance);
          
          let cardCommission = selectedInsurance.comision || 0;
          let finalTotalFinal = selectedInsurance.totalFinal !== undefined && selectedInsurance.totalFinal !== null
            ? selectedInsurance.totalFinal
            : (selectedInsurance.totalPrice || 0);

          let extraUp: any = {};

          if (isNewIns) {
            cardCommission = isCard ? Math.round((selectedInsurance.totalPrice * 0.045) * 100) / 100 : 0;
            finalTotalFinal = Math.round((selectedInsurance.totalPrice - (selectedInsurance.discount || 0) - (selectedInsurance.adjustment || 0) + cardCommission) * 100) / 100;
            
            extraUp.comision = cardCommission;
            extraUp.totalFinal = finalTotalFinal;
          }

          const receiptNumber = `REC-${Math.floor(1000 + Math.random() * 9000)}`;
          const newTotalPaid = (selectedInsurance.totalPaid || 0) + paymentAmount;
          const status = newTotalPaid >= finalTotalFinal ? 'paid' : 'partially_paid';

          await handleUpdateStatus(selectedInsurance.id!, status, {
            paymentMethod,
            receiptNumber,
            paymentDate,
            depositAccount,
            paymentCurrency,
            paymentExchangeRate,
            paymentAmountMXP,
            amountPaid: paymentAmount,
            ...extraUp
          });
          setSelectedInsurance(prev => prev ? { ...prev, status, paymentMethod, receiptNumber, totalPaid: newTotalPaid, ...extraUp } : null);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleCreateStripePaymentLink = async () => {
    if (!selectedInsurance || paymentAmount <= 0) return;
    
    setStripeLoading(true);
    setStripePaymentUrl(null);
    setStripeEmailSent(false);

    try {
      const actualAmount = paymentCurrency === 'USD' ? paymentAmount : paymentAmountMXP;
      const response = await fetch('/api/stripe/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: actualAmount,
          currency: paymentCurrency,
          description: `Abono Póliza #${selectedInsurance.policyNumber || selectedInsurance.id?.substring(0,6)} - ${selectedInsurance.firstName} ${selectedInsurance.lastName}`,
          clientEmail: selectedInsurance.email || '',
          insuranceId: selectedInsurance.id,
          origin: window.location.origin
        })
      });

      const data = await response.json();
      if (response.ok && data.url) {
        setStripePaymentUrl(data.url);
      } else {
        alert(data.error || 'Error al generar la liga de pago.');
      }
    } catch (error: any) {
      console.error('Error generating stripe link:', error);
      alert('Error de conexión al generar la liga de pago: ' + error.message);
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSendStripeEmail = async () => {
    if (!selectedInsurance || !stripePaymentUrl || paymentAmount <= 0) return;

    setStripeEmailSending(true);
    setStripeEmailSent(false);

    try {
      const actualAmount = paymentCurrency === 'USD' ? paymentAmount : paymentAmountMXP;
      const response = await fetch('/api/stripe/send-payment-link-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedInsurance.email || '',
          clientName: `${selectedInsurance.firstName} ${selectedInsurance.lastName}`,
          paymentUrl: stripePaymentUrl,
          amount: actualAmount,
          currency: paymentCurrency,
          description: `Abono de Póliza #${selectedInsurance.policyNumber || selectedInsurance.id?.substring(0,6)}`
        })
      });

      const data = await response.json();
      if (response.ok) {
        setStripeEmailSent(true);
      } else {
        alert(data.error || 'Error al enviar la liga por correo.');
      }
    } catch (error: any) {
      console.error('Error sending stripe link email:', error);
      alert('Error de conexión al enviar correo: ' + error.message);
    } finally {
      setStripeEmailSending(false);
    }
  };

  const handleShareStripeWhatsApp = () => {
    if (!selectedInsurance || !stripePaymentUrl) return;
    const phone = selectedInsurance.phone?.replace(/\s+/g, '') || '';
    const text = `Hola ${selectedInsurance.firstName},\n\nTe comparto la liga de pago segura de Stripe para realizar tu abono de póliza por un monto de $${paymentAmount.toLocaleString()} ${paymentCurrency}:\n\n${stripePaymentUrl}\n\nQuedamos a tus órdenes.`;
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
  };

  const handleConfirmDiscountCommission = async () => {
    if (!selectedInsurance?.id) return;
    if (isInsuranceClosed(selectedInsurance)) {
      alert('Este registro está cerrado y no se puede modificar.');
      return;
    }

    const amt = parseFloat(discountCommissionAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Por favor ingrese un monto válido mayor a 0.');
      return;
    }

    setIsSavingDiscountCommission(true);
    try {
      // 1. Create client payment (Pago de cliente)
      const clientPaymentData = {
        insuranceId: selectedInsurance.id,
        amount: amt,
        currency: 'USD' as const,
        amountMXP: amt * 20,
        exchangeRate: 20,
        type: 'client_payment' as const,
        paymentMethod: 'Descuento comision',
        status: 'completed' as const,
        date: new Date(),
        notes: discountCommissionNotes || 'Descuento de comisión aplicado automáticamente',
        createdAt: new Date()
      };
      await addDoc(collection(db, 'payments'), clientPaymentData);

      // 2. Create agent commission payment (Pago de Comisión)
      const commissionPaymentData = {
        insuranceId: selectedInsurance.id,
        amount: amt,
        currency: 'USD' as const,
        amountMXP: amt * 20,
        exchangeRate: 20,
        type: 'agent_commission' as const,
        paymentMethod: 'Descuento comision',
        status: 'completed' as const,
        date: new Date(),
        notes: discountCommissionNotes || 'Comisión compensada automáticamente por Descuento Comisión',
        createdAt: new Date()
      };
      await addDoc(collection(db, 'payments'), commissionPaymentData);

      // 3. Update the insurance totalPaid and status
      const insRef = doc(db, 'insurances', selectedInsurance.id);
      const insSnap = await getDoc(insRef);
      if (insSnap.exists()) {
        const insData = insSnap.data() as InsuranceRequest;
        const currentTotalPaid = insData.totalPaid || 0;
        const newTotalPaid = currentTotalPaid + amt;
        const totalPrice = insData.totalFinal || insData.totalPrice || 0;
        
        let newStatus = insData.status;
        if (newTotalPaid >= totalPrice) {
          newStatus = 'paid';
        } else if (newTotalPaid > 0) {
          newStatus = 'partially_paid';
        }

        const newBalance = totalPrice - newTotalPaid;
        const shouldClose = -5 < newBalance && newBalance < 5;
        const updateFields: any = {
          totalPaid: newTotalPaid,
          status: newStatus,
          commissionStatus: 'paid',
          commissionPaymentDate: new Date().toISOString().split('T')[0],
          commissionPaymentMethod: 'Descuento comision',
          commissionPaymentCurrency: 'USD',
          commissionPaymentAmount: insData.agentCommission || amt,
          commissionPaymentExchangeRate: 1
        };
        if (shouldClose) {
          updateFields.closed = true;
        }

        await updateDoc(insRef, updateFields);
        setSelectedInsurance(prev => prev ? { ...prev, ...updateFields } : null);
      }

      // 4. Log to bitacora
      try {
        await addDoc(collection(db, 'insuranceActivities'), {
          insuranceId: selectedInsurance.id,
          type: 'automatic',
          description: `Se aplicó descuento de comisión por $${amt.toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD. Se generó Pago de Cliente y Pago de Comisión con método "Descuento comision".`,
          date: new Date(),
          createdBy: auth.currentUser?.email || profile?.email || 'Sistema'
        });
      } catch (logErr) {
        console.error("Error logging discount activity:", logErr);
      }

      alert('Descuento de comisión aplicado con éxito.');
      setShowDiscountCommissionModal(false);
    } catch (err) {
      console.error("Error saving discount commission:", err);
      alert('Ocurrió un error al procesar el descuento de comisión.');
    } finally {
      setIsSavingDiscountCommission(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPaymentIds.length === 0) return;
    confirmAction(
      'Eliminar Registros Masivamente',
      `¿Estás seguro de eliminar los ${selectedPaymentIds.length} registros seleccionados? Esta acción es irreversible y actualizará consecutivamente los montos de pólizas.`,
      async () => {
        setSubmitting(true);
        try {
          const insuranceUpdates: { [id: string]: { amountSubtract: number } } = {};
          const paymentDeletes: string[] = [];

          for (const paymentId of selectedPaymentIds) {
            const payment = payments.find(p => p.id === paymentId);
            if (!payment) continue;
            paymentDeletes.push(paymentId);

            if (payment.type === 'client_payment' && payment.status === 'completed' && payment.insuranceId) {
              if (!insuranceUpdates[payment.insuranceId]) {
                insuranceUpdates[payment.insuranceId] = { amountSubtract: 0 };
              }
              insuranceUpdates[payment.insuranceId].amountSubtract += payment.amount || 0;
            }
          }

          // Build batch operations
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

          // Queue payment deletes
          for (const paymentId of paymentDeletes) {
            currentBatch.delete(doc(db, 'payments', paymentId));
            addOp();
          }

          // Queue insurance status updates
          for (const [insId, updateInfo] of Object.entries(insuranceUpdates)) {
            const insurance = insurances.find(ins => ins.id === insId);
            if (insurance) {
              const newTotalPaid = (insurance.totalPaid || 0) - updateInfo.amountSubtract;
              const totalPrice = insurance.totalFinal || insurance.totalPrice;
              let newStatus = insurance.status;
              if (newTotalPaid <= 0) {
                newStatus = 'pending';
              } else if (newTotalPaid < totalPrice) {
                newStatus = 'partially_paid';
              } else {
                newStatus = 'paid';
              }
              currentBatch.update(doc(db, 'insurances', insId), {
                totalPaid: newTotalPaid,
                status: newStatus
              });
              addOp();
            }
          }

          if (opCount > 0) {
            batches.push(currentBatch);
          }

          await Promise.all(batches.map(b => b.commit()));
          setSelectedPaymentIds([]);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `payments/bulk`);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleDeleteAllFilteredIncomes = async () => {
    if (visibleIncomes.length === 0) return;
    confirmAction(
      'Eliminar Todos los Ingresos Filtrados',
      `¿Estás seguro de eliminar los ${visibleIncomes.length} ingresos actualmente filtrados/mostrados de la base de datos? Esta acción es irreversible, eliminará permanentemente estos registros de depósitos y restará sus montos de las pólizas relacionadas para actualizar sus estados de pago.`,
      async () => {
        setSubmitting(true);
        try {
          const insuranceUpdates: { [id: string]: { amountSubtract: number } } = {};
          const paymentDeletes: string[] = [];

          for (const payment of visibleIncomes) {
            if (!payment.id) continue;
            paymentDeletes.push(payment.id);

            if (payment.type === 'client_payment' && payment.status === 'completed' && payment.insuranceId) {
              if (!insuranceUpdates[payment.insuranceId]) {
                insuranceUpdates[payment.insuranceId] = { amountSubtract: 0 };
              }
              insuranceUpdates[payment.insuranceId].amountSubtract += payment.amount || 0;
            }
          }

          // Build batch operations
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

          // Queue payment deletes
          for (const paymentId of paymentDeletes) {
            currentBatch.delete(doc(db, 'payments', paymentId));
            addOp();
          }

          // Queue insurance status updates
          for (const [insId, updateInfo] of Object.entries(insuranceUpdates)) {
            const insurance = insurances.find(ins => ins.id === insId);
            if (insurance) {
              const newTotalPaid = (insurance.totalPaid || 0) - updateInfo.amountSubtract;
              const totalPrice = insurance.totalFinal || insurance.totalPrice;
              let newStatus = insurance.status;
              if (newTotalPaid <= 0) {
                newStatus = 'pending';
              } else if (newTotalPaid < totalPrice) {
                newStatus = 'partially_paid';
              } else {
                newStatus = 'paid';
              }
              currentBatch.update(doc(db, 'insurances', insId), {
                totalPaid: newTotalPaid,
                status: newStatus
              });
              addOp();
            }
          }

          if (opCount > 0) {
            batches.push(currentBatch);
          }

          await Promise.all(batches.map(b => b.commit()));
          setSelectedPaymentIds([]);
          setIncomePage(1);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `payments/bulk-all-filtered`);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleBulkEditSave = async () => {
    if (selectedPaymentIds.length === 0) return;
    confirmAction(
      'Actualizar Registros Masivamente',
      `¿Estás seguro de aplicar estos cambios a los ${selectedPaymentIds.length} registros seleccionados?`,
      async () => {
        setSubmitting(true);
        try {
          for (const paymentId of selectedPaymentIds) {
            const oldPayment = payments.find(p => p.id === paymentId);
            if (!oldPayment) continue;

            const updateObj: any = {
              updatedAt: serverTimestamp()
            };

            if (bulkEditData.status) updateObj.status = bulkEditData.status;
            if (bulkEditData.paymentMethod) updateObj.paymentMethod = bulkEditData.paymentMethod;
            if (bulkEditData.date) {
              updateObj.date = new Date(bulkEditData.date);
            }
            
            // Category/subcategory can only be set on provider_payment (expenses)
            if (oldPayment.type === 'provider_payment') {
              if (bulkEditData.categoryId) updateObj.categoryId = bulkEditData.categoryId;
              if (bulkEditData.subcategoryId) updateObj.subcategoryId = bulkEditData.subcategoryId;
            }

            await updateDoc(doc(db, 'payments', paymentId), updateObj);

            // Update insurance payment status and totalPaid if status or type changes
            if (oldPayment.type === 'client_payment') {
              const insurance = insurances.find(ins => ins.id === oldPayment.insuranceId);
              if (insurance) {
                let newTotalPaid = insurance.totalPaid || 0;
                
                if (bulkEditData.status === 'completed' && oldPayment.status !== 'completed') {
                  newTotalPaid += oldPayment.amount;
                } else if (bulkEditData.status === 'pending' && oldPayment.status === 'completed') {
                  newTotalPaid -= oldPayment.amount;
                }

                if (newTotalPaid !== (insurance.totalPaid || 0)) {
                  const totalPrice = insurance.totalFinal || insurance.totalPrice;
                  let newStatus = insurance.status;
                  if (newTotalPaid >= totalPrice) {
                    newStatus = 'paid';
                  } else if (newTotalPaid > 0) {
                    newStatus = 'partially_paid';
                  } else {
                    newStatus = 'pending';
                  }
                  await updateDoc(doc(db, 'insurances', insurance.id!), {
                    totalPaid: newTotalPaid,
                    status: newStatus
                  });
                }
              }
            }
          }
          setShowBulkEditModal(false);
          setBulkEditData({});
          setSelectedPaymentIds([]);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `payments/bulk`);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleDeletePayment = async (paymentId: string) => {
    try {
      const payment = payments.find(p => p.id === paymentId);
      if (!payment) return;

      await deleteDoc(doc(db, 'payments', paymentId));

      // If it was a client payment, update the insurance totalPaid
      if (payment.type === 'client_payment' && payment.status === 'completed') {
        const insurance = insurances.find(ins => ins.id === payment.insuranceId);
        if (insurance) {
          const newTotalPaid = (insurance.totalPaid || 0) - payment.amount;
          const totalPrice = insurance.totalFinal || insurance.totalPrice;
          let newStatus = insurance.status;
          if (newTotalPaid <= 0) {
            newStatus = 'pending';
          } else if (newTotalPaid < totalPrice) {
            newStatus = 'partially_paid';
          } else {
            newStatus = 'paid';
          }
          await updateDoc(doc(db, 'insurances', insurance.id!), {
            totalPaid: newTotalPaid,
            status: newStatus
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `payments/${paymentId}`);
    }
  };

  const handleSaveEditedPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;
    confirmAction(
      'Actualizar Pago',
      '¿Estás seguro de guardar los cambios en este pago?',
      async () => {
        setSubmitting(true);
        try {
          const oldPayment = payments.find(p => p.id === editingPayment.id);
          if (!oldPayment) return;

          const { id, createdAt, ...data } = editingPayment;
          
          // Convert date string to Date object if it's a string
          const processedData: any = {
            ...data,
            date: typeof data.date === 'string' ? new Date(data.date) : data.date,
            updatedAt: serverTimestamp()
          };

          // Clean undefined values
          const cleanProcessedData: any = {};
          Object.keys(processedData).forEach(key => {
            if (processedData[key] !== undefined) {
              cleanProcessedData[key] = processedData[key];
            }
          });

          await updateDoc(doc(db, 'payments', id!), cleanProcessedData);

          // If it's a client payment and amount changed, update insurance
          if (data.type === 'client_payment' && data.status === 'completed') {
            const insurance = insurances.find(ins => ins.id === data.insuranceId);
            if (insurance) {
              const diff = data.amount - oldPayment.amount;
              if (diff !== 0) {
                const newTotalPaid = (insurance.totalPaid || 0) + diff;
                const totalPrice = insurance.totalFinal || insurance.totalPrice;
                let newStatus = insurance.status;
                if (newTotalPaid >= totalPrice) {
                  newStatus = 'paid';
                } else if (newTotalPaid > 0) {
                  newStatus = 'partially_paid';
                } else {
                  newStatus = 'pending';
                }
                await updateDoc(doc(db, 'insurances', insurance.id!), {
                  totalPaid: newTotalPaid,
                  status: newStatus
                });
              }
            }
          }
          setEditingPayment(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `payments/${editingPayment.id}`);
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const providerPaymentsMap = useMemo(() => {
    const map = new Map<string, number>();
    payments.forEach(p => {
      if (p.type === 'provider_payment' && p.insuranceId) {
        map.set(p.insuranceId, (map.get(p.insuranceId) || 0) + p.amount);
      }
    });
    return map;
  }, [payments]);

  const policiesMap = useMemo(() => {
    const map = new Map<string, Policy>();
    policies.forEach(p => {
      if (p.id) {
        map.set(p.id, p);
      }
    });
    return map;
  }, [policies]);

  const invoiceGroups = useMemo(() => {
    const groups: Record<string, {
      invoiceNumber: string;
      insurances: InsuranceRequest[];
      totalCost: number;
      paidAmount: number;
      pendingAmount: number;
      status: 'paid' | 'partial' | 'pending';
      validation: {
        isCotejado: boolean;
        isValid: boolean;
        discrepancies: {
          insuranceId: string;
          insuredName: string;
          policyId: string;
          policyName: string;
          actualCost: number;
          expectedCost: number;
          difference: number;
          reason: 'policy_not_found' | 'cost_mismatch';
        }[];
        totalExpectedCost: number;
      };
    }> = {};

    insurances.forEach(ins => {
      const invKey = (ins.InvoiceCaremed || 'Sin Invoice / No Facturado').trim();
      if (!groups[invKey]) {
        groups[invKey] = {
          invoiceNumber: invKey,
          insurances: [],
          totalCost: 0,
          paidAmount: 0,
          pendingAmount: 0,
          status: 'pending',
          validation: {
            isCotejado: false,
            isValid: false,
            discrepancies: [],
            totalExpectedCost: 0
          }
        };
      }
      
      const group = groups[invKey];
      group.insurances.push(ins);
      
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      const currentCost = (ins.totalCost || 0) * mul;
      group.totalCost += currentCost;

      let providerPaid = providerPaymentsMap.get(ins.id || '') || 0;
      if (ins.providerPaymentStatus === 'paid') {
        providerPaid = (ins.totalCost || 0) * mul;
      }
      group.paidAmount += providerPaid;
    });

    return Object.values(groups).map(g => {
      const pending = g.totalCost - g.paidAmount;
      g.pendingAmount = pending > 0.01 ? pending : 0;
      if (g.pendingAmount === 0 && g.totalCost > 0) {
        g.status = 'paid';
      } else if (g.paidAmount > 0.01) {
        g.status = 'partial';
      } else {
        g.status = 'pending';
      }

      // Live policy validation
      const isCotejado = !g.invoiceNumber.startsWith('Sin Invoice');
      const discrepancies: {
        insuranceId: string;
        insuredName: string;
        policyId: string;
        policyName: string;
        actualCost: number;
        expectedCost: number;
        difference: number;
        reason: 'policy_not_found' | 'cost_mismatch';
      }[] = [];

      let totalExpected = 0;

      if (isCotejado) {
        g.insurances.forEach(ins => {
          const matchedPolicy = policiesMap.get(ins.policyId || '');
          const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
          const actualCost = (ins.totalCost || 0) * mul;

          if (!matchedPolicy) {
            discrepancies.push({
              insuranceId: ins.id || '',
              insuredName: `${ins.firstName} ${ins.lastName}`,
              policyId: ins.policyId || 'N/A',
              policyName: ins.policyName || 'N/A',
              actualCost,
              expectedCost: 0,
              difference: actualCost,
              reason: 'policy_not_found'
            });
          } else {
            let expectedCostUnit = 0;
            const days = ins.days || 0;
            if (days <= 39) {
              expectedCostUnit = (matchedPolicy.costPerDay || 0) * days;
            } else {
              const months = Math.ceil(days / 30.4);
              expectedCostUnit = ((matchedPolicy.costPerDay || 0) * 30) * months;
            }
            const expectedCost = expectedCostUnit * mul;
            totalExpected += expectedCost;

            const diff = actualCost - expectedCost;
            if (Math.abs(diff) > 0.05) {
              discrepancies.push({
                insuranceId: ins.id || '',
                insuredName: `${ins.firstName} ${ins.lastName}`,
                policyId: ins.policyId,
                policyName: matchedPolicy.name || ins.policyName || 'N/A',
                actualCost,
                expectedCost,
                difference: diff,
                reason: 'cost_mismatch'
              });
            }
          }
        });
      }

      g.validation = {
        isCotejado,
        isValid: isCotejado && discrepancies.length === 0,
        discrepancies,
        totalExpectedCost: isCotejado ? totalExpected : g.totalCost
      };

      return g;
    }).sort((a, b) => {
      if (a.invoiceNumber.startsWith('Sin Invoice')) return 1;
      if (b.invoiceNumber.startsWith('Sin Invoice')) return -1;
      return b.invoiceNumber.localeCompare(a.invoiceNumber);
    });
  }, [insurances, providerPaymentsMap, policiesMap]);

  const totalPayableInvoices = useMemo(() => {
    return invoiceGroups.reduce((sum, g) => sum + g.pendingAmount, 0);
  }, [invoiceGroups]);

  const filteredInvoiceGroups = useMemo(() => {
    let result = invoiceGroups;
    if (payableFilter === 'pending') {
      result = result.filter(g => g.pendingAmount > 0.01);
    }
    
    if (payableValidationFilter === 'valid') {
      result = result.filter(g => g.validation.isCotejado && g.validation.isValid);
    } else if (payableValidationFilter === 'invalid') {
      result = result.filter(g => g.validation.isCotejado && !g.validation.isValid);
    } else if (payableValidationFilter === 'uncotejado') {
      result = result.filter(g => !g.validation.isCotejado);
    }
    
    return result;
  }, [invoiceGroups, payableFilter, payableValidationFilter]);

  const handleToggleInvoiceSelection = (invKey: string) => {
    setSelectedInvoiceKeys(prev => 
      prev.includes(invKey) ? prev.filter(k => k !== invKey) : [...prev, invKey]
    );
  };

  const handleSelectAllInvoices = () => {
    const pendingKeys = invoiceGroups
      .filter(g => g.pendingAmount > 0.01)
      .map(g => g.invoiceNumber);

    if (selectedInvoiceKeys.length === pendingKeys.length) {
      setSelectedInvoiceKeys([]);
    } else {
      setSelectedInvoiceKeys(pendingKeys);
    }
  };

  const processBulkInvoicesPayment = async () => {
    if (selectedInvoiceKeys.length === 0) return;
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      for (const invNum of selectedInvoiceKeys) {
        const group = invoiceGroups.find(g => g.invoiceNumber === invNum);
        if (!group) continue;

        let totalInvoiceAmount = 0;
        for (const ins of group.insurances) {
          const providerPaid = payments
            .filter(p => p.insuranceId === ins.id && p.type === 'provider_payment')
            .reduce((sum, p) => sum + p.amount, 0);
          
          const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
          const remaining = (ins.totalCost * mul) - providerPaid;

          if (remaining > 0.01) {
            totalInvoiceAmount += remaining;
          }

          // A los seguros solo se le pone Pagado CareMed con la fecha de pago
          const insRef = doc(db, 'insurances', ins.id);
          batch.update(insRef, {
            providerPaymentStatus: 'paid',
            providerPaymentMethod: 'Pagado CareMed',
            providerPaymentDate: invoicePaymentDate || new Date().toISOString().split('T')[0]
          });
        }

        // En Gastos USD se coloca solo el número del Invoice
        if (totalInvoiceAmount > 0.01) {
          const paymentRef = doc(collection(db, 'payments'));
          batch.set(paymentRef, {
            amount: totalInvoiceAmount,
            currency: 'USD',
            type: 'provider_payment',
            status: 'completed',
            date: invoicePaymentDate ? new Date(invoicePaymentDate + 'T12:00:00') : new Date(),
            paymentMethod: invoicePaymentMethod || 'N/A',
            depositAccount: invoiceDepositAccount || '',
            invoiceNumber: invNum === 'Sin Invoice / No Facturado' ? 'PENDING' : invNum,
            notes: invNum, // Solo el numero del Invoice
            createdAt: serverTimestamp()
          });
        }
      }
      await batch.commit();
      setSelectedInvoiceKeys([]);
      setShowInvoicePrompt(false);
      // Reset forms
      setInvoicePaymentDate(new Date().toISOString().split('T')[0]);
      setInvoicePaymentMethod('');
      setInvoiceDepositAccount('');
      alert('Pagos de invoice confirmados correctamente.');
    } catch (error) {
      console.error(error);
      alert('Error al registrar pagos.');
    } finally {
      setSubmitting(false);
    }
  };

  const processDifferencePayment = async () => {
    if (!selectedDifferenceGroup) return;
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const group = selectedDifferenceGroup;
      const invNum = group.invoiceNumber;

      let totalAmountToPay = 0;
      if (selectedAmountType === 'registered') {
        totalAmountToPay = group.pendingAmount;
      } else if (selectedAmountType === 'expected') {
        totalAmountToPay = Math.max(0, group.validation.totalExpectedCost - group.paidAmount);
      } else {
        totalAmountToPay = parseFloat(customPaymentAmount) || 0;
      }

      if (totalAmountToPay <= 0) {
        alert('Por favor, ingresa un monto válido a pagar.');
        setSubmitting(false);
        return;
      }

      // En Gastos USD se coloca solo el número del Invoice
      const paymentRef = doc(collection(db, 'payments'));
      batch.set(paymentRef, {
        amount: totalAmountToPay,
        currency: 'USD',
        type: 'provider_payment',
        status: 'completed',
        date: invoicePaymentDate ? new Date(invoicePaymentDate + 'T12:00:00') : new Date(),
        paymentMethod: invoicePaymentMethod || 'N/A',
        depositAccount: invoiceDepositAccount || '',
        invoiceNumber: invNum === 'Sin Invoice / No Facturado' ? 'PENDING' : invNum,
        notes: invNum, // Solo el número del Invoice
        createdAt: serverTimestamp()
      });

      // A los seguros solo se le pone Pagado CareMed con la fecha de pago
      for (const ins of group.insurances) {
        const insRef = doc(db, 'insurances', ins.id);
        batch.update(insRef, {
          providerPaymentStatus: 'paid',
          providerPaymentMethod: 'Pagado CareMed',
          providerPaymentDate: invoicePaymentDate || new Date().toISOString().split('T')[0]
        });
      }

      await batch.commit();
      setDifferenceModalOpen(false);
      setSelectedDifferenceGroup(null);
      // Reset forms
      setInvoicePaymentDate(new Date().toISOString().split('T')[0]);
      setInvoicePaymentMethod('');
      setInvoiceDepositAccount('');
      alert('Pago registrado con éxito tras resolver la diferencia.');
    } catch (error) {
      console.error(error);
      alert('Error al registrar el pago de la diferencia.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteInvoice = async (invoiceNumber: string) => {
    if (!isSuperAdmin) {
      alert("Solo el super administrador puede realizar esta acción.");
      return;
    }

    const group = invoiceGroups.find(g => g.invoiceNumber === invoiceNumber);
    if (!group) return;

    confirmAction(
      "Borrar Invoice",
      `¿Estás seguro de eliminar el invoice "${invoiceNumber}"? Esto desvinculará sus ${group.insurances.length} pólizas y eliminará todos los pagos asociados a este invoice.`,
      async () => {
        setSubmitting(true);
        try {
          const batch = writeBatch(db);

          // 1. Set InvoiceCaremed to null for all insurances in this invoice group
          group.insurances.forEach(ins => {
            batch.update(doc(db, 'insurances', ins.id!), { InvoiceCaremed: null });
          });

          // 2. Find and delete provider payments associated with this invoiceNumber
          const paymentsToDelete = payments.filter(p => 
            p.type === 'provider_payment' && 
            (p.invoiceNumber === invoiceNumber || (p.insuranceId && group.insurances.some(ins => ins.id === p.insuranceId)))
          );

          paymentsToDelete.forEach(p => {
            batch.delete(doc(db, 'payments', p.id));
          });

          await batch.commit();

          // Clear selection if it was selected
          setSelectedInvoiceKeys(prev => prev.filter(k => k !== invoiceNumber));

          alert("Invoice eliminado correctamente.");
        } catch (error) {
          console.error("Error al borrar invoice:", error);
          alert("Error al intentar borrar el invoice.");
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    confirmAction(
      expenseForm.id ? 'Actualizar Gasto' : 'Crear Gasto',
      `¿Estás seguro de ${expenseForm.id ? 'actualizar' : 'crear'} este registro de gasto?`,
      async () => {
        setSubmitting(true);
        try {
          const data: any = {
            ...expenseForm,
            date: typeof expenseForm.date === 'string' ? new Date(expenseForm.date) : expenseForm.date,
            updatedAt: serverTimestamp()
          };

          if (expenseForm.id) {
            const { id, createdAt, ...updateData } = data;
            
            // Clean undefined values
            const cleanUpdateData: any = {};
            Object.keys(updateData).forEach(key => {
              if (updateData[key] !== undefined) {
                cleanUpdateData[key] = updateData[key];
              }
            });

            await updateDoc(doc(db, 'payments', id!), cleanUpdateData);
          } else {
            data.createdAt = serverTimestamp();
            
            // Clean undefined values
            const cleanData: any = {};
            Object.keys(data).forEach(key => {
              if (data[key] !== undefined) {
                cleanData[key] = data[key];
              }
            });

            await addDoc(collection(db, 'payments'), cleanData);
          }
          setShowExpenseModal(false);
          setExpenseForm({
            type: 'provider_payment',
            currency: 'USD',
            status: 'completed',
            date: new Date().toISOString().split('T')[0],
            amount: 0,
            exchangeRate: 17.5,
            amountMXP: 0
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'payments');
        } finally {
          setSubmitting(false);
        }
      }
    );
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModalState({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModalState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDownloadIncomes = () => {
    if (visibleIncomes.length === 0) return;

    const dataToExport = visibleIncomes.map(item => {
      const p = item as any;
      const insurance = insurances.find(ins => ins.id === p.insuranceId);
      let formattedDate = '';
      if (p.date) {
        if (typeof p.date.toDate === 'function') {
          formattedDate = format(p.date.toDate(), 'yyyy-MM-dd');
        } else {
          formattedDate = format(new Date(p.date), 'yyyy-MM-dd');
        }
      }
      return {
        'IDSeg': insurance?.IDseg || '',
        'Poliza ID': p.insuranceId || '',
        'Cliente Email': p.clientEmail || insurance?.email || '',
        'Cliente Nombre': insurance ? `${insurance.firstName} ${insurance.lastName}` : '',
        'Fecha de Pago': formattedDate,
        'Monto USD': p.amount || 0,
        'Monto MXP': p.amountMXP || 0,
        'Metodo de Pago': p.paymentMethod || '',
        'Tipo de Pago': p.paymentType || '',
        'Referencia': p.reference || '',
        'Recibo': p.receiptNumber || '',
        'Notas': p.notes || '',
        'Estado': p.status || ''
      };
    });

    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pagos_exportados_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadReceipt = async (insurance: InsuranceRequest) => {
    const doc = new jsPDF();
    const insurancePayments = payments.filter(p => p.insuranceId === insurance.id);
    
    // Header
    doc.setFillColor(37, 99, 235); // Blue-600
    doc.rect(0, 0, 210, 40, 'F');

    // Logo
    try {
      const logoUrl = companySettings?.logoUrlDark || companySettings?.logoUrl || APP_LOGO;
      const img = new Image();
      img.src = logoUrl;
      img.crossOrigin = "Anonymous";
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
      if (img.complete && img.naturalWidth > 0) {
        const logoWidth = 30;
        const logoHeight = (img.naturalHeight * logoWidth) / img.naturalWidth;
        doc.addImage(img, 'PNG', 15, 20 - logoHeight / 2, logoWidth, logoHeight);
      }
    } catch (e) {
      console.error("Error adding logo to manual receipt:", e);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text('RECIBO DE PAGO', 105, 25, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString()}`, 150, 50);
    doc.text(`Recibo No: ${insurance.receiptNumber || 'N/A'}`, 150, 55);
    
    // Client Info
    doc.setFontSize(14);
    doc.text('Información del Cliente', 20, 70);
    doc.line(20, 72, 80, 72);
    doc.setFontSize(10);
    doc.text(`Nombre: ${insurance.firstName} ${insurance.lastName}`, 20, 80);
    doc.text(`Email: ${insurance.email}`, 20, 85);
    doc.text(`Tipo: ${insurance.clientType}`, 20, 90);
    
    // Policy Info
    doc.setFontSize(14);
    doc.text('Detalles del Seguro', 110, 70);
    doc.line(110, 72, 170, 72);
    doc.setFontSize(10);
    doc.text(`Póliza: ${insurance.policyId}`, 110, 80);
    doc.text(`Vigencia: ${insurance.startDate} al ${insurance.endDate}`, 110, 85);
    doc.text(`Días: ${insurance.days}`, 110, 90);
    
    // Payments Table
    doc.setFontSize(14);
    doc.text('Historial de Pagos', 20, 110);
    
    const tableData = insurancePayments.map(p => [
      p.date?.toDate ? p.date.toDate().toLocaleDateString() : new Date(p.date).toLocaleDateString(),
      p.paymentMethod || 'N/A',
      p.currency,
      p.currency === 'USD' ? `$${p.amount.toLocaleString()}` : `$${(p.amountMXP || 0).toLocaleString()}`,
      p.status === 'completed' ? 'Completado' : 'Pendiente'
    ]);
    
    autoTable(doc, {
      startY: 115,
      head: [['Fecha', 'Método', 'Moneda', 'Monto', 'Estado']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] }
    });
    
    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.text(`Total Póliza: $${(insurance.totalFinal || insurance.totalPrice).toLocaleString()} USD`, 140, finalY);
    doc.setTextColor(22, 163, 74); // Green-600
    doc.text(`Total Pagado: $${(insurance.totalPaid || 0).toLocaleString()} USD`, 140, finalY + 7);
    doc.setTextColor(220, 38, 38); // Red-600
    doc.text(`Saldo Pendiente: $${((insurance.totalFinal || insurance.totalPrice) - (insurance.totalPaid || 0)).toLocaleString()} USD`, 140, finalY + 14);
    
    doc.save(`Recibo_${insurance.firstName}_${insurance.lastName}_${insurance.id?.slice(0, 8)}.pdf`);
  };

  // Dashboard KPI Calculations
  const dashboardData = useMemo(() => {
    const filteredInsurances = insurances.filter(ins => {
      const dateStr = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString() : new Date(ins.createdAt).toISOString());
      const date = parseISO(dateStr.split('T')[0]);
      
      const inRange = isWithinInterval(date, {
        start: parseISO(dashboardFilters.startDate),
        end: parseISO(dashboardFilters.endDate)
      });
      const matchesPlan = dashboardFilters.plan === 'all' || ins.plan === dashboardFilters.plan;
      const matchesClientType = dashboardFilters.clientType === 'all' || ins.clientType === dashboardFilters.clientType;
      const matchesPolicy = dashboardFilters.policyId === 'all' || ins.policyId === dashboardFilters.policyId;
      const matchesClient = dashboardFilters.clientId === 'all' || ins.email === dashboardFilters.clientId;
      
      const today = format(new Date(), 'yyyy-MM-dd');
      let opStatus = 'Activo';
      if (ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled') opStatus = 'Cancelado';
      else if (today > ins.endDate) opStatus = 'Terminado';

      const matchesOpStatus = dashboardFilters.operationalStatus === 'all' || opStatus === dashboardFilters.operationalStatus;

      return inRange && matchesPlan && matchesClientType && matchesPolicy && matchesClient && matchesOpStatus;
    });

    const totalSales = filteredInsurances.reduce((sum, ins) => {
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      return sum + ((ins.totalFinal || ins.totalPrice || 0) * mul);
    }, 0);
    const totalPaid = filteredInsurances.reduce((sum, ins) => {
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      return sum + ((ins.totalPaid || 0) * mul);
    }, 0);
    const totalCost = filteredInsurances.reduce((sum, ins) => {
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      return sum + ((ins.totalCost || 0) * mul);
    }, 0);
    const totalCommissions = filteredInsurances.reduce((sum, ins) => {
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      return sum + ((ins.agentCommission || 0) * mul);
    }, 0);
    const netProfit = totalSales - totalCost - totalCommissions;

    // Data for charts
    const salesByPlan: any = {};
    const salesByClientType: any = {};
    const salesOverTime: any = {};

    filteredInsurances.forEach(ins => {
      const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
      // Sales by Plan
      const planName = ins.plan || ins.policyName || 'Otros';
      salesByPlan[planName] = (salesByPlan[planName] || 0) + ((ins.totalFinal || ins.totalPrice || 0) * mul);

      // Sales by Client Type
      const clientType = ins.clientType || 'Individual';
      salesByClientType[clientType] = (salesByClientType[clientType] || 0) + ((ins.totalFinal || ins.totalPrice || 0) * mul);

      // Sales Over Time
      const dateStr = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString() : new Date(ins.createdAt).toISOString());
      const dateKey = format(parseISO(dateStr.split('T')[0]), 'yyyy-MM-dd');
      salesOverTime[dateKey] = (salesOverTime[dateKey] || 0) + ((ins.totalFinal || ins.totalPrice || 0) * mul);
    });

    const planChartData = Object.keys(salesByPlan).map(name => ({ name, value: salesByPlan[name] }));
    const clientTypeChartData = Object.keys(salesByClientType).map(name => ({ name, value: salesByClientType[name] }));
    const timeChartData = Object.keys(salesOverTime).sort().map(date => ({ date, sales: salesOverTime[date] }));

    return {
      kpis: {
        totalSales,
        totalPaid,
        pendingBalance: totalSales - totalPaid,
        totalCost,
        totalCommissions,
        netProfit,
        count: filteredInsurances.length,
        avgValue: filteredInsurances.length > 0 ? totalSales / filteredInsurances.length : 0
      },
      charts: {
        planChartData,
        clientTypeChartData,
        timeChartData
      }
    };
  }, [insurances, dashboardFilters]);

  const uniquePlans = useMemo(() => {
    const set = new Set(insurances.map(ins => ins.plan).filter(Boolean));
    return Array.from(set).sort();
  }, [insurances]);

  const uniquePolicies = useMemo(() => {
    const policiesMap = new Map();
    insurances.forEach(ins => {
      if (ins.policyId && !policiesMap.has(ins.policyId)) {
        policiesMap.set(ins.policyId, ins.policyName || ins.policyId);
      }
    });
    return Array.from(policiesMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [insurances]);

  const uniqueClients = useMemo(() => {
    const clientsMap = new Map();
    insurances.forEach(ins => {
      if (!clientsMap.has(ins.email)) {
        clientsMap.set(ins.email, `${ins.firstName} ${ins.lastName}`);
      }
    });
    return Array.from(clientsMap.entries()).map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [insurances]);

  const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  
  const uniqueIncomesMethods = useMemo(() => {
    const list = payments.filter(p => p.type === 'client_payment').map(p => p.paymentMethod?.trim()).filter(Boolean);
    return Array.from(new Set(list)) as string[];
  }, [payments]);

  const uniqueIncomesAccounts = useMemo(() => {
    const list = payments.filter(p => p.type === 'client_payment').map(p => p.depositAccount?.trim()).filter(Boolean);
    return Array.from(new Set(list)) as string[];
  }, [payments]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach(c => {
      const name = c.type === 'Individual' ? `${c.firstName} ${c.lastName}` : (c.commercialName || c.legalName || c.firstName || '');
      map.set(c.id!, name);
    });
    payments.forEach(p => {
      if (p.type === 'client_payment' && p.clientId && !map.has(p.clientId)) {
        const ins = insurances.find(i => i.id === p.insuranceId);
        const name = ins ? `${ins.firstName} ${ins.lastName}` : `Cliente ${p.clientId.slice(0, 6)}`;
        map.set(p.clientId, name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, payments, insurances]);

  const agentOptions = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach(u => {
      if (u.role === 'agent') {
        const name = u.displayName ? u.displayName.trim() : u.email;
        map.set(u.uid, name);
      }
    });
    insurances.forEach(ins => {
      if (ins.agentId && !map.has(ins.agentId)) {
        const u = users.find(usr => usr.uid === ins.agentId || usr.email === ins.agentId);
        const name = u ? (u.displayName ? u.displayName.trim() : u.email) : ins.agentId;
        map.set(ins.agentId, name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [users, insurances]);

  const visibleIncomes = useMemo(() => {
    return payments
      .filter(p => {
        if (p.type !== 'client_payment') return false;
        if ((p.currency || 'USD') !== incomeCurrencyTab) return false;

        let parsedDate = new Date();
        if (p.date) {
          if (typeof p.date.toDate === 'function') {
            parsedDate = p.date.toDate();
          } else {
            parsedDate = new Date(p.date);
          }
        }

        // Fecha Inicio
        if (incomeFilters.startDate) {
          const start = parseISO(incomeFilters.startDate);
          if (parsedDate < start) return false;
        }

        // Fecha Fin
        if (incomeFilters.endDate) {
          const end = parseISO(incomeFilters.endDate);
          const endCopy = new Date(end);
          endCopy.setHours(23, 59, 59, 999);
          if (parsedDate > endCopy) return false;
        }

        // Método de pago
        if (incomeFilters.paymentMethod !== 'all') {
          if (p.paymentMethod?.trim() !== incomeFilters.paymentMethod) return false;
        }

        // Cuenta de pago / Método cuenta
        if (incomeFilters.account !== 'all') {
          if ((p.depositAccount?.trim() || 'Sin Especificar') !== incomeFilters.account) return false;
        }

        // Estado
        if (incomeFilters.status !== 'all') {
          if (p.status !== incomeFilters.status) return false;
        }

        // Cliente
        if (incomeFilters.clientId !== 'all') {
          const insurance = insurances.find(ins => ins.id === p.insuranceId);
          const paymentClientId = p.clientId || insurance?.clientId;
          if (paymentClientId !== incomeFilters.clientId) return false;
        }

        // Agente
        if (incomeFilters.agentId !== 'all') {
          const insurance = insurances.find(ins => ins.id === p.insuranceId);
          const paymentAgentId = insurance?.agentId || insurance?.linkedAgentId;
          if (paymentAgentId !== incomeFilters.agentId) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const dateA = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date).getTime();
        const dateB = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date).getTime();
        if (incomeSortOrder === 'asc') {
          return dateA - dateB;
        } else {
          return dateB - dateA;
        }
      });
  }, [payments, incomeCurrencyTab, incomeFilters, insurances, incomeSortOrder]);

  const paginatedIncomes = useMemo(() => {
    const startIndex = (incomePage - 1) * incomePageSize;
    return visibleIncomes.slice(startIndex, startIndex + incomePageSize);
  }, [visibleIncomes, incomePage, incomePageSize]);

  const totalIncomePages = Math.ceil(visibleIncomes.length / incomePageSize);

  const visibleExpenses = useMemo(() => {
    return payments
      .filter(p => p.type === 'provider_payment' && (p.currency || 'USD') === expenseCurrencyTab)
      .sort((a, b) => {
        const dateA = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date).getTime();
        const dateB = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date).getTime();
        return dateB - dateA;
      });
  }, [payments, expenseCurrencyTab]);

  const incomeStats = useMemo(() => {
    const total = visibleIncomes.reduce((sum, p) => sum + (incomeCurrencyTab === 'USD' ? p.amount : (p.amountMXP || 0)), 0);
    return { count: visibleIncomes.length, total };
  }, [visibleIncomes, incomeCurrencyTab]);

  const expenseStats = useMemo(() => {
    const total = visibleExpenses.reduce((sum, p) => sum + (expenseCurrencyTab === 'USD' ? p.amount : (p.amountMXP || 0)), 0);
    return { count: visibleExpenses.length, total };
  }, [visibleExpenses, expenseCurrencyTab]);

  // Compute all Cash Flow operations
  const cashFlowOperations = useMemo(() => {
    return payments.map(p => {
      let parsedDate = new Date();
      if (p.date) {
        if (typeof p.date.toDate === 'function') {
          parsedDate = p.date.toDate();
        } else {
          parsedDate = new Date(p.date);
        }
      }
      
      const insurance = insurances.find(ins => ins.id === p.insuranceId);
      const client = clients.find(c => c.id === p.clientId);
      const provider = providers.find(prov => prov.id === p.providerId);
      
      // Determine Asegurado
      let asegurado = 'Sin Especificar';
      if (client) {
        asegurado = client.type === 'Individual' ? `${client.firstName} ${client.lastName}` : (client.commercialName || client.legalName || '');
      } else if (insurance) {
        asegurado = `${insurance.firstName} ${insurance.lastName}`;
      } else if (p.providerName) {
        asegurado = p.providerName;
      } else if (p.notes) {
        asegurado = p.notes;
      }
      
      // Plan and dates of coverage
      let planFechas = 'Gasto / Pago General';
      if (insurance) {
        const pName = insurance.plan || insurance.policyName || 'Póliza';
        const startStr = insurance.startDate ? insurance.startDate : '';
        const endStr = insurance.endDate ? insurance.endDate : '';
        planFechas = `${pName}${startStr && endStr ? ` (${startStr} a ${endStr})` : ''}`;
      }
      
      const tc = p.exchangeRate || exchangeRate || 17.5;
      const amountInUSD = p.currency === 'USD' ? p.amount : (p.amountMXP || 0) / tc;
      
      const ingreso = p.type === 'client_payment' ? amountInUSD : 0;
      const egreso = (p.type === 'provider_payment' || p.type === 'agent_commission') ? amountInUSD : 0;
      
      // Comisión column (comisión status or agent commission rate/amount in the policy)
      const comision = insurance ? (insurance.agentCommission || 0) : 0;
      
      // Comisión Agente (paid agent commission if any or current registered commission)
      const isAgentCommPayment = p.type === 'agent_commission';
      const comisionAgente = isAgentCommPayment ? amountInUSD : (insurance ? (insurance.agentCommission || 0) : 0);
      
      // Profit Margin: (Insurance premium - Insurance cost - Insurance commission)
      const margen = p.type === 'client_payment' && insurance
        ? ((insurance.totalFinal || insurance.totalPrice || 0) - (insurance.totalCost || 0) - (insurance.agentCommission || 0))
        : 0;
        
      return {
        id: p.id,
        parsedDate,
        asegurado,
        planFechas,
        cuentaPago: p.depositAccount?.trim() || 'Sin Especificar',
        metodo: p.paymentMethod?.trim() || 'Sin Especificar',
        ingreso,
        egreso,
        comision,
        comisionAgente,
        margen,
        status: p.status || 'completed',
        rawPayment: p
      };
    });
  }, [payments, insurances, clients, providers, exchangeRate]);

  // Apply filters on Cash Flow operations
  const filteredOperations = useMemo(() => {
    return cashFlowOperations.filter(op => {
      // Date bounds
      if (cashFlowFilters.startDate) {
        const start = parseISO(cashFlowFilters.startDate);
        if (op.parsedDate < start) return false;
      }
      if (cashFlowFilters.endDate) {
        const end = parseISO(cashFlowFilters.endDate);
        const endCopy = new Date(end);
        endCopy.setHours(23, 59, 59, 999);
        if (op.parsedDate > endCopy) return false;
      }
      
      // Type bound
      if (cashFlowFilters.type === 'income' && op.ingreso === 0) return false;
      if (cashFlowFilters.type === 'expense' && op.egreso === 0) return false;
      
      // Account bound
      if (cashFlowFilters.account !== 'all') {
        if (op.cuentaPago.toLowerCase() !== cashFlowFilters.account.toLowerCase()) return false;
      }

      // Status bound
      if (cashFlowFilters.status !== 'all') {
        if (op.status !== cashFlowFilters.status) return false;
      }
      
      return true;
    }).sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());
  }, [cashFlowOperations, cashFlowFilters]);

  const cashFlowData = useMemo(() => {
    const monthlyFlows: Record<string, { month: string; ingresos: number; egresos: number; neto: number }> = {};
    
    filteredOperations.forEach(op => {
      const year = op.parsedDate.getFullYear();
      const month = String(op.parsedDate.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`; // 'yyyy-MM'
      
      if (!monthlyFlows[monthKey]) {
        monthlyFlows[monthKey] = { month: monthKey, ingresos: 0, egresos: 0, neto: 0 };
      }
      
      monthlyFlows[monthKey].ingresos += op.ingreso;
      monthlyFlows[monthKey].egresos += op.egreso;
    });

    const sortedData = Object.keys(monthlyFlows).sort().map(key => {
      const item = monthlyFlows[key];
      item.neto = item.ingresos - item.egresos;
      return item;
    });

    const totalIngresos = sortedData.reduce((sum, item) => sum + item.ingresos, 0);
    const totalEgresos = sortedData.reduce((sum, item) => sum + item.egresos, 0);
    const totalNeto = totalIngresos - totalEgresos;

    return {
      chartData: sortedData,
      kpis: {
        totalIngresos,
        totalEgresos,
        totalNeto
      }
    };
  }, [filteredOperations]);

  // Unique Agent Names specifically having active balances in Accounts Receivable
  const uniqueArAgentNames = useMemo(() => {
    const relevantInsurances = insurances.filter(item => {
      if (isInsuranceClosed(item)) return false;
      const expected = item.totalFinal !== undefined && item.totalFinal !== null ? item.totalFinal : (item.totalPrice || 0);
      const balance = expected - (item.totalPaid || 0);
      return Math.abs(balance) >= 0.01;
    });
    const names = relevantInsurances.map(item => getAgentName(item)).filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [insurances, clients]);

  // Compute Accounts Receivable data and KPIs
  const accountsReceivableData = useMemo(() => {
    const items = insurances.map(ins => {
      const expected = ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : (ins.totalPrice || 0);
      const totalPaid = ins.totalPaid || 0;
      const balance = expected - totalPaid;
      return {
        ...ins,
        expected,
        totalPaid,
        balance
      };
    }).filter(item => {
      // If the insurance is closed, it must not appear in Cuentas por Cobrar
      if (isInsuranceClosed(item)) return false;

      // Must have some balance mismatch (debt or overpaid)
      if (Math.abs(item.balance) < 0.01) return false;

      // Filter by search query (Client name, IDseg, or Policy ID)
      if (accountsReceivableFilters.search) {
        const queryStr = accountsReceivableFilters.search.toLowerCase();
        const fullName = `${item.firstName} ${item.lastName}`.toLowerCase();
        const policyId = (item.policyId || '').toLowerCase();
        const IDseg = (item.IDseg || '').toLowerCase();
        if (!fullName.includes(queryStr) && !policyId.includes(queryStr) && !IDseg.includes(queryStr)) {
          return false;
        }
      }

      // Filter by type: all, deudor, overpaid
      if (accountsReceivableFilters.type === 'deudor') {
        if (item.balance <= 0.01) return false;
      } else if (accountsReceivableFilters.type === 'overpaid') {
        if (item.balance >= -0.01) return false;
      }

      // Filter by policy standard ID
      if (accountsReceivableFilters.policyId !== 'all') {
        if (item.policyId !== accountsReceivableFilters.policyId) return false;
      }

      // Filter by insurance status: active/cancelled etc.
      if (accountsReceivableFilters.status !== 'all') {
        if (accountsReceivableFilters.status === 'active') {
          const today = format(new Date(), 'yyyy-MM-dd');
          const isCancelled = item.actionType?.toUpperCase() === 'CAN' || item.status === 'cancelled';
          const isFinished = today > item.endDate;
          if (isCancelled || isFinished) return false;
        } else if (accountsReceivableFilters.status === 'cancelled') {
          const isCancelled = item.actionType?.toUpperCase() === 'CAN' || item.status === 'cancelled';
          if (!isCancelled) return false;
        } else {
          if (item.status !== accountsReceivableFilters.status) return false;
        }
      }

      // Filter by request date range (Fecha de Solicitud de/hasta)
      const itemReqDate = item.requestDate || (item.createdAt?.toDate ? format(item.createdAt.toDate(), 'yyyy-MM-dd') : (item.createdAt ? format(new Date(item.createdAt), 'yyyy-MM-dd') : ''));
      if (accountsReceivableFilters.requestDateStart) {
        if (itemReqDate < accountsReceivableFilters.requestDateStart) return false;
      }
      if (accountsReceivableFilters.requestDateEnd) {
        if (itemReqDate > accountsReceivableFilters.requestDateEnd) return false;
      }

      // Filter by Agent Name
      if (accountsReceivableFilters.agentName !== 'all') {
        const itemAgentName = getAgentName(item);
        if (itemAgentName !== accountsReceivableFilters.agentName) return false;
      }

      return true;
    });

    // Dynamic sorting (Concatenated multi-column sorting)
    items.sort((a, b) => {
      const getCompareValue = (item: any, field: string) => {
        if (field === 'requestDate') {
          return item.requestDate || (item.createdAt?.toDate ? format(item.createdAt.toDate(), 'yyyy-MM-dd') : (item.createdAt ? format(new Date(item.createdAt), 'yyyy-MM-dd') : ''));
        } else if (field === 'createdAt') {
          return item.createdAt?.toDate ? item.createdAt.toDate().getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : 0);
        } else if (field === 'name') {
          return `${item.firstName || ''} ${item.lastName || ''}`.toLowerCase().trim();
        } else if (field === 'policyId') {
          return (item.policyId || '').toLowerCase().trim();
        } else if (field === 'startDate') {
          return item.startDate || '';
        } else if (field === 'expected') {
          return item.expected || 0;
        } else if (field === 'totalPaid') {
          return item.totalPaid || 0;
        } else if (field === 'agentCommission') {
          return item.agentCommission || 0;
        } else if (field === 'balance') {
          return item.balance || 0;
        } else if (field === 'status') {
          return item.status || '';
        }
        return 0;
      };

      // 1. Compare Primary Field
      const valAPrimary = getCompareValue(a, arSortField);
      const valBPrimary = getCompareValue(b, arSortField);

      if (valAPrimary < valBPrimary) return arSortDirection === 'asc' ? -1 : 1;
      if (valAPrimary > valBPrimary) return arSortDirection === 'asc' ? 1 : -1;

      // 2. Primary equal? Compare Secondary Field
      if (arSortFieldSecondary && arSortFieldSecondary !== 'none' && arSortFieldSecondary !== arSortField) {
        const valASecondary = getCompareValue(a, arSortFieldSecondary);
        const valBSecondary = getCompareValue(b, arSortFieldSecondary);

        if (valASecondary < valBSecondary) return arSortDirectionSecondary === 'asc' ? -1 : 1;
        if (valASecondary > valBSecondary) return arSortDirectionSecondary === 'asc' ? 1 : -1;
      }

      return 0;
    });

    let totalDeuda = 0;
    let totalSobrepago = 0;
    let deudoresCount = 0;
    let overpaidCount = 0;

    items.forEach(item => {
      if (item.balance > 0.01) {
        totalDeuda += item.balance;
        deudoresCount++;
      } else if (item.balance < -0.01) {
        totalSobrepago += Math.abs(item.balance);
        overpaidCount++;
      }
    });

    return {
      items,
      kpis: {
        totalDeuda,
        totalSobrepago,
        netoAR: totalDeuda - totalSobrepago,
        deudoresCount,
        overpaidCount,
        totalCount: items.length
      }
    };
  }, [insurances, accountsReceivableFilters, arSortField, arSortDirection, arSortFieldSecondary, arSortDirectionSecondary, clients]);

  const paginatedAccountsReceivable = useMemo(() => {
    const start = (accountsReceivablePage - 1) * accountsReceivablePageSize;
    return accountsReceivableData.items.slice(start, start + accountsReceivablePageSize);
  }, [accountsReceivableData.items, accountsReceivablePage, accountsReceivablePageSize]);

  const totalARPages = Math.ceil(accountsReceivableData.items.length / accountsReceivablePageSize);

  // Compute unique accounts from operations
  const uniqueAccountsList = useMemo(() => {
    const list = payments.map(p => p.depositAccount?.trim()).filter(Boolean);
    return Array.from(new Set(list)) as string[];
  }, [payments]);

  // Segment/divide by account (Summing incomes, expenses and transaction count)
  const accountsSegmentation = useMemo(() => {
    const segmentMap: Record<string, { account: string; ingresos: number; egresos: number; count: number }> = {};
    
    // Calculated over the filtered operations so it responds to current date and filters
    filteredOperations.forEach(op => {
      const acName = op.cuentaPago || 'Sin Especificar';
      if (!segmentMap[acName]) {
        segmentMap[acName] = { account: acName, ingresos: 0, egresos: 0, count: 0 };
      }
      segmentMap[acName].ingresos += op.ingreso;
      segmentMap[acName].egresos += op.egreso;
      segmentMap[acName].count += 1;
    });
    
    return Object.values(segmentMap).sort((a, b) => b.ingresos - a.ingresos);
  }, [filteredOperations]);

  // Handle pagination over filtered operations
  const paginatedOperations = useMemo(() => {
    const startIndex = (cashFlowPage - 1) * cashFlowPageSize;
    return filteredOperations.slice(startIndex, startIndex + cashFlowPageSize);
  }, [filteredOperations, cashFlowPage, cashFlowPageSize]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredOperations.length / cashFlowPageSize) || 1;
  }, [filteredOperations, cashFlowPageSize]);

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-indigo-600 rounded-2xl">
            <BarChart3 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Reportes Financieros</h1>
            <p className="text-gray-500 text-sm">Visualiza y exporta el historial detallado de movimientos de caja.</p>
          </div>
        </div>
        {activeTab === 'dashboard' && (
          <button
            onClick={handleDownloadDashboardReport}
            className="flex items-center gap-2 bg-white text-gray-700 px-5 py-3 border border-gray-200 rounded-2xl text-sm font-bold hover:bg-gray-50 transition-all shadow-sm hover:shadow"
          >
            <Download className="w-4 h-4 text-gray-500" />
            Exportar PDF
          </button>
        )}
      </header>

      {/* Tabs Menu Capsule with single-line horizontal styling that hides the scrollbar */}
      <div className="bg-slate-50 border border-slate-100 p-1 rounded-2xl shadow-sm overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-row items-center w-full justify-between gap-1 min-w-[920px] xl:min-w-0 flex-nowrap font-sans">
          {([
            { id: 'dashboard', label: 'Resumen', icon: BarChart3 },
            { id: 'incomes', label: 'Ingresos', icon: Users },
            { id: 'expenses', label: 'Gastos', icon: Building2 },
            { id: 'accounts_payable', label: 'Cuentas por Pagar', icon: DollarSign },
            { id: 'accounts_receivable', label: 'Cuentas por Cobrar', icon: Coins },
            { id: 'reconciliation', label: 'Conciliación', icon: FileText },
            { id: 'comparison', label: 'Comparación', icon: ArrowRightLeft },
            { id: 'cash_flow', label: 'Cash Flow', icon: TrendingUp },
            { id: 'income_statement', label: 'Estado Resultados', icon: Receipt }
          ] as const).map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-2 py-2 rounded-xl font-bold transition-all whitespace-nowrap flex items-center justify-center gap-1.5 text-[10.5px] md:text-[11.5px] lg:text-xs flex-1 ${
                  isActive 
                    ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/40' 
                    : 'text-gray-500 hover:text-slate-800 hover:bg-slate-200/30'
                }`}
              >
                <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'comparison' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight">Comparativa de Periodos</h3>
              </div>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                {(['sales', 'type', 'client'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setComparisonFilters(prev => ({ ...prev, type }))}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                      comparisonFilters.type === type ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {type === 'sales' ? 'Monto Ventas' : type === 'type' ? 'Ventas por Tipo' : 'Ventas por Cliente'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Period A Filters */}
              <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                <h4 className="text-xs font-black text-blue-700 uppercase tracking-widest mb-4">Periodo A (Referencia)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-blue-400 uppercase mb-1 ml-1">Solicitud Inicio</label>
                    <input 
                      type="date" 
                      value={comparisonFilters.periodA.startDate}
                      onChange={(e) => setComparisonFilters(prev => ({ ...prev, periodA: { ...prev.periodA, startDate: e.target.value } }))}
                      className="w-full p-2.5 bg-white border border-blue-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-blue-400 uppercase mb-1 ml-1">Solicitud Fin</label>
                    <input 
                      type="date" 
                      value={comparisonFilters.periodA.endDate}
                      onChange={(e) => setComparisonFilters(prev => ({ ...prev, periodA: { ...prev.periodA, endDate: e.target.value } }))}
                      className="w-full p-2.5 bg-white border border-blue-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Period B Filters */}
              <div className="p-6 bg-purple-50 rounded-2xl border border-purple-100">
                <h4 className="text-xs font-black text-purple-700 uppercase tracking-widest mb-4">Periodo B (Contraste)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-purple-400 uppercase mb-1 ml-1">Solicitud Inicio</label>
                    <input 
                      type="date" 
                      value={comparisonFilters.periodB.startDate}
                      onChange={(e) => setComparisonFilters(prev => ({ ...prev, periodB: { ...prev.periodB, startDate: e.target.value } }))}
                      className="w-full p-2.5 bg-white border border-purple-100 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-purple-400 uppercase mb-1 ml-1">Solicitud Fin</label>
                    <input 
                      type="date" 
                      value={comparisonFilters.periodB.endDate}
                      onChange={(e) => setComparisonFilters(prev => ({ ...prev, periodB: { ...prev.periodB, endDate: e.target.value } }))}
                      className="w-full p-2.5 bg-white border border-purple-100 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none text-sm font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Results A */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h4 className="text-lg font-black text-gray-900 uppercase">Resultados Periodo A</h4>
                  <p className="text-xs text-gray-400 font-bold">{comparisonFilters.periodA.startDate} al {comparisonFilters.periodA.endDate}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-blue-600">${comparisonData.dataA.totalSales.toLocaleString()}</p>
                  <p className="text-[10px] font-black text-gray-400 uppercase">Total Ventas USD</p>
                </div>
              </div>

              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  {comparisonFilters.type === 'sales' ? (
                    <BarChart data={[{ name: 'Ventas A', value: comparisonData.dataA.totalSales }]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" hide />
                      <YAxis fontSize={10} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#2563eb" radius={[10, 10, 0, 0]} />
                    </BarChart>
                  ) : comparisonFilters.type === 'type' ? (
                    <BarChart layout="vertical" data={comparisonData.dataA.byType}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={10} />
                      <YAxis dataKey="name" type="category" fontSize={10} width={100} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#2563eb" radius={[0, 10, 10, 0]} />
                    </BarChart>
                  ) : (
                    <BarChart layout="vertical" data={comparisonData.dataA.byClient}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={10} />
                      <YAxis dataKey="name" type="category" fontSize={10} width={120} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#2563eb" radius={[0, 10, 10, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            {/* Results B */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h4 className="text-lg font-black text-gray-900 uppercase">Resultados Periodo B</h4>
                  <p className="text-xs text-gray-400 font-bold">{comparisonFilters.periodB.startDate} al {comparisonFilters.periodB.endDate}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-purple-600">${comparisonData.dataB.totalSales.toLocaleString()}</p>
                  <p className="text-[10px] font-black text-gray-400 uppercase">Total Ventas USD</p>
                </div>
              </div>

              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  {comparisonFilters.type === 'sales' ? (
                    <BarChart data={[{ name: 'Ventas B', value: comparisonData.dataB.totalSales }]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" hide />
                      <YAxis fontSize={10} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[10, 10, 0, 0]} />
                    </BarChart>
                  ) : comparisonFilters.type === 'type' ? (
                    <BarChart layout="vertical" data={comparisonData.dataB.byType}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={10} />
                      <YAxis dataKey="name" type="category" fontSize={10} width={100} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[0, 10, 10, 0]} />
                    </BarChart>
                  ) : (
                    <BarChart layout="vertical" data={comparisonData.dataB.byClient}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={10} />
                      <YAxis dataKey="name" type="category" fontSize={10} width={120} />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[0, 10, 10, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 rounded-2xl shadow-xl text-white">
              <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mb-1">Diferencia en Ventas</p>
              <h5 className="text-3xl font-black mb-2">
                {comparisonData.dataB.totalSales > comparisonData.dataA.totalSales ? '+' : ''}
                ${(comparisonData.dataB.totalSales - comparisonData.dataA.totalSales).toLocaleString()} USD
              </h5>
              <p className="text-sm font-bold text-blue-100 italic">
                {comparisonData.dataA.totalSales === 0 ? 'Referencia sin ventas' : 
                  `${(((comparisonData.dataB.totalSales - comparisonData.dataA.totalSales) / (comparisonData.dataA.totalSales)) * 100).toFixed(1)}% de variación`
                }
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Pólizas A vs B</p>
              <div className="flex items-end gap-3">
                <h5 className="text-3xl font-black text-gray-900">{comparisonData.dataA.count}</h5>
                <span className="text-gray-300 font-black text-xl mb-1">vs</span>
                <h5 className="text-3xl font-black text-purple-600">{comparisonData.dataB.count}</h5>
              </div>
              <p className="text-xs text-gray-500 font-bold mt-2">Diferencia: {comparisonData.dataB.count - comparisonData.dataA.count} pólizas</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Ticket Promedio</p>
              <div className="flex items-end gap-3">
                <h5 className="text-xl font-black text-gray-900">
                  ${(comparisonData.dataA.count > 0 ? comparisonData.dataA.totalSales / comparisonData.dataA.count : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </h5>
                <span className="text-gray-300 font-black text-xl mb-1">vs</span>
                <h5 className="text-xl font-black text-purple-600">
                  ${(comparisonData.dataB.count > 0 ? comparisonData.dataB.totalSales / comparisonData.dataB.count : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </h5>
              </div>
              <p className="text-xs text-gray-500 font-bold mt-2">Variación en ticket: $
                {((comparisonData.dataB.count > 0 ? comparisonData.dataB.totalSales / comparisonData.dataB.count : 0) - 
                  (comparisonData.dataA.count > 0 ? comparisonData.dataA.totalSales / comparisonData.dataA.count : 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Filters */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-gray-900">Filtros del Dashboard</h3>
              </div>
              <button
                onClick={handleDownloadDashboardReport}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-md"
              >
                <Download className="w-4 h-4" />
                Descargar Reporte PDF
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Solicitud Inicio</label>
                <input 
                  type="date" 
                  value={dashboardFilters.startDate}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Solicitud Fin</label>
                <input 
                  type="date" 
                  value={dashboardFilters.endDate}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Plan</label>
                <select 
                  value={dashboardFilters.plan}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, plan: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="all">Todos los Planes</option>
                  {uniquePlans.map(plan => (
                    <option key={plan} value={plan}>{plan}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Póliza</label>
                <select 
                  value={dashboardFilters.policyId}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, policyId: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="all">Todas las Pólizas</option>
                  {uniquePolicies.map(policy => (
                    <option key={policy.id} value={policy.id}>{policy.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Tipo Cliente</label>
                <select 
                  value={dashboardFilters.clientType}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, clientType: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="all">Todos los Tipos</option>
                  <option value="Agent">Agente</option>
                  <option value="Individual">Individual</option>
                  <option value="Corporate">Corporativo</option>
                  <option value="University">Universidad</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Cliente</label>
                <select 
                  value={dashboardFilters.clientId}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, clientId: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  <option value="all">Todos los Clientes</option>
                  {uniqueClients.map(client => (
                    <option key={client.email} value={client.email}>{client.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Estado Vigencia</label>
                <select 
                  value={dashboardFilters.operationalStatus}
                  onChange={(e) => setDashboardFilters(prev => ({ ...prev, operationalStatus: e.target.value }))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold text-gray-700"
                >
                  <option value="all">Cualquier Estado</option>
                  <option value="Activo">Activo</option>
                  <option value="Cancelado">Cancelado</option>
                  <option value="Terminado">Terminado</option>
                </select>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-blue-100 p-2 rounded-lg w-fit">
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Ventas Totales</p>
                <p className="text-lg font-black text-gray-900">${dashboardData.kpis.totalSales.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-green-100 p-2 rounded-lg w-fit">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Total Recaudado</p>
                <p className="text-lg font-black text-gray-900">${dashboardData.kpis.totalPaid.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-red-100 p-2 rounded-lg w-fit">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Saldo Pendiente</p>
                <p className="text-lg font-black text-gray-900">${dashboardData.kpis.pendingBalance.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-orange-100 p-2 rounded-lg w-fit">
                <Database className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Costo</p>
                <p className="text-lg font-black text-gray-900">${dashboardData.kpis.totalCost.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-emerald-100 p-2 rounded-lg w-fit">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Margen</p>
                <p className="text-lg font-black text-emerald-600">${dashboardData.kpis.netProfit.toLocaleString()}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-indigo-100 p-2 rounded-lg w-fit">
                <FileText className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Pólizas</p>
                <p className="text-lg font-black text-gray-900">{dashboardData.kpis.count}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-2">
              <div className="bg-purple-100 p-2 rounded-lg w-fit">
                <DollarSign className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Comisiones</p>
                <p className="text-lg font-black text-gray-900">${dashboardData.kpis.totalCommissions.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Sales Over Time */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Ventas en el Tiempo</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboardData.charts.timeChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Line type="monotone" dataKey="sales" stroke="#2563eb" strokeWidth={3} dot={{ fill: '#2563eb' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales by Plan */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Ventas por Plan</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboardData.charts.planChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {dashboardData.charts.planChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales by Client Type */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-6">Ventas por Tipo de Cliente</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboardData.charts.clientTypeChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Profitability Summary */}
            <div className="bg-indigo-600 p-8 rounded-2xl shadow-xl text-white flex flex-col justify-center">
              <h3 className="text-xl font-bold mb-2">Resumen de Rentabilidad</h3>
              <p className="text-indigo-100 mb-6">Basado en los filtros seleccionados</p>
              <div className="space-y-4">
                <div className="flex justify-between items-baseline">
                  <span className="text-indigo-200 text-sm">Ventas Totales:</span>
                  <span className="text-lg font-bold">${dashboardData.kpis.totalSales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-indigo-200 text-sm">Costo Seguros:</span>
                  <span className="text-lg font-bold text-red-300">-${dashboardData.kpis.totalCost.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-indigo-200 text-sm">Comisiones:</span>
                  <span className="text-lg font-bold text-orange-300">-${dashboardData.kpis.totalCommissions.toLocaleString()}</span>
                </div>
                <div className="pt-4 border-t border-indigo-500">
                  <div className="flex justify-between items-baseline">
                    <span className="text-indigo-100 font-bold">Utilidad Neta:</span>
                    <span className="text-3xl font-black">${dashboardData.kpis.netProfit.toLocaleString()} USD</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-indigo-200">Margen Bruto:</span>
                  <span className="font-bold">{((dashboardData.kpis.netProfit / (dashboardData.kpis.totalSales || 1)) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-indigo-200">Ticket Promedio:</span>
                  <span className="font-bold">${dashboardData.kpis.avgValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'accounts_payable' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Cuentas por Pagar a Proveedores (Invoices)</h3>
              <p className="text-gray-500 text-sm">Resumen agrupado por número de Invoice CareMed.</p>
            </div>
            
            <div className="flex flex-wrap gap-4 items-center w-full sm:w-auto">
              {/* Segmented Filter */}
              <div className="bg-gray-100 p-1 rounded-xl border border-gray-200 flex items-center">
                <button
                  onClick={() => setPayableFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    payableFilter === 'pending'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-gray-500 hover:text-gray-900'
                   }`}
                >
                  Por Procesar ({invoiceGroups.filter(g => g.pendingAmount > 0.01).length})
                </button>
                <button
                  onClick={() => setPayableFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    payableFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-gray-500 hover:text-gray-900'
                   }`}
                >
                  Todos ({invoiceGroups.length})
                </button>
              </div>

              {selectedInvoiceKeys.length > 0 && (
                <div className="flex items-center gap-4 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-blue-600 uppercase">Seleccionados ({selectedInvoiceKeys.length})</p>
                    <p className="text-lg font-black text-blue-700">
                      ${invoiceGroups
                        .filter(g => selectedInvoiceKeys.includes(g.invoiceNumber))
                        .reduce((sum, g) => sum + g.pendingAmount, 0)
                        .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  </div>
                  <button
                    onClick={() => setShowInvoicePrompt(true)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-md flex items-center gap-2 font-sans"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Confirmar Pago
                  </button>
                </div>
              )}
              
              <div className="bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Total por Pagar</p>
                <p className="text-xl font-black text-gray-700">
                  ${totalPayableInvoices.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </p>
              </div>
            </div>
          </div>

          {/* Validation Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <button
              onClick={() => setPayableValidationFilter('all')}
              type="button"
              className={`p-4 rounded-2xl border text-left transition-all ${
                payableValidationFilter === 'all'
                  ? 'bg-blue-50/60 border-blue-200 ring-2 ring-blue-500/20 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Todos los Invoices</span>
                <span className="text-[10px] bg-gray-100 text-gray-700 font-black px-2 py-0.5 rounded-full">
                  {invoiceGroups.length}
                </span>
              </div>
              <p className="text-2xl font-black text-gray-900 mt-2">
                {invoiceGroups.length}
              </p>
              <p className="text-[10px] text-gray-400 mt-1 font-sans">
                Total de registros consolidados
              </p>
            </button>

            <button
              onClick={() => setPayableValidationFilter('valid')}
              type="button"
              className={`p-4 rounded-2xl border text-left transition-all ${
                payableValidationFilter === 'valid'
                  ? 'bg-emerald-50/60 border-emerald-200 ring-2 ring-emerald-500/20 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Cotejo Correcto</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-full">
                  {invoiceGroups.filter(g => g.validation.isCotejado && g.validation.isValid).length}
                </span>
              </div>
              <p className="text-2xl font-black text-emerald-600 mt-2 flex items-center gap-1.5">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                {invoiceGroups.filter(g => g.validation.isCotejado && g.validation.isValid).length}
              </p>
              <p className="text-[10px] text-emerald-600/80 mt-1 font-sans">
                Sin discrepancias vs tarifa catálogo
              </p>
            </button>

            <button
              onClick={() => setPayableValidationFilter('invalid')}
              type="button"
              className={`p-4 rounded-2xl border text-left transition-all ${
                payableValidationFilter === 'invalid'
                  ? 'bg-amber-50/60 border-amber-200 ring-2 ring-amber-500/20 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Con Discrepancia</span>
                <span className="text-[10px] bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-full">
                  {invoiceGroups.filter(g => g.validation.isCotejado && !g.validation.isValid).length}
                </span>
              </div>
              <p className="text-2xl font-black text-amber-600 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                {invoiceGroups.filter(g => g.validation.isCotejado && !g.validation.isValid).length}
              </p>
              <p className="text-[10px] text-amber-600/80 mt-1 font-sans">
                Diferencias de costo detectadas
              </p>
            </button>

            <button
              onClick={() => setPayableValidationFilter('uncotejado')}
              type="button"
              className={`p-4 rounded-2xl border text-left transition-all ${
                payableValidationFilter === 'uncotejado'
                  ? 'bg-purple-50/60 border-purple-200 ring-2 ring-purple-500/20 shadow-sm'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider font-sans">Sin Facturar / Cotejar</span>
                <span className="text-[10px] bg-purple-100 text-purple-800 font-black px-2 py-0.5 rounded-full">
                  {invoiceGroups.filter(g => !g.validation.isCotejado).length}
                </span>
              </div>
              <p className="text-2xl font-black text-purple-600 mt-2">
                {invoiceGroups.filter(g => !g.validation.isCotejado).length}
              </p>
              <p className="text-[10px] text-purple-500 mt-1 font-sans">
                Pólizas sin invoice CareMed asignado
              </p>
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-4 w-12 text-center">Detalle</th>
                    <th className="px-6 py-4 w-10">
                      <button onClick={handleSelectAllInvoices} className="p-1 hover:bg-gray-200 rounded transition-colors">
                        {selectedInvoiceKeys.length === invoiceGroups.filter(g => g.pendingAmount > 0.01).length && invoiceGroups.filter(g => g.pendingAmount > 0.01).length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="px-6 py-4 font-medium">Número de Invoice</th>
                    <th className="px-6 py-4 font-medium text-center">Validación</th>
                    <th className="px-6 py-4 font-medium text-center">Pólizas</th>
                    <th className="px-6 py-4 font-medium text-right font-semibold font-sans">Costo Total</th>
                    <th className="px-6 py-4 font-medium text-right text-green-600 font-sans">Pagado Proveedor</th>
                    <th className="px-6 py-4 font-medium text-right text-blue-600 font-sans">Monto Por Pagar</th>
                    <th className="px-6 py-4 font-medium text-center">Estado Pago</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInvoiceGroups.map((group) => {
                    const isFullyPaid = group.pendingAmount <= 0.01;
                    const isExpanded = !!expandedInvoices[group.invoiceNumber];
                    return (
                      <React.Fragment key={group.invoiceNumber}>
                        <tr className={`hover:bg-gray-50/80 transition-colors ${isFullyPaid ? 'bg-gray-50/30' : ''} ${isExpanded ? 'bg-blue-50/10' : ''}`}>
                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() => setExpandedInvoices(prev => ({ ...prev, [group.invoiceNumber]: !prev[group.invoiceNumber] }))}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center mx-auto"
                              title={isExpanded ? "Contraer detalles" : "Ver detalle de asegurados"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            {!isFullyPaid && (
                              <button onClick={() => handleToggleInvoiceSelection(group.invoiceNumber)} className="p-1 hover:bg-gray-200 rounded transition-colors">
                                {selectedInvoiceKeys.includes(group.invoiceNumber) ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-sm font-bold ${group.invoiceNumber.startsWith('Sin Invoice') ? 'text-gray-400 italic' : 'text-gray-900 font-mono'}`}>
                              {group.invoiceNumber}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center relative group">
                            {group.validation.isCotejado ? (
                              group.validation.isValid ? (
                                <>
                                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 cursor-help hover:bg-emerald-100 transition-colors">
                                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                                    <span className="text-xs font-bold">Validado</span>
                                  </div>
                                  {/* Tooltip detail */}
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50 w-80 bg-slate-900 text-white text-xs rounded-xl p-4 shadow-xl border border-slate-800 pointer-events-none text-left">
                                    <div className="font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
                                      <CheckCircle className="w-4 h-4" />
                                      Cotejo Exitoso
                                    </div>
                                    <p className="text-slate-300 leading-relaxed text-[11px] font-sans">
                                      Todas las pólizas vinculadas a este invoice coinciden perfectamente con las tarifas registradas en el catálogo maestro.
                                    </p>
                                    <div className="mt-3 pt-2 border-t border-slate-800 text-[10px] text-slate-400 font-sans flex justify-between">
                                      <span>Monto Esperado:</span>
                                      <span className="font-bold text-white">${group.validation.totalExpectedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedDifferenceGroup(group);
                                      setSelectedAmountType('registered');
                                      setCustomPaymentAmount(group.pendingAmount.toFixed(2));
                                      setInvoicePaymentDate(new Date().toISOString().split('T')[0]);
                                      setInvoicePaymentMethod('');
                                      setInvoiceDepositAccount('');
                                      setDifferenceModalOpen(true);
                                    }}
                                    type="button"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-800 rounded-full border border-amber-200 cursor-pointer hover:bg-amber-100 active:scale-95 transition-all"
                                    title="Click para resolver diferencia y registrar/modificar pago"
                                  >
                                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                                    <span className="text-xs font-bold">Diferencia ({group.validation.discrepancies.length})</span>
                                  </button>
                                  {/* Tooltip detail */}
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50 w-96 bg-slate-900 text-white text-xs rounded-xl p-4 shadow-xl border border-slate-800 pointer-events-none text-left">
                                    <div className="font-bold text-amber-400 mb-1.5 flex items-center gap-1.5">
                                      <AlertTriangle className="w-4 h-4" />
                                      Diferencias Detectadas ({group.validation.discrepancies.length})
                                    </div>
                                    <p className="text-slate-300 mb-3 text-[11px] leading-tight font-sans">
                                      Se identificaron discrepancias de costo respecto al catálogo de planes del sistema:
                                    </p>
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                      {group.validation.discrepancies.map((d, index) => (
                                        <div key={index} className="p-2 bg-slate-800/85 rounded-lg border border-slate-750 text-[11px]">
                                          <div className="flex justify-between font-bold text-slate-200">
                                            <span className="truncate max-w-[180px]">{d.insuredName}</span>
                                            <span className="text-amber-300 font-mono font-semibold">
                                              Diff: ${d.difference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <div className="text-[10px] text-slate-400 mt-1 flex justify-between font-sans">
                                            <span>Póliza: {d.policyId}</span>
                                            <span>
                                              Reg: ${d.actualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs Esp: ${d.expectedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <p className="text-[9px] text-amber-400/90 font-medium italic mt-1 font-sans">
                                            Motivo: {d.reason === 'policy_not_found' ? 'Plan no registrado en catálogo' : 'Costo diario no coincide con el plan maestro'}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="mt-3 pt-2 border-t border-slate-800 text-[10px] text-slate-400 flex justify-between font-sans">
                                      <span>Total Registrado: <strong className="text-slate-200">${group.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                      <span>Total Esperado: <strong className="text-slate-200">${group.validation.totalExpectedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                    </div>
                                  </div>
                                </>
                              )
                            ) : (
                              <span className="text-[11px] text-gray-400 italic">No aplica (Sin Facturar)</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="text-sm font-medium bg-gray-100 text-gray-800 px-2.5 py-1 rounded-full">{group.insurances.length}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-bold text-gray-900">${group.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm text-green-600">${group.paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-sm font-black text-blue-600">${group.pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {isFullyPaid ? (
                              <span className="px-2 py-1 rounded-full text-[10px] font-black bg-green-100 text-green-700 border border-green-200">
                                PAGADO
                              </span>
                            ) : group.paidAmount > 0.01 ? (
                              <span className="px-2 py-1 rounded-full text-[10px] font-black bg-orange-100 text-orange-700 border border-orange-200">
                                PARCIAL
                              </span>
                            ) : (
                              <span className="px-2 py-1 rounded-full text-[10px] font-black bg-red-100 text-red-700 border border-red-200">
                                PENDIENTE
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end items-center gap-2">
                              <button
                                onClick={() => {
                                  setSelectedInvoiceKeys([group.invoiceNumber]);
                                  setShowInvoicePrompt(true);
                                }}
                                disabled={isFullyPaid}
                                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                Pagar
                              </button>
                              {isSuperAdmin && !group.invoiceNumber.startsWith('Sin Invoice') && (
                                <button
                                  onClick={() => handleDeleteInvoice(group.invoiceNumber)}
                                  className="bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-100 transition-all flex items-center gap-1"
                                  title="Borrar Invoice (desvincular pólizas y borrar pagos)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Borrar
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Collapsible details for insureds/policies */}
                        {isExpanded && (
                          <tr className="bg-gray-50/30">
                            <td colSpan={10} className="px-6 py-4 bg-gray-50/30 border-t border-b border-gray-100">
                              <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    Detalle del Invoice: {group.invoiceNumber} ({group.insurances.length} pólizas)
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-medium font-sans italic">
                                    Lista de Asegurados Vinculados
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs text-gray-600">
                                    <thead className="bg-gray-50 text-gray-400 text-[10px] uppercase font-bold tracking-wider border-b border-gray-100">
                                      <tr>
                                        <th className="px-4 py-2.5 font-bold">Asegurado / Titular</th>
                                        <th className="px-4 py-2.5 font-bold">ID Seg</th>
                                        <th className="px-4 py-2.5 font-bold">Póliza / Plan</th>
                                        <th className="px-4 py-2.5 font-bold text-center">Vigencia</th>
                                        <th className="px-4 py-2.5 font-bold text-center">Días</th>
                                        <th className="px-4 py-2.5 font-bold text-right font-sans">Costo Total</th>
                                        <th className="px-4 py-2.5 font-bold text-right text-green-600 font-sans">Pagado</th>
                                        <th className="px-4 py-2.5 font-bold text-right text-blue-600 font-sans">Pendiente</th>
                                        <th className="px-4 py-2.5 font-bold text-center">Estado</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {group.insurances.map((ins, idx) => {
                                        let providerPaid = providerPaymentsMap.get(ins.id || '') || 0;
                                        const mul = ins.actionType?.toUpperCase() === 'CAN' ? -1 : 1;
                                        if (ins.providerPaymentStatus === 'paid') {
                                          providerPaid = (ins.totalCost || 0) * mul;
                                        }
                                        const exactCost = (ins.totalCost || 0) * mul;
                                        const exactPending = exactCost - providerPaid;
                                        const isInsPaid = exactPending <= 0.01;

                                        return (
                                          <tr key={ins.id || idx} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-4 py-3 font-bold text-gray-900">
                                              {ins.firstName} {ins.lastName}
                                            </td>
                                            <td className="px-4 py-3 font-mono font-medium text-gray-500">
                                              {ins.IDseg || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 font-mono">
                                              <div className="flex flex-col">
                                                <span className="text-gray-700 font-bold">{ins.policyId || 'N/A'}</span>
                                                {ins.policyName && <span className="text-[10px] text-gray-400 font-sans">{ins.policyName}</span>}
                                              </div>
                                            </td>
                                            <td className="px-4 py-3 text-center text-gray-500 font-medium">
                                              {ins.startDate} al {ins.endDate}
                                            </td>
                                            <td className="px-4 py-3 text-center text-gray-500 font-mono">
                                              {ins.days || 0}d
                                            </td>
                                            <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                              ${exactCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium text-green-600">
                                              ${providerPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-3 text-right font-black text-blue-600 font-sans">
                                              ${exactPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                              {isInsPaid ? (
                                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-600 border border-green-100 uppercase">
                                                  Pagada
                                                </span>
                                              ) : providerPaid > 0.01 ? (
                                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-100 uppercase">
                                                  Parcial
                                                </span>
                                              ) : (
                                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-600 border border-red-100 uppercase">
                                                  Pendiente
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'accounts_receivable' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Header section with high contrast panel */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Coins className="w-5 h-5 text-indigo-600" />
                Cuentas por Cobrar
              </h3>
              <p className="text-gray-500 text-sm">Monitoreo de pólizas con saldos deudores pendientes de cobro o sobrepagos acumulados.</p>
            </div>
            <div className="flex gap-4 items-center w-full md:w-auto">
              <div className="bg-amber-50 px-4 py-2 rounded-xl border border-amber-100 flex-1 md:flex-initial">
                <p className="text-[10px] font-bold text-amber-600 uppercase">Total deudor</p>
                <p className="text-lg font-black text-amber-700">
                  ${accountsReceivableData.kpis.totalDeuda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </p>
              </div>
              <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 flex-1 md:flex-initial">
                <p className="text-[10px] font-bold text-blue-600 uppercase">Total Sobrepagos</p>
                <p className="text-lg font-black text-blue-700">
                  ${accountsReceivableData.kpis.totalSobrepago.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </p>
              </div>
            </div>
          </div>

          {/* Key Metric KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cuentas Deudoras</p>
                <p className="text-xl font-black text-gray-900">{accountsReceivableData.kpis.deudoresCount} pólizas</p>
                <p className="text-xs text-amber-600 font-medium">Suma de saldos por cobrar</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                <CheckCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-sans">Sobrepagos</p>
                <p className="text-xl font-black text-gray-900">{accountsReceivableData.kpis.overpaidCount} pólizas</p>
                <p className="text-xs text-blue-600 font-medium">Exceso abonado por clientes</p>
              </div>
            </div>

            <div className={`p-5 rounded-2xl border shadow-xs flex items-center gap-4 ${
              accountsReceivableData.kpis.netoAR >= 0 ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100'
            }`}>
              <div className={`p-3 rounded-xl border ${
                accountsReceivableData.kpis.netoAR >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
              }`}>
                <DollarSign className={`w-5 h-5 ${accountsReceivableData.kpis.netoAR >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Saldo Neto Ajustado</p>
                <p className="text-xl font-black text-gray-900">
                  ${accountsReceivableData.kpis.netoAR.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                </p>
                <p className={`text-xs font-semibold ${accountsReceivableData.kpis.netoAR >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {accountsReceivableData.kpis.netoAR >= 0 ? 'Balance a favor global' : 'Exceso de sobrepagos'}
                </p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                <Search className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pólizas Coincidentes</p>
                <p className="text-xl font-black text-gray-900">{accountsReceivableData.kpis.totalCount} registros</p>
                <p className="text-xs text-gray-500 font-medium">Con desfase de saldo</p>
              </div>
            </div>
          </div>

          {/* Filtering Panel */}
          <div className="bg-slate-50/70 border border-slate-200/50 p-4 rounded-2xl flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/40 pb-2">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-700">Filtros y Consultas</span>
              </div>
              <button
                type="button"
                onClick={handleDownloadARReportPDF}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-all border border-rose-200 self-start sm:self-center"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Reporte (PDF)
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* Search field */}
              <div className="flex flex-col gap-1 col-span-1 sm:col-span-2">
                <label className="text-[10px] uppercase font-bold text-gray-400">Buscar Asegurado / Folio</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Escriba nombre, email, folio de seguro..."
                    value={accountsReceivableFilters.search}
                    onChange={(e) => {
                      setAccountsReceivableFilters(prev => ({ ...prev, search: e.target.value }));
                      setAccountsReceivablePage(1);
                    }}
                    className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Type selector */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">Tipo de Cuenta</label>
                <select
                  value={accountsReceivableFilters.type}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, type: e.target.value as any }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">Saldos y Sobrepagos (Todos)</option>
                  <option value="deudor">Solo con Saldo Deudor</option>
                  <option value="overpaid">Solo con Sobrepagos</option>
                </select>
              </div>

              {/* Policy status selector */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">Estado de Póliza</label>
                <select
                  value={accountsReceivableFilters.status}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, status: e.target.value as any }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">Todos los Estados</option>
                  <option value="active">Solo Activos</option>
                  <option value="cancelled">Solo Cancelados</option>
                  <option value="pending">Registros Pendientes</option>
                  <option value="partially_paid">Parcialmente Pagados</option>
                  <option value="paid">Marcados como Pagado</option>
                </select>
              </div>

              {/* Policy/Insurance standard selection */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">Póliza / Aseguradora</label>
                <select
                  value={accountsReceivableFilters.policyId}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, policyId: e.target.value }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">Todas las Aseguradoras</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                  ))}
                </select>
              </div>

              {/* Agent selector */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">Agente</label>
                <select
                  value={accountsReceivableFilters.agentName}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, agentName: e.target.value }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">Todos los Agentes</option>
                  {uniqueArAgentNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              {/* Request date range start */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">F. Solicitud Desde</label>
                <input
                  type="date"
                  value={accountsReceivableFilters.requestDateStart}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, requestDateStart: e.target.value }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Request date range end */}
              <div className="flex flex-col gap-1 col-span-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">F. Solicitud Hasta</label>
                <input
                  type="date"
                  value={accountsReceivableFilters.requestDateEnd}
                  onChange={(e) => {
                    setAccountsReceivableFilters(prev => ({ ...prev, requestDateEnd: e.target.value }));
                    setAccountsReceivablePage(1);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Clear filters button */}
              <div className="flex items-end justify-end col-span-1">
                {(accountsReceivableFilters.search || accountsReceivableFilters.type !== 'all' || accountsReceivableFilters.policyId !== 'all' || accountsReceivableFilters.status !== 'all' || accountsReceivableFilters.requestDateStart || accountsReceivableFilters.requestDateEnd || accountsReceivableFilters.agentName !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setAccountsReceivableFilters({
                        search: '',
                        type: 'all',
                        policyId: 'all',
                        status: 'all',
                        requestDateStart: '',
                        requestDateEnd: '',
                        agentName: 'all'
                      });
                      setAccountsReceivablePage(1);
                    }}
                    className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-all w-full text-center"
                  >
                    Restablecer Filtros
                  </button>
                )}
              </div>
            </div>

            {/* Configuración de Ordenamiento Concatenado */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 mt-1 border-t border-slate-200/60">
              <div className="flex items-center gap-1.5 flex-wrap">
                <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-xs font-bold text-slate-700">Orden Principal:</span>
                <span className="text-[11px] font-semibold text-slate-800 bg-slate-200/50 px-2.5 py-0.5 rounded-full border border-slate-200/20">
                  {arSortField === 'requestDate' ? 'Fecha de Solicitud' :
                   arSortField === 'createdAt' ? 'Fecha de Creación' :
                   arSortField === 'name' ? 'Asegurado' :
                   arSortField === 'policyId' ? 'Aseguradora' :
                   arSortField === 'startDate' ? 'Fecha de Inicio' :
                   arSortField === 'expected' ? 'Monto Esperado' :
                   arSortField === 'totalPaid' ? 'Total Pagado' :
                   arSortField === 'agentCommission' ? 'Comisión' :
                   arSortField === 'balance' ? 'Saldo Pendiente' :
                   arSortField === 'status' ? 'Estatus Póliza' : arSortField}
                  <span className="ml-1 text-[9.5px] text-indigo-600 font-extrabold">{arSortDirection === 'asc' ? '▲ ASC' : '▼ DESC'}</span>
                </span>
                <span className="text-xs font-bold text-slate-400">➔ y después por:</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <select
                    value={arSortFieldSecondary}
                    onChange={(e) => {
                      setArSortFieldSecondary(e.target.value as any);
                    }}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded-xl text-xs font-bold text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-xs"
                  >
                    <option value="none">Sin orden secundario</option>
                    <option value="name">Nombre del Asegurado</option>
                    <option value="requestDate">Fecha de Solicitud</option>
                    <option value="startDate">Fecha de Inicio</option>
                    <option value="expected">Monto Esperado</option>
                    <option value="totalPaid">Monto Pagado</option>
                    <option value="balance">Saldo Pendiente</option>
                    <option value="agentCommission">Comisión del Agente</option>
                    <option value="status">Estatus Póliza</option>
                    <option value="createdAt">Fecha de Creación</option>
                  </select>
                </div>

                {arSortFieldSecondary !== 'none' && (
                  <button
                    type="button"
                    onClick={() => setArSortDirectionSecondary(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 rounded-xl text-[10px] font-black transition-all flex items-center gap-1"
                  >
                    {arSortDirectionSecondary === 'asc' ? '▲ ASC' : '▼ DESC'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {selectedArIds.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-150 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-indigo-600" />
                <span className="text-sm font-bold text-indigo-900">
                  {selectedArIds.length} {selectedArIds.length === 1 ? 'póliza seleccionada' : 'pólizas seleccionadas'}
                </span>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setSelectedArIds([])}
                  className="flex-1 sm:flex-none px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition-all text-center"
                >
                  Deseleccionar Todo
                </button>
                <button
                  type="button"
                  onClick={handleBulkAutoAdjustBalance}
                  disabled={isBulkSavingAr}
                  className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {isBulkSavingAr ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Sliders className="w-4 h-4" />
                  )}
                  Auto-Ajustar Selección ({selectedArIds.length})
                </button>
              </div>
            </div>
          )}

          {/* Table displaying accounts receivable */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#f8fafc] text-slate-500 text-[10.5px] uppercase tracking-wider font-bold border-b border-gray-200 select-none">
                  <tr>
                    <th className="px-4 py-4 w-10 text-center">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                        checked={
                          paginatedAccountsReceivable.length > 0 &&
                          paginatedAccountsReceivable.every(item => selectedArIds.includes(item.id!))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const pageIds = paginatedAccountsReceivable.map(item => item.id!).filter(Boolean);
                            setSelectedArIds(prev => Array.from(new Set([...prev, ...pageIds])));
                          } else {
                            const pageIds = paginatedAccountsReceivable.map(item => item.id!);
                            setSelectedArIds(prev => prev.filter(id => !pageIds.includes(id)));
                          }
                        }}
                      />
                    </th>
                    <th className="px-6 py-4">
                      <button
                        onClick={() => handleArSort('requestDate')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider"
                      >
                        Fecha Solicitud
                        <span className="text-gray-400">
                          {arSortField === 'requestDate' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4">
                      <button
                        onClick={() => handleArSort('name')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider"
                      >
                        Asegurado / Datos
                        <span className="text-gray-400">
                          {arSortField === 'name' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleArSort('startDate')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider mx-auto"
                      >
                        Vigencia
                        <span className="text-gray-400">
                          {arSortField === 'startDate' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleArSort('expected')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider ml-auto justify-end"
                      >
                        Cotizado (USD)
                        <span className="text-gray-400">
                          {arSortField === 'expected' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="uppercase font-bold text-[10.5px] tracking-wider ml-auto justify-end block text-slate-500">
                        Ajuste
                      </span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleArSort('totalPaid')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider ml-auto justify-end"
                      >
                        Pagado (USD)
                        <span className="text-gray-400">
                          {arSortField === 'totalPaid' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-right bg-slate-50/50">
                      <button
                        onClick={() => handleArSort('agentCommission')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider ml-auto justify-end"
                      >
                        Comisión (USD)
                        <span className="text-gray-400">
                          {arSortField === 'agentCommission' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleArSort('balance')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider ml-auto justify-end"
                      >
                        Balance / Dif.
                        <span className="text-gray-400">
                          {arSortField === 'balance' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleArSort('status')}
                        className="flex items-center gap-1 hover:text-indigo-600 transition-colors uppercase font-bold text-[10.5px] tracking-wider mx-auto animate-pulse-subtle"
                      >
                        Estado
                        <span className="text-gray-400">
                          {arSortField === 'status' ? (arSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                    <th className="px-6 py-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                  {paginatedAccountsReceivable.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-gray-400 italic">
                        No se encontraron cuentas con saldo descuadrado o sobrepagado.
                      </td>
                    </tr>
                  ) : (
                    paginatedAccountsReceivable.map((item) => {
                      // Status analysis
                      const today = format(new Date(), 'yyyy-MM-dd');
                      let opStatusDesc = item.status === 'cancelled' || item.actionType?.toUpperCase() === 'CAN' ? 'Cancelado' : 'Activo';
                      if (opStatusDesc === 'Activo' && today > item.endDate) {
                        opStatusDesc = 'Terminado';
                      }

                      return (
                        <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors ${selectedArIds.includes(item.id!) ? 'bg-indigo-50/30' : ''}`}>
                          <td className="px-4 py-4 text-center">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                              checked={selectedArIds.includes(item.id!)}
                              onChange={() => {
                                setSelectedArIds(prev =>
                                  prev.includes(item.id!)
                                    ? prev.filter(id => id !== item.id!)
                                    : [...prev, item.id!]
                                );
                              }}
                            />
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-600">
                            <div className="flex flex-col">
                              <span className="font-semibold text-gray-850">
                                {item.requestDate ? (
                                  (() => {
                                    try {
                                      return format(parseISO(item.requestDate), 'yyyy-MM-dd');
                                    } catch (err) {
                                      return item.requestDate;
                                    }
                                  })()
                                ) : item.createdAt ? (
                                  (() => {
                                    try {
                                      const rawDate = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
                                      return format(rawDate, 'yyyy-MM-dd');
                                    } catch (err) {
                                      return 'N/A';
                                    }
                                  })()
                                ) : (
                                  <span className="text-gray-400 font-mono text-[11px]">N/A</span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900">{item.firstName} {item.lastName}</span>
                              <span className="text-[10px] text-gray-400 font-mono">
                                ID Seg: {item.IDseg || 'Sin Folio'} • Póliza ID: {item.policyId || 'S/N'}
                              </span>
                              {item.policyName && (
                                <span className="text-[10px] text-indigo-500 font-medium">
                                  {item.policyName}
                                </span>
                              )}
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-55/10 border border-indigo-100 rounded px-1.5 py-0.5 uppercase tracking-wide">
                                  Agente: {getAgentName(item)}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex flex-col items-center">
                              <span className="font-semibold text-gray-700">{item.startDate}</span>
                              <span className="text-[10px] text-gray-400">al {item.endDate}</span>
                              <span className="text-[10px] font-bold text-[#475569] bg-slate-100 px-1.5 py-0.5 rounded-full mt-1">
                                {item.days} Días
                              </span>
                              {item.days !== undefined && item.days > 39 && (
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full mt-1">
                                  {Math.ceil(item.days / 30.4)} Meses
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-semibold text-gray-900">
                            ${(item.expected || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {editingArAdjustmentId === item.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  value={inlineArAdjustmentVal}
                                  onChange={(e) => setInlineArAdjustmentVal(e.target.value)}
                                  className="w-20 px-2 py-1 text-right border border-indigo-300 rounded-lg text-xs font-semibold focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                  placeholder="0.00"
                                  autoFocus
                                  disabled={isSavingInlineAr === item.id}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleSaveInlineAdjustment(item, Number(inlineArAdjustmentVal) || 0);
                                    } else if (e.key === 'Escape') {
                                      setEditingArAdjustmentId(null);
                                    }
                                  }}
                                />
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleSaveInlineAdjustment(item, Number(inlineArAdjustmentVal) || 0)}
                                    disabled={isSavingInlineAr === item.id}
                                    className="p-1 bg-green-50 hover:bg-green-100 text-green-600 rounded-md transition-colors"
                                    title="Guardar"
                                  >
                                    {isSavingInlineAr === item.id ? (
                                      <div className="w-3.5 h-3.5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                      <CheckCircle className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => setEditingArAdjustmentId(null)}
                                    disabled={isSavingInlineAr === item.id}
                                    className="p-1 bg-rose-55/10 hover:bg-rose-100 text-rose-600 rounded-md transition-colors"
                                    title="Cancelar"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5 group/adj">
                                <span className={`font-semibold ${item.adjustment ? (item.adjustment > 0 ? 'text-amber-600' : 'text-blue-600') : 'text-gray-400'}`}>
                                  ${(item.adjustment || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <button
                                  onClick={() => {
                                    setEditingArAdjustmentId(item.id || null);
                                    setInlineArAdjustmentVal((item.adjustment || 0).toString());
                                  }}
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors opacity-0 group-hover/adj:opacity-100 focus:opacity-100"
                                  title="Editar Ajuste"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right font-semibold text-emerald-600">
                            ${(item.totalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-right bg-slate-50/25">
                            <div className="flex flex-col items-end">
                              <span className="font-bold text-slate-800">
                                ${(item.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span className={`text-[8.5px] font-black uppercase mt-0.5 px-1.5 py-0.5 rounded-full border ${
                                item.commissionStatus === 'paid' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                  : item.commissionStatus === 'confirmed' 
                                    ? 'bg-[#e2e8f0] text-[#334155] border-slate-200' 
                                    : 'bg-gray-50 text-gray-400 border-gray-100'
                              }`}>
                                {item.commissionStatus === 'paid' ? 'Pagada' : item.commissionStatus === 'confirmed' ? 'Por Pagar' : 'Pendiente'}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {item.balance > 0.01 ? (
                              <div className="flex flex-col items-end">
                                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold border border-amber-100 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                  ${item.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <span className="text-[9px] text-amber-600 font-bold uppercase mt-0.5">Saldo Deudor</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end">
                                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 flex items-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5 text-blue-500" />
                                  -${Math.abs(item.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                <span className="text-[9px] text-blue-600 font-bold uppercase mt-0.5 font-sans">Sobrepago</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`px-2.5 py-0.5 text-[8.5px] font-black rounded-full border ${
                                opStatusDesc === 'Activo' ? 'bg-indigo-600 text-white border-indigo-700' :
                                opStatusDesc === 'Cancelado' ? 'bg-red-600 text-white border-red-700' :
                                'bg-gray-600 text-white border-gray-700'
                              }`}>
                                {opStatusDesc.toUpperCase()}
                              </span>
                              <span className={`text-[9px] font-bold ${
                                item.status === 'paid' ? 'text-emerald-600' :
                                item.status === 'partially_paid' ? 'text-amber-500' :
                                'text-gray-400'
                              }`}>
                                {item.status === 'paid' ? 'PAGADO' :
                                 item.status === 'partially_paid' ? 'PARCIAL' : 'PENDIENTE'}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setSelectedInsurance(item)}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                                title="Editar Datos"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setSelectedInsuranceForTransactions(item.id || null)}
                                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors border border-transparent hover:border-green-100"
                                title="Ingresar / Ver Pagos"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (isInsuranceClosed(item)) {
                                    alert('Este registro está cerrado y no se puede modificar.');
                                    return;
                                  }
                                  const diff = item.balance || 0;
                                  if (Math.abs(diff) < 0.01) {
                                    alert('El saldo ya se encuentra totalmente cuadrado.');
                                    return;
                                  }
                                  confirmAction(
                                    'Auto-Ajustar Balance',
                                    `¿Estás seguro de que deseas aplicar un ajuste de $${Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD para cuadrar el balance de esta póliza automáticamente a $0.00?`,
                                    () => {
                                      const newAdjustment = (item.adjustment || 0) + diff;
                                      handleSaveInlineAdjustment(item, Number(newAdjustment.toFixed(2)));
                                    }
                                  );
                                }}
                                disabled={isSavingInlineAr === item.id}
                                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors border border-transparent hover:border-amber-100 disabled:opacity-50"
                                title="Auto-Ajustar Balance (Cuadrar a Cero)"
                              >
                                {isSavingInlineAr === item.id ? (
                                  <div className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Sliders className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {isSuperAdmin && (
                                <button
                                  onClick={() => confirmAction('Eliminar Póliza', '¿Estás seguro de eliminar esta póliza?', () => {
                                    deleteDoc(doc(db, 'insurances', item.id!));
                                  })}
                                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-100"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
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

            {/* Pagination Controls */}
            {accountsReceivableData.items.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-gray-100 text-xs text-gray-500 bg-white">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                   <span>
                    Mostrando <span className="font-bold text-gray-900">{Math.min(accountsReceivableData.items.length, (accountsReceivablePage - 1) * accountsReceivablePageSize + 1)}</span> a{' '}
                    <span className="font-bold text-gray-900">{Math.min(accountsReceivableData.items.length, accountsReceivablePage * accountsReceivablePageSize)}</span> de{' '}
                    <span className="font-bold text-gray-900">{accountsReceivableData.items.length}</span> registros con desfase
                   </span>

                  <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                    <span>Por página:</span>
                    <select
                      value={accountsReceivablePageSize}
                      onChange={(e) => {
                        setAccountsReceivablePageSize(Number(e.target.value));
                        setAccountsReceivablePage(1);
                      }}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                {totalARPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAccountsReceivablePage(prev => Math.max(1, prev - 1))}
                      disabled={accountsReceivablePage === 1}
                      className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-medium text-slate-700">
                      Página {accountsReceivablePage} de {totalARPages}
                    </span>
                    <button
                      onClick={() => setAccountsReceivablePage(prev => Math.min(totalARPages, prev + 1))}
                      disabled={accountsReceivablePage === totalARPages}
                      className="p-1 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <StatementOCRManager 
            profile={profile} 
            exchangeRate={exchangeRate}
            onReconcile={(type) => {
              handleTabChange(type === 'income' ? 'incomes' : 'expenses');
            }}
          />
        </div>
      )}

      {activeTab === 'incomes' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Registro de Ingresos</h3>
              <p className="text-gray-500 text-sm">Cobros realizados a clientes por pólizas de seguro.</p>
            </div>
            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <button
                  onClick={handleDeleteAllFilteredIncomes}
                  disabled={visibleIncomes.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl font-bold border border-rose-100 hover:bg-rose-100 transition-all shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Eliminar todos los ingresos que coinciden con los filtros aplicados"
                >
                  <Trash2 className="w-4 h-4" />
                  Borrar Todas las Operaciones {visibleIncomes.length > 0 && `(${visibleIncomes.length})`}
                </button>
              )}
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-bold border border-indigo-100 hover:bg-indigo-100 transition-all shadow-sm text-sm"
              >
                <Upload className="w-4 h-4" />
                Importar Pagos
              </button>
              <button
                onClick={handleDownloadIncomes}
                disabled={visibleIncomes.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-xl font-bold border border-green-100 hover:bg-green-100 transition-all shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                title="Descargar la lista de pagos actual en formato CSV"
              >
                <Download className="w-4 h-4" />
                Descargar Pagos
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setIncomeCurrencyTab('USD')}
                className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
                  incomeCurrencyTab === 'USD' 
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                USD (Dólares)
              </button>
              <button
                onClick={() => setIncomeCurrencyTab('MXP')}
                className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
                  incomeCurrencyTab === 'MXP' 
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                MXP (Pesos)
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
              <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <CheckSquare className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Operaciones ({incomeCurrencyTab})</p>
                  <p className="text-2xl font-black text-gray-900">{incomeStats.count}</p>
                </div>
              </div>
              <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total ({incomeCurrencyTab})</p>
                  <p className="text-2xl font-black text-gray-900">${incomeStats.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {incomeCurrencyTab}</p>
                </div>
              </div>
            </div>

            {/* Filtros de Ingresos */}
            <div className="bg-slate-50/70 border border-slate-200/50 p-4 mx-6 my-2 rounded-2xl flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/40 pb-2">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-bold text-gray-700">Filtros de Ingresos</span>
                </div>
                {/* Sort Order Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 font-semibold uppercase">Ordenar por fecha:</span>
                  <select
                    value={incomeSortOrder}
                    onChange={(e) => {
                      setIncomeSortOrder(e.target.value as 'desc' | 'asc');
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="desc">Más Recientes primero</option>
                    <option value="asc">Más Antiguos primero</option>
                  </select>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {/* Fecha Inicio */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Fecha Inicio</label>
                  <input 
                    type="date"
                    value={incomeFilters.startDate}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, startDate: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Fecha Fin */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Fecha Fin</label>
                  <input 
                    type="date"
                    value={incomeFilters.endDate}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, endDate: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* Cliente */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Cliente</label>
                  <select
                    value={incomeFilters.clientId}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, clientId: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Clientes</option>
                    {clientOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </div>

                {/* Agente */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Agente</label>
                  <select
                    value={incomeFilters.agentId}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, agentId: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Agentes</option>
                    {agentOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </div>

                {/* Cuenta de Pago / Método cuenta */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Cuenta de Pago</label>
                  <select
                    value={incomeFilters.account}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, account: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todas las Cuentas</option>
                    {uniqueIncomesAccounts.map((ac, idx) => (
                      <option key={idx} value={ac}>{ac}</option>
                    ))}
                    <option value="Sin Especificar">Sin Especificar</option>
                  </select>
                </div>

                {/* Método de Pago */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Método de Pago</label>
                  <select
                    value={incomeFilters.paymentMethod}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, paymentMethod: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Métodos</option>
                    {uniqueIncomesMethods.map((met, idx) => (
                      <option key={idx} value={met}>{met}</option>
                    ))}
                  </select>
                </div>

                {/* Estado */}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Estado</label>
                  <select
                    value={incomeFilters.status}
                    onChange={(e) => {
                      setIncomeFilters(prev => ({ ...prev, status: e.target.value }));
                      setIncomePage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Estados</option>
                    <option value="completed">Completado</option>
                    <option value="pending">Pendiente</option>
                  </select>
                </div>

                {/* Button container */}
                <div className="flex items-end justify-end">
                  {(incomeFilters.startDate || incomeFilters.endDate || incomeFilters.paymentMethod !== 'all' || incomeFilters.account !== 'all' || incomeFilters.status !== 'all' || incomeFilters.clientId !== 'all' || incomeFilters.agentId !== 'all') && (
                    <button
                      onClick={() => {
                        setIncomeFilters({
                          startDate: '',
                          endDate: '',
                          paymentMethod: 'all',
                          account: 'all',
                          status: 'all',
                          clientId: 'all',
                          agentId: 'all'
                        });
                        setIncomePage(1);
                      }}
                      className="w-full sm:w-auto px-3 py-1.5 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300 transition-colors"
                    >
                      Limpiar Filtros
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isSuperAdmin && selectedPaymentIds.length > 0 && (
              <div className="mx-6 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex flex-wrap items-center gap-2">
                  <CheckSquare className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-bold text-blue-800 animate-pulse">
                    {selectedPaymentIds.length} {selectedPaymentIds.length === 1 ? 'registro seleccionado' : 'registros seleccionados'}
                  </span>
                  {selectedPaymentIds.length < visibleIncomes.length && (
                    <button
                      onClick={() => {
                        const allIds = visibleIncomes.map(p => p.id!).filter(Boolean);
                        setSelectedPaymentIds(allIds);
                      }}
                      className="text-xs text-[#2563eb] hover:text-blue-800 underline font-extrabold ml-2 transition-all"
                    >
                      Seleccionar todas las {visibleIncomes.length} operaciones filtradas
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setBulkEditData({});
                      setShowBulkEditModal(true);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar {selectedPaymentIds.length === 1 ? 'Seleccionado' : 'Seleccionados'}
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar {selectedPaymentIds.length === 1 ? 'Seleccionado' : 'Seleccionados'}
                  </button>
                  <button
                    onClick={() => setSelectedPaymentIds([])}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-medium transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    {isSuperAdmin && (
                      <th className="px-6 py-4 font-medium w-12 text-center">
                        <button
                          onClick={() => {
                            const allIds = paginatedIncomes.map(p => p.id!).filter(Boolean);
                            const allSelected = allIds.every(id => selectedPaymentIds.includes(id));
                            if (allSelected) {
                              setSelectedPaymentIds(prev => prev.filter(id => !allIds.includes(id)));
                            } else {
                              setSelectedPaymentIds(prev => Array.from(new Set([...prev, ...allIds])));
                            }
                          }}
                          className="text-gray-400 hover:text-blue-600 transition-colors"
                          title="Seleccionar Todos"
                        >
                          {paginatedIncomes.length > 0 && paginatedIncomes.every(p => selectedPaymentIds.includes(p.id!)) ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      </th>
                    )}
                    <th className="px-6 py-4 font-medium">Fecha</th>
                    <th className="px-6 py-4 font-medium">Cliente / Póliza</th>
                    <th className="px-6 py-4 font-medium">Método / Cuenta</th>
                    <th className="px-6 py-4 font-medium">Monto</th>
                    <th className="px-6 py-4 font-medium">Estado</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedIncomes.length === 0 ? (
                    <tr>
                      <td colSpan={isSuperAdmin ? 7 : 6} className="px-6 py-12 text-center text-gray-400">No hay ingresos registrados en {incomeCurrencyTab} con los filtros especificados.</td>
                    </tr>
                  ) : (
                    paginatedIncomes.map((p) => {
                      const insurance = insurances.find(ins => ins.id === p.insuranceId);
                      const client = clients.find(c => c.id === p.clientId);
                      const clientName = client ? (client.type === 'Individual' ? `${client.firstName} ${client.lastName}` : (client.commercialName || client.legalName)) : (insurance ? `${insurance.firstName} ${insurance.lastName}` : 'N/A');
                      
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          {isSuperAdmin && (
                            <td className="px-6 py-4 text-sm text-gray-600 w-12 text-center">
                              <button
                                onClick={() => {
                                  setSelectedPaymentIds(prev => 
                                    prev.includes(p.id!) ? prev.filter(item => item !== p.id!) : [...prev, p.id!]
                                  );
                                }}
                                className="text-gray-400 hover:text-blue-600 transition-colors"
                              >
                                {selectedPaymentIds.includes(p.id!) ? (
                                  <CheckSquare className="w-5 h-5 text-blue-600" />
                                ) : (
                                  <Square className="w-5 h-5" />
                                )}
                              </button>
                            </td>
                          )}
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {p.date?.toDate ? p.date.toDate().toLocaleDateString() : new Date(p.date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900">
                                {clientName}
                              </span>
                              <span className="text-[10px] font-mono text-gray-400 uppercase">
                                {p.insuranceId === 'conciliacion_bancaria' ? 'Conciliación Bancaria' : `${p.insuranceId?.slice(0, 8) || 'N/A'} - ${insurance?.policyId || 'N/A'}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-medium text-gray-900">{p.paymentMethod}</p>
                            {p.depositAccount && <p className="text-[10px] text-gray-400">{p.depositAccount}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-green-600">
                              {p.currency === 'USD' ? `$${p.amount.toLocaleString()} USD` : `$${(p.amountMXP || 0).toLocaleString()} MXP`}
                            </p>
                            {p.currency === 'MXP' && p.exchangeRate && (
                              <p className="text-[10px] text-gray-400">T.C. {p.exchangeRate}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-[10px] font-bold rounded-full uppercase ${
                              p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {p.status === 'completed' ? 'Completado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => setEditingPayment({
                                  ...p,
                                  date: p.date?.toDate ? p.date.toDate().toISOString().split('T')[0] : new Date(p.date).toISOString().split('T')[0]
                                } as any)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar Pago"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => confirmAction('Eliminar Ingreso', '¿Estás seguro de eliminar este ingreso?', () => {
                                  handleDeletePayment(p.id!);
                                })}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar Pago"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {visibleIncomes.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50 px-6 py-4 border-t border-gray-100">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <p className="text-sm text-gray-500 font-semibold">
                    Mostrando <span className="font-bold text-gray-900">{visibleIncomes.length === 0 ? 0 : ((incomePage - 1) * incomePageSize) + 1}</span> a <span className="font-bold text-gray-900">{Math.min(incomePage * incomePageSize, visibleIncomes.length)}</span> de <span className="font-bold text-gray-900">{visibleIncomes.length}</span> ingresos registrados
                  </p>
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                    <span className="text-xs text-gray-500 font-medium">Filas por página:</span>
                    <select
                      value={incomePageSize}
                      onChange={(e) => {
                        setIncomePageSize(Number(e.target.value));
                        setIncomePage(1);
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
                {totalIncomePages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIncomePage(p => Math.max(1, p - 1))}
                      disabled={incomePage === 1}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 bg-white rounded-lg border border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    {Array.from({ length: totalIncomePages }, (_, i) => i + 1).filter(p => {
                      return p === 1 || p === totalIncomePages || Math.abs(p - incomePage) <= 1;
                    }).map((p, i, arr) => (
                      <React.Fragment key={p}>
                        {i > 0 && arr[i-1] !== p - 1 && <span className="text-gray-300 mx-1 border-none bg-transparent">...</span>}
                        <button
                          onClick={() => setIncomePage(p)}
                          className={`min-w-[32px] h-8 rounded-lg text-xs font-bold transition-all border ${
                            incomePage === p 
                              ? 'bg-[#2563eb] text-white border-[#2563eb] shadow-md shadow-blue-100' 
                              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-blue-600'
                          }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    ))}
                    <button
                      onClick={() => setIncomePage(p => Math.min(totalIncomePages, p + 1))}
                      disabled={incomePage === totalIncomePages}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 bg-white rounded-lg border border-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Registro de Egresos</h3>
              <p className="text-gray-500 text-sm">Pagos realizados a proveedores y gastos operativos.</p>
            </div>
            <div className="flex gap-4 items-center">
              <button
                onClick={() => {
                  setExpenseForm({
                    type: 'provider_payment',
                    currency: expenseCurrencyTab,
                    status: 'completed',
                    date: new Date().toISOString().split('T')[0],
                    amount: 0,
                    exchangeRate: exchangeRate,
                    amountMXP: 0
                  });
                  setShowExpenseModal(true);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-md flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Nuevo Egreso
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setExpenseCurrencyTab('USD')}
                className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
                  expenseCurrencyTab === 'USD' 
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                USD (Dólares)
              </button>
              <button
                onClick={() => setExpenseCurrencyTab('MXP')}
                className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
                  expenseCurrencyTab === 'MXP' 
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
              >
                MXP (Pesos)
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 flex items-center gap-4">
                <div className="p-3 bg-red-100 rounded-xl">
                  <CheckSquare className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Operaciones ({expenseCurrencyTab})</p>
                  <p className="text-2xl font-black text-gray-900">{expenseStats.count}</p>
                </div>
              </div>
              <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 flex items-center gap-4">
                <div className="p-3 bg-red-100 rounded-xl">
                  <DollarSign className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total ({expenseCurrencyTab})</p>
                  <p className="text-2xl font-black text-gray-900">${expenseStats.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {expenseCurrencyTab}</p>
                </div>
              </div>
            </div>

            {isSuperAdmin && selectedPaymentIds.length > 0 && (
              <div className="mx-6 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-bold text-blue-800">
                    {selectedPaymentIds.length} {selectedPaymentIds.length === 1 ? 'registro seleccionado' : 'registros seleccionados'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setBulkEditData({});
                      setShowBulkEditModal(true);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar {selectedPaymentIds.length === 1 ? 'Seleccionado' : 'Seleccionados'}
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar {selectedPaymentIds.length === 1 ? 'Seleccionado' : 'Seleccionados'}
                  </button>
                  <button
                    onClick={() => setSelectedPaymentIds([])}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-medium transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    {isSuperAdmin && (
                      <th className="px-6 py-4 font-medium w-12 text-center">
                        <button
                          onClick={() => {
                            const allIds = visibleExpenses.map(p => p.id!).filter(Boolean);
                            const allSelected = allIds.every(id => selectedPaymentIds.includes(id));
                            if (allSelected) {
                              setSelectedPaymentIds(prev => prev.filter(id => !allIds.includes(id)));
                            } else {
                              setSelectedPaymentIds(prev => Array.from(new Set([...prev, ...allIds])));
                            }
                          }}
                          className="text-gray-400 hover:text-blue-600 transition-colors"
                          title="Seleccionar Todos"
                        >
                          {visibleExpenses.length > 0 && visibleExpenses.every(p => selectedPaymentIds.includes(p.id!)) ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      </th>
                    )}
                    <th className="px-6 py-4 font-medium">Fecha</th>
                    <th className="px-6 py-4 font-medium">Proveedor / Concepto</th>
                    <th className="px-6 py-4 font-medium">Categoría</th>
                    <th className="px-6 py-4 font-medium">Monto</th>
                    <th className="px-6 py-4 font-medium">Estado</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={isSuperAdmin ? 7 : 6} className="px-6 py-12 text-center text-gray-400">No hay gastos registrados en {expenseCurrencyTab}.</td>
                    </tr>
                  ) : (
                    visibleExpenses.map((p) => {
                      const insurance = insurances.find(ins => ins.id === p.insuranceId);
                      const provider = providers.find(prov => prov.id === p.providerId);
                      const category = categories.find(c => c.id === p.categoryId);
                      const subcategory = subcategories.find(s => s.id === p.subcategoryId);
                      
                      const providerName = p.providerName || (provider ? (provider.commercialName || provider.legalName) : (insurance ? `${insurance.firstName} ${insurance.lastName}` : 'N/A'));
                      
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          {isSuperAdmin && (
                            <td className="px-6 py-4 text-sm text-gray-600 w-12 text-center">
                              <button
                                onClick={() => {
                                  setSelectedPaymentIds(prev => 
                                    prev.includes(p.id!) ? prev.filter(item => item !== p.id!) : [...prev, p.id!]
                                  );
                                }}
                                className="text-gray-400 hover:text-blue-600 transition-colors"
                              >
                                {selectedPaymentIds.includes(p.id!) ? (
                                  <CheckSquare className="w-5 h-5 text-blue-600" />
                                ) : (
                                  <Square className="w-5 h-5" />
                                )}
                              </button>
                            </td>
                          )}
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {p.date?.toDate ? p.date.toDate().toLocaleDateString() : new Date(p.date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900">
                                {providerName}
                              </span>
                              <span className="text-[10px] font-mono text-gray-400 uppercase">
                                {p.insuranceId === 'conciliacion_bancaria' ? 'Conciliación Bancaria' : (p.insuranceId ? `${p.insuranceId.slice(0, 8)} - ${insurance?.policyId || 'N/A'}` : p.notes || 'Gasto Operativo')}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {category ? (
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-blue-600">{category.name}</span>
                                {subcategory && <span className="text-[10px] text-gray-400">{subcategory.name}</span>}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 italic">Sin categoría</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-red-600">
                              {p.currency === 'USD' ? `$${p.amount.toLocaleString()} USD` : `$${(p.amountMXP || 0).toLocaleString()} MXP`}
                            </p>
                            {p.currency === 'MXP' && p.exchangeRate && (
                              <p className="text-[10px] text-gray-400">T.C. {p.exchangeRate}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-[10px] font-bold rounded-full uppercase ${
                              p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {p.status === 'completed' ? 'Completado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {p.receiptUrl && (
                                <a 
                                  href={p.receiptUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Ver Comprobante"
                                >
                                  <FileText className="w-4 h-4" />
                                </a>
                              )}
                              <button 
                                onClick={() => {
                                  setExpenseForm({
                                    ...p,
                                    date: p.date?.toDate ? p.date.toDate().toISOString().split('T')[0] : new Date(p.date).toISOString().split('T')[0]
                                  });
                                  setShowExpenseModal(true);
                                }}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar Gasto"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => confirmAction('Eliminar Gasto', '¿Estás seguro de eliminar este gasto?', () => {
                                  handleDeletePayment(p.id!);
                                })}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar Gasto"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
      )}

      {activeTab === 'commissions' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Registro de Comisiones</h3>
              <p className="text-gray-500 text-sm">Pagos realizados a agentes por comisiones de venta.</p>
            </div>
            <div className="bg-purple-50 px-4 py-2 rounded-xl border border-purple-100">
              <p className="text-[10px] font-bold text-purple-600 uppercase">Total Comisiones Pagadas</p>
              <p className="text-xl font-black text-purple-700">
                ${payments.filter(p => p.type === 'agent_commission').reduce((sum, p) => sum + p.amount, 0).toLocaleString()} USD
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium">Fecha</th>
                    <th className="px-6 py-4 font-medium">Agente / Póliza</th>
                    <th className="px-6 py-4 font-medium">Método / Cuenta</th>
                    <th className="px-6 py-4 font-medium">Monto</th>
                    <th className="px-6 py-4 font-medium">Estado</th>
                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.filter(p => p.type === 'agent_commission').length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No hay comisiones registradas.</td>
                    </tr>
                  ) : (
                    payments.filter(p => p.type === 'agent_commission').sort((a, b) => {
                      const dateA = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date).getTime();
                      const dateB = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date).getTime();
                      return dateB - dateA;
                    }).map((p) => {
                      const insurance = insurances.find(ins => ins.id === p.insuranceId);
                      return (
                        <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {p.date?.toDate ? p.date.toDate().toLocaleDateString() : new Date(p.date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900">
                                {insurance ? `${insurance.firstName} ${insurance.lastName}` : 'N/A'}
                              </span>
                              <span className="text-[10px] font-mono text-gray-400 uppercase">
                                {p.insuranceId.slice(0, 8)} - {insurance?.policyId || 'N/A'}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-medium text-gray-900">{p.paymentMethod}</p>
                            {p.depositAccount && <p className="text-[10px] text-gray-400">{p.depositAccount}</p>}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-purple-600">
                              {p.currency === 'USD' ? `$${p.amount.toLocaleString()} USD` : `$${(p.amountMXP || 0).toLocaleString()} MXP`}
                            </p>
                            {p.currency === 'MXP' && p.exchangeRate && (
                              <p className="text-[10px] text-gray-400">T.C. {p.exchangeRate}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-[10px] font-bold rounded-full uppercase ${
                              p.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {p.status === 'completed' ? 'Completado' : 'Pendiente'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => setEditingPayment({
                                  ...p,
                                  date: p.date?.toDate ? p.date.toDate().toISOString().split('T')[0] : new Date(p.date).toISOString().split('T')[0]
                                } as any)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Editar Pago"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => confirmAction('Eliminar Comisión', '¿Estás seguro de eliminar esta comisión?', () => {
                                  handleDeletePayment(p.id!);
                                })}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Eliminar Pago"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
      )}

      {activeTab === 'cash_flow' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Análisis de Flujo de Caja (Cash Flow)</h3>
                <p className="text-gray-500 text-sm">Monitorea la dinámica de ingresos contra egresos directos e indirectos por mes.</p>
              </div>
            </div>
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-green-50 p-5 rounded-2xl border border-green-100 flex flex-col gap-1">
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider">Entradas (Inflows)</p>
                <p className="text-2xl font-black text-green-700">${cashFlowData.kpis.totalIngresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                <p className="text-xs text-green-500/80 font-medium">Cobros recibidos de clientes</p>
              </div>

              <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 flex flex-col gap-1">
                <p className="text-xs font-bold text-orange-600 uppercase tracking-wider">Salidas (Outflows)</p>
                <p className="text-2xl font-black text-orange-700">${cashFlowData.kpis.totalEgresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                <p className="text-xs text-orange-500/80 font-medium">Egresos, pagos a proveedores y comisiones</p>
              </div>

              <div className={`p-5 rounded-2xl border flex flex-col gap-1 ${
                cashFlowData.kpis.totalNeto >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'
              }`}>
                <p className={`text-xs font-bold uppercase tracking-wider ${
                  cashFlowData.kpis.totalNeto >= 0 ? 'text-blue-600' : 'text-red-600'
                }`}>Flujo Neto Acumulado</p>
                <p className={`text-2xl font-black ${
                  cashFlowData.kpis.totalNeto >= 0 ? 'text-blue-700' : 'text-red-700'
                }`}>${cashFlowData.kpis.totalNeto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                <p className="text-xs text-gray-500 font-medium">Balance neto consolidado</p>
              </div>
            </div>

            {/* Cash Flow Chart */}
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
              <h4 className="text-sm font-bold text-gray-800 mb-4">Comportamiento de Flujo Mensual (USD)</h4>
              <div className="h-[320px]">
                {cashFlowData.chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 italic">
                    Insuficiente información para graficar. Registra pagos de cliente o egresos para ver el flujo.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashFlowData.chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)' }}
                        formatter={(val: number) => [`$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`]} 
                      />
                      <Legend verticalAlign="top" height={36} iconType="circle" />
                      <Bar name="Ingresos (Inflows)" dataKey="ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar name="Egresos (Outflows)" dataKey="egresos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Interactive Filters Bar */}
            <div className="bg-slate-50/70 border border-slate-200/50 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold text-gray-700">Filtros de Flujo</span>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap items-center gap-3 w-full md:w-auto">
                <div className="flex flex-col gap-1 min-w-[130px]">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Fecha Inicio</label>
                  <input 
                    type="date"
                    value={cashFlowFilters.startDate}
                    onChange={(e) => {
                      setCashFlowFilters(prev => ({ ...prev, startDate: e.target.value }));
                      setCashFlowPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1 min-w-[130px]">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Fecha Fin</label>
                  <input 
                    type="date"
                    value={cashFlowFilters.endDate}
                    onChange={(e) => {
                      setCashFlowFilters(prev => ({ ...prev, endDate: e.target.value }));
                      setCashFlowPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1 min-w-[140px]">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Tipo Movimiento</label>
                  <select
                    value={cashFlowFilters.type}
                    onChange={(e) => {
                      setCashFlowFilters(prev => ({ ...prev, type: e.target.value as any }));
                      setCashFlowPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Movimientos</option>
                    <option value="income">Ingresos (+)</option>
                    <option value="expense">Egresos (-)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[160px]">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Cuenta de Pago</label>
                  <select
                    value={cashFlowFilters.account}
                    onChange={(e) => {
                      setCashFlowFilters(prev => ({ ...prev, account: e.target.value }));
                      setCashFlowPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[200px]"
                  >
                    <option value="all">Todas las Cuentas</option>
                    {uniqueAccountsList.map((ac, idx) => (
                      <option key={idx} value={ac}>{ac}</option>
                    ))}
                    <option value="Sin Especificar">Sin Especificar</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1 min-w-[140px]">
                  <label className="text-[10px] uppercase font-bold text-gray-400">Estado de Pago</label>
                  <select
                    value={cashFlowFilters.status}
                    onChange={(e) => {
                      setCashFlowFilters(prev => ({ ...prev, status: e.target.value as any }));
                      setCashFlowPage(1);
                    }}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="all">Todos los Estados</option>
                    <option value="completed">Completados (Monetizado)</option>
                    <option value="pending">Pendientes (Proyección)</option>
                  </select>
                </div>

                {(cashFlowFilters.startDate || cashFlowFilters.endDate || cashFlowFilters.type !== 'all' || cashFlowFilters.account !== 'all' || cashFlowFilters.status !== 'completed') && (
                  <button
                    onClick={() => {
                      setCashFlowFilters({
                        startDate: '',
                        endDate: '',
                        type: 'all',
                        account: 'all',
                        status: 'completed'
                      });
                      setCashFlowPage(1);
                    }}
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300 transition-colors mt-[15px] sm:mt-0 self-end"
                  >
                    Limpiar Filtros
                  </button>
                )}
              </div>
            </div>

            {/* Account Segmentation Panel */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-600" />
                <h4 className="text-base font-bold text-gray-900">Resumen y Desglose por Cuentas</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {accountsSegmentation.map((seg, idx) => {
                  const netBalance = seg.ingresos - seg.egresos;
                  return (
                    <div key={idx} className="bg-slate-50 border border-slate-250 p-4.5 rounded-2xl flex flex-col gap-2 shadow-xs hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                        <span className="text-xs font-extrabold text-slate-800 tracking-tight truncate max-w-[150px]" title={seg.account}>
                          {seg.account === 'Sin Especificar' ? '⚠️ Sin Especificar' : seg.account}
                        </span>
                        <span className="text-[10px] font-black px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                          {seg.count} {seg.count === 1 ? 'Tx' : 'Txs'}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between items-center text-gray-500">
                          <span>Ingresos:</span>
                          <span className="font-bold text-green-600">+${seg.ingresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center text-gray-500">
                          <span>Egresos:</span>
                          <span className="font-bold text-orange-600">-${seg.egresos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center pt-1.5 border-t border-dashed border-gray-200">
                          <span className="font-extrabold text-slate-700">Saldo Neto:</span>
                          <span className={`font-black ${netBalance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            ${netBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {accountsSegmentation.length === 0 && (
                  <div className="col-span-full py-6 text-center text-slate-400 text-sm italic">
                    No hay registros de cuenta para los filtros seleccionados.
                  </div>
                )}
              </div>
            </div>

            {/* Listado de Operaciones */}
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <span>Listado General de Operaciones</span>
                  <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                    {filteredOperations.length} registros encontrados
                  </span>
                </h4>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-gray-150 shadow-xs">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead className="bg-[#f8fafc] text-slate-500 text-[10.5px] uppercase tracking-wider font-bold border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3.5">Fecha</th>
                      <th className="px-4 py-3.5">Asegurado</th>
                      <th className="px-4 py-3.5">Plan / Cobertura</th>
                      <th className="px-4 py-3.5">Cuenta Pago</th>
                      <th className="px-4 py-3.5">Método</th>
                      <th className="px-4 py-3.5 text-right">Ingreso (USD)</th>
                      <th className="px-4 py-3.5 text-right">Egreso (USD)</th>
                      <th className="px-4 py-3.5 text-right">Comisión</th>
                      <th className="px-4 py-3.5 text-right">Comisión Agto.</th>
                      <th className="px-4 py-3.5 text-right">Margen (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs">
                    {paginatedOperations.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-12 text-center text-gray-400 italic">
                          No se encontraron operaciones con los filtros configurados.
                        </td>
                      </tr>
                    ) : (
                      paginatedOperations.map((op) => {
                        return (
                          <tr key={op.id} className="hover:bg-slate-50/75 transition-colors">
                            <td className="px-4 py-3 font-mono text-gray-500 whitespace-nowrap">
                              {op.parsedDate.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })}
                            </td>
                            <td className="px-4 py-3 font-bold text-gray-950 whitespace-nowrap">
                              <div className="max-w-[180px] truncate" title={op.asegurado}>
                                {op.asegurado}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              <div className="max-w-[200px] truncate" title={op.planFechas}>
                                {op.planFechas}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                              {op.cuentaPago === 'Sin Especificar' ? (
                                <span className="text-gray-400 italic">Sin Especificar</span>
                              ) : (
                                <span className="font-semibold bg-slate-100/80 text-slate-700 px-2 py-0.5 rounded-md">
                                  {op.cuentaPago}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                              {op.metodo}
                            </td>
                            <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                              {op.ingreso > 0 ? (
                                <span className="text-green-600">
                                  +${op.ingreso.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                              {op.egreso > 0 ? (
                                <span className="text-orange-600">
                                  -${op.egreso.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                              {op.comision > 0 ? (
                                <span className="text-indigo-600 font-medium">
                                  ${op.comision.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                              {op.comisionAgente > 0 ? (
                                <span className="text-purple-600 font-medium">
                                  ${op.comisionAgente.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap font-bold">
                              {op.margen > 0 ? (
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-lg">
                                  ${op.margen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : op.margen < 0 ? (
                                <span className="bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 rounded-lg">
                                  ${op.margen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {filteredOperations.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3.5 border-t border-gray-100 text-xs text-gray-500">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span>
                      Mostrando <span className="font-bold text-gray-900">{Math.min(filteredOperations.length, (cashFlowPage - 1) * cashFlowPageSize + 1)}</span> a{' '}
                      <span className="font-bold text-gray-900">{Math.min(filteredOperations.length, cashFlowPage * cashFlowPageSize)}</span> de{' '}
                      <span className="font-bold text-gray-900">{filteredOperations.length}</span> registros
                    </span>

                    <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                      <span>Registros por página:</span>
                      <select
                        value={cashFlowPageSize}
                        onChange={(e) => {
                          setCashFlowPageSize(Number(e.target.value));
                          setCashFlowPage(1);
                        }}
                        className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none"
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCashFlowPage(p => Math.max(1, p - 1))}
                      disabled={cashFlowPage === 1}
                      className="p-1 px-2.5 border border-gray-200 text-gray-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 font-bold flex items-center gap-1 transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Anterior
                    </button>
                    
                    <span className="text-gray-500 font-bold px-1 text-center min-w-[90px]">
                      Pág. {cashFlowPage} de {totalPages}
                    </span>

                    <button
                      onClick={() => setCashFlowPage(p => Math.min(totalPages, p + 1))}
                      disabled={cashFlowPage === totalPages}
                      className="p-1 px-2.5 border border-gray-200 text-gray-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 font-bold flex items-center gap-1 transition-all"
                    >
                      Siguiente
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'income_statement' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-4xl mx-auto">
            <div className="text-center mb-8 pb-6 border-b border-gray-100">
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">Estado de Resultados Consolidado</h3>
              <p className="text-gray-500 text-sm mt-1">Reporte corporativo detallado del desempeño y margen operacional (Valores en USD).</p>
            </div>

            <div className="space-y-6 max-w-2xl mx-auto font-sans">
              {/* Seccion 1 */}
              <div>
                <div className="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                  <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Ingreso Operativo (Ventas)</span>
                  <span className="text-base font-black text-slate-900">
                    ${dashboardData.kpis.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="pl-6 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>(+) Primas Totales Vendidas</span>
                    <span>${dashboardData.kpis.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                </div>
              </div>

              {/* Seccion 2 */}
              <div>
                <div className="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                  <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">2. Costo Directo de Cobertura</span>
                  <span className="text-base font-black text-rose-600">
                    -${dashboardData.kpis.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="pl-6 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>(-) Costo de Cobertura a Proveedor</span>
                    <span>-${dashboardData.kpis.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                </div>
              </div>

              {/* Utilidad Bruta */}
              <div className="border-t border-dashed border-gray-200 pt-3">
                <div className="flex justify-between items-center bg-emerald-50 px-4 py-3.5 rounded-xl border border-emerald-100 font-bold">
                  <span className="text-sm font-black text-emerald-800 uppercase tracking-widest">(=) UTILIDAD BRUTA OPERATIVA</span>
                  <span className="text-lg font-black text-emerald-700">
                    ${(dashboardData.kpis.totalSales - dashboardData.kpis.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              {/* Seccion 3 */}
              <div>
                <div className="flex justify-between items-center bg-slate-50 px-4 py-3 rounded-xl border border-slate-100">
                  <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">3. Costo Canal / Gastos Administrativos</span>
                  <span className="text-base font-black text-orange-600">
                    -${dashboardData.kpis.totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="pl-6 pt-2 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>(-) Comisiones a Agentes de Venta</span>
                    <span>-${dashboardData.kpis.totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                  </div>
                </div>
              </div>

              {/* Utilidad Neta */}
              <div className="border-t-2 border-slate-200 pt-4">
                <div className="flex justify-between items-center bg-indigo-600 text-white px-5 py-4 rounded-2xl shadow-lg shadow-indigo-100">
                  <div>
                    <span className="text-sm font-black uppercase tracking-widest block opacity-90">(=) UTILIDAD NETA DEL EJERCICIO</span>
                    <span className="text-xs opacity-75">Rentabilidad real acumulada</span>
                  </div>
                  <span className="text-2xl font-black">
                    ${dashboardData.kpis.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              {/* Rentabilidad global % */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center text-xs text-gray-500 font-bold">
                PORCENTAJE DE RENTABILIDAD SOBRE INGRESOS: {' '}
                <span className="text-indigo-600 text-sm font-black">
                  {dashboardData.kpis.totalSales > 0 
                    ? ((dashboardData.kpis.netProfit / dashboardData.kpis.totalSales) * 100).toFixed(2) 
                    : '0.00'}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <BulkImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        policies={policies}
        countries={countries}
        clients={clients}
        insuranceTypes={insuranceTypes}
        exchangeRate={exchangeRate}
        profile={profile}
      />

      {/* Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-red-600 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">{expenseForm.id ? 'Editar Gasto' : 'Nuevo Gasto'}</h3>
                <p className="text-red-100 text-sm">Registra un egreso o pago a proveedor</p>
              </div>
              <button onClick={() => setShowExpenseModal(false)} className="p-2 hover:bg-red-500 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSaveExpense} className="p-8 space-y-6 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Fecha</label>
                  <input
                    type="date"
                    required
                    value={expenseForm.date as string}
                    onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Proveedor / Concepto</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Seguros Atlas"
                    value={expenseForm.providerName || ''}
                    onChange={(e) => setExpenseForm({ ...expenseForm, providerName: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Categoría</label>
                  <select
                    required
                    value={expenseForm.categoryId || ''}
                    onChange={(e) => setExpenseForm({ ...expenseForm, categoryId: e.target.value, subcategoryId: '' })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Subcategoría</label>
                  <select
                    value={expenseForm.subcategoryId || ''}
                    onChange={(e) => setExpenseForm({ ...expenseForm, subcategoryId: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  >
                    <option value="">Seleccionar...</option>
                    {subcategories.filter(s => s.categoryId === expenseForm.categoryId).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Moneda</label>
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    {(['USD', 'MXP'] as const).map(curr => (
                      <button
                        key={curr}
                        type="button"
                        onClick={() => {
                          const isSwitchingToMXP = curr === 'MXP' && expenseForm.currency === 'USD';
                          const isSwitchingToUSD = curr === 'USD' && expenseForm.currency === 'MXP';
                          
                          if (isSwitchingToMXP) {
                            setExpenseForm({ ...expenseForm, currency: curr });
                          } else if (isSwitchingToUSD) {
                            setExpenseForm({ ...expenseForm, currency: curr });
                          } else {
                            setExpenseForm({ ...expenseForm, currency: curr });
                          }
                        }}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                          expenseForm.currency === curr ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500'
                        }`}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Monto ({expenseForm.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={expenseForm.currency === 'USD' ? expenseForm.amount : expenseForm.amountMXP}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (expenseForm.currency === 'USD') {
                        setExpenseForm({ ...expenseForm, amount: val, amountMXP: val * (expenseForm.exchangeRate || exchangeRate) });
                      } else {
                        setExpenseForm({ ...expenseForm, amountMXP: val, amount: val / (expenseForm.exchangeRate || exchangeRate) });
                      }
                    }}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Tipo de Cambio</label>
                  <input
                    type="number"
                    step="0.01"
                    value={expenseForm.exchangeRate}
                    onChange={(e) => {
                      const rate = parseFloat(e.target.value) || 1;
                      if (expenseForm.currency === 'USD') {
                        setExpenseForm({ 
                          ...expenseForm, 
                          exchangeRate: rate,
                          amountMXP: (expenseForm.amount || 0) * rate
                        });
                      } else {
                        setExpenseForm({ 
                          ...expenseForm, 
                          exchangeRate: rate,
                          amount: (expenseForm.amountMXP || 0) / rate
                        });
                      }
                    }}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    {expenseForm.currency === 'USD' ? 'Monto Equivalente (MXP)' : 'Monto Equivalente (USD)'}
                  </label>
                  <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex justify-between items-center">
                    <span className="text-red-700 font-bold">Total:</span>
                    <span className="text-2xl font-black text-red-800">
                      {expenseForm.currency === 'USD' 
                        ? `$${(expenseForm.amountMXP || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP`
                        : `$${(expenseForm.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
                      }
                    </span>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">URL Comprobante (Opcional)</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={expenseForm.receiptUrl || ''}
                    onChange={(e) => setExpenseForm({ ...expenseForm, receiptUrl: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-6">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-4 bg-red-600 text-white font-black rounded-xl hover:bg-red-700 shadow-xl disabled:opacity-50 transition-all"
                >
                  {submitting ? 'Guardando...' : expenseForm.id ? 'Actualizar Gasto' : 'Crear Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Invoice Prompt Modal */}
      {showInvoicePrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Confirmar Pago de Invoices</h3>
              <p className="text-gray-500 text-sm mt-1">Se registrará el pago para los registros asociados.</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Invoices Seleccionados</label>
                <div className="text-sm font-semibold font-mono text-gray-800 bg-gray-50 p-3 rounded-xl border border-gray-200 break-all max-h-24 overflow-y-auto w-full">
                  {selectedInvoiceKeys.join(', ') || 'Ninguno'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Fecha de Pago</label>
                <input
                  type="date"
                  value={invoicePaymentDate}
                  onChange={(e) => setInvoicePaymentDate(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold text-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Forma de Pago</label>
                <select
                  value={invoicePaymentMethod}
                  onChange={(e) => setInvoicePaymentMethod(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold text-gray-800"
                >
                  <option value="">Seleccionar método...</option>
                  {paymentMethods
                    .filter(m => m.status === 'active')
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(m => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Cuenta de Pago / Depósito</label>
                <input
                  type="text"
                  placeholder="Ej. Banco de origen / cuenta corporativa"
                  value={invoiceDepositAccount}
                  onChange={(e) => setInvoiceDepositAccount(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold text-gray-800"
                />
              </div>
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-700 font-bold uppercase">Total a Pagar</p>
                <p className="text-xl font-black text-blue-800">
                  ${invoiceGroups
                    .filter(g => selectedInvoiceKeys.includes(g.invoiceNumber))
                    .reduce((sum, g) => sum + g.pendingAmount, 0)
                    .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </p>
              </div>
            </div>
            <div className="p-6 bg-gray-50 flex gap-4">
              <button
                onClick={() => setShowInvoicePrompt(false)}
                className="flex-1 py-3 bg-white text-gray-700 font-bold rounded-xl border border-gray-200 hover:bg-gray-100 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={processBulkInvoicesPayment}
                disabled={selectedInvoiceKeys.length === 0 || !invoicePaymentMethod || submitting}
                className="flex-1 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 shadow-lg disabled:opacity-50 transition-all font-sans"
              >
                {submitting ? 'Procesando...' : 'Confirmar Pago'}
              </button>
            </div>
          </div>
        </div>
      )}

      {differenceModalOpen && selectedDifferenceGroup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Resolución y Pago de Diferencia</h3>
                <p className="text-xs text-gray-500 mt-1 font-mono">Invoice: {selectedDifferenceGroup.invoiceNumber}</p>
              </div>
              <button 
                onClick={() => {
                  setDifferenceModalOpen(false);
                  setSelectedDifferenceGroup(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <span className="text-xl font-bold">&times;</span>
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Discrepancies listing */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Pólizas con Discrepancias ({selectedDifferenceGroup.validation.discrepancies.length})</label>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {selectedDifferenceGroup.validation.discrepancies.map((d: any, index: number) => (
                    <div key={index} className="p-3 bg-slate-50 rounded-xl border border-gray-100 text-xs">
                      <div className="flex justify-between font-bold text-gray-800 mb-1">
                        <span>{d.insuredName}</span>
                        <span className="text-amber-600 font-mono">
                          Diff: ${d.difference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="text-gray-500 font-sans flex justify-between">
                        <span>Póliza: {d.policyId}</span>
                        <span>
                          Reg: ${d.actualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} vs Esp: ${d.expectedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <p className="text-[10px] text-amber-700 font-medium italic mt-1 font-sans">
                        Motivo: {d.reason === 'policy_not_found' ? 'Plan no registrado en catálogo' : 'Costo diario no coincide con el plan maestro'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Amount Selection */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-gray-400 uppercase">Selecciona el Monto a Confirmar y Pagar</label>
                
                {/* Registered Amount Option */}
                <button
                  type="button"
                  onClick={() => setSelectedAmountType('registered')}
                  className={`w-full p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                    selectedAmountType === 'registered'
                      ? 'bg-blue-50/70 border-blue-200 ring-2 ring-blue-500/20'
                      : 'bg-white border-gray-100 hover:bg-gray-50/50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-bold text-gray-800">Monto Registrado (Sistema)</p>
                    <p className="text-xs text-gray-500 mt-1 font-sans">Monto actualmente guardado en las pólizas de este invoice.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-blue-800">${selectedDifferenceGroup.pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                    <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full mt-1 inline-block">Monto Original</span>
                  </div>
                </button>

                {/* Expected Amount Option */}
                <button
                  type="button"
                  onClick={() => setSelectedAmountType('expected')}
                  className={`w-full p-4 rounded-xl border text-left transition-all flex items-center justify-between ${
                    selectedAmountType === 'expected'
                      ? 'bg-emerald-50/70 border-emerald-200 ring-2 ring-emerald-500/20'
                      : 'bg-white border-gray-100 hover:bg-gray-50/50'
                  }`}
                >
                  <div>
                    <p className="text-sm font-bold text-gray-800">Monto Esperado (Catálogo de Planes)</p>
                    <p className="text-xs text-gray-500 mt-1 font-sans">Monto calculado según tarifas vigentes del catálogo.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-emerald-800">
                      ${Math.max(0, selectedDifferenceGroup.validation.totalExpectedCost - selectedDifferenceGroup.paidAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full mt-1 inline-block">Costo Calculado</span>
                  </div>
                </button>

                {/* Custom Amount Option */}
                <div className={`p-4 rounded-xl border transition-all space-y-3 ${
                  selectedAmountType === 'custom'
                    ? 'bg-amber-50/40 border-amber-200 ring-2 ring-amber-500/10'
                    : 'bg-white border-gray-100'
                }`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAmountType('custom');
                      setCustomPaymentAmount(selectedDifferenceGroup.pendingAmount.toFixed(2));
                    }}
                    className="w-full text-left flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-bold text-gray-800">Modificar y Pagar Otra Cantidad</p>
                      <p className="text-xs text-gray-500 mt-0.5 font-sans">Escribe el monto exacto acordado con el proveedor.</p>
                    </div>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">Ajustar Cantidad</span>
                  </button>
                  
                  {selectedAmountType === 'custom' && (
                    <div className="relative animate-in slide-in-from-top-1 duration-100 pt-1">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="text-gray-500 font-bold">$</span>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={customPaymentAmount}
                        onChange={(e) => setCustomPaymentAmount(e.target.value)}
                        className="w-full pl-8 pr-12 py-2 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 font-bold text-gray-800 bg-white text-sm"
                        placeholder="0.00"
                      />
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <span className="text-xs text-gray-400 font-bold">USD</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Fecha de Pago</label>
                  <input
                    type="date"
                    value={invoicePaymentDate}
                    onChange={(e) => setInvoicePaymentDate(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Forma de Pago</label>
                  <select
                    value={invoicePaymentMethod}
                    onChange={(e) => setInvoicePaymentMethod(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold text-gray-800 bg-white"
                  >
                    <option value="">Seleccionar...</option>
                    {paymentMethods
                      .filter(m => m.status === 'active')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(m => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Cuenta de Origen / Depósito</label>
                  <input
                    type="text"
                    placeholder="Ej. Banco de origen / cuenta corporativa"
                    value={invoiceDepositAccount}
                    onChange={(e) => setInvoiceDepositAccount(e.target.value)}
                    className="w-full p-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-semibold text-gray-800"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-4">
              <button
                onClick={() => {
                  setDifferenceModalOpen(false);
                  setSelectedDifferenceGroup(null);
                }}
                className="flex-1 py-3 bg-white text-gray-700 font-bold rounded-xl border border-gray-200 hover:bg-gray-100 transition-all text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={processDifferencePayment}
                disabled={!invoicePaymentMethod || submitting}
                className="flex-1 py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 shadow-lg disabled:opacity-50 transition-all font-sans text-xs"
              >
                {submitting ? 'Procesando...' : 'Confirmar y Pagar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscountCommissionModal && selectedInsurance && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 className="text-xl font-black text-[#1A2138] uppercase tracking-tight">Descuento Comisión</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Registrar compensación de saldo</p>
              </div>
              <button 
                onClick={() => setShowDiscountCommissionModal(false)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors cursor-pointer animate-none"
              >
                <X className="w-6 h-6 text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            <div className="p-8 space-y-6 text-left">
              <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100/50 flex items-center gap-3">
                <div className="p-2 bg-indigo-600 text-white rounded-lg">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Saldo Pendiente Actual</p>
                  <p className="text-xl font-black text-indigo-900">${(selectedInsurance ? ((selectedInsurance.totalFinal || selectedInsurance.totalPrice) - (selectedInsurance.totalPaid || 0)) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Monto a Aplicar (USD)</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <span className="text-gray-500 font-bold">$</span>
                    </div>
                    <input 
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={discountCommissionAmount}
                      onChange={(e) => setDiscountCommissionAmount(e.target.value)}
                      className="w-full pl-8 pr-16 py-3.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                      required
                    />
                    <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                      <span className="text-xs font-black text-gray-400 uppercase">USD</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Método de Pago</label>
                  <input 
                    type="text"
                    value="Descuento comision"
                    disabled
                    className="w-full p-3.5 bg-gray-100 border border-gray-200 rounded-xl text-sm font-bold text-gray-500 outline-none cursor-not-allowed"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest">Notas / Justificación</label>
                  <textarea 
                    rows={3}
                    placeholder="Escriba el motivo o detalles de este descuento..."
                    value={discountCommissionNotes}
                    onChange={(e) => setDiscountCommissionNotes(e.target.value)}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-600 outline-none transition-all resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowDiscountCommissionModal(false)}
                  className="flex-1 py-4 bg-gray-50 border border-gray-200 hover:bg-gray-100 text-[#1A2138] font-bold rounded-xl text-sm cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSavingDiscountCommission || !discountCommissionAmount}
                  onClick={handleConfirmDiscountCommission}
                  className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-sm uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-100"
                >
                  {isSavingDiscountCommission ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      Confirmar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* General Confirmation Modal */}
      {confirmModalState.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{confirmModalState.title}</h3>
              <p className="text-gray-500 mt-2">{confirmModalState.message}</p>
            </div>
            <div className="p-6 bg-gray-50 flex gap-4">
              <button
                onClick={() => setConfirmModalState(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 py-3 bg-white text-gray-700 font-bold rounded-xl border border-gray-200 hover:bg-gray-100 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmModalState.onConfirm}
                className="flex-1 py-3 bg-red-600 text-white font-black rounded-xl hover:bg-red-700 shadow-lg transition-all"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insurance Details Modal */}
      {selectedInsurance && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold">Gestión de Seguro</h3>
                  <p className="text-blue-100 text-sm">ID: {selectedInsurance.id}</p>
                </div>
                <button onClick={() => setSelectedInsurance(null)} className="p-2 hover:bg-blue-500 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex gap-4">
                {(['details', 'payments', 'commissions'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setModalTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                      modalTab === tab ? 'bg-white text-blue-600 shadow-lg' : 'text-blue-100 hover:bg-blue-500'
                    }`}
                  >
                    {tab === 'details' ? 'Detalles' : tab === 'payments' ? 'Pagos' : 'Comisiones'}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-8 overflow-y-auto max-h-[70vh]">
              {isInsuranceClosed(selectedInsurance) && (
                <div role="alert" className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">Registro Cerrado</p>
                      <p className="text-xs text-amber-700">Este registro se ha cerrado automáticamente por saldo $0 o diferencia menor a $5 USD. No se puede modificar ni registrar pagos/comisiones.</p>
                    </div>
                  </div>
                  {canManageClosedState && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm('¿Estás seguro de abrir este registro para modificación?')) {
                          try {
                            setSubmitting(true);
                            await updateDoc(doc(db, 'insurances', selectedInsurance.id!), {
                              closed: false
                            });
                            setSelectedInsurance(prev => prev ? { ...prev, closed: false } : null);
                            alert('Registro abierto correctamente.');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.UPDATE, `insurances/${selectedInsurance.id}`);
                          } finally {
                            setSubmitting(false);
                          }
                        }
                      }}
                      className="px-3 py-1.5 bg-amber-605 hover:bg-amber-700 bg-amber-600 text-white text-xs font-black rounded-lg shadow transition-all shrink-0 cursor-pointer"
                    >
                      Abrir Registro
                    </button>
                  )}
                </div>
              )}

              {selectedInsurance.closed === false && (
                <div role="alert" className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded-r-xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 select-none">
                  <div className="flex gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-green-905 text-green-900">Registro Abierto</p>
                      <p className="text-xs text-green-700">Este registro fue abierto para modificación y puede ser modificado por administradores.</p>
                    </div>
                  </div>
                  {canManageClosedState && (
                    <button
                      type="button"
                      onClick={async () => {
                        const totalFinal = selectedInsurance.totalFinal !== undefined && selectedInsurance.totalFinal !== null 
                          ? selectedInsurance.totalFinal 
                          : (selectedInsurance.totalPrice || 0);
                        const totalPaid = selectedInsurance.totalPaid || 0;
                        const balance = totalFinal - totalPaid;
                        const balanceIsSmall = Math.abs(balance) < 5;
                        const isCommissionPaid = !selectedInsurance.agentCommission || selectedInsurance.agentCommission <= 0 || selectedInsurance.commissionStatus === 'paid';

                        if (!balanceIsSmall) {
                          alert(`No se puede cerrar el registro: El saldo pendiente es de $${balance.toFixed(2)} USD (debe ser menor a $5 USD).`);
                          return;
                        }
                        if (!isCommissionPaid) {
                          alert(`No se puede cerrar el registro: La comisión del agente de $${(selectedInsurance.agentCommission || 0).toFixed(2)} USD aún no ha sido pagada.`);
                          return;
                        }

                        if (confirm('¿Estás seguro de volver a cerrar de forma permanente este registro?')) {
                          try {
                            setSubmitting(true);
                            await updateDoc(doc(db, 'insurances', selectedInsurance.id!), {
                              closed: true
                            });
                            setSelectedInsurance(prev => prev ? { ...prev, closed: true } : null);
                            alert('Registro cerrado de forma permanente.');
                          } catch (err) {
                            handleFirestoreError(err, OperationType.UPDATE, `insurances/${selectedInsurance.id}`);
                          } finally {
                            setSubmitting(false);
                          }
                        }
                      }}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-black rounded-lg shadow transition-all shrink-0 cursor-pointer"
                    >
                      Cerrar Registro
                    </button>
                  )}
                </div>
              )}

              {modalTab === 'details' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  {/* Left Column: Client & Trip Info */}
                  <div className="space-y-8">
                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Información del Cliente</h4>
                      <div className="bg-gray-50 p-4 rounded-xl space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Nombre:</span>
                          <span className="text-sm font-bold text-gray-900">{selectedInsurance.firstName} {selectedInsurance.lastName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Email:</span>
                          <span className="text-sm font-medium text-blue-600">{selectedInsurance.email}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Tipo de Cliente:</span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                            selectedInsurance.clientType === 'Agent' ? 'bg-purple-100 text-purple-700' :
                            selectedInsurance.clientType === 'Corporate' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {selectedInsurance.clientType}
                          </span>
                        </div>
                        {selectedInsurance.linkedAgentId && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-500">Agente Solicitante:</span>
                            <span className="text-sm font-bold text-indigo-600">{getAgentName(selectedInsurance)}</span>
                          </div>
                        )}
                      </div>
                    </section>

                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Detalles del Viaje</h4>
                      <div className="bg-gray-50 p-4 rounded-xl space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Vigencia:</span>
                          <span className="text-sm font-bold text-gray-900">{selectedInsurance.startDate} al {selectedInsurance.endDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Duración:</span>
                          <span className="text-sm font-bold text-blue-600">{selectedInsurance.days} días</span>
                        </div>
                        {selectedInsurance.days !== undefined && selectedInsurance.days > 39 && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-500">Equivalente:</span>
                            <span className="text-sm font-bold text-indigo-600">{Math.ceil(selectedInsurance.days / 30.4)} meses</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">País Origen:</span>
                          <span className="text-sm font-medium text-gray-900">{selectedInsurance.originCountry}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">País Destino:</span>
                          <span className="text-sm font-medium text-gray-900">{selectedInsurance.destinationCountry}</span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Información de Póliza y Plan</h4>
                      <div className="bg-gray-50 p-4 rounded-xl space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Póliza / Aseguradora:</span>
                          <span className="text-sm font-bold text-gray-900">
                            {getInsuranceTypeLabel(selectedInsurance.policyId, selectedInsurance.policyName)}
                          </span>
                        </div>
                        {selectedInsurance.policyId && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-500">ID de Póliza:</span>
                            <span className="text-sm font-mono text-gray-700 bg-gray-200/50 px-2.5 py-0.5 rounded border border-slate-250">
                              {selectedInsurance.policyId}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-500">Plan:</span>
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100 uppercase">
                            {(() => {
                              const policyObj = policies.find(p => p.id === selectedInsurance.policyId);
                              const planVal = selectedInsurance.plan || policyObj?.plan || selectedInsurance.policyId.split('-')[0];
                              return getPlanLabel(planVal || '');
                            })()}
                          </span>
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Right Column: Financial Breakdown */}
                  <div className="space-y-8">
                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Desglose Económico</h4>
                      <div className="border border-gray-100 rounded-xl overflow-hidden">
                        <div className="p-4 space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Precio Base:</span>
                            <span className="font-bold text-gray-900">${selectedInsurance.totalPrice.toLocaleString()} USD</span>
                          </div>
                          {isEditingFinancials && isSuperAdminOrDirector ? (
                            <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-100 my-2 select-none">
                              <p className="text-[10px] font-bold text-slate-400 uppercase">Modificar Descuento y Ajuste (USD)</p>
                              
                              <div className="flex flex-col gap-1">
                                <label className="text-[10.5px] font-semibold text-gray-500">Descuento:</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editDiscount}
                                  onChange={(e) => setEditDiscount(parseFloat(e.target.value) || 0)}
                                  className="w-full px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-[10.5px] font-semibold text-gray-500">Ajuste (Valor positivo suma, negativo resta):</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editAdjustment}
                                  onChange={(e) => setEditAdjustment(parseFloat(e.target.value) || 0)}
                                  className="w-full px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                                />
                              </div>

                              <div className="pt-2 flex justify-between items-center text-xs font-bold border-t border-slate-250">
                                <span className="text-gray-500">Nuevo Total Final:</span>
                                <span className="text-blue-600 font-black">
                                  ${(selectedInsurance.totalPrice - editDiscount - editAdjustment + (selectedInsurance.comision || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                                </span>
                              </div>

                              {(() => {
                                const originalTotalPrice = selectedInsurance.totalPrice || 0;
                                const originalDiscount = selectedInsurance.discount || 0;
                                const originalAdjustment = selectedInsurance.adjustment || 0;
                                const cardComision = selectedInsurance.comision || 0;
                                const originalTotalFinal = selectedInsurance.totalFinal !== undefined && selectedInsurance.totalFinal !== null 
                                  ? selectedInsurance.totalFinal 
                                  : (originalTotalPrice - originalDiscount - originalAdjustment + cardComision);
                                const originalCommission = selectedInsurance.agentCommission || 0;
                                const newTotalFinal = originalTotalPrice - editDiscount - editAdjustment + cardComision;
                                let calculatedNewCommission = originalCommission;
                                if (originalTotalFinal > 0) {
                                  const commissionRate = originalCommission / originalTotalFinal;
                                  calculatedNewCommission = Math.round((newTotalFinal * commissionRate) * 100) / 100;
                                }
                                return (
                                  <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="text-gray-500">Comisión Ajustada (Estimada):</span>
                                    <span className="text-indigo-650 font-black">
                                      ${calculatedNewCommission.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                                    </span>
                                  </div>
                                );
                              })()}

                              <div className="flex justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setIsEditingFinancials(false)}
                                  className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded text-[10.5px] transition-all"
                                  disabled={isSavingFinancials}
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveFinancials}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-[10.5px] transition-all flex items-center gap-1"
                                  disabled={isSavingFinancials}
                                >
                                  {isSavingFinancials ? 'Guardando...' : 'Guardar'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Descuento:</span>
                                <span className="font-bold text-green-600">
                                  -${(selectedInsurance.discount || 0).toLocaleString()} USD
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Ajuste:</span>
                                <span className={`font-bold ${selectedInsurance.adjustment && selectedInsurance.adjustment > 0 ? 'text-blue-600' : selectedInsurance.adjustment && selectedInsurance.adjustment < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                  ${selectedInsurance.adjustment && selectedInsurance.adjustment > 0 ? '+' : ''}${(selectedInsurance.adjustment || 0).toLocaleString()} USD
                                </span>
                              </div>
                              {selectedInsurance.comision && selectedInsurance.comision > 0 ? (
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Recargo Tarjeta (AMEX/MC/VISA):</span>
                                  <span className="font-bold text-amber-600">
                                    +${selectedInsurance.comision.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                                  </span>
                                </div>
                              ) : null}
                              {isSuperAdminOrDirector && (
                                <div className="flex justify-end pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditDiscount(selectedInsurance.discount || 0);
                                      setEditAdjustment(selectedInsurance.adjustment || 0);
                                      setIsEditingFinancials(true);
                                    }}
                                    className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline flex items-center gap-1 bg-indigo-50/50 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-all"
                                  >
                                    <Edit2 className="w-2.5 h-2.5" />
                                    Modificar Descuento / Ajuste
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Comisión Agente:</span>
                            <span className="font-bold text-indigo-600">${(selectedInsurance.agentCommission || 0).toLocaleString()} USD</span>
                          </div>
                          <div className="pt-3 border-t border-gray-100 flex justify-between items-baseline">
                            <span className="font-bold text-gray-900">Total a Pagar:</span>
                            <div className="text-right">
                              <p className="text-2xl font-black text-blue-600">${(selectedInsurance.totalFinal || selectedInsurance.totalPrice).toLocaleString()} USD</p>
                              <p className="text-sm font-bold text-gray-500">${((selectedInsurance.totalFinal || selectedInsurance.totalPrice) * exchangeRate).toLocaleString()} MXP</p>
                            </div>
                          </div>
                          {selectedInsurance.totalPaid && selectedInsurance.totalPaid > 0 && (
                            <>
                              <div className="flex justify-between text-sm pt-2">
                                <span className="text-gray-500">Cantidad Pagada:</span>
                                <span className="font-bold text-green-600">${selectedInsurance.totalPaid.toLocaleString()} USD</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500">Saldo Pendiente:</span>
                                <span className="font-bold text-red-600">${((selectedInsurance.totalFinal || selectedInsurance.totalPrice) - selectedInsurance.totalPaid).toLocaleString()} USD</span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="bg-red-50 p-4 border-t border-red-100 flex justify-between text-sm">
                          <span className="text-red-700 font-medium">Costo Proveedor:</span>
                          <span className="text-red-700 font-bold">${selectedInsurance.totalCost.toLocaleString()} USD</span>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Estado de la Póliza</h4>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-4">
                          <span className={`px-4 py-2 rounded-xl text-sm font-bold uppercase ${
                            selectedInsurance.status === 'paid' ? 'bg-green-100 text-green-700' : 
                            selectedInsurance.status === 'partially_paid' ? 'bg-blue-100 text-blue-700' :
                            selectedInsurance.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 
                            'bg-red-100 text-red-700'
                          }`}>
                            {selectedInsurance.status === 'partially_paid' ? 'Pago Parcial' : selectedInsurance.status}
                          </span>
                        </div>
                        {selectedInsurance.totalPaid && selectedInsurance.totalPaid > 0 && (
                          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                            <p className="text-xs text-blue-700 font-bold">Pagado: ${selectedInsurance.totalPaid.toLocaleString()} USD</p>
                            <p className="text-xs text-blue-500">Saldo: ${((selectedInsurance.totalFinal || selectedInsurance.totalPrice) - selectedInsurance.totalPaid).toLocaleString()} USD</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {modalTab === 'payments' && (
                <div className="space-y-8">
                  <section>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Registrar Pago</h4>
                    <div className="bg-gray-50 p-6 rounded-2xl space-y-6">
                      {isInsuranceClosed(selectedInsurance) ? (
                        <div className="text-center py-8">
                          <div className="bg-amber-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-300">
                            <AlertTriangle className="w-8 h-8 text-amber-600" />
                          </div>
                          <h5 className="text-lg font-bold text-gray-900">Registro de Pagos Bloqueado</h5>
                          <p className="text-gray-500 mt-2 px-6">La póliza está cerrada y no se pueden agregar abonos o pagos adicionales.</p>
                          {selectedInsurance.totalPaid && selectedInsurance.totalPaid > 0 && (
                            <p className="text-gray-500 mt-2 font-bold">Total Pagado: ${(selectedInsurance.totalPaid || 0).toLocaleString()} USD</p>
                          )}
                        </div>
                      ) : selectedInsurance.status === 'paid' ? (
                        <div className="text-center py-8">
                          <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-600" />
                          </div>
                          <h5 className="text-lg font-bold text-gray-900">Seguro Pagado en su Totalidad</h5>
                          <p className="text-gray-500 mt-2">Total Pagado: ${(selectedInsurance.totalPaid || 0).toLocaleString()} USD</p>
                          <p className="text-gray-500">Recibo: {selectedInsurance.receiptNumber}</p>
                          <button 
                            className="mt-6 px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-lg flex items-center gap-2 mx-auto"
                            onClick={() => handleDownloadReceipt(selectedInsurance)}
                          >
                            <Download className="w-4 h-4" />
                            Descargar Recibo
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-gray-400 uppercase">Resumen de Pago</span>
                              </div>
                              <div className="space-y-1">
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Total Póliza:</span>
                                  <span className="font-bold text-gray-900">${(selectedInsurance.totalFinal || selectedInsurance.totalPrice).toLocaleString()} USD</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-500">Pagado a la fecha:</span>
                                  <span className="font-bold text-green-600">${(selectedInsurance.totalPaid || 0).toLocaleString()} USD</span>
                                </div>
                                <div className="flex justify-between text-sm pt-1 border-t border-gray-50">
                                  <span className="text-gray-700 font-bold">Saldo Pendiente:</span>
                                  <span className="font-bold text-red-600">${((selectedInsurance.totalFinal || selectedInsurance.totalPrice) - (selectedInsurance.totalPaid || 0)).toLocaleString()} USD</span>
                                </div>
                              </div>
                            </div>

                            {((selectedInsurance.totalFinal || selectedInsurance.totalPrice) - (selectedInsurance.totalPaid || 0)) >= 3 && !isInsuranceClosed(selectedInsurance) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const pending = (selectedInsurance.totalFinal || selectedInsurance.totalPrice) - (selectedInsurance.totalPaid || 0);
                                  setDiscountCommissionAmount(pending.toFixed(2));
                                  setDiscountCommissionNotes('');
                                  setShowDiscountCommissionModal(true);
                                }}
                                className="w-full mt-1 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-all border border-indigo-200 flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                              >
                                <Percent className="w-4 h-4 text-indigo-600" />
                                Descuento Comisión
                              </button>
                            )}

                            <div>
                              <label className="block text-sm font-bold text-gray-700 mb-2">
                                Monto del Abono Actual ({paymentCurrency})
                              </label>
                              <div className="relative">
                                <span className="absolute left-3 top-3 text-gray-400 font-bold">$</span>
                                <input 
                                  type="number"
                                  step="0.01"
                                  value={paymentCurrency === 'USD' ? paymentAmount : paymentAmountMXP}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (paymentCurrency === 'USD') {
                                      setPaymentAmount(val);
                                      setPaymentAmountMXP(val * paymentExchangeRate);
                                    } else {
                                      setPaymentAmountMXP(val);
                                      setPaymentAmount(val / (paymentExchangeRate || 1));
                                    }
                                    if (paymentMethod?.toLowerCase().includes('stripe')) {
                                      setStripePaymentUrl(null);
                                      setStripeEmailSent(false);
                                    }
                                  }}
                                  className="w-full p-3 pl-8 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-600"
                                />
                              </div>
                              {paymentCurrency === 'MXP' && (
                                <div className="mt-2 p-2 bg-blue-50 rounded-lg border border-blue-100 flex justify-between items-center">
                                  <span className="text-[10px] text-blue-700 font-bold uppercase">Equivalente en USD:</span>
                                  <span className="text-sm font-black text-blue-800">${paymentAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="block text-sm font-bold text-gray-700 mb-2">Fecha de Pago</label>
                              <input 
                                type="date"
                                value={paymentDate}
                                onChange={(e) => setPaymentDate(e.target.value)}
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-bold text-gray-700 mb-2">Forma de Pago</label>
                              <select 
                                value={paymentMethod}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPaymentMethod(val);
                                  if (val.toLowerCase().includes('stripe') || val === 'Stripe') {
                                    if (paymentAmount > 0) {
                                      setTimeout(() => {
                                        handleCreateStripePaymentLink();
                                      }, 100);
                                    } else {
                                      alert("Por favor ingrese un monto válido para generar la liga de Stripe.");
                                    }
                                  }
                                }}
                                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800"
                              >
                                <option value="">Seleccionar método...</option>
                                {paymentMethods
                                  .filter(m => m.status === 'active')
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map(m => (
                                    <option key={m.id} value={m.name}>{m.name}</option>
                                  ))}
                              </select>
                            </div>
                            {(paymentMethod?.toLowerCase().includes('transferencia') || 
                              paymentMethod?.toLowerCase().includes('deposito') || 
                              paymentMethod?.toLowerCase().includes('depósito') || 
                              paymentMethod?.toLowerCase().includes('zelle') || 
                              paymentMethod?.toLowerCase().includes('banco') ||
                              paymentMethod?.toLowerCase().includes('bancaria')) && (
                              <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Cuenta Depósito</label>
                                <input 
                                  type="text"
                                  placeholder="Nombre del banco / Cuenta"
                                  value={depositAccount}
                                  onChange={(e) => setDepositAccount(e.target.value)}
                                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                              </div>
                            )}
                          </div>

                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-bold text-gray-700 mb-2">Moneda de Pago</label>
                              <div className="flex bg-white p-1 rounded-xl border border-gray-200">
                                {(['USD', 'MXP'] as const).map((curr) => (
                                  <button
                                    key={curr}
                                    onClick={() => setPaymentCurrency(curr)}
                                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                                      paymentCurrency === curr ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'
                                    }`}
                                  >
                                    {curr}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {paymentCurrency === 'MXP' && (
                              <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Tipo de Cambio</label>
                                <input 
                                  type="number"
                                  step="0.01"
                                  value={paymentExchangeRate}
                                  onChange={(e) => setPaymentExchangeRate(parseFloat(e.target.value))}
                                  className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-blue-600"
                                />
                                <p className="text-[10px] text-gray-400 mt-1">Se obtiene automáticamente de la fecha, pero puede modificarse.</p>
                              </div>
                            )}

                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-blue-700 font-medium">Total en {paymentCurrency}:</span>
                                <div className="text-right">
                                  <span className="text-xl font-black text-blue-800">
                                    {paymentCurrency === 'USD' 
                                      ? `$${paymentAmount.toLocaleString()} USD`
                                      : `$${paymentAmountMXP.toLocaleString()} MXP`
                                    }
                                  </span>
                                  {paymentCurrency === 'MXP' && (
                                    <p className="text-[10px] text-blue-600 font-bold">Base: ${paymentAmount.toLocaleString()} USD</p>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button 
                              onClick={handleEmitReceipt}
                              disabled={!paymentMethod || submitting || paymentAmount <= 0}
                              className="w-full py-4 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              {submitting ? 'Procesando...' : 'Emitir Recibo y Registrar Pago'}
                            </button>
                          </div>
                        </div>

                        {/* Stripe Gateway Widget */}
                        <div className="border-t border-gray-200/80 pt-6 mt-6 space-y-4 col-span-1 md:col-span-2">
                          <div className="flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-indigo-600" />
                            <h5 className="font-bold text-gray-900 text-sm">Cobro en Línea con Stripe</h5>
                          </div>
                          <p className="text-xs text-gray-500 leading-relaxed">
                            ¿Quieres que el cliente pague de forma segura con tarjeta? Genera una liga de cobro por el abono de <strong className="text-indigo-600 font-bold">${paymentAmount.toLocaleString()} USD</strong> para enviarla por WhatsApp o correo electrónico. Al pagar, el sistema registrará el abono y conciliará de forma 105% automática.
                          </p>

                          {stripePaymentUrl ? (
                            <div className="bg-gradient-to-br from-indigo-50 to-blue-50/50 p-5 rounded-2xl border border-indigo-100 space-y-4 animate-in slide-in-from-top-3 duration-300">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-indigo-800 uppercase tracking-widest">Liga de Pago Stripe Generada</span>
                                <button 
                                  onClick={() => { setStripePaymentUrl(null); setStripeEmailSent(false); }}
                                  className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer uppercase"
                                >
                                  Generar otra liga
                                </button>
                              </div>

                              <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-xl border border-indigo-100 font-mono text-xs text-indigo-700 select-all overflow-hidden relative group">
                                <span className="truncate flex-1 font-bold">{stripePaymentUrl}</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(stripePaymentUrl);
                                    setStripeCopied(true);
                                    setTimeout(() => setStripeCopied(false), 2000);
                                  }}
                                  className="p-1.5 hover:bg-indigo-50 rounded-lg text-gray-400 group-hover:text-indigo-600 transition-colors shrink-0"
                                  title="Copiar Liga"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                                {stripeCopied && (
                                  <span className="absolute right-2 bg-indigo-600 text-white font-bold text-[9px] px-2 py-0.5 rounded-md shadow-lg">¡Copiado!</span>
                                )}
                              </div>

                              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                                <button
                                  type="button"
                                  onClick={handleShareStripeWhatsApp}
                                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-[#25D366] hover:bg-[#20ba56] text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-md hover:shadow-lg hover:scale-[1.02]"
                                >
                                  <MessageSquare className="w-4.5 h-4.5" />
                                  Compartir por WhatsApp
                                </button>

                                <button
                                  type="button"
                                  disabled={stripeEmailSending}
                                  onClick={handleSendStripeEmail}
                                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-md shadow-indigo-100 hover:shadow-lg hover:scale-[1.02] disabled:opacity-50"
                                >
                                  {stripeEmailSending ? (
                                    <>
                                      <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                                      Enviando por Correo...
                                    </>
                                  ) : stripeEmailSent ? (
                                    <>
                                      <CheckCircle className="w-4.5 h-4.5 text-white" />
                                      ¡Enviado Exitosamente!
                                    </>
                                  ) : (
                                    <>
                                      <Mail className="w-4.5 h-4.5" />
                                      Enviar por Correo
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={stripeLoading || paymentAmount <= 0}
                              onClick={handleCreateStripePaymentLink}
                              className="w-full flex items-center justify-center gap-2.5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl transition-all shadow-lg shadow-indigo-100 hover:shadow-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {stripeLoading ? (
                                <>
                                  <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                                  Generando Checkout Seguro...
                                </>
                              ) : (
                                <>
                                  <Link2 className="w-4.5 h-4.5" />
                                  Generar Liga de Cobro Segura (Stripe Card)
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    </div>
                  </section>
                </div>
              )}

              {modalTab === 'commissions' && (
                <div className="space-y-8">
                  <section>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Gestión de Comisiones</h4>
                    <div className="bg-gray-50 p-6 rounded-2xl space-y-6">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-sm text-gray-500">Monto de Comisión (USD)</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-gray-400 font-bold">$</span>
                            <input 
                              type="number"
                              value={editingCommission}
                              onChange={(e) => setEditingCommission(parseFloat(e.target.value))}
                              disabled={selectedInsurance.commissionStatus === 'confirmed' || selectedInsurance.commissionStatus === 'paid'}
                              className="w-32 p-2 border border-gray-200 rounded-lg font-bold text-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-white"
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Estado</p>
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase mt-1 ${
                            selectedInsurance.commissionStatus === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                            selectedInsurance.commissionStatus === 'paid' ? 'bg-green-100 text-green-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                            {selectedInsurance.commissionStatus || 'pending'}
                          </span>
                        </div>
                      </div>

                      {selectedInsurance.commissionStatus !== 'confirmed' && selectedInsurance.commissionStatus !== 'paid' ? (
                        <div className="pt-6 border-t border-gray-200">
                          <p className="text-xs text-gray-400 mb-4 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            Al confirmar, la comisión se enviará al menú de comisiones para su programación de pago.
                          </p>
                          <button 
                            onClick={handleConfirmCommission}
                            className="w-full py-4 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 shadow-xl transition-all"
                          >
                            Confirmar Comisión para Pago
                          </button>
                        </div>
                      ) : (
                        <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 flex items-center gap-4">
                          <ShieldCheck className="w-8 h-8 text-indigo-600" />
                          <div>
                            <p className="text-sm font-bold text-indigo-900">Comisión Confirmada</p>
                            <p className="text-xs text-indigo-700">Esta comisión ya ha sido validada y está en el menú de comisiones.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setSelectedInsurance(null)}
                className="px-8 py-3 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <TransactionModal 
        isOpen={!!selectedInsuranceForTransactions}
        onClose={() => setSelectedInsuranceForTransactions(null)}
        insuranceId={selectedInsuranceForTransactions || undefined}
        title="Transacciones de la Póliza"
        exchangeRate={exchangeRate}
      />

      {/* Edit Payment Modal */}
      {editingPayment && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Edit2 className="w-6 h-6" />
                <h3 className="text-xl font-bold">Editar Pago</h3>
              </div>
              <button onClick={() => setEditingPayment(null)} className="p-2 hover:bg-blue-500 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSaveEditedPayment} className="p-8 space-y-6">
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Moneda</label>
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    {(['USD', 'MXP'] as const).map(curr => (
                      <button
                        key={curr}
                        type="button"
                        onClick={() => setEditingPayment({ ...editingPayment, currency: curr })}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                          editingPayment.currency === curr ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                        }`}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Monto ({editingPayment.currency})</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editingPayment.currency === 'USD' ? editingPayment.amount : editingPayment.amountMXP}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (editingPayment.currency === 'USD') {
                        setEditingPayment({ ...editingPayment, amount: val, amountMXP: val * (editingPayment.exchangeRate || exchangeRate) });
                      } else {
                        setEditingPayment({ ...editingPayment, amountMXP: val, amount: val / (editingPayment.exchangeRate || exchangeRate) });
                      }
                    }}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Tipo de Cambio</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={editingPayment.exchangeRate}
                    onChange={(e) => {
                      const rate = parseFloat(e.target.value) || 1;
                      if (editingPayment.currency === 'USD') {
                        setEditingPayment({ 
                          ...editingPayment, 
                          exchangeRate: rate,
                          amountMXP: (editingPayment.amount || 0) * rate
                        });
                      } else {
                        setEditingPayment({ 
                          ...editingPayment, 
                          exchangeRate: rate,
                          amount: (editingPayment.amountMXP || 0) / rate
                        });
                      }
                    }}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex justify-between items-center">
                  <span className="text-blue-700 font-bold">
                    {editingPayment.currency === 'USD' ? 'Equivalente MXP:' : 'Equivalente USD:'}
                  </span>
                  <span className="text-xl font-black text-blue-800">
                    {editingPayment.currency === 'USD' 
                      ? `$${(editingPayment.amountMXP || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP`
                      : `$${(editingPayment.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
                    }
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Fecha</label>
                  <input 
                    type="date"
                    value={editingPayment.date as any}
                    onChange={(e) => setEditingPayment({ ...editingPayment, date: e.target.value as any })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Método de Pago</label>
                  <select 
                    value={editingPayment.paymentMethod}
                    onChange={(e) => setEditingPayment({ ...editingPayment, paymentMethod: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800"
                  >
                    <option value="">Seleccionar método...</option>
                    {paymentMethods
                      .filter(m => m.status === 'active')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(m => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Notas</label>
                  <textarea 
                    value={editingPayment.notes || ''}
                    onChange={(e) => setEditingPayment({ ...editingPayment, notes: e.target.value })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none min-h-[100px]"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPayment(null)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
                >
                  {submitting ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Edit Payments Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-3 font-sans">
                <Edit2 className="w-6 h-6" />
                <h3 className="text-xl font-bold">Editar {selectedPaymentIds.length} Registros</h3>
              </div>
              <button onClick={() => setShowBulkEditModal(false)} className="p-2 hover:bg-blue-500 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-500 font-sans">
                Selecciona únicamente los campos que deseas modificar de manera masiva. Los campos que dejes en blanco o sin seleccionar conservarán sus valores originales.
              </p>

              <div className="grid grid-cols-1 gap-6 font-sans">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Estado</label>
                  <select
                    value={bulkEditData.status || ''}
                    onChange={(e) => setBulkEditData({ ...bulkEditData, status: e.target.value || undefined })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                  >
                    <option value="">No modificar (mantener original)</option>
                    <option value="completed">Completado</option>
                    <option value="pending">Pendiente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Método de Pago</label>
                  <select
                    value={bulkEditData.paymentMethod || ''}
                    onChange={(e) => setBulkEditData({ ...bulkEditData, paymentMethod: e.target.value || undefined })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-800"
                  >
                    <option value="">No modificar (mantener original)</option>
                    {paymentMethods
                      .filter(m => m.status === 'active')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(m => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Fecha de Pago</label>
                  <input
                    type="date"
                    value={bulkEditData.date || ''}
                    onChange={(e) => setBulkEditData({ ...bulkEditData, date: e.target.value || undefined })}
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                  />
                </div>

                {activeTab === 'expenses' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Categoría (Solo Egresos)</label>
                      <select
                        value={bulkEditData.categoryId || ''}
                        onChange={(e) => setBulkEditData({ ...bulkEditData, categoryId: e.target.value || undefined, subcategoryId: undefined })}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                      >
                        <option value="">No modificar (mantener original)</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>

                    {bulkEditData.categoryId && (
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Subcategoría (Solo Egresos)</label>
                        <select
                          value={bulkEditData.subcategoryId || ''}
                          onChange={(e) => setBulkEditData({ ...bulkEditData, subcategoryId: e.target.value || undefined })}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                        >
                          <option value="">No modificar (mantener original)</option>
                          {subcategories.filter(sub => sub.categoryId === bulkEditData.categoryId).map(sub => (
                            <option key={sub.id} value={sub.id}>{sub.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowBulkEditModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all font-sans"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleBulkEditSave}
                  disabled={submitting || (!bulkEditData.status && !bulkEditData.paymentMethod && !bulkEditData.date && !bulkEditData.categoryId && !bulkEditData.subcategoryId)}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 font-sans"
                >
                  {submitting ? 'Guardando...' : 'Aplicar Cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
