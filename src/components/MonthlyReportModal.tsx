import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Download, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  BarChart3, 
  DollarSign, 
  CreditCard, 
  Users, 
  Building2, 
  User, 
  ArrowUpRight, 
  TrendingUp, 
  Wallet, 
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2
} from 'lucide-react';
import { InsuranceRequest, Client, Policy, UserProfile } from '../types';
import { getNormalizedYYYYMMDD, formatDisplayDate, SPANISH_MONTHS, getPolicyEffectiveCost, findPolicyPrioritized, getPolicyNumber } from '../lib/policyUtils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadCompanyLogo, drawReportHeader, addReportFooters } from '../utils/reportPdfUtils';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

interface MonthlyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurances: InsuranceRequest[];
  clients: Client[];
  policies: Policy[];
  companySettings?: any;
  profile?: UserProfile | null;
  onEnsureFullHistory?: () => void;
}

export interface ChannelConsolidatedRow {
  key: string;
  name: string;
  type: 'Agent' | 'Corporate' | 'Individual';
  policyCount: number;
  // 1. Ventas por Canal
  totalSales: number;
  salesPercentage: number;
  // 2. Cuentas por cobrar
  totalCollected: number;
  toCollect: number; // Saldo pendiente
  policiesWithDebtCount: number;
  // 3. Cuentas por pagar (proveedor)
  totalCost: number;
  costPaid: number;
  toPayCost: number; // Saldo pendiente al proveedor
  // 4. Comisiones por pagar
  totalCommissions: number;
  commissionsPaid: number;
  toPayCommissions: number; // Saldo pendiente comisiones
}

