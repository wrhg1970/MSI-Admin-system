import { jsPDF } from 'jspdf';
import { drawVectorLogo } from '../lib/pdfGenerator';
import { format } from 'date-fns';

export interface LoadedLogoInfo {
  url: string;
  width: number;
  height: number;
}

export async function loadCompanyLogo(logoUrl?: string): Promise<LoadedLogoInfo | null> {
  if (!logoUrl) return null;
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
        return {
          url: canvas.toDataURL('image/png'),
          width: w,
          height: h
        };
      }
    }
  } catch (error) {
    console.warn('Error loading logo for report:', error);
  }
  return null;
}

export function drawReportHeader(
  pdfDoc: jsPDF,
  title: string,
  subtitle: string,
  loadedLogo: LoadedLogoInfo | null,
  isLandscape: boolean = false,
  extraMeta?: string
) {
  const pageMetrics = pdfDoc.internal.pageSize;
  const pageWidth = pageMetrics.width || (isLandscape ? 297 : 210);
  const margin = 14;

  // Draw Logo on top right
  if (loadedLogo) {
    const ratio = loadedLogo.width / loadedLogo.height;
    const maxHeight = 16;
    const maxWidth = 50;
    let renderWidth = maxHeight * ratio;
    let renderHeight = maxHeight;

    if (renderWidth > maxWidth) {
      renderWidth = maxWidth;
      renderHeight = maxWidth / ratio;
    }

    const x = pageWidth - margin - renderWidth;
    const y = 10;
    pdfDoc.addImage(loadedLogo.url, 'PNG', x, y, renderWidth, renderHeight);
  } else {
    const scale = 0.85;
    const x = pageWidth - margin - 50;
    const y = 12;
    drawVectorLogo(pdfDoc, x, y, scale, false);
  }

  // Draw Title and Subtitles
  pdfDoc.setFont('helvetica', 'bold');
  pdfDoc.setFontSize(18);
  pdfDoc.setTextColor(17, 24, 39); // Gray 900
  pdfDoc.text(title, margin, 18);

  pdfDoc.setFont('helvetica', 'normal');
  pdfDoc.setFontSize(10);
  pdfDoc.setTextColor(75, 85, 99); // Gray 600
  pdfDoc.text(subtitle, margin, 25);

  const metaText = extraMeta || `Generado el: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
  pdfDoc.setFontSize(8.5);
  pdfDoc.setTextColor(107, 114, 128); // Gray 500
  pdfDoc.text(metaText, margin, 31);

  // Divider line
  pdfDoc.setDrawColor(229, 231, 235); // Gray 200
  pdfDoc.setLineWidth(0.5);
  pdfDoc.line(margin, 35, pageWidth - margin, 35);
}

export function addReportFooters(pdfDoc: jsPDF, isLandscape: boolean = false) {
  const totalPages = (pdfDoc.internal as any).getNumberOfPages();
  const pageMetrics = pdfDoc.internal.pageSize;
  const pageWidth = pageMetrics.width || (isLandscape ? 297 : 210);
  const pageHeight = pageMetrics.height || (isLandscape ? 210 : 297);

  for (let i = 1; i <= totalPages; i++) {
    pdfDoc.setPage(i);
    pdfDoc.setFont('helvetica', 'normal');
    pdfDoc.setFontSize(8);
    pdfDoc.setTextColor(156, 163, 175); // Gray 400
    
    // Top separator on footer
    pdfDoc.setDrawColor(243, 244, 246);
    pdfDoc.setLineWidth(0.4);
    pdfDoc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

    pdfDoc.text(
      'Documento Confidencial - Sistema de Control y Administración',
      14,
      pageHeight - 6
    );

    const pageNumStr = `Página ${i} de ${totalPages}`;
    pdfDoc.text(pageNumStr, pageWidth - 14 - pdfDoc.getTextWidth(pageNumStr), pageHeight - 6);
  }
}
