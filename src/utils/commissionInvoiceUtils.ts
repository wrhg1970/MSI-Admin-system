import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { CommissionInvoice } from '../types';

export const formatUSD = (val: number): string => {
  return `$${(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
};

export const formatMXP = (val: number): string => {
  return `$${(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
};

/**
 * Genera el documento oficial PDF de Liquidación / Invoice de Comisiones
 * con membrete institucional, desglose de pólizas, datos fiscales/bancarios
 * del agente y totales en USD y MXP.
 */
export const generateCommissionInvoicePDF = (
  invoice: CommissionInvoice,
  companySettings?: {
    companyName?: string;
    logoUrl?: string;
    rfc?: string;
    address?: string;
    phone?: string;
    email?: string;
  }
) => {
  // Configuración de página A4 vertical
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const primaryColor: [number, number, number] = [26, 33, 56]; // Navy #1A2138
  const accentColor: [number, number, number] = [16, 185, 129]; // Emerald #10B981
  const grayText: [number, number, number] = [100, 116, 139]; // Slate 500

  // 1. Barra superior
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Decoración esmeralda
  doc.setFillColor(...accentColor);
  doc.rect(0, 27, pageWidth, 2, 'F');

  // Título del documento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text('ESTADO DE LIQUIDACIÓN Y FACTURA DE COMISIONES', 14, 13);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text('DOCUMENTO OFICIAL DE LIQUIDACIÓN PARA PAGO DE AGENTE', 14, 20);

  // Logo institucional o nombre
  if (companySettings?.logoUrl) {
    try {
      doc.addImage(companySettings.logoUrl, 'PNG', pageWidth - 46, 3.5, 32, 21);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(companySettings.companyName || 'MI SEGURO INTERNACIONAL', pageWidth - 14, 15, { align: 'right' });
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text(companySettings?.companyName || 'MI SEGURO INTERNACIONAL', pageWidth - 14, 15, { align: 'right' });
  }

  // 2. Tarjetas de Información: Folio / Emisión & Datos del Agente
  let currentY = 36;

  // Cuadro Izquierdo: Datos del Folio y Liquidación
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, currentY, 86, 38, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...primaryColor);
  doc.text('DATOS DE LA LIQUIDACIÓN', 18, currentY + 6);

  doc.setFontSize(7.5);
  doc.setTextColor(...grayText);
  doc.text('Folio:', 18, currentY + 12);
  doc.text('Fecha de Emisión:', 18, currentY + 18);
  doc.text('Estado:', 18, currentY + 24);
  doc.text('Moneda / T.C.:', 18, currentY + 30);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(invoice.folio || 'N/A', 52, currentY + 12);

  const createdAtStr = invoice.createdAt?.toDate
    ? format(invoice.createdAt.toDate(), 'dd/MM/yyyy HH:mm')
    : invoice.createdAt
    ? format(new Date(invoice.createdAt), 'dd/MM/yyyy')
    : format(new Date(), 'dd/MM/yyyy');
  doc.text(createdAtStr, 52, currentY + 18);

  const statusLabel = 
    invoice.status === 'paid' ? 'PAGADO / LIQUIDADO' :
    invoice.status === 'approved' ? 'APROBADO PARA PAGO' :
    invoice.status === 'rejected' ? 'RECHAZADO' : 'SOLICITADO / EN REVISIÓN';
  const statusColor: [number, number, number] =
    invoice.status === 'paid' ? [16, 185, 129] :
    invoice.status === 'approved' ? [59, 130, 246] :
    invoice.status === 'rejected' ? [239, 68, 68] : [245, 158, 11];
  doc.setTextColor(...statusColor);
  doc.text(statusLabel, 52, currentY + 24);

  doc.setTextColor(15, 23, 42);
  const tcStr = invoice.exchangeRate ? `T.C. $${Number(invoice.exchangeRate).toFixed(2)}` : '1.00';
  doc.text(`${invoice.currency || 'USD'} (${tcStr})`, 52, currentY + 30);

  // Cuadro Derecho: Datos del Agente y Cuenta Bancaria
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(106, currentY, 90, 38, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...primaryColor);
  doc.text('DATOS FISCALES Y BANCARIOS DEL AGENTE', 110, currentY + 6);

  doc.setFontSize(7.5);
  doc.setTextColor(...grayText);
  doc.text('Nombre:', 110, currentY + 12);
  doc.text('Email:', 110, currentY + 17);
  doc.text('RFC / Tax ID:', 110, currentY + 22);
  doc.text('Banco:', 110, currentY + 27);
  doc.text('CLABE / Cuenta:', 110, currentY + 32);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const safeAgentName = (invoice.agentName || 'Agente Registrado').substring(0, 35);
  doc.text(safeAgentName, 136, currentY + 12);
  doc.text((invoice.agentEmail || '').substring(0, 35), 136, currentY + 17);
  doc.text(invoice.agentTaxId || 'No especificado', 136, currentY + 22);
  doc.text(invoice.bankInfo?.bankName || 'No especificado', 136, currentY + 27);
  const clabeAccount = invoice.bankInfo?.clabe || invoice.bankInfo?.account || 'No especificada';
  doc.text(clabeAccount, 136, currentY + 32);

  // 3. Tabla de Pólizas Liquidadas
  currentY += 44;

  const tableRows = (invoice.policiesSummary || []).map((p, idx) => {
    const saleUSD = Number(p.totalPrice || 0);
    const commUSD = Number(p.commissionAmount || 0);
    const commPct = saleUSD > 0 ? ((commUSD / saleUSD) * 100).toFixed(1) + '%' : '-';
    const rate = Number(invoice.exchangeRate || 1);
    const commMXP = commUSD * rate;

    return [
      (idx + 1).toString(),
      p.policyNumber || p.id?.substring(0, 8) || 'S/N',
      p.startDate || '-',
      p.insuredName || 'Asegurado',
      formatUSD(saleUSD),
      commPct,
      formatUSD(commUSD),
      rate.toFixed(2),
      formatMXP(commMXP)
    ];
  });

  // Fila de totales
  const totalSaleUSD = (invoice.policiesSummary || []).reduce((acc, curr) => acc + Number(curr.totalPrice || 0), 0);
  const totalCommUSD = invoice.totalCommissionUSD || (invoice.policiesSummary || []).reduce((acc, curr) => acc + Number(curr.commissionAmount || 0), 0);
  const totalCommMXP = invoice.totalCommissionMXP || (totalCommUSD * Number(invoice.exchangeRate || 1));

  tableRows.push([
    '',
    'TOTALES',
    `${invoice.policiesSummary?.length || 0} pólizas`,
    '',
    formatUSD(totalSaleUSD),
    '',
    formatUSD(totalCommUSD),
    '',
    formatMXP(totalCommMXP)
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [[
      '#',
      'Póliza / ID',
      'Fecha',
      'Asegurado',
      'Prima USD',
      '% Com.',
      'Comisión USD',
      'T.C.',
      'Comisión MXN'
    ]],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center'
    },
    styles: {
      fontSize: 7,
      cellPadding: 1.8,
      textColor: [30, 41, 59]
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'center', cellWidth: 24 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'left' },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'center', cellWidth: 14 },
      6: { halign: 'right', cellWidth: 24 },
      7: { halign: 'center', cellWidth: 14 },
      8: { halign: 'right', cellWidth: 26 }
    },
    didParseCell: (data) => {
      // Destacar la fila de totales
      if (data.row.index === tableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.textColor = primaryColor;
      }
    }
  });

  // 4. Bloque Resumen de Liquidación y Totales
  const finalTableY = (doc as any).lastAutoTable?.finalY || currentY + 40;
  let summaryY = finalTableY + 8;

  // Si nos acercamos al final de la hoja, agregar nueva página
  if (summaryY + 50 > pageHeight) {
    doc.addPage();
    summaryY = 20;
  }

  // Recuadro de Totales (a la derecha)
  const boxWidth = 86;
  const boxX = pageWidth - 14 - boxWidth;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...primaryColor);
  doc.roundedRect(boxX, summaryY, boxWidth, 34, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...primaryColor);
  doc.text('RESUMEN DE LIQUIDACIÓN', boxX + 6, summaryY + 7);

  doc.setFontSize(8);
  doc.setTextColor(...grayText);
  doc.text('Total Comisiones USD:', boxX + 6, summaryY + 14);
  doc.text('Tipo de Cambio Aplicado:', boxX + 6, summaryY + 20);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(formatUSD(totalCommUSD), boxX + boxWidth - 6, summaryY + 14, { align: 'right' });
  doc.text(`$${Number(invoice.exchangeRate || 1).toFixed(2)} MXN`, boxX + boxWidth - 6, summaryY + 20, { align: 'right' });

  // Total a Liquidar Neto
  doc.setFillColor(...primaryColor);
  doc.rect(boxX, summaryY + 23, boxWidth, 11, 'F');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('NETO A LIQUIDAR:', boxX + 6, summaryY + 30);
  const displayTotal = invoice.currency === 'MXP' ? formatMXP(totalCommMXP) : formatUSD(totalCommUSD);
  doc.setFont('helvetica', 'bold');
  doc.text(displayTotal, boxX + boxWidth - 6, summaryY + 30, { align: 'right' });

  // Recuadro de Notas / Comentarios del Agente y Administración (a la izquierda)
  const notesWidth = boxX - 14 - 6;
  if (invoice.agentInvoiceFolio || invoice.agentNotes || invoice.paymentReference) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, summaryY, notesWidth, 34, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...primaryColor);
    doc.text('DETALLES FISCALES Y NOTAS:', 18, summaryY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);

    let noteLineY = summaryY + 12;
    if (invoice.agentInvoiceFolio) {
      doc.text(`• Factura Fiscal Agente (Folio): ${invoice.agentInvoiceFolio}`, 18, noteLineY);
      noteLineY += 5;
    }
    if (invoice.paymentMethod) {
      doc.text(`• Método de Pago: ${invoice.paymentMethod} ${invoice.paymentReference ? `(Ref: ${invoice.paymentReference})` : ''}`, 18, noteLineY);
      noteLineY += 5;
    }
    if (invoice.agentNotes) {
      const splitNotes = doc.splitTextToSize(`• Nota Agente: ${invoice.agentNotes}`, notesWidth - 8);
      doc.text(splitNotes, 18, noteLineY);
    }
  }

  // 5. Firmas y pie de página institucional
  const footerY = Math.max(summaryY + 45, pageHeight - 30);
  
  doc.setDrawColor(203, 213, 225);
  doc.line(14, footerY + 12, 85, footerY + 12);
  doc.line(pageWidth - 85, footerY + 12, pageWidth - 14, footerY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...primaryColor);
  doc.text('ELABORADO Y AUTORIZADO POR', 49.5, footerY + 16, { align: 'center' });
  doc.text('CONFORMIDAD DEL AGENTE', pageWidth - 49.5, footerY + 16, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...grayText);
  doc.text(companySettings?.companyName || 'Dirección de Administración y Finanzas', 49.5, footerY + 20, { align: 'center' });
  doc.text(invoice.agentName || 'Agente de Seguros', pageWidth - 49.5, footerY + 20, { align: 'center' });

  // Pie legal
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text('Este documento sirve como estado de liquidación de comisiones emitido por el sistema central.', 14, pageHeight - 6);
  doc.text(`Página 1 de 1 - ${invoice.folio}`, pageWidth - 14, pageHeight - 6, { align: 'right' });

  // Guardar PDF
  const cleanFolio = (invoice.folio || 'INVOICE').replace(/[^a-zA-Z0-9-_]/g, '_');
  doc.save(`${cleanFolio}_Liquidacion_Comisiones.pdf`);
};
