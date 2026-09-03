import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Download, 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  AlertCircle, 
  FileText, 
  CheckCircle2, 
  Building2, 
  Users, 
  User, 
  Send, 
  FileQuestion, 
  Receipt,
  Search,
  Filter
} from 'lucide-react';
import { InsuranceRequest, Client, Policy, UserProfile } from '../types';
import { getNormalizedYYYYMMDD, formatDisplayDate, SPANISH_MONTHS, findPolicyPrioritized, getPolicyNumber } from '../lib/policyUtils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadCompanyLogo, drawReportHeader, addReportFooters } from '../utils/reportPdfUtils';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

interface MonthlyClosingModalProps {
  isOpen: boolean;
  onClose: () => void;
  insurances: InsuranceRequest[];
  clients: Client[];
  policies: Policy[];
  companySettings?: any;
  profile?: UserProfile | null;
  onEnsureFullHistory?: () => void;
}

export default function MonthlyClosingModal({
  isOpen,
  onClose,
  insurances: propInsurances,
  clients,
  policies,
  companySettings,
  profile,
  onEnsureFullHistory
}: MonthlyClosingModalProps) {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(currentDate.getMonth()); // 0 - 11
  const [activeTab, setActiveTab] = useState<'all' | 'unexported' | 'uninvoiced' | 'to_bill'>('all');
  const [isDownloading, setIsDownloading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [allInsurances, setAllInsurances] = useState<InsuranceRequest[]>(propInsurances);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Sync prop insurances
  useEffect(() => {
    if (propInsurances.length > allInsurances.length) {
      setAllInsurances(propInsurances);
    }
  }, [propInsurances]);

  // When modal opens or year/month changes, ensure we have data
  useEffect(() => {
    if (!isOpen) return;

    if (onEnsureFullHistory) {
      onEnsureFullHistory();
    }

    // Also fetch all insurances if needed to ensure previous months are complete
    const fetchFullInsurances = async () => {
      if (allInsurances.length > 500) return; // already loaded full list
      try {
        setLoadingHistory(true);
        const q = query(collection(db, 'insurances'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as InsuranceRequest));
        setAllInsurances(loaded);
      } catch (err) {
        console.warn('Error loading full insurances history:', err);
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

  // Helper to get client/agency name
  const getClientEntityName = (ins: InsuranceRequest): string => {
    let client = ins.clientId ? clients.find(cl => cl.id === ins.clientId || cl.email === ins.clientId) : undefined;
    if (!client && ins.linkedAgentId) {
      client = clients.find(cl => cl.id === ins.linkedAgentId || cl.email === ins.linkedAgentId);
    }
    if (client) {
      return client.commercialName || client.legalName || `${client.firstName || ''} ${client.lastName || ''}`.trim();
    }
    if (ins.clientType === 'Agent' || ins.linkedAgentId) return ins.linkedAgentId || 'Agente Sin Asignar';
    if (ins.clientType === 'Corporate') return 'Corporativo Sin Asignar';
    return 'Individual / Directo';
  };

  // Helper to sort: 1st by requestDate (or createdAt) ascending, 2nd alphabetically by insured name
  const sortPolicies = (list: InsuranceRequest[]): InsuranceRequest[] => {
    return [...list].sort((a, b) => {
      const dateA = getNormalizedYYYYMMDD(a.requestDate) || getNormalizedYYYYMMDD(a.createdAt) || '';
      const dateB = getNormalizedYYYYMMDD(b.requestDate) || getNormalizedYYYYMMDD(b.createdAt) || '';
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      const nameA = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
      const nameB = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });
  };

  // Base filtered policies for the selected month (excluding cancelled)
  const monthPolicies = useMemo(() => {
    return allInsurances.filter(ins => {
      const isCancelled = ins.status === 'cancelled' || ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can';
      if (isCancelled) return false;

      const insDate = getNormalizedYYYYMMDD(ins.requestDate) || getNormalizedYYYYMMDD(ins.createdAt);
      if (!insDate) return false;

      return insDate.startsWith(monthPrefix);
    });
  }, [allInsurances, monthPrefix]);

  // Group into the 3 requested categories:
  // 1. Pólizas que no han sido exportadas (!ins.Caremed)
  const unexportedPolicies = useMemo(() => {
    return monthPolicies.filter(ins => !ins.Caremed);
  }, [monthPolicies]);

  // 2. Pólizas que no tienen número de Invoices (!ins.InvoiceCaremed)
  const uninvoicedPolicies = useMemo(() => {
    return monthPolicies.filter(ins => !ins.InvoiceCaremed || ins.InvoiceCaremed.trim() === '');
  }, [monthPolicies]);

  // 3. Pólizas por facturar (ins.solicitudFactura === true)
  const toBillPolicies = useMemo(() => {
    return monthPolicies.filter(ins => ins.solicitudFactura === true);
  }, [monthPolicies]);

  // Function to split any list by: Agente, Corporativo, Individuales (sorted)
  const splitByChannel = (list: InsuranceRequest[]) => {
    const isAgent = (i: InsuranceRequest) => {
      if (i.clientType === 'Agent') return true;
      if (i.linkedAgentId) return true;
      const c = i.clientId ? clients.find(cl => cl.id === i.clientId || cl.email === i.clientId) : undefined;
      return c?.type === 'Agent';
    };
    const isCorp = (i: InsuranceRequest) => {
      if (i.clientType === 'Corporate') return true;
      const c = i.clientId ? clients.find(cl => cl.id === i.clientId || cl.email === i.clientId) : undefined;
      return c?.type === 'Corporate';
    };

    const agents = sortPolicies(list.filter(i => isAgent(i)));
    const corporate = sortPolicies(list.filter(i => !isAgent(i) && isCorp(i)));
    const individual = sortPolicies(list.filter(i => !isAgent(i) && !isCorp(i)));

    const totalAmount = (items: InsuranceRequest[]) =>
      items.reduce((sum, i) => sum + (i.totalFinal !== undefined && i.totalFinal !== null ? i.totalFinal : (i.totalPrice || 0)), 0);

    return {
      agents,
      corporate,
      individual,
      agentsTotal: totalAmount(agents),
      corporateTotal: totalAmount(corporate),
      individualTotal: totalAmount(individual),
      totalCount: list.length,
      grandTotal: totalAmount(list)
    };
  };

  const unexportedGrouped = useMemo(() => splitByChannel(unexportedPolicies), [unexportedPolicies]);
  const uninvoicedGrouped = useMemo(() => splitByChannel(uninvoicedPolicies), [uninvoicedPolicies]);
  const toBillGrouped = useMemo(() => splitByChannel(toBillPolicies), [toBillPolicies]);

  // Generate the Single Comprehensive PDF for Cierre de Mes
  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const loadedLogo = await loadCompanyLogo(companySettings?.logoUrl);
      const title = `REPORTE DE CIERRE DE MES - ${monthName.toUpperCase()} ${selectedYear}`;
      const subtitle = `Período auditado: ${dateRangeStr} | Estado: Auditoría previa al cierre contable`;
      const extraMeta = `Generado: ${formatDisplayDate(new Date())} por ${profile?.displayName || 'Administración'}`;

      drawReportHeader(doc, title, subtitle, loadedLogo, true, extraMeta);

      // Section 0: Executive KPI Summary Box / Table
      let currentY = 40;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(31, 41, 55);
      doc.text('RESUMEN EJECUTIVO DE PÓLIZAS PENDIENTES DE CIERRE', 14, currentY);

      autoTable(doc, {
        startY: currentY + 3,
        theme: 'grid',
        head: [['Puntos de Control para Cierre de Mes', 'Agentes', 'Corporativo', 'Individuales', 'Total Pólizas', 'Importe Total (USD)']],
        body: [
          [
            '1. Pólizas que no han sido exportadas (Pendientes CareMed)',
            `${unexportedGrouped.agents.length} ($${unexportedGrouped.agentsTotal.toFixed(2)})`,
            `${unexportedGrouped.corporate.length} ($${unexportedGrouped.corporateTotal.toFixed(2)})`,
            `${unexportedGrouped.individual.length} ($${unexportedGrouped.individualTotal.toFixed(2)})`,
            unexportedGrouped.totalCount.toString(),
            `$${unexportedGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            '2. Pólizas que no tienen número de Invoice CareMed',
            `${uninvoicedGrouped.agents.length} ($${uninvoicedGrouped.agentsTotal.toFixed(2)})`,
            `${uninvoicedGrouped.corporate.length} ($${uninvoicedGrouped.corporateTotal.toFixed(2)})`,
            `${uninvoicedGrouped.individual.length} ($${uninvoicedGrouped.individualTotal.toFixed(2)})`,
            uninvoicedGrouped.totalCount.toString(),
            `$${uninvoicedGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ],
          [
            '3. Pólizas por facturar (Solicitud de Factura Fiscal)',
            `${toBillGrouped.agents.length} ($${toBillGrouped.agentsTotal.toFixed(2)})`,
            `${toBillGrouped.corporate.length} ($${toBillGrouped.corporateTotal.toFixed(2)})`,
            `${toBillGrouped.individual.length} ($${toBillGrouped.individualTotal.toFixed(2)})`,
            toBillGrouped.totalCount.toString(),
            `$${toBillGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          ]
        ],
        headStyles: {
          fillColor: [30, 58, 138], // Dark Indigo
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 9
        },
        bodyStyles: {
          fontSize: 8.5,
          textColor: 50
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 95 },
          1: { halign: 'center' },
          2: { halign: 'center' },
          3: { halign: 'center' },
          4: { halign: 'center', fontStyle: 'bold' },
          5: { halign: 'right', fontStyle: 'bold' }
        },
        margin: { left: 14, right: 14 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 12;

      // Helper to render a full section with subsections: Agente, Corporativo, Individuales
      const renderSectionTables = (
        sectionNumber: number,
        sectionTitle: string,
        grouped: ReturnType<typeof splitByChannel>,
        isFacturaSection: boolean = false
      ) => {
        // Section Header
        if (currentY > 165) {
          doc.addPage();
          drawReportHeader(doc, title, subtitle, loadedLogo, true, extraMeta);
          currentY = 40;
        }

        doc.setFillColor(isFacturaSection ? 245 : 243, 244, 246);
        doc.roundedRect(14, currentY, 269, 10, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(isFacturaSection ? 99 : 26, isFacturaSection ? 102 : 60, isFacturaSection ? 241 : 114);
        doc.text(
          `${sectionNumber}. ${sectionTitle.toUpperCase()} (TOTAL: ${grouped.totalCount} PÓLIZAS | $${grouped.grandTotal.toFixed(2)} USD)`,
          18,
          currentY + 6.8
        );

        currentY += 14;

        const subChannels: { label: string; items: InsuranceRequest[]; subtotal: number }[] = [
          { label: 'AGENTE', items: grouped.agents, subtotal: grouped.agentsTotal },
          { label: 'CORPORATIVO', items: grouped.corporate, subtotal: grouped.corporateTotal },
          { label: 'INDIVIDUALES', items: grouped.individual, subtotal: grouped.individualTotal }
        ];

        subChannels.forEach(({ label, items, subtotal }) => {
          if (currentY > 175) {
            doc.addPage();
            drawReportHeader(doc, title, subtitle, loadedLogo, true, extraMeta);
            currentY = 40;
          }

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(55, 65, 81);
          doc.text(`▸ ${label} (${items.length} pólizas - Subtotal: $${subtotal.toFixed(2)} USD)`, 16, currentY);
          currentY += 3;

          if (items.length === 0) {
            autoTable(doc, {
              startY: currentY,
              theme: 'plain',
              body: [['Sin pólizas pendientes en esta categoría para este período.']],
              bodyStyles: { textColor: 150, fontStyle: 'italic', fontSize: 8.5 },
              margin: { left: 16, right: 14 }
            });
            currentY = (doc as any).lastAutoTable.finalY + 6;
            return;
          }

          const headColumns = isFacturaSection
            ? ['Folio / Certificado', 'Fecha Solicitud', 'Asegurado', 'Entidad / Cliente', 'RFC Factura', 'Razón Social Fiscal', 'Plan / Póliza', 'Importe Venta']
            : ['Folio / Certificado', 'Fecha Solicitud', 'Asegurado', 'Entidad / Cliente', 'Plan / Cobertura', 'Vigencia', 'Importe Venta'];

          const bodyRows = items.map(ins => {
            const pObj = findPolicyPrioritized(ins.policyId, policies)
                      || findPolicyPrioritized(ins.policyNumber, policies)
                      || findPolicyPrioritized(ins.policyName, policies);
            const folio = ins.policyNumber 
              || (pObj ? getPolicyNumber(pObj, ins.age) : '') 
              || pObj?.CodigoPoliza 
              || ins.policyId 
              || (ins.id ? ins.id.substring(0, 10).toUpperCase() : '-');
            const fechaSol = ins.requestDate ? formatDisplayDate(ins.requestDate) : formatDisplayDate(ins.createdAt);
            const asegurado = `${ins.firstName || ''} ${ins.lastName || ''}`.trim() || 'Sin Nombre';
            const entidad = getClientEntityName(ins);
            const plan = pObj?.NombrePoliza || pObj?.name || ins.policyName || ins.plan || ins.subcategoryName || '-';
            const vigencia = `${formatDisplayDate(ins.startDate)} al ${formatDisplayDate(ins.endDate)}`;
            const monto = `$${(ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : (ins.totalPrice || 0)).toFixed(2)}`;

            if (isFacturaSection) {
              const rfc = ins.rfcFactura || ins.facturaData?.rfc || 'PENDIENTE';
              const razon = ins.razonSocialFactura || ins.facturaData?.razonSocial || '-';
              return [folio, fechaSol, asegurado, entidad, rfc, razon, plan, monto];
            }

            return [folio, fechaSol, asegurado, entidad, plan, vigencia, monto];
          });

          // Push Subtotal row
          if (isFacturaSection) {
            bodyRows.push([
              `SUBTOTAL ${label}`,
              '',
              '',
              '',
              '',
              '',
              `${items.length} pólizas`,
              `$${subtotal.toFixed(2)}`
            ]);
          } else {
            bodyRows.push([
              `SUBTOTAL ${label}`,
              '',
              '',
              '',
              '',
              `${items.length} pólizas`,
              `$${subtotal.toFixed(2)}`
            ]);
          }

          autoTable(doc, {
            startY: currentY,
            theme: 'striped',
            head: [headColumns],
            body: bodyRows,
            headStyles: {
              fillColor: isFacturaSection ? [79, 70, 229] : [51, 65, 85],
              textColor: 255,
              fontSize: 7.8,
              fontStyle: 'bold'
            },
            bodyStyles: {
              fontSize: 7.5,
              textColor: 50
            },
            didParseCell: (data) => {
              if (data.row.index === bodyRows.length - 1) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [241, 245, 249];
                data.cell.styles.textColor = [15, 23, 42];
              }
            },
            columnStyles: isFacturaSection ? {
              0: { cellWidth: 28 },
              1: { cellWidth: 22 },
              2: { cellWidth: 42 },
              3: { cellWidth: 40 },
              4: { cellWidth: 26, fontStyle: 'bold' },
              5: { cellWidth: 48 },
              6: { cellWidth: 35 },
              7: { cellWidth: 28, halign: 'right' }
            } : {
              0: { cellWidth: 32 },
              1: { cellWidth: 24 },
              2: { cellWidth: 50 },
              3: { cellWidth: 48 },
              4: { cellWidth: 45 },
              5: { cellWidth: 42 },
              6: { cellWidth: 28, halign: 'right' }
            },
            margin: { left: 16, right: 14 }
          });

          currentY = (doc as any).lastAutoTable.finalY + 8;
        });

        currentY += 4;
      };

      // 1. Pólizas que no han sido exportadas
      renderSectionTables(
        1,
        'Pólizas que no han sido exportadas (Pendientes de Exportación CareMed)',
        unexportedGrouped,
        false
      );

      // 2. Pólizas que no tienen número de Invoices
      renderSectionTables(
        2,
        'Pólizas que no tienen número de Invoices (Sin Invoice CareMed Asignado)',
        uninvoicedGrouped,
        false
      );

      // 3. Pólizas por facturar
      renderSectionTables(
        3,
        'Pólizas por facturar (Clientes que Solicitaron Factura Fiscal / SAT)',
        toBillGrouped,
        true
      );

      // Add page numbering & footer notes
      addReportFooters(doc, true);

      // Save PDF
      doc.save(`Cierre_de_Mes_${monthName}_${selectedYear}.pdf`);
    } catch (err) {
      console.error('Error generating Cierre de Mes PDF:', err);
      alert('Ocurrió un error al generar el PDF de Cierre de Mes.');
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen) return null;

  // Filter list for active tab in UI
  const getTabItems = () => {
    let list: InsuranceRequest[] = [];
    if (activeTab === 'unexported') list = unexportedPolicies;
    else if (activeTab === 'uninvoiced') list = uninvoicedPolicies;
    else if (activeTab === 'to_bill') list = toBillPolicies;
    else list = monthPolicies;

    if (!searchTerm.trim()) return list;

    const term = searchTerm.toLowerCase();
    return list.filter(ins => {
      const name = `${ins.firstName || ''} ${ins.lastName || ''}`.toLowerCase();
      const entity = getClientEntityName(ins).toLowerCase();
      const folio = (ins.policyNumber || ins.id || '').toLowerCase();
      const invoice = (ins.InvoiceCaremed || '').toLowerCase();
      const rfc = (ins.rfcFactura || ins.facturaData?.rfc || '').toLowerCase();
      return name.includes(term) || entity.includes(term) || folio.includes(term) || invoice.includes(term) || rfc.includes(term);
    });
  };

  const displayedList = getTabItems();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              <Calendar className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">Cierre de Mes</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  Auditoría de Pólizas
                </span>
              </div>
              <p className="text-xs text-indigo-200/80">
                Identifica pólizas no exportadas, sin Invoice y por facturar antes de cerrar el mes contable
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Generando PDF...' : 'Descargar PDF Cierre'}
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
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Mes a Cerrar:</span>
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
              Rango: <strong className="text-gray-700">{dateRangeStr}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar asegurado, cliente..."
                className="pl-9 pr-4 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none w-56 shadow-sm"
              />
            </div>
          </div>
        </div>

        {/* 3 KPI Summary Cards */}
        <div className="p-6 pb-2 grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Card 1: Sin Exportar */}
          <div 
            onClick={() => setActiveTab('unexported')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'unexported' 
                ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-400/30 shadow-md' 
                : 'bg-white border-gray-200 hover:border-amber-200 hover:bg-amber-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-amber-600" />
                1. No Exportadas (CareMed)
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {unexportedGrouped.totalCount} pólizas
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${unexportedGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-amber-100 text-[11px] text-gray-600">
              <div><strong className="text-amber-800 font-bold">{unexportedGrouped.agents.length}</strong> Agentes</div>
              <div><strong className="text-amber-800 font-bold">{unexportedGrouped.corporate.length}</strong> Corp</div>
              <div><strong className="text-amber-800 font-bold">{unexportedGrouped.individual.length}</strong> Indiv</div>
            </div>
          </div>

          {/* Card 2: Sin Invoice */}
          <div 
            onClick={() => setActiveTab('uninvoiced')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'uninvoiced' 
                ? 'bg-rose-50/80 border-rose-300 ring-2 ring-rose-400/30 shadow-md' 
                : 'bg-white border-gray-200 hover:border-rose-200 hover:bg-rose-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                <FileQuestion className="w-3.5 h-3.5 text-rose-600" />
                2. Sin Número de Invoice
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                {uninvoicedGrouped.totalCount} pólizas
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${uninvoicedGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-rose-100 text-[11px] text-gray-600">
              <div><strong className="text-rose-800 font-bold">{uninvoicedGrouped.agents.length}</strong> Agentes</div>
              <div><strong className="text-rose-800 font-bold">{uninvoicedGrouped.corporate.length}</strong> Corp</div>
              <div><strong className="text-rose-800 font-bold">{uninvoicedGrouped.individual.length}</strong> Indiv</div>
            </div>
          </div>

          {/* Card 3: Por Facturar */}
          <div 
            onClick={() => setActiveTab('to_bill')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer ${
              activeTab === 'to_bill' 
                ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-400/30 shadow-md' 
                : 'bg-white border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                3. Pólizas Por Facturar (SAT)
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                {toBillGrouped.totalCount} pólizas
              </span>
            </div>
            <div className="text-xl font-bold text-gray-900 mb-2">
              ${toBillGrouped.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-normal text-gray-500">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-2 border-t border-indigo-100 text-[11px] text-gray-600">
              <div><strong className="text-indigo-800 font-bold">{toBillGrouped.agents.length}</strong> Agentes</div>
              <div><strong className="text-indigo-800 font-bold">{toBillGrouped.corporate.length}</strong> Corp</div>
              <div><strong className="text-indigo-800 font-bold">{toBillGrouped.individual.length}</strong> Indiv</div>
            </div>
          </div>

        </div>

        {/* Tab Filters Bar */}
        <div className="px-6 py-2 flex items-center gap-2 border-b border-gray-200 text-xs font-bold">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'all'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Todas las Pólizas del Mes ({monthPolicies.length})
          </button>
          <button
            onClick={() => setActiveTab('unexported')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'unexported'
                ? 'bg-amber-600 text-white'
                : 'text-gray-600 hover:bg-amber-50'
            }`}
          >
            1. No Exportadas ({unexportedGrouped.totalCount})
          </button>
          <button
            onClick={() => setActiveTab('uninvoiced')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'uninvoiced'
                ? 'bg-rose-600 text-white'
                : 'text-gray-600 hover:bg-rose-50'
            }`}
          >
            2. Sin Invoices ({uninvoicedGrouped.totalCount})
          </button>
          <button
            onClick={() => setActiveTab('to_bill')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'to_bill'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-indigo-50'
            }`}
          >
            3. Por Facturar ({toBillGrouped.totalCount})
          </button>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {displayedList.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500/60 mb-3" />
              <p className="font-bold text-gray-700">¡Excelente! No hay pólizas pendientes en esta sección.</p>
              <p className="text-xs text-gray-500 mt-1">El cierre de este rubro se encuentra al día para {monthName} {selectedYear}.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Group by Agentes, Corporativo, Individuales */}
              {(['Agent', 'Corporate', 'Individual'] as const).map(channel => {
                const channelItems = sortPolicies(
                  displayedList.filter(i => (channel === 'Individual' ? (!i.clientType || i.clientType === 'Individual') : i.clientType === channel))
                );

                if (channelItems.length === 0) return null;

                const channelLabel = channel === 'Agent' ? 'Agentes' : channel === 'Corporate' ? 'Corporativo' : 'Individuales';
                const channelIcon = channel === 'Agent' ? Users : channel === 'Corporate' ? Building2 : User;
                const ChannelIconComponent = channelIcon;
                const channelTotal = channelItems.reduce((acc, i) => acc + (i.totalFinal !== undefined && i.totalFinal !== null ? i.totalFinal : (i.totalPrice || 0)), 0);

                return (
                  <div key={channel} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-xs text-gray-800">
                        <ChannelIconComponent className="w-4 h-4 text-indigo-600" />
                        <span>Canal: {channelLabel}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-white border border-gray-200 text-gray-600">
                          {channelItems.length} pólizas
                        </span>
                      </div>
                      <span className="text-xs font-bold text-gray-900">
                        Subtotal: ${channelTotal.toFixed(2)} USD
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-gray-50/50 text-[10px] text-gray-500 font-bold uppercase border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-2.5">Folio / Certificado</th>
                            <th className="px-4 py-2.5">Fecha Solicitud</th>
                            <th className="px-4 py-2.5">Asegurado</th>
                            <th className="px-4 py-2.5">Cliente / Agencia</th>
                            <th className="px-4 py-2.5">Plan / Póliza</th>
                            <th className="px-4 py-2.5">Vigencia</th>
                            {activeTab === 'to_bill' && <th className="px-4 py-2.5">RFC Factura</th>}
                            <th className="px-4 py-2.5 text-right">Venta Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {channelItems.map(ins => {
                            const pObj = findPolicyPrioritized(ins.policyId, policies)
                                      || findPolicyPrioritized(ins.policyNumber, policies)
                                      || findPolicyPrioritized(ins.policyName, policies);
                            const folio = ins.policyNumber 
                              || (pObj ? getPolicyNumber(pObj, ins.age) : '') 
                              || pObj?.CodigoPoliza 
                              || ins.policyId 
                              || ins.id?.substring(0, 8).toUpperCase() 
                              || '-';
                            const planLabel = pObj?.NombrePoliza || pObj?.name || ins.policyName || ins.plan || '-';
                            const reqDate = ins.requestDate ? formatDisplayDate(ins.requestDate) : formatDisplayDate(ins.createdAt);
                            const amount = ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : (ins.totalPrice || 0);

                            return (
                              <tr key={ins.id} className="hover:bg-gray-50/80 transition-colors">
                                <td className="px-4 py-2.5 font-mono font-bold text-indigo-700">{folio}</td>
                                <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{reqDate}</td>
                                <td className="px-4 py-2.5 font-medium text-gray-900">
                                  {ins.firstName} {ins.lastName}
                                </td>
                                <td className="px-4 py-2.5 text-gray-600">{getClientEntityName(ins)}</td>
                                <td className="px-4 py-2.5 text-gray-600">{planLabel}</td>
                                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-[11px]">
                                  {formatDisplayDate(ins.startDate)} al {formatDisplayDate(ins.endDate)}
                                </td>
                                {activeTab === 'to_bill' && (
                                  <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-gray-700">
                                    {ins.rfcFactura || ins.facturaData?.rfc || 'Sin RFC'}
                                  </td>
                                )}
                                <td className="px-4 py-2.5 text-right font-bold text-gray-900 whitespace-nowrap">
                                  ${amount.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-gray-500">
            Acomodo de reporte: <span className="font-semibold text-gray-700">Fecha de solicitud (cronológico) y orden alfabético</span>
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
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {isDownloading ? 'Generando PDF...' : `Descargar PDF Cierre (${monthName} ${selectedYear})`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