export default function MonthlyReportModal({
  isOpen,
  onClose,
  insurances: propInsurances,
  clients,
  policies,
  companySettings,
  profile,
  onEnsureFullHistory
}: MonthlyReportModalProps) {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(currentDate.getMonth());
  const [activeTab, setActiveTab] = useState<'matrix' | 'sales' | 'receivable' | 'payable' | 'commissions'>('matrix');
  const [isDownloading, setIsDownloading] = useState(false);
  const [allInsurances, setAllInsurances] = useState<InsuranceRequest[]>(propInsurances);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (propInsurances.length > allInsurances.length) {
      setAllInsurances(propInsurances);
    }
  }, [propInsurances]);

  useEffect(() => {
    if (!isOpen) return;

    if (onEnsureFullHistory) {
      onEnsureFullHistory();
    }

    const fetchFullInsurances = async () => {
      if (allInsurances.length > 500) return;
      try {
        setLoadingHistory(true);
        const q = query(collection(db, 'insurances'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as InsuranceRequest));
        setAllInsurances(loaded);
      } catch (err) {
        console.warn('Error loading insurances for monthly report:', err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchFullInsurances();
  }, [isOpen]);

  const monthName = SPANISH_MONTHS[selectedMonthIndex];
  const monthNumberStr = String(selectedMonthIndex + 1).padStart(2, '0');
  const monthPrefix = `${selectedYear}-${monthNumberStr}`;
  const lastDayOfMonth = new Date(selectedYear, selectedMonthIndex + 1, 0).getDate();
  const dateRangeStr = `01/${monthNumberStr}/${selectedYear} al ${lastDayOfMonth}/${monthNumberStr}/${selectedYear}`;

  const handlePrevMonth = () => {
    if (selectedMonthIndex === 0) {
      setSelectedMonthIndex(11);
      setSelectedYear(prev => prev - 1);
    } else {
      setSelectedMonthIndex(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonthIndex === 11) {
      setSelectedMonthIndex(0);
      setSelectedYear(prev => prev + 1);
    } else {
      setSelectedMonthIndex(prev => prev + 1);
    }
  };

  // Filter insurances for the month
  const monthInsurances = useMemo(() => {
    return allInsurances.filter(ins => {
      const isCancelled = ins.status === 'cancelled' || ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can';
      if (isCancelled) return false;

      const insDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      if (!insDate) return false;

      return insDate.startsWith(monthPrefix);
    });
  }, [allInsurances, monthPrefix]);

  // Grand totals for percentage calculations
  const grandTotalSales = useMemo(() => {
    return monthInsurances.reduce((sum, i) => sum + (i.totalFinal !== undefined && i.totalFinal !== null ? i.totalFinal : (i.totalPrice || 0)), 0);
  }, [monthInsurances]);

  // Helper to get exact client/agency name
  const getEntityName = (ins: InsuranceRequest): { key: string; name: string; type: 'Agent' | 'Corporate' | 'Individual' } => {
    let client = ins.clientId ? clients.find(c => c.id === ins.clientId || c.email === ins.clientId) : undefined;
    if (!client && ins.linkedAgentId) {
      client = clients.find(c => c.id === ins.linkedAgentId || c.email === ins.linkedAgentId);
    }

    let type: 'Agent' | 'Corporate' | 'Individual' = 'Individual';
    if (client?.type === 'Agent' || client?.type === 'Corporate') {
      type = client.type;
    } else if (ins.clientType === 'Agent' || ins.clientType === 'Corporate') {
      type = ins.clientType;
    } else if (ins.linkedAgentId) {
      type = 'Agent';
    }

    if (type === 'Individual') {
      return { key: 'INDIVIDUAL', name: 'Pólizas Individuales (Venta Directa)', type: 'Individual' };
    }

    if (client) {
      const name = client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim();
      return {
        key: client.id || `${type}_${name}`,
        name: name || (type === 'Agent' ? (ins.linkedAgentId || 'Agente') : 'Corporativo'),
        type
      };
    }

    if (type === 'Agent') {
      return {
        key: `AGENT_${ins.linkedAgentId || 'unassigned'}`,
        name: ins.linkedAgentId || 'Agente Sin Asignar',
        type: 'Agent'
      };
    }

    return {
      key: 'CORP_unassigned',
      name: 'Corporativo Sin Asignar',
      type: 'Corporate'
    };
  };

  // Compute consolidated rows for each Agent, each Corporate, and Individuales
  const consolidatedData = useMemo(() => {
    const entityMap = new Map<string, {
      key: string;
      name: string;
      type: 'Agent' | 'Corporate' | 'Individual';
      policies: InsuranceRequest[];
    }>();

    // Group month insurances
    monthInsurances.forEach(ins => {
      const { key, name, type } = getEntityName(ins);
      if (!entityMap.has(key)) {
        entityMap.set(key, { key, name, type, policies: [] });
      }
      entityMap.get(key)!.policies.push(ins);
    });

    // Compute consolidated numbers
    const rows: ChannelConsolidatedRow[] = [];

    entityMap.forEach((entry) => {
      const count = entry.policies.length;
      let sales = 0;
      let collected = 0;
      let toCollect = 0;
      let debtCount = 0;
      let costTotal = 0;
      let costPaid = 0;
      let toPayCost = 0;
      let commTotal = 0;
      let commPaid = 0;
      let toPayComm = 0;

      entry.policies.forEach(ins => {
        const price = ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : (ins.totalPrice || 0);
        const paid = ins.totalPaid || 0;
        const balance = price - paid;

        sales += price;
        collected += paid;
        if (balance > 0.01) {
          toCollect += balance;
          debtCount += 1;
        }

        const effectiveCost = getPolicyEffectiveCost(ins);
        costTotal += effectiveCost;
        if (ins.providerPaymentStatus === 'paid') {
          costPaid += effectiveCost;
        } else {
          toPayCost += effectiveCost;
        }

        const comm = Number(ins.agentCommission) || 0;
        commTotal += comm;
        if (ins.commissionStatus === 'paid') {
          commPaid += comm;
        } else {
          toPayComm += comm;
        }
      });

      const salesPct = grandTotalSales > 0 ? (sales / grandTotalSales) * 100 : 0;

      rows.push({
        key: entry.key,
        name: entry.name,
        type: entry.type,
        policyCount: count,
        totalSales: sales,
        salesPercentage: salesPct,
        totalCollected: collected,
        toCollect,
        policiesWithDebtCount: debtCount,
        totalCost: costTotal,
        costPaid,
        toPayCost,
        totalCommissions: commTotal,
        commissionsPaid: commPaid,
        toPayCommissions: toPayComm
      });
    });

    // Sort: Agents first, then Corporate, then Individual
    return rows.sort((a, b) => {
      const typeOrder = { Agent: 1, Corporate: 2, Individual: 3 };
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return b.totalSales - a.totalSales;
    });
  }, [monthInsurances, grandTotalSales, clients]);

  // Aggregate Totals
  const summaryTotals = useMemo(() => {
    return consolidatedData.reduce((acc, row) => ({
      policies: acc.policies + row.policyCount,
      sales: acc.sales + row.totalSales,
      collected: acc.collected + row.totalCollected,
      toCollect: acc.toCollect + row.toCollect,
      debtPolicies: acc.debtPolicies + row.policiesWithDebtCount,
      costTotal: acc.costTotal + row.totalCost,
      costPaid: acc.costPaid + row.costPaid,
      toPayCost: acc.toPayCost + row.toPayCost,
      commTotal: acc.commTotal + row.totalCommissions,
      commPaid: acc.commPaid + row.commissionsPaid,
      toPayComm: acc.toPayComm + row.toPayCommissions
    }), {
      policies: 0,
      sales: 0,
      collected: 0,
      toCollect: 0,
      debtPolicies: 0,
      costTotal: 0,
      costPaid: 0,
      toPayCost: 0,
      commTotal: 0,
      commPaid: 0,
      toPayComm: 0
    });
  }, [consolidatedData]);

  // Subtotals by Channel Type
  const channelTotals = useMemo(() => {
    const calc = (type: 'Agent' | 'Corporate' | 'Individual') => {
      const filtered = consolidatedData.filter(r => r.type === type);
      return {
        count: filtered.reduce((s, r) => s + r.policyCount, 0),
        sales: filtered.reduce((s, r) => s + r.totalSales, 0),
        toCollect: filtered.reduce((s, r) => s + r.toCollect, 0),
        toPayCost: filtered.reduce((s, r) => s + r.toPayCost, 0),
        toPayComm: filtered.reduce((s, r) => s + r.toPayCommissions, 0)
      };
    };

    return {
      agent: calc('Agent'),
      corporate: calc('Corporate'),
      individual: calc('Individual')
    };
  }, [consolidatedData]);

  // Generate Executive Consolidated PDF
  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const loadedLogo = await loadCompanyLogo(companySettings?.logoUrl);
      const title = `REPORTE MENSUAL EJECUTIVO CONSOLIDADO - ${monthName.toUpperCase()} ${selectedYear}`;
      const subtitle = `Período: ${dateRangeStr} | Cifras Consolidadas por Canal: Agentes, Corporativo e Individuales`;
      const extraMeta = `Generado: ${formatDisplayDate(new Date())} por ${profile?.displayName || 'Administración'}`;

      drawReportHeader(doc, title, subtitle, loadedLogo, true, extraMeta);

      // Calculations for graphical representations
      const totalSalesVal = summaryTotals.sales || 1;
      const agentPct = (channelTotals.agent.sales / totalSalesVal) * 100;
      const corpPct = (channelTotals.corporate.sales / totalSalesVal) * 100;
      const indivPct = (channelTotals.individual.sales / totalSalesVal) * 100;

      const totalExpected = summaryTotals.sales || 1;
      const collectionRate = Math.min(100, (summaryTotals.collected / totalExpected) * 100);

      const totalCost = summaryTotals.costTotal || 1;
      const costPaidRate = Math.min(100, (summaryTotals.costPaid / totalCost) * 100);

      const totalComm = summaryTotals.commTotal || 1;
      const commPaidRate = summaryTotals.commTotal > 0 ? Math.min(100, (summaryTotals.commPaid / totalComm) * 100) : 100;

      const grossProfit = summaryTotals.sales - summaryTotals.costTotal - summaryTotals.commTotal;
      const grossMarginPct = summaryTotals.sales > 0 ? (grossProfit / summaryTotals.sales) * 100 : 0;

      // ==========================================
      // PAGE 1: EXECUTIVE GRAPHICAL KPIS DASHBOARD
      // ==========================================

      // 1. TOP 4 GRAPHICAL KPI CARDS (y: 38 to 74, h: 36mm)
      const cardY = 38;
      const cardH = 36;
      const cardW = 64.25;
      const cardGap = 4;
      const startX = 14;

      // Helper for drawing rounded vector card
      const drawCardContainer = (
        x: number,
        y: number,
        w: number,
        h: number,
        bgColor: [number, number, number],
        borderColor: [number, number, number],
        topBarColor: [number, number, number]
      ) => {
        doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
        doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, y, w, h, 2, 2, 'FD');

        // Top accent line
        doc.setFillColor(topBarColor[0], topBarColor[1], topBarColor[2]);
        doc.roundedRect(x, y, w, 2, 1, 1, 'F');
      };

      // Helper for drawing vector bar
      const drawBar = (
        x: number,
        y: number,
        w: number,
        h: number,
        pct: number,
        fillColor: [number, number, number],
        bgColor: [number, number, number] = [241, 245, 249]
      ) => {
        doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
        doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
        const validPct = Math.max(0, Math.min(100, pct));
        if (validPct > 0) {
          const fillW = Math.max(h, (w * validPct) / 100);
          doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
          doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
        }
      };

      // Helper for dual-color bar
      const drawDualBar = (
        x: number,
        y: number,
        w: number,
        h: number,
        pctA: number,
        fillA: [number, number, number],
        fillB: [number, number, number]
      ) => {
        doc.setFillColor(fillB[0], fillB[1], fillB[2]);
        doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
        const validPctA = Math.max(0, Math.min(100, pctA));
        if (validPctA > 0) {
          const fillW = Math.max(h, (w * validPctA) / 100);
          doc.setFillColor(fillA[0], fillA[1], fillA[2]);
          doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
        }
      };

      // CARD 1: VENTAS POR CANAL
      const c1X = startX;
      drawCardContainer(c1X, cardY, cardW, cardH, [248, 250, 252], [226, 232, 240], [37, 99, 235]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 58, 138);
      doc.text('1. VENTAS TOTALES', c1X + 4, cardY + 7);

      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(`$${summaryTotals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, c1X + 4, cardY + 13.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`${summaryTotals.policies} pólizas emitidas`, c1X + 4, cardY + 17.5);

      // Micro breakdown
      doc.setFontSize(6);
      doc.setTextColor(51, 65, 85);
      doc.text(`Agentes: $${channelTotals.agent.sales.toFixed(0)} (${agentPct.toFixed(0)}%)`, c1X + 4, cardY + 22);
      doc.text(`Corp: $${channelTotals.corporate.sales.toFixed(0)} (${corpPct.toFixed(0)}%)`, c1X + 4, cardY + 26);
      doc.text(`Indiv: $${channelTotals.individual.sales.toFixed(0)} (${indivPct.toFixed(0)}%)`, c1X + 4, cardY + 30);

      // Mini stacked bar
      const mBarY = cardY + 32;
      const mBarW = cardW - 8;
      const mBarH = 2;
      const seg1 = (mBarW * agentPct) / 100;
      const seg2 = (mBarW * corpPct) / 100;
      const seg3 = mBarW - seg1 - seg2;
      doc.setFillColor(37, 99, 235); // Blue
      doc.rect(c1X + 4, mBarY, seg1, mBarH, 'F');
      doc.setFillColor(14, 165, 233); // Sky
      doc.rect(c1X + 4 + seg1, mBarY, seg2, mBarH, 'F');
      doc.setFillColor(16, 185, 129); // Emerald
      doc.rect(c1X + 4 + seg1 + seg2, mBarY, Math.max(0, seg3), mBarH, 'F');

      // CARD 2: CUENTAS POR COBRAR
      const c2X = startX + cardW + cardGap;
      drawCardContainer(c2X, cardY, cardW, cardH, [255, 241, 242], [254, 205, 211], [225, 29, 72]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(159, 18, 57);
      doc.text('2. CUENTAS POR COBRAR', c2X + 4, cardY + 7);

      doc.setFontSize(11);
      doc.setTextColor(159, 18, 57);
      doc.text(`$${summaryTotals.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, c2X + 4, cardY + 13.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Saldo pendiente de clientes', c2X + 4, cardY + 17.5);

      doc.setFontSize(6);
      doc.setTextColor(51, 65, 85);
      doc.text(`Cobrado: $${summaryTotals.collected.toFixed(0)} (${collectionRate.toFixed(1)}%)`, c2X + 4, cardY + 22);
      doc.text(`Por Cobrar: $${summaryTotals.toCollect.toFixed(0)} (${(100 - collectionRate).toFixed(1)}%)`, c2X + 4, cardY + 26);
      doc.text(`Pólizas con Saldo: ${summaryTotals.debtPolicies} pólizas`, c2X + 4, cardY + 30);

      // Mini recovery bar: Green (Cobrado) vs Rose (Pendiente)
      drawDualBar(c2X + 4, mBarY, mBarW, mBarH, collectionRate, [16, 185, 129], [225, 29, 72]);

      // CARD 3: CUENTAS POR PAGAR
      const c3X = c2X + cardW + cardGap;
      drawCardContainer(c3X, cardY, cardW, cardH, [240, 253, 250], [204, 251, 241], [13, 148, 136]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(17, 94, 89);
      doc.text('3. CUENTAS POR PAGAR', c3X + 4, cardY + 7);

      doc.setFontSize(11);
      doc.setTextColor(17, 94, 89);
      doc.text(`$${summaryTotals.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, c3X + 4, cardY + 13.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Saldo costos proveedor', c3X + 4, cardY + 17.5);

      doc.setFontSize(6);
      doc.setTextColor(51, 65, 85);
      doc.text(`Costo Total: $${summaryTotals.costTotal.toFixed(0)}`, c3X + 4, cardY + 22);
      doc.text(`Liquidado: $${summaryTotals.costPaid.toFixed(0)} (${costPaidRate.toFixed(1)}%)`, c3X + 4, cardY + 26);
      doc.text(`Pendiente: $${summaryTotals.toPayCost.toFixed(0)} (${(100 - costPaidRate).toFixed(1)}%)`, c3X + 4, cardY + 30);

      // Mini cost bar: Teal (Liquidado) vs Orange (Pendiente)
      drawDualBar(c3X + 4, mBarY, mBarW, mBarH, costPaidRate, [13, 148, 136], [249, 115, 22]);

      // CARD 4: COMISIONES POR PAGAR
      const c4X = c3X + cardW + cardGap;
      drawCardContainer(c4X, cardY, cardW, cardH, [255, 251, 235], [254, 243, 199], [217, 119, 6]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(180, 83, 9);
      doc.text('4. COMISIONES AGENTES', c4X + 4, cardY + 7);

      doc.setFontSize(11);
      doc.setTextColor(180, 83, 9);
      doc.text(`$${summaryTotals.toPayComm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, c4X + 4, cardY + 13.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Saldo comisiones por liquidar', c4X + 4, cardY + 17.5);

      doc.setFontSize(6);
      doc.setTextColor(51, 65, 85);
      doc.text(`Generado: $${summaryTotals.commTotal.toFixed(0)}`, c4X + 4, cardY + 22);
      doc.text(`Pagado: $${summaryTotals.commPaid.toFixed(0)} (${commPaidRate.toFixed(1)}%)`, c4X + 4, cardY + 26);
      doc.text(`Margen Operativo: $${grossProfit.toFixed(0)} (${grossMarginPct.toFixed(1)}%)`, c4X + 4, cardY + 30);

      // Mini commission bar: Amber (Pagado) vs Rose (Pendiente)
      drawDualBar(c4X + 4, mBarY, mBarW, mBarH, commPaidRate, [217, 119, 6], [239, 68, 68]);

      // =========================================================================
      // 2. TWO GRAPHICAL KPI PANELS (SIDE BY SIDE) (y: 77 to 142, h: 65mm, w: 132mm)
      // =========================================================================
      const panelY = 77;
      const panelH = 65;
      const panelW = 132;
      const panelGap = 5;

      // LEFT PANEL: PARTICIPACIÓN Y VOLUMEN POR CANAL
      const p1X = startX;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(p1X, panelY, panelW, panelH, 2, 2, 'FD');

      // Left Panel Header
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(p1X, panelY, panelW, 9, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(p1X, panelY + 9, p1X + panelW, panelY + 9);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      doc.text('DISTRIBUCIÓN GRÁFICA DE VENTAS Y PARTICIPACIÓN POR CANAL', p1X + 4, panelY + 6);

      // Channel 1: Agentes
      const barStartX = p1X + 6;
      const barMaxW = panelW - 12;
      let barRowY = panelY + 15;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(37, 99, 235);
      doc.text('Agentes de Viajes y Asesores', barStartX, barRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`$${channelTotals.agent.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (${agentPct.toFixed(1)}%) • ${channelTotals.agent.count} pólizas`, barStartX + 52, barRowY);
      drawBar(barStartX, barRowY + 1.5, barMaxW, 4, agentPct, [37, 99, 235], [239, 246, 255]);

      // Channel 2: Corporativo
      barRowY = panelY + 27;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(14, 165, 233);
      doc.text('Cuentas Corporativas / Empresas', barStartX, barRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`$${channelTotals.corporate.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (${corpPct.toFixed(1)}%) • ${channelTotals.corporate.count} pólizas`, barStartX + 52, barRowY);
      drawBar(barStartX, barRowY + 1.5, barMaxW, 4, corpPct, [14, 165, 233], [240, 249, 255]);

      // Channel 3: Individuales
      barRowY = panelY + 39;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(16, 185, 129);
      doc.text('Pólizas Individuales / Directas', barStartX, barRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`$${channelTotals.individual.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (${indivPct.toFixed(1)}%) • ${channelTotals.individual.count} pólizas`, barStartX + 52, barRowY);
      drawBar(barStartX, barRowY + 1.5, barMaxW, 4, indivPct, [16, 185, 129], [236, 253, 245]);

      // Bottom: Stacked continuous mix bar
      const mixY = panelY + 52;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text('MIX PROPORCIONAL CONSOLIDADO (100% DE LA VENTA):', barStartX, mixY);

      const mixBarY = mixY + 2.5;
      const segA = (barMaxW * agentPct) / 100;
      const segC = (barMaxW * corpPct) / 100;
      const segI = Math.max(0, barMaxW - segA - segC);

      doc.setFillColor(37, 99, 235);
      doc.roundedRect(barStartX, mixBarY, segA, 4, 1, 1, 'F');
      doc.setFillColor(14, 165, 233);
      doc.rect(barStartX + segA, mixBarY, segC, 4, 'F');
      doc.setFillColor(16, 185, 129);
      doc.roundedRect(barStartX + segA + segC, mixBarY, segI, 4, 1, 1, 'F');

      // Legend
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(71, 85, 105);
      doc.text(`■ Agentes ${agentPct.toFixed(1)}%   ■ Corporativo ${corpPct.toFixed(1)}%   ■ Individuales ${indivPct.toFixed(1)}%`, barStartX, mixBarY + 7);

      // RIGHT PANEL: SALUD FINANCIERA Y RECUPERACIÓN
      const p2X = p1X + panelW + panelGap;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(p2X, panelY, panelW, panelH, 2, 2, 'FD');

      // Right Panel Header
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(p2X, panelY, panelW, 9, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(p2X, panelY + 9, p2X + panelW, panelY + 9);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      doc.text('INDICADORES DE SALUD FINANCIERA, RECUPERACIÓN Y RENTABILIDAD', p2X + 4, panelY + 6);

      const rBarStartX = p2X + 6;
      let rRowY = panelY + 15;

      // 1. Cobranza (CxC)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(159, 18, 57);
      doc.text('Recuperación de Cobranza (CxC):', rBarStartX, rRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`${collectionRate.toFixed(1)}% Cobrado ($${summaryTotals.collected.toFixed(0)}) | ${(100 - collectionRate).toFixed(1)}% Por Cobrar ($${summaryTotals.toCollect.toFixed(0)})`, rBarStartX + 42, rRowY);
      drawDualBar(rBarStartX, rRowY + 1.5, barMaxW, 4, collectionRate, [16, 185, 129], [225, 29, 72]);

      // 2. Proveedores (CxP)
      rRowY = panelY + 27;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(17, 94, 89);
      doc.text('Costos Proveedores (CxP):', rBarStartX, rRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`${costPaidRate.toFixed(1)}% Liquidado ($${summaryTotals.costPaid.toFixed(0)}) | ${(100 - costPaidRate).toFixed(1)}% Pendiente ($${summaryTotals.toPayCost.toFixed(0)})`, rBarStartX + 42, rRowY);
      drawDualBar(rBarStartX, rRowY + 1.5, barMaxW, 4, costPaidRate, [13, 148, 136], [249, 115, 22]);

      // 3. Comisiones Agentes
      rRowY = panelY + 39;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(180, 83, 9);
      doc.text('Comisiones Agentes:', rBarStartX, rRowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`${commPaidRate.toFixed(1)}% Pagado ($${summaryTotals.commPaid.toFixed(0)}) | ${(100 - commPaidRate).toFixed(1)}% Pendiente ($${summaryTotals.toPayComm.toFixed(0)})`, rBarStartX + 42, rRowY);
      drawDualBar(rBarStartX, rRowY + 1.5, barMaxW, 4, commPaidRate, [217, 119, 6], [239, 68, 68]);

      // Bottom Box: Margen Operativo Bruto
      const profitBoxY = panelY + 49;
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(rBarStartX, profitBoxY, barMaxW, 11, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(`MARGEN OPERATIVO ESTIMADO: $${grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD (${grossMarginPct.toFixed(1)}% sobre ventas)`, rBarStartX + 4, profitBoxY + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Utilidad Bruta = Ventas Totales ($' + summaryTotals.sales.toFixed(0) + ') - Costos Proveedor ($' + summaryTotals.costTotal.toFixed(0) + ') - Comisiones Agentes ($' + summaryTotals.commTotal.toFixed(0) + ')', rBarStartX + 4, profitBoxY + 8.5);

      // =========================================================================
      // 3. CONSOLIDATED SUMMARY TABLE (y: 145 to 186)
      // =========================================================================
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      doc.text('RESUMEN DE CIFRAS CONSOLIDADAS POR PILAR Y CANAL (NÚMEROS FINALES)', 14, 147);

      autoTable(doc, {
        startY: 149,
        theme: 'grid',
        head: [['Pilar Financiero / Operativo', 'Agentes', 'Corporativo', 'Individuales', 'TOTAL CONSOLIDADO (USD)']],
        body: [
          [
            '1. Ventas Totales por Canal',
            `$${channelTotals.agent.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.corporate.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.individual.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${summaryTotals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            '2. Cuentas por Cobrar (Saldos Clientes)',
            `$${channelTotals.agent.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.corporate.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.individual.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${summaryTotals.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            '3. Cuentas por Pagar (Proveedores / Costos)',
            `$${channelTotals.agent.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.corporate.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${channelTotals.individual.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$${summaryTotals.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            '4. Comisiones por Pagar (Agentes)',
            `$${channelTotals.agent.toPayComm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            `$0.00`,
            `$0.00`,
            `$${summaryTotals.toPayComm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            'Volumen de Pólizas Emitidas',
            `${channelTotals.agent.count} pólizas`,
            `${channelTotals.corporate.count} pólizas`,
            `${channelTotals.individual.count} pólizas`,
            `${summaryTotals.policies} pólizas en total`
          ]
        ],
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 7.5
        },
        bodyStyles: {
          fontSize: 7,
          textColor: 50
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 80 },
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold', textColor: [30, 58, 138] }
        },
        margin: { left: 14, right: 14 }
      });

      // =========================================================================
      // PAGE 2: FULL MASTER MATRIX (ALL AGENTS, CORPORATES, INDIVIDUALS)
      // =========================================================================
      doc.addPage();
      drawReportHeader(doc, title, 'Matriz Consolidada Integral por Canal y Entidad (Números Finales)', loadedLogo, true, extraMeta);
      let currentY = 40;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(30, 41, 59);
      doc.text('MATRIZ CONSOLIDADA INTEGRAL POR CANAL Y ENTIDAD (NÚMEROS FINALES)', 14, currentY);

      const matrixRows = consolidatedData.map(row => {
        const typeLabel = row.type === 'Agent' ? 'Agente' : row.type === 'Corporate' ? 'Corporativo' : 'Individual';
        return [
          row.name,
          typeLabel,
          row.policyCount.toString(),
          `$${row.totalSales.toFixed(2)}`,
          `${row.salesPercentage.toFixed(1)}%`,
          `$${row.toCollect.toFixed(2)}`,
          `$${row.toPayCost.toFixed(2)}`,
          `$${row.toPayCommissions.toFixed(2)}`
        ];
      });

      matrixRows.push([
        'TOTALES CONSOLIDADOS',
        '-',
        summaryTotals.policies.toString(),
        `$${summaryTotals.sales.toFixed(2)}`,
        '100.0%',
        `$${summaryTotals.toCollect.toFixed(2)}`,
        `$${summaryTotals.toPayCost.toFixed(2)}`,
        `$${summaryTotals.toPayComm.toFixed(2)}`
      ]);

      autoTable(doc, {
        startY: currentY + 3,
        theme: 'striped',
        head: [[
          'Canal / Entidad',
          'Tipo',
          'Pólizas',
          '1. Ventas',
          '% Ventas',
          '2. CxC (Cobrar)',
          '3. CxP (Proveedor)',
          '4. Comisiones Pend.'
        ]],
        body: matrixRows,
        headStyles: {
          fillColor: [30, 58, 138],
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 8.5
        },
        bodyStyles: {
          fontSize: 8,
          textColor: 50
        },
        didParseCell: (data) => {
          if (data.row.index === matrixRows.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [226, 232, 240];
            data.cell.styles.textColor = [15, 23, 42];
          }
        },
        columnStyles: {
          0: { cellWidth: 70, fontStyle: 'bold' },
          1: { cellWidth: 26, halign: 'center' },
          2: { cellWidth: 20, halign: 'center' },
          3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
          4: { cellWidth: 22, halign: 'center' },
          5: { cellWidth: 33, halign: 'right' },
          6: { cellWidth: 33, halign: 'right' },
          7: { cellWidth: 33, halign: 'right' }
        },
        margin: { left: 14, right: 14 }
      });

      // Page 3: The 4 Dedicated Analytical Focus Tables
      doc.addPage();
      drawReportHeader(doc, title, 'Desglose Consolidado por Pilar de Control', loadedLogo, true, extraMeta);
      currentY = 40;

      // Helper to add sub-table
      const addSectionTable = (
        secTitle: string,
        headCols: string[],
        bodyData: (string | number)[][],
        headerBg: [number, number, number]
      ) => {
        if (currentY > 150) {
          doc.addPage();
          drawReportHeader(doc, title, 'Desglose Consolidado por Pilar de Control', loadedLogo, true, extraMeta);
          currentY = 40;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(31, 41, 55);
        doc.text(secTitle, 14, currentY);

        autoTable(doc, {
          startY: currentY + 3,
          theme: 'grid',
          head: [headCols],
          body: bodyData,
          headStyles: {
            fillColor: headerBg,
            textColor: 255,
            fontSize: 8,
            fontStyle: 'bold'
          },
          bodyStyles: {
            fontSize: 7.8,
            textColor: 50
          },
          margin: { left: 14, right: 14 }
        });

        currentY = (doc as any).lastAutoTable.finalY + 10;
      };

      // 1. Ventas por Canal
      const salesTableRows = consolidatedData.map(r => [
        r.name,
        r.type === 'Agent' ? 'Agente' : r.type === 'Corporate' ? 'Corporativo' : 'Individual',
        r.policyCount.toString(),
        `$${r.totalSales.toFixed(2)}`,
        `${r.salesPercentage.toFixed(1)}%`,
        `$${(r.policyCount > 0 ? r.totalSales / r.policyCount : 0).toFixed(2)}`
      ]);
      salesTableRows.push([
        'TOTAL GENERAL',
        '-',
        summaryTotals.policies.toString(),
        `$${summaryTotals.sales.toFixed(2)}`,
        '100.0%',
        `$${(summaryTotals.policies > 0 ? summaryTotals.sales / summaryTotals.policies : 0).toFixed(2)}`
      ]);
      addSectionTable(
        '1. VENTAS POR CANAL CONSOLIDADAS',
        ['Entidad / Canal', 'Tipo', 'Pólizas', 'Total Venta (USD)', '% Participación', 'Ticket Promedio'],
        salesTableRows,
        [37, 99, 235] // Blue 600
      );

      // 2. Cuentas por Cobrar
      const receivableRows = consolidatedData.map(r => [
        r.name,
        r.type === 'Agent' ? 'Agente' : r.type === 'Corporate' ? 'Corporativo' : 'Individual',
        r.policiesWithDebtCount.toString(),
        `$${r.totalSales.toFixed(2)}`,
        `$${r.totalCollected.toFixed(2)}`,
        `$${r.toCollect.toFixed(2)}`
      ]);
      receivableRows.push([
        'TOTAL CUENTAS POR COBRAR',
        '-',
        summaryTotals.debtPolicies.toString(),
        `$${summaryTotals.sales.toFixed(2)}`,
        `$${summaryTotals.collected.toFixed(2)}`,
        `$${summaryTotals.toCollect.toFixed(2)}`
      ]);
      addSectionTable(
        '2. CUENTAS POR COBRAR CONSOLIDADAS (SALDOS CLIENTES)',
        ['Entidad / Canal', 'Tipo', 'Pólizas c/ Saldo', 'Venta Total', 'Total Cobrado', 'Saldo Pendiente por Cobrar'],
        receivableRows,
        [225, 29, 72] // Rose 600
      );

      // 3. Cuentas por Pagar (Proveedores)
      const payableRows = consolidatedData.map(r => [
        r.name,
        r.type === 'Agent' ? 'Agente' : r.type === 'Corporate' ? 'Corporativo' : 'Individual',
        r.policyCount.toString(),
        `$${r.totalCost.toFixed(2)}`,
        `$${r.costPaid.toFixed(2)}`,
        `$${r.toPayCost.toFixed(2)}`
      ]);
      payableRows.push([
        'TOTAL CUENTAS POR PAGAR',
        '-',
        summaryTotals.policies.toString(),
        `$${summaryTotals.costTotal.toFixed(2)}`,
        `$${summaryTotals.costPaid.toFixed(2)}`,
        `$${summaryTotals.toPayCost.toFixed(2)}`
      ]);
      addSectionTable(
        '3. CUENTAS POR PAGAR CONSOLIDADAS (COSTO PROVEEDORES / CAREMED)',
        ['Entidad / Canal', 'Tipo', 'Pólizas', 'Costo Total Proveedor', 'Costo Liquidado', 'Saldo Pendiente a Proveedor'],
        payableRows,
        [5, 150, 105] // Emerald 600
      );

      // 4. Comisiones por Pagar (Agentes)
      const commissionRows = consolidatedData
        .filter(r => r.type === 'Agent' || r.totalCommissions > 0)
        .map(r => [
          r.name,
          r.policyCount.toString(),
          `$${r.totalSales.toFixed(2)}`,
          `$${r.totalCommissions.toFixed(2)}`,
          `$${r.commissionsPaid.toFixed(2)}`,
          `$${r.toPayCommissions.toFixed(2)}`
        ]);
      commissionRows.push([
        'TOTAL COMISIONES AGENTES',
        channelTotals.agent.count.toString(),
        `$${channelTotals.agent.sales.toFixed(2)}`,
        `$${summaryTotals.commTotal.toFixed(2)}`,
        `$${summaryTotals.commPaid.toFixed(2)}`,
        `$${summaryTotals.toPayComm.toFixed(2)}`
      ]);
      addSectionTable(
        '4. COMISIONES POR PAGAR A AGENTES (CONSOLIDADO)',
        ['Agente / Canal', 'Pólizas', 'Ventas Generadas', 'Comisión Generada', 'Comisión Pagada', 'Saldo Comisiones por Pagar'],
        commissionRows,
        [217, 119, 6] // Amber 600
      );

      addReportFooters(doc, true);

      doc.save(`Reporte_Mensual_Consolidado_${monthName}_${selectedYear}.pdf`);
    } catch (err) {
      console.error('Error generating Monthly Report PDF:', err);
      alert('Ocurrió un error al generar el Reporte Mensual Consolidado.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              <BarChart3 className="w-6 h-6 text-blue-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">Reporte Mensual Consolidado</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/30 text-blue-200 border border-blue-400/30">
                  Cifras Finales por Canal
                </span>
              </div>
              <p className="text-xs text-blue-200/80">
                Resumen ejecutivo con solo números finales de cada Agente, cada Corporativo e Individuales
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Generando PDF...' : 'Descargar PDF Consolidado'}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-gray-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Month Selector Bar */}
        <div className="p-4 bg-gray-50 border-b border-gray-200/70 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mes a Evaluar:</span>
            <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                title="Mes Anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2 px-3">
                <select
                  value={selectedMonthIndex}
                  onChange={e => setSelectedMonthIndex(Number(e.target.value))}
                  className="font-bold text-sm text-gray-900 bg-transparent border-none outline-none cursor-pointer"
                >
                  {SPANISH_MONTHS.map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="font-bold text-sm text-gray-900 bg-transparent border-none outline-none cursor-pointer"
                >
                  {[2024, 2025, 2026, 2027].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleNextMonth}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                title="Mes Siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <span className="text-xs text-gray-500 ml-2 hidden sm:inline">
              Período: <strong className="text-gray-700">{dateRangeStr}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Pólizas Emitidas: <strong className="text-gray-800 font-bold">{summaryTotals.policies}</strong></span>
          </div>
        </div>

        {/* 4 Thematic Executive KPI Cards */}
        <div className="p-6 pb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* 1. Ventas por Canal */}
          <div 
            onClick={() => setActiveTab('sales')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'sales'
                ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-400/30 shadow-md'
                : 'bg-white border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-blue-600" />
                1. Ventas por Canal
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                Total
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${summaryTotals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="pt-2 border-t border-blue-100 text-[11px] text-gray-600 space-y-0.5">
              <div className="flex justify-between">
                <span>Agentes:</span>
                <strong className="text-blue-900">${channelTotals.agent.sales.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Corporativo:</span>
                <strong className="text-blue-900">${channelTotals.corporate.sales.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Individuales:</span>
                <strong className="text-blue-900">${channelTotals.individual.sales.toFixed(2)} ({channelTotals.individual.count} pólizas)</strong>
              </div>
            </div>
          </div>

          {/* 2. Cuentas por Cobrar */}
          <div 
            onClick={() => setActiveTab('receivable')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'receivable'
                ? 'bg-rose-50/90 border-rose-300 ring-2 ring-rose-400/30 shadow-md'
                : 'bg-white border-gray-200 hover:border-rose-200 hover:bg-rose-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-rose-600" />
                2. Cuentas por Cobrar
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                Saldos
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${summaryTotals.toCollect.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="pt-2 border-t border-rose-100 text-[11px] text-gray-600 space-y-0.5">
              <div className="flex justify-between">
                <span>Agentes:</span>
                <strong className="text-rose-900">${channelTotals.agent.toCollect.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Corporativo:</span>
                <strong className="text-rose-900">${channelTotals.corporate.toCollect.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Individuales:</span>
                <strong className="text-rose-900">${channelTotals.individual.toCollect.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* 3. Cuentas por Pagar */}
          <div 
            onClick={() => setActiveTab('payable')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'payable'
                ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-400/30 shadow-md'
                : 'bg-white border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                3. Cuentas por Pagar
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                Proveedor
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${summaryTotals.toPayCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="pt-2 border-t border-emerald-100 text-[11px] text-gray-600 space-y-0.5">
              <div className="flex justify-between">
                <span>Agentes:</span>
                <strong className="text-emerald-900">${channelTotals.agent.toPayCost.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Corporativo:</span>
                <strong className="text-emerald-900">${channelTotals.corporate.toPayCost.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Individuales:</span>
                <strong className="text-emerald-900">${channelTotals.individual.toPayCost.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* 4. Comisiones por Pagar */}
          <div 
            onClick={() => setActiveTab('commissions')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'commissions'
                ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400/30 shadow-md'
                : 'bg-white border-gray-200 hover:border-amber-200 hover:bg-amber-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                4. Comisiones por Pagar
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                Agentes
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${summaryTotals.toPayComm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="pt-2 border-t border-amber-100 text-[11px] text-gray-600 space-y-0.5">
              <div className="flex justify-between">
                <span>Comisiones Generadas:</span>
                <strong className="text-amber-900">${summaryTotals.commTotal.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Comisiones Pagadas:</span>
                <strong className="text-emerald-700">${summaryTotals.commPaid.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Pendientes por Pagar:</span>
                <strong className="text-amber-900 font-bold">${summaryTotals.toPayComm.toFixed(2)}</strong>
              </div>
            </div>
          </div>

        </div>

        {/* Interactive Graphical KPIs Panel */}
        <div className="px-6 py-3 bg-gradient-to-r from-slate-50 via-gray-50 to-blue-50/40 border-y border-gray-200/80">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Left: Participación Gráfica por Canal */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200/80 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                  Distribución Gráfica de Ventas por Canal
                </span>
                <span className="text-[11px] font-semibold text-gray-500">
                  Total: ${summaryTotals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>
              </div>

              {/* Proportional Segmented Bar */}
              {(() => {
                const totalSalesVal = summaryTotals.sales || 1;
                const agentPct = (channelTotals.agent.sales / totalSalesVal) * 100;
                const corpPct = (channelTotals.corporate.sales / totalSalesVal) * 100;
                const indivPct = (channelTotals.individual.sales / totalSalesVal) * 100;

                return (
                  <div>
                    <div className="w-full h-3.5 bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                      <div 
                        style={{ width: `${agentPct}%` }} 
                        className="bg-blue-600 h-full transition-all" 
                        title={`Agentes: $${channelTotals.agent.sales.toFixed(2)} (${agentPct.toFixed(1)}%)`}
                      />
                      <div 
                        style={{ width: `${corpPct}%` }} 
                        className="bg-sky-500 h-full transition-all" 
                        title={`Corporativo: $${channelTotals.corporate.sales.toFixed(2)} (${corpPct.toFixed(1)}%)`}
                      />
                      <div 
                        style={{ width: `${indivPct}%` }} 
                        className="bg-emerald-500 h-full transition-all" 
                        title={`Individuales: $${channelTotals.individual.sales.toFixed(2)} (${indivPct.toFixed(1)}%)`}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[11px]">
                      <span className="flex items-center gap-1 text-gray-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                        <strong>Agentes:</strong> {agentPct.toFixed(1)}% (${channelTotals.agent.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                      </span>
                      <span className="flex items-center gap-1 text-gray-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
                        <strong>Corporativo:</strong> {corpPct.toFixed(1)}% (${channelTotals.corporate.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                      </span>
                      <span className="flex items-center gap-1 text-gray-700">
                        <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                        <strong>Individual:</strong> {indivPct.toFixed(1)}% (${channelTotals.individual.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Right: Salud Financiera y Recuperación de Cartera */}
            <div className="bg-white p-3.5 rounded-xl border border-gray-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  Salud Financiera y Recuperación
                </span>
                {(() => {
                  const grossProfit = summaryTotals.sales - summaryTotals.costTotal - summaryTotals.commTotal;
                  const grossMarginPct = summaryTotals.sales > 0 ? (grossProfit / summaryTotals.sales) * 100 : 0;
                  return (
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      Margen Bruto: ${grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({grossMarginPct.toFixed(1)}%)
                    </span>
                  );
                })()}
              </div>

              {/* Progress bars */}
              {(() => {
                const totalSalesVal = summaryTotals.sales || 1;
                const collectionRate = Math.min(100, (summaryTotals.collected / totalSalesVal) * 100);
                const costPaidRate = summaryTotals.costTotal > 0 ? Math.min(100, (summaryTotals.costPaid / summaryTotals.costTotal) * 100) : 0;

                return (
                  <div className="space-y-1.5 text-[11px]">
                    <div>
                      <div className="flex justify-between text-gray-600 mb-0.5">
                        <span>Cobranza Clientes (CxC): <strong className="text-emerald-700">{collectionRate.toFixed(1)}% Cobrado</strong></span>
                        <span className="text-rose-600 font-semibold">${summaryTotals.toCollect.toLocaleString(undefined, { maximumFractionDigits: 0 })} Pendiente</span>
                      </div>
                      <div className="w-full h-2 bg-rose-200 rounded-full overflow-hidden flex">
                        <div style={{ width: `${collectionRate}%` }} className="bg-emerald-500 h-full" />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-gray-600 mb-0.5">
                        <span>Costos Proveedores (CxP): <strong className="text-teal-700">{costPaidRate.toFixed(1)}% Liquidado</strong></span>
                        <span className="text-orange-600 font-semibold">${summaryTotals.toPayCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} Pendiente</span>
                      </div>
                      <div className="w-full h-2 bg-orange-200 rounded-full overflow-hidden flex">
                        <div style={{ width: `${costPaidRate}%` }} className="bg-teal-600 h-full" />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 py-2 flex items-center gap-2 border-b border-gray-200 text-xs font-bold">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'matrix'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Matriz Consolidada Integral ({consolidatedData.length} canales)
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'sales'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-blue-50'
            }`}
          >
            1. Ventas por Canal
          </button>
          <button
            onClick={() => setActiveTab('receivable')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'receivable'
                ? 'bg-rose-600 text-white'
                : 'text-gray-600 hover:bg-rose-50'
            }`}
          >
            2. Cuentas por Cobrar
          </button>
          <button
            onClick={() => setActiveTab('payable')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'payable'
                ? 'bg-emerald-600 text-white'
                : 'text-gray-600 hover:bg-emerald-50'
            }`}
          >
            3. Cuentas por Pagar
          </button>
          <button
            onClick={() => setActiveTab('commissions')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'commissions'
                ? 'bg-amber-600 text-white'
                : 'text-gray-600 hover:bg-amber-50'
            }`}
          >
            4. Comisiones por Pagar
          </button>
        </div>

        {/* Content Table Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {consolidatedData.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle2 className="w-12 h-12 mx-auto text-blue-500/60 mb-3" />
              <p className="font-bold text-gray-700">No hay transacciones registradas para {monthName} {selectedYear}.</p>
              <p className="text-xs text-gray-500 mt-1">Selecciona otro mes para visualizar sus datos consolidados.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-[10px] text-gray-500 font-bold uppercase border-b border-gray-200">
                    {activeTab === 'matrix' && (
                      <tr>
                        <th className="px-4 py-3">Canal / Entidad</th>
                        <th className="px-4 py-3 text-center">Tipo</th>
                        <th className="px-4 py-3 text-center">Pólizas</th>
                        <th className="px-4 py-3 text-right">1. Ventas Totales</th>
                        <th className="px-4 py-3 text-center">% Ventas</th>
                        <th className="px-4 py-3 text-right">2. CxC (Cobrar)</th>
                        <th className="px-4 py-3 text-right">3. CxP (Proveedor)</th>
                        <th className="px-4 py-3 text-right">4. Comisiones Pend.</th>
                      </tr>
                    )}
                    {activeTab === 'sales' && (
                      <tr>
                        <th className="px-4 py-3">Canal / Entidad</th>
                        <th className="px-4 py-3 text-center">Tipo</th>
                        <th className="px-4 py-3 text-center">Pólizas Emitidas</th>
                        <th className="px-4 py-3 text-right">Venta Total (USD)</th>
                        <th className="px-4 py-3 text-center">% Participación</th>
                        <th className="px-4 py-3 text-right">Ticket Promedio</th>
                      </tr>
                    )}
                    {activeTab === 'receivable' && (
                      <tr>
                        <th className="px-4 py-3">Canal / Entidad</th>
                        <th className="px-4 py-3 text-center">Tipo</th>
                        <th className="px-4 py-3 text-center">Pólizas c/ Saldo</th>
                        <th className="px-4 py-3 text-right">Venta Total Facturada</th>
                        <th className="px-4 py-3 text-right">Total Cobrado</th>
                        <th className="px-4 py-3 text-right text-rose-700">Saldo Pendiente por Cobrar</th>
                      </tr>
                    )}
                    {activeTab === 'payable' && (
                      <tr>
                        <th className="px-4 py-3">Canal / Entidad</th>
                        <th className="px-4 py-3 text-center">Tipo</th>
                        <th className="px-4 py-3 text-center">Pólizas</th>
                        <th className="px-4 py-3 text-right">Costo Total Proveedor</th>
                        <th className="px-4 py-3 text-right">Costo Liquidado</th>
                        <th className="px-4 py-3 text-right text-emerald-700">Saldo Pendiente por Pagar</th>
                      </tr>
                    )}
                    {activeTab === 'commissions' && (
                      <tr>
                        <th className="px-4 py-3">Agente / Canal</th>
                        <th className="px-4 py-3 text-center">Pólizas con Comisión</th>
                        <th className="px-4 py-3 text-right">Ventas Generadas</th>
                        <th className="px-4 py-3 text-right">Comisiones Generadas</th>
                        <th className="px-4 py-3 text-right">Comisiones Pagadas</th>
                        <th className="px-4 py-3 text-right text-amber-700">Saldo por Pagar</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {consolidatedData
                      .filter(row => activeTab !== 'commissions' || row.type === 'Agent' || row.totalCommissions > 0)
                      .map(row => {
                        const typeBadge = row.type === 'Agent' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">Agente</span>
                        ) : row.type === 'Corporate' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">Corporativo</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Individual</span>
                        );

                        return (
                          <tr key={row.key} className="hover:bg-gray-50/80 transition-colors">
                            {activeTab === 'matrix' && (
                              <>
                                <td className="px-4 py-2.5 font-bold text-gray-900">{row.name}</td>
                                <td className="px-4 py-2.5 text-center">{typeBadge}</td>
                                <td className="px-4 py-2.5 text-center font-bold text-gray-700">{row.policyCount}</td>
                                <td className="px-4 py-2.5 text-right font-bold text-blue-900">${row.totalSales.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-center text-gray-600">{row.salesPercentage.toFixed(1)}%</td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${row.toCollect > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                  ${row.toCollect.toFixed(2)}
                                </td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${row.toPayCost > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                                  ${row.toPayCost.toFixed(2)}
                                </td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${row.toPayCommissions > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                                  ${row.toPayCommissions.toFixed(2)}
                                </td>
                              </>
                            )}

                            {activeTab === 'sales' && (
                              <>
                                <td className="px-4 py-2.5 font-bold text-gray-900">{row.name}</td>
                                <td className="px-4 py-2.5 text-center">{typeBadge}</td>
                                <td className="px-4 py-2.5 text-center font-bold text-gray-700">{row.policyCount}</td>
                                <td className="px-4 py-2.5 text-right font-bold text-blue-900">${row.totalSales.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-center text-gray-600">{row.salesPercentage.toFixed(1)}%</td>
                                <td className="px-4 py-2.5 text-right text-gray-700">
                                  ${(row.policyCount > 0 ? row.totalSales / row.policyCount : 0).toFixed(2)}
                                </td>
                              </>
                            )}

                            {activeTab === 'receivable' && (
                              <>
                                <td className="px-4 py-2.5 font-bold text-gray-900">{row.name}</td>
                                <td className="px-4 py-2.5 text-center">{typeBadge}</td>
                                <td className="px-4 py-2.5 text-center font-bold text-gray-700">{row.policiesWithDebtCount}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700">${row.totalSales.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-right text-emerald-700">${row.totalCollected.toFixed(2)}</td>
                                <td className={`px-4 py-2.5 text-right font-bold ${row.toCollect > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                                  ${row.toCollect.toFixed(2)}
                                </td>
                              </>
                            )}

                            {activeTab === 'payable' && (
                              <>
                                <td className="px-4 py-2.5 font-bold text-gray-900">{row.name}</td>
                                <td className="px-4 py-2.5 text-center">{typeBadge}</td>
                                <td className="px-4 py-2.5 text-center font-bold text-gray-700">{row.policyCount}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700">${row.totalCost.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-right text-emerald-700">${row.costPaid.toFixed(2)}</td>
                                <td className={`px-4 py-2.5 text-right font-bold ${row.toPayCost > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                                  ${row.toPayCost.toFixed(2)}
                                </td>
                              </>
                            )}

                            {activeTab === 'commissions' && (
                              <>
                                <td className="px-4 py-2.5 font-bold text-gray-900">{row.name}</td>
                                <td className="px-4 py-2.5 text-center font-bold text-gray-700">{row.policyCount}</td>
                                <td className="px-4 py-2.5 text-right text-gray-700">${row.totalSales.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-right text-blue-900">${row.totalCommissions.toFixed(2)}</td>
                                <td className="px-4 py-2.5 text-right text-emerald-700">${row.commissionsPaid.toFixed(2)}</td>
                                <td className={`px-4 py-2.5 text-right font-bold ${row.toPayCommissions > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                                  ${row.toPayCommissions.toFixed(2)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                  </tbody>
                  {/* Totals Row */}
                  <tfoot className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-300">
                    {activeTab === 'matrix' && (
                      <tr>
                        <td className="px-4 py-3">TOTALES GENERALES</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">{summaryTotals.policies}</td>
                        <td className="px-4 py-3 text-right text-blue-900">${summaryTotals.sales.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">100.0%</td>
                        <td className="px-4 py-3 text-right text-rose-700">${summaryTotals.toCollect.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-emerald-800">${summaryTotals.toPayCost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-amber-800">${summaryTotals.toPayComm.toFixed(2)}</td>
                      </tr>
                    )}
                    {activeTab === 'sales' && (
                      <tr>
                        <td className="px-4 py-3">TOTAL GENERAL</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">{summaryTotals.policies}</td>
                        <td className="px-4 py-3 text-right text-blue-900">${summaryTotals.sales.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">100.0%</td>
                        <td className="px-4 py-3 text-right">
                          ${(summaryTotals.policies > 0 ? summaryTotals.sales / summaryTotals.policies : 0).toFixed(2)}
                        </td>
                      </tr>
                    )}
                    {activeTab === 'receivable' && (
                      <tr>
                        <td className="px-4 py-3">TOTAL CUENTAS POR COBRAR</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">{summaryTotals.debtPolicies}</td>
                        <td className="px-4 py-3 text-right">${summaryTotals.sales.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-emerald-800">${summaryTotals.collected.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-rose-700">${summaryTotals.toCollect.toFixed(2)}</td>
                      </tr>
                    )}
                    {activeTab === 'payable' && (
                      <tr>
                        <td className="px-4 py-3">TOTAL CUENTAS POR PAGAR</td>
                        <td className="px-4 py-3 text-center">-</td>
                        <td className="px-4 py-3 text-center">{summaryTotals.policies}</td>
                        <td className="px-4 py-3 text-right">${summaryTotals.costTotal.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-emerald-800">${summaryTotals.costPaid.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-emerald-800">${summaryTotals.toPayCost.toFixed(2)}</td>
                      </tr>
                    )}
                    {activeTab === 'commissions' && (
                      <tr>
                        <td className="px-4 py-3">TOTAL COMISIONES AGENTES</td>
                        <td className="px-4 py-3 text-center">{channelTotals.agent.count}</td>
                        <td className="px-4 py-3 text-right">${channelTotals.agent.sales.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-blue-900">${summaryTotals.commTotal.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-emerald-800">${summaryTotals.commPaid.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-amber-800">${summaryTotals.toPayComm.toFixed(2)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-gray-500">
            Reporte Consolidado: <span className="font-semibold text-gray-700">Solo números finales de cada Agente, cada Corporativo e Individuales</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors cursor-pointer"
            >
              Cerrar
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-200 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Generando PDF...' : `Descargar PDF Consolidado (${monthName} ${selectedYear})`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
