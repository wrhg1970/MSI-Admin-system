import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  Download, 
  Filter, 
  Calendar, 
  Search, 
  ChevronDown, 
  FileText, 
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
  ChevronRight
} from 'lucide-react';
import { collection, query, getDocs, where, orderBy, updateDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { InsuranceRequest, Client, ClientType, UserProfile, CustomRole, Policy, Payment, Category, Subcategory } from '../types';
import { usePermissions } from '../hooks/usePermissions';
import { format, parseISO } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function ReportsManager({ profile, rolePermissions }: { profile: UserProfile | null, rolePermissions: CustomRole | null }) {
  const { hasPermission } = usePermissions(profile, rolePermissions);
  const [insurances, setInsurances] = useState<InsuranceRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Quick Reports Modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState<'altas' | 'to_collect' | 'to_pay' | 'commissions' | 'income_statement'>('altas');
  const [reportFormat, setReportFormat] = useState<'detailed' | 'consolidated'>('detailed');
  const [reportDates, setReportDates] = useState({
    start: format(new Date(), 'yyyy-MM-01'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  const [reportClientId, setReportClientId] = useState<string>('All');
  
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [insurancesSnap, clientsSnap, policiesSnap, paymentsSnap, categoriesSnap, subcategoriesSnap] = await Promise.all([
          getDocs(query(collection(db, 'insurances'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'clients')),
          getDocs(collection(db, 'policies')),
          getDocs(collection(db, 'payments')),
          getDocs(collection(db, 'categories')),
          getDocs(collection(db, 'subcategories'))
        ]);

        setInsurances(insurancesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InsuranceRequest)));
        setClients(clientsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
        setPolicies(policiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Policy)));
        setPayments(paymentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment)));
        setCategories(categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
        setSubcategories(subcategoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subcategory)));
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'reports data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
      
      const insDate = ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '';
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
        .filter(ins => ins.status === 'pending' || ins.status === 'partially_paid')
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

  const getFilteredReportData = () => {
    const filtered = insurances.filter(ins => {
      const insDate = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '');
      const matchesDate = insDate >= reportDates.start && insDate <= reportDates.end;
      const matchesClient = reportClientId === 'All' || ins.clientId === reportClientId;
      return matchesDate && matchesClient;
    });

    if (reportType === 'altas') {
      const totalSales = filtered.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      return {
        filtered,
        totalSales,
        count: filtered.length
      };
    } else if (reportType === 'to_collect') {
      const toCollect = filtered.filter(ins => ins.status === 'pending' || ins.status === 'partially_paid');
      const totalSales = toCollect.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      const totalPaid = toCollect.reduce((acc, curr) => acc + (curr.totalPaid || 0), 0);
      const totalPending = totalSales - totalPaid;
      return {
        filtered: toCollect,
        totalSales,
        totalPaid,
        totalPending,
        count: toCollect.length
      };
    } else if (reportType === 'to_pay') {
      const toPay = filtered.filter(ins => ins.status === 'paid' && (!ins.providerPaymentStatus || ins.providerPaymentStatus === 'pending'));
      const totalCost = toPay.reduce((acc, curr) => acc + (curr.totalCost || 0), 0);
      return {
        filtered: toPay,
        totalCost,
        count: toPay.length
      };
    } else if (reportType === 'commissions') {
      const pending = filtered.filter(ins => ins.commissionStatus === 'confirmed');
      const totalSales = pending.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
      const totalCommissions = pending.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);
      return {
        filtered: pending,
        totalSales,
        totalCommissions,
        count: pending.length
      };
    } else if (reportType === 'income_statement') {
      const getPaymentDateStr = (pDate: any) => {
        if (!pDate) return '';
        if (typeof pDate === 'string') return pDate.split('T')[0];
        if (pDate.toDate) return pDate.toDate().toISOString().split('T')[0];
        if (pDate instanceof Date) return pDate.toISOString().split('T')[0];
        return '';
      };

      const rangeInsurances = insurances.filter(ins => {
        const insDate = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '');
        return insDate >= reportDates.start && insDate <= reportDates.end;
      });

      const rangePayments = payments.filter(p => {
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

  const generatePDF = () => {
    const doc = new jsPDF();
    const filtered = insurances.filter(ins => {
      const insDate = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '');
      const matchesDate = insDate >= reportDates.start && insDate <= reportDates.end;
      const matchesClient = reportClientId === 'All' || ins.clientId === reportClientId;
      return matchesDate && matchesClient;
    });

    let title = '';
    let headers: string[] = [];
    let data: any[][] = [];

    if (reportType === 'altas') {
      title = 'Reporte de Altas de Seguros';
      headers = ['Póliza', 'Asegurado', 'Fecha Sol.', 'Inicio', 'Fin', 'Total'];
      data = filtered.map(ins => [
        ins.policyName || ins.policyId,
        `${ins.firstName} ${ins.lastName}`,
        ins.requestDate || '',
        ins.startDate,
        ins.endDate,
        `$${(ins.totalFinal || 0).toFixed(2)}`
      ]);

      doc.setFontSize(18);
      doc.text(title, 14, 22);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
      doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

      autoTable(doc, {
        startY: 45,
        head: [headers],
        body: data,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
        margin: { top: 45 },
      });
    } else if (reportType === 'to_collect') {
      title = 'Reporte de Seguros por Cobrar';
      const toCollect = filtered.filter(ins => ins.status === 'pending' || ins.status === 'partially_paid');
      
      if (reportFormat === 'consolidated') {
        const grouped: { [key: string]: { name: string, count: number, pendingAmount: number } } = {};
        toCollect.forEach(ins => {
          const client = clients.find(c => c.id === ins.clientId);
          const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
          const pendingAmount = (ins.totalFinal || 0) - (ins.totalPaid || 0);
          
          if (!grouped[groupName]) {
            grouped[groupName] = { name: groupName, count: 0, pendingAmount: 0 };
          }
          grouped[groupName].count += 1;
          grouped[groupName].pendingAmount += pendingAmount;
        });

        const bodyData = Object.values(grouped).map(g => [
          g.name,
          g.count.toString(),
          `$${g.pendingAmount.toFixed(2)}`
        ]);

        const totalCount = toCollect.length;
        const totalPending = toCollect.reduce((acc, curr) => acc + ((curr.totalFinal || 0) - (curr.totalPaid || 0)), 0);

        bodyData.push([
          'TOTALES',
          totalCount.toString(),
          `$${totalPending.toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text('Reporte Consolidado de Seguros por Cobrar', 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Agente', 'Número de Seguros', 'Saldo Deudor']],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [225, 29, 72] }, // rose-600
          margin: { top: 45 },
        });
      } else {
        // Global Summary Calculations
        const totalInsurances = toCollect.length;
        const totalSales = toCollect.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
        const totalCommissions = toCollect.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);
        const policyCounts: { [key: string]: number } = {};
        toCollect.forEach(ins => {
          const pName = ins.policyName || 'Sin Póliza';
          policyCounts[pName] = (policyCounts[pName] || 0) + 1;
        });

        // Render Summary Page (Page 1)
        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Resumen General', '']],
          body: [
            ['Total de Seguros', totalInsurances.toString()],
            ['Ventas Totales', `$${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
            ['Comisiones Totales', `$${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
          ],
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          styles: { fontSize: 10, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 40 } }
        });

        autoTable(doc, {
          startY: (doc as any).lastAutoTable.finalY + 10,
          head: [['Póliza', 'Cantidad de Seguros']],
          body: Object.entries(policyCounts).map(([p, c]) => [p, c.toString()]),
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          styles: { fontSize: 10 },
          columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 40 } }
        });

        // Group by Client (Agent/Corporate)
        const grouped: { [key: string]: any[] } = {};
        toCollect.forEach(ins => {
          const client = clients.find(c => c.id === ins.clientId);
          const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName].push(ins);
        });

        headers = ['Asegurado', 'Póliza', 'Fecha Sol.', 'Total', 'Pagado', 'Pendiente'];
        
        Object.keys(grouped).forEach(group => {
          doc.addPage();
          doc.setFontSize(18);
          doc.text(title, 14, 22);
          doc.setFontSize(11);
          doc.setTextColor(100);
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
          doc.text(`Cliente: ${group}`, 14, 36);
          doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 42);

          const groupData = grouped[group].map(ins => [
            `${ins.firstName} ${ins.lastName}`,
            ins.policyName || ins.policyId,
            ins.requestDate || '',
            `$${(ins.totalFinal || 0).toFixed(2)}`,
            `$${(ins.totalPaid || 0).toFixed(2)}`,
            `$${((ins.totalFinal || 0) - (ins.totalPaid || 0)).toFixed(2)}`
          ]);

          const groupTotal = grouped[group].reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
          const groupPaid = grouped[group].reduce((acc, curr) => acc + (curr.totalPaid || 0), 0);
          const groupPending = groupTotal - groupPaid;

          groupData.push([
            { content: 'TOTALES', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
            `$${groupTotal.toFixed(2)}`,
            `$${groupPaid.toFixed(2)}`,
            `$${groupPending.toFixed(2)}`
          ]);

          autoTable(doc, {
            startY: 50,
            head: [headers],
            body: groupData,
            theme: 'striped',
            headStyles: { fillColor: [225, 29, 72] }, // rose-600
            margin: { top: 50 },
          });
        });
      }
    } else if (reportType === 'to_pay') {
      title = 'Reporte de Seguros por Pagar (Proveedores)';
      const toPay = filtered.filter(ins => ins.status === 'paid' && (!ins.providerPaymentStatus || ins.providerPaymentStatus === 'pending'));

      if (reportFormat === 'consolidated') {
        const grouped: { [key: string]: { invoice: string, count: number, totalCost: number } } = {};
        toPay.forEach(ins => {
          const inv = ins.InvoiceCaremed || 'No asignado';
          if (!grouped[inv]) {
            grouped[inv] = { invoice: inv, count: 0, totalCost: 0 };
          }
          grouped[inv].count += 1;
          grouped[inv].totalCost += (ins.totalCost || 0);
        });

        const bodyData = Object.values(grouped).map(g => [
          g.invoice,
          g.count.toString(),
          `$${g.totalCost.toFixed(2)}`
        ]);

        const totalCount = toPay.length;
        const totalCostSum = toPay.reduce((acc, curr) => acc + (curr.totalCost || 0), 0);

        bodyData.push([
          'TOTALES',
          totalCount.toString(),
          `$${totalCostSum.toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text('Reporte Consolidado de Seguros por Pagar (Proveedores)', 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Invoice', 'Número de Seguros', 'Saldo por Pagar']],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [5, 150, 105] }, // emerald-600
          margin: { top: 45 },
        });
      } else {
        headers = ['Asegurado', 'Póliza', 'Fecha Sol.', 'Costo'];
        data = toPay.map(ins => [
          `${ins.firstName} ${ins.lastName}`,
          ins.policyName || ins.policyId,
          ins.requestDate || '',
          `$${(ins.totalCost || 0).toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text(title, 14, 22);
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
      title = 'Reporte de Comisiones Pendientes';
      const pending = filtered.filter(ins => ins.commissionStatus === 'confirmed');
      
      if (reportFormat === 'consolidated') {
        const grouped: { [key: string]: { name: string, count: number, totalCommissions: number } } = {};
        pending.forEach(ins => {
          const client = clients.find(c => c.id === ins.clientId);
          const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
          if (!grouped[groupName]) {
            grouped[groupName] = { name: groupName, count: 0, totalCommissions: 0 };
          }
          grouped[groupName].count += 1;
          grouped[groupName].totalCommissions += (ins.agentCommission || 0);
        });

        const bodyData = Object.values(grouped).map(g => [
          g.name,
          g.count.toString(),
          `$${g.totalCommissions.toFixed(2)}`
        ]);

        const totalCount = pending.length;
        const totalCommissionsSum = pending.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

        bodyData.push([
          'TOTALES',
          totalCount.toString(),
          `$${totalCommissionsSum.toFixed(2)}`
        ]);

        doc.setFontSize(18);
        doc.text('Reporte Consolidado de Comisiones Pendientes', 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Agente / Corporativo', 'Número de Seguros', 'Saldo de Comisiones']],
          body: bodyData,
          theme: 'striped',
          headStyles: { fillColor: [217, 119, 6] }, // amber-600
          margin: { top: 45 },
        });
      } else {
        // Global Summary Calculations
        const totalInsurances = pending.length;
        const totalSales = pending.reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
        const totalCommissions = pending.reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);
        const policyCounts: { [key: string]: number } = {};
        pending.forEach(ins => {
          const pName = ins.policyName || 'Sin Póliza';
          policyCounts[pName] = (policyCounts[pName] || 0) + 1;
        });

        // Render Summary Page (Page 1)
        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 36);

        autoTable(doc, {
          startY: 45,
          head: [['Resumen General', '']],
          body: [
            ['Total de Seguros', totalInsurances.toString()],
            ['Ventas Totales', `$${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
            ['Comisiones Totales', `$${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
          ],
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          styles: { fontSize: 10, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 40 } }
        });

        autoTable(doc, {
          startY: (doc as any).lastAutoTable.finalY + 10,
          head: [['Póliza', 'Cantidad de Seguros']],
          body: Object.entries(policyCounts).map(([p, c]) => [p, c.toString()]),
          theme: 'grid',
          headStyles: { fillColor: [100, 100, 100] },
          styles: { fontSize: 10 },
          columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 40 } }
        });

        // Group by Client (Agent/Corporate)
        const grouped: { [key: string]: any[] } = {};
        pending.forEach(ins => {
          const client = clients.find(c => c.id === ins.clientId);
          const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName].push(ins);
        });

        headers = ['Asegurado', 'Póliza', 'Fecha Sol.', 'Venta', 'Comisión'];
        
        Object.keys(grouped).forEach(group => {
          doc.addPage();
          doc.setFontSize(18);
          doc.text(title, 14, 22);
          doc.setFontSize(11);
          doc.setTextColor(100);
          doc.text(`Rango: ${reportDates.start} al ${reportDates.end}`, 14, 30);
          doc.text(`Agente: ${group}`, 14, 36);
          doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 42);

          const groupData = grouped[group].map(ins => [
            `${ins.firstName} ${ins.lastName}`,
            ins.policyName || ins.policyId,
            ins.requestDate || '',
            `$${(ins.totalFinal || 0).toFixed(2)}`,
            `$${(ins.agentCommission || 0).toFixed(2)}`
          ]);

          const groupVenta = grouped[group].reduce((acc, curr) => acc + (curr.totalFinal || 0), 0);
          const groupComision = grouped[group].reduce((acc, curr) => acc + (curr.agentCommission || 0), 0);

          groupData.push([
            { content: 'TOTALES', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
            `$${groupVenta.toFixed(2)}`,
            `$${groupComision.toFixed(2)}`
          ]);

          autoTable(doc, {
            startY: 50,
            head: [headers],
            body: groupData,
            theme: 'striped',
            headStyles: { fillColor: [217, 119, 6] }, // amber-600
            margin: { top: 50 },
          });
        });
      }
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
      const rangeInsurances = insurances.filter(ins => {
        const insDate = ins.requestDate || (ins.createdAt?.toDate ? ins.createdAt.toDate().toISOString().split('T')[0] : '');
        return insDate >= reportDates.start && insDate <= reportDates.end;
      });

      // Filter payments in range
      const rangePayments = payments.filter(p => {
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
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes y Estadísticas</h1>
          <p className="text-gray-500">Visualiza el rendimiento y genera informes detallados</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && (
            <button 
              onClick={() => setShowPaymentModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 animate-in fade-in slide-in-from-right-4"
            >
              <CreditCard className="w-4 h-4" />
              Pagar Seleccionados ({selectedIds.length})
            </button>
          )}
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
          >
            <Download className="w-4 h-4" />
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

                  {(reportType === 'to_collect' || reportType === 'to_pay' || reportType === 'commissions') && (
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
                        const { filtered, totalSales, count } = data as { filtered: InsuranceRequest[], totalSales: number, count: number };
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

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                                    <th className="pb-2">Póliza</th>
                                    <th className="pb-2">Asegurado</th>
                                    <th className="pb-2">Fecha Sol.</th>
                                    <th className="pb-2 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-xs">
                                  {filtered.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="py-8 text-center text-gray-400 italic">No hay registros en el rango de fechas.</td>
                                    </tr>
                                  ) : (
                                    filtered.map((ins, idx) => (
                                      <tr key={ins.id || idx}>
                                        <td className="py-2 text-gray-600 font-bold">{ins.policyName || ins.policyId}</td>
                                        <td className="py-2 font-medium">{ins.firstName} {ins.lastName}</td>
                                        <td className="py-2 text-gray-500">{ins.requestDate || (ins.createdAt?.toDate ? format(ins.createdAt.toDate(), 'yyyy-MM-dd') : '')}</td>
                                        <td className="py-2 text-right font-bold text-gray-900">${(ins.totalFinal || ins.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'to_collect') {
                        const { filtered, totalSales, totalPaid, totalPending, count } = data as { filtered: InsuranceRequest[], totalSales: number, totalPaid: number, totalPending: number, count: number };
                        
                        if (reportFormat === 'consolidated') {
                          // Group filtered by client
                          const grouped: { [key: string]: { name: string, count: number, pendingAmount: number } } = {};
                          filtered.forEach(ins => {
                            const client = clients.find(c => c.id === ins.clientId);
                            const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
                            const pendingAmount = (ins.totalFinal || ins.totalPrice || 0) - (ins.totalPaid || 0);
                            
                            if (!grouped[groupName]) {
                              grouped[groupName] = { name: groupName, count: 0, pendingAmount: 0 };
                            }
                            grouped[groupName].count += 1;
                            grouped[groupName].pendingAmount += pendingAmount;
                          });

                          return (
                            <div className="space-y-6">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Total de Seguros</p>
                                  <p className="text-xl font-black text-rose-600 mt-1">{count}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Saldo Deudor Total</p>
                                  <p className="text-xl font-black text-gray-900 mt-1">${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <th className="pb-2">Agente</th>
                                      <th className="pb-2 text-center">Número de Seguros</th>
                                      <th className="pb-2 text-right">Saldo Deudor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 text-xs">
                                    {Object.values(grouped).length === 0 ? (
                                      <tr>
                                        <td colSpan={3} className="py-8 text-center text-gray-400 italic">No hay registros de cobros pendientes.</td>
                                      </tr>
                                    ) : (
                                      Object.values(grouped).map((g, idx) => (
                                        <tr key={idx}>
                                          <td className="py-2 font-semibold text-gray-800">{g.name}</td>
                                          <td className="py-2 text-center font-medium text-gray-600">{g.count}</td>
                                          <td className="py-2 text-right font-bold text-rose-600">${g.pendingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                            <div className="grid grid-cols-3 gap-3">
                              <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Por Cobrar</p>
                                <p className="text-base font-black text-rose-600 mt-1">${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                              <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Cobrado</p>
                                <p className="text-base font-black text-emerald-600 mt-1">${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                              <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[9px] font-bold text-gray-400 uppercase">Total Ventas</p>
                                <p className="text-base font-black text-gray-900 mt-1">${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <th className="pb-2">Asegurado</th>
                                    <th className="pb-2">Póliza</th>
                                    <th className="pb-2 text-right">Total</th>
                                    <th className="pb-2 text-right">Pagado</th>
                                    <th className="pb-2 text-right">Pendiente</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-xs">
                                  {filtered.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="py-8 text-center text-gray-400 italic">No hay seguros pendientes de cobro.</td>
                                    </tr>
                                  ) : (
                                    filtered.map((ins, idx) => {
                                      const pending = (ins.totalFinal || ins.totalPrice || 0) - (ins.totalPaid || 0);
                                      return (
                                        <tr key={ins.id || idx}>
                                          <td className="py-2 font-medium">{ins.firstName} {ins.lastName}</td>
                                          <td className="py-2 text-gray-500 font-bold">{ins.policyName || ins.policyId}</td>
                                          <td className="py-2 text-right font-medium text-gray-600">${(ins.totalFinal || ins.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          <td className="py-2 text-right text-emerald-600">${(ins.totalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          <td className="py-2 text-right font-bold text-rose-600">${pending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'to_pay') {
                        const { filtered, totalCost, count } = data as { filtered: InsuranceRequest[], totalCost: number, count: number };
                        
                        if (reportFormat === 'consolidated') {
                          const grouped: { [key: string]: { invoice: string, count: number, totalCost: number } } = {};
                          filtered.forEach(ins => {
                            const inv = ins.InvoiceCaremed || 'No asignado';
                            if (!grouped[inv]) {
                              grouped[inv] = { invoice: inv, count: 0, totalCost: 0 };
                            }
                            grouped[inv].count += 1;
                            grouped[inv].totalCost += (ins.totalCost || 0);
                          });

                          return (
                            <div className="space-y-6">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Total de Seguros por Pagar</p>
                                  <p className="text-xl font-black text-emerald-600 mt-1">{count}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Saldo por Pagar Total</p>
                                  <p className="text-xl font-black text-gray-900 mt-1">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <th className="pb-2">Invoice</th>
                                      <th className="pb-2 text-center">Número de Seguros</th>
                                      <th className="pb-2 text-right">Saldo por Pagar</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 text-xs">
                                    {Object.values(grouped).length === 0 ? (
                                      <tr>
                                        <td colSpan={3} className="py-8 text-center text-gray-400 italic">No hay seguros por pagar.</td>
                                      </tr>
                                    ) : (
                                      Object.values(grouped).map((g, idx) => (
                                        <tr key={idx}>
                                          <td className="py-2 font-semibold text-gray-800">{g.invoice}</td>
                                          <td className="py-2 text-center font-medium text-gray-600">{g.count}</td>
                                          <td className="py-2 text-right font-bold text-emerald-600">${g.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Seguros Pendientes Pago</p>
                                <p className="text-xl font-black text-emerald-600 mt-1">{count}</p>
                              </div>
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Costo Total a Proveedores</p>
                                <p className="text-xl font-black text-gray-900 mt-1">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <th className="pb-2">Asegurado</th>
                                    <th className="pb-2">Póliza</th>
                                    <th className="pb-2">Fecha Sol.</th>
                                    <th className="pb-2 text-right">Costo</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-xs">
                                  {filtered.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="py-8 text-center text-gray-400 italic">No hay seguros por pagar a proveedores.</td>
                                    </tr>
                                  ) : (
                                    filtered.map((ins, idx) => (
                                      <tr key={ins.id || idx}>
                                        <td className="py-2 font-medium">{ins.firstName} {ins.lastName}</td>
                                        <td className="py-2 text-gray-600 font-bold">{ins.policyName || ins.policyId}</td>
                                        <td className="py-2 text-gray-500">{ins.requestDate || ''}</td>
                                        <td className="py-2 text-right font-bold text-gray-900">${(ins.totalCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      }

                      if (reportType === 'commissions') {
                        const { filtered, totalSales, totalCommissions, count } = data as { filtered: InsuranceRequest[], totalSales: number, totalCommissions: number, count: number };
                        
                        if (reportFormat === 'consolidated') {
                          const grouped: { [key: string]: { name: string, count: number, totalCommissions: number } } = {};
                          filtered.forEach(ins => {
                            const client = clients.find(c => c.id === ins.clientId);
                            const groupName = client ? (client.commercialName || client.legalName || `${client.firstName} ${client.lastName}`) : 'Individual/Otros';
                            if (!grouped[groupName]) {
                              grouped[groupName] = { name: groupName, count: 0, totalCommissions: 0 };
                            }
                            grouped[groupName].count += 1;
                            grouped[groupName].totalCommissions += (ins.agentCommission || 0);
                          });

                          return (
                            <div className="space-y-6">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase font-black">Agentes con Comisión</p>
                                  <p className="text-xl font-black text-amber-600 mt-1">{Object.keys(grouped).length}</p>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase font-bold">Saldo de Comisiones Total</p>
                                  <p className="text-xl font-black text-gray-900 mt-1">${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                      <th className="pb-2">Agente / Corporativo</th>
                                      <th className="pb-2 text-center">Número de Seguros</th>
                                      <th className="pb-2 text-right">Saldo de Comisiones</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 text-xs">
                                    {Object.values(grouped).length === 0 ? (
                                      <tr>
                                        <td colSpan={3} className="py-8 text-center text-gray-400 italic">No hay comisiones de agente pendientes.</td>
                                      </tr>
                                    ) : (
                                      Object.values(grouped).map((g, idx) => (
                                        <tr key={idx}>
                                          <td className="py-2 font-semibold text-gray-800">{g.name}</td>
                                          <td className="py-2 text-center font-medium text-gray-600">{g.count}</td>
                                          <td className="py-2 text-right font-bold text-amber-600">${g.totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Comisiones Coincidencias</p>
                                <p className="text-xl font-black text-amber-600 mt-1">{count}</p>
                              </div>
                              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                <p className="text-[10px] font-bold text-gray-400 uppercase font-bold">Comisión Total Pendiente</p>
                                <p className="text-xl font-black text-gray-900 mt-1">${totalCommissions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-gray-200 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    <th className="pb-2">Asegurado</th>
                                    <th className="pb-2">Póliza</th>
                                    <th className="pb-2 text-right">Venta</th>
                                    <th className="pb-2 text-right">Comisión</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-xs">
                                  {filtered.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="py-8 text-center text-gray-400 italic">No hay comisiones de agente pendientes.</td>
                                    </tr>
                                  ) : (
                                    filtered.map((ins, idx) => (
                                      <tr key={ins.id || idx}>
                                        <td className="py-2 font-medium">{ins.firstName} {ins.lastName}</td>
                                        <td className="py-2 text-gray-500 font-bold">{ins.policyName || ins.policyId}</td>
                                        <td className="py-2 text-right font-medium text-gray-600">${(ins.totalFinal || ins.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="py-2 text-right font-bold text-amber-600">${(ins.agentCommission || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
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
    </div>
  );
}
