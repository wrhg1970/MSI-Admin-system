import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { es, de, it, fr } from 'date-fns/locale';
import { InsuranceRequest, PolicyLetter, Policy } from '../types';
import { APP_LOGO, LOGO_LINK } from '../constants';
import { doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

const drawVectorLogo = (doc: jsPDF, x: number, y: number, scale: number = 1.0, isDarkBg: boolean = false) => {
  const prevFontName = doc.getFont().fontName;
  const prevFontStyle = doc.getFont().fontStyle;
  const prevFontSize = doc.getFontSize();
  
  // Shield coordinates and dimensions
  const w = 14 * scale;
  const h = 14 * scale;
  
  // Draw outer shield body
  if (isDarkBg) {
    doc.setFillColor(255, 255, 255); // White shield for dark background
  } else {
    doc.setFillColor(26, 60, 114); // #1a3c72 (Dark blue)
  }
  doc.rect(x, y, w, 3 * scale, 'F');
  doc.triangle(
    x, y + 3 * scale,
    x + w, y + 3 * scale,
    x + w / 2, y + h,
    'F'
  );
  
  // Draw cyan accent inner shield
  doc.setFillColor(34, 186, 201); // #22bac9 (Teal/Cyan)
  doc.triangle(
    x + 1.5 * scale, y + 4 * scale,
    x + w - 1.5 * scale, y + 4 * scale,
    x + w / 2, y + h - 2 * scale,
    'F'
  );
  
  // Draw inner cutout
  if (isDarkBg) {
    doc.setFillColor(37, 99, 235); // matches header background (blue-600)
  } else {
    doc.setFillColor(255, 255, 255); // White core
  }
  doc.triangle(
    x + 3 * scale, y + 4.5 * scale,
    x + w - 3 * scale, y + 4.5 * scale,
    x + w / 2, y + h - 3.5 * scale,
    'F'
  );
  
  // Draw stylized 'S' ribbon inside
  doc.setFillColor(34, 186, 201); // #22bac9
  doc.rect(x + 4 * scale, y + 5 * scale, 6 * scale, 1.5 * scale, 'F');
  doc.rect(x + 4 * scale, y + 8 * scale, 6 * scale, 1.5 * scale, 'F');
  
  // Text next to shield
  const textX = x + w + 4 * scale;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14 * scale);
  if (isDarkBg) {
    doc.setTextColor(255, 255, 255); // White text
  } else {
    doc.setTextColor(26, 33, 56); // Deep navy #1a2138
  }
  doc.text('Mi Seguro', textX, y + 5.5 * scale);
  doc.text('Internacional', textX, y + 11.5 * scale);
  
  // Restore settings
  doc.setFont(prevFontName, prevFontStyle);
  doc.setFontSize(prevFontSize);
};

const drawCovidCard = (
  doc: jsPDF,
  contentWidth: number,
  margin: number,
  title: string,
  paras: string[],
  startY: number,
  borderColor: [number, number, number] = [191, 219, 254], // default blue-200 border
  bgColor: [number, number, number] = [248, 250, 252], // slate-50 bg
  headerColor: [number, number, number] = [29, 78, 216] // blue-700 header
) => {
  let currentY = startY + 12; // Title space + padding
  const paddingX = 6;
  const innerWidth = contentWidth - (paddingX * 2);
  
  const parsedParas = paras.map(p => {
    const isHeading = p.length < 50 && (
      p.toLowerCase().includes('información') || 
      p.toLowerCase().includes('information') || 
      p.toLowerCase().includes('póliza') || 
      p.toLowerCase().includes('policy number')
    );
    const split = doc.splitTextToSize(p, innerWidth);
    return { text: p, split, isHeading };
  });

  // Calculate total height
  parsedParas.forEach((p, idx) => {
    const lineHeight = p.isHeading ? 4.5 : 3.8;
    const height = p.split.length * lineHeight;
    currentY += height;
    if (idx < parsedParas.length - 1) {
      currentY += p.isHeading ? 2 : 4; // Gap between paragraphs
    }
  });
  
  const cardHeight = (currentY + 6) - startY; // Add bottom padding

  // Background and border
  doc.setFillColor(...bgColor);
  doc.setDrawColor(...borderColor);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, startY, contentWidth, cardHeight, 3, 3, 'FD');

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...headerColor);
  doc.text(title, margin + paddingX, startY + 7);

  // Divider line
  doc.setDrawColor(...borderColor);
  doc.setLineWidth(0.2);
  doc.line(margin + paddingX, startY + 10, margin + contentWidth - paddingX, startY + 10);

  // Draw Paragraphs
  let textY = startY + 15;
  parsedParas.forEach((p, idx) => {
    if (p.isHeading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59); // Slate-800
      doc.text(p.split, margin + paddingX, textY, { align: 'left' });
      textY += (p.split.length * 4.5) + 2;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85); // Slate-700
      doc.text(p.split, margin + paddingX, textY, { align: 'left' }); // Left alignment as requested
      textY += (p.split.length * 3.8) + 4;
    }
  });

  return cardHeight;
};

export const generatePDF = async (insurance: InsuranceRequest, template?: PolicyLetter, policies: Policy[] = [], customLogo?: string, returnRaw: boolean = false) => {
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'letter'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2);
  const isCovidLetter = template?.language === 'covid';
  const isPolicyLetter = template?.language === 'policy';

  // Find policy with robust matching
  const policy = policies.find(p => 
    p.id === insurance.policyId || 
    (p.CodigoPoliza && p.CodigoPoliza === insurance.policyId) ||
    p.name === insurance.policyId
  );
  
  const plan = insurance.plan || policy?.plan || insurance.policyId.split('-')[0];
  
  let logoData: { url: string, width: number, height: number } | null = null;

  // 1. Logo (Top Left)
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = customLogo || APP_LOGO;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = (e) => {
        console.error("Image load error:", e);
        reject(e);
      };
    });
    
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
      logoData = {
        url: canvas.toDataURL('image/png'),
        width: w,
        height: h
      };
    }
  } catch (error) {
    console.error('Error loading logo in generatePDF:', error);
  }

  let directorSignatureData: string | null = null;
  try {
    const companySnap = await getDoc(firestoreDoc(db, 'settings', 'company'));
    if (companySnap.exists()) {
      const companyData = companySnap.data() as any;
      if (companyData && companyData.directorSignature) {
        directorSignatureData = companyData.directorSignature;
      }
    }
  } catch (err) {
    console.error("Error loading company settings for signature:", err);
  }

  if (logoData) {
    const ratio = logoData.width / logoData.height;
    const maxWidth = isPolicyLetter ? 40 : 55;
    const maxHeight = isPolicyLetter ? 15 : 25;
    let renderWidth = maxWidth;
    let renderHeight = maxWidth / ratio;
    
    if (renderHeight > maxHeight) {
      renderHeight = maxHeight;
      renderWidth = maxHeight * ratio;
    }
    const logoY = isPolicyLetter ? 8 : 15;
    doc.addImage(logoData.url, 'PNG', margin, logoY, renderWidth, renderHeight);
    
    // Add clickable link over the logo
    doc.link(margin, logoY, renderWidth, renderHeight, { url: LOGO_LINK });
  } else {
    // Beautiful vector logo fallback
    const logoY = isPolicyLetter ? 8 : 15;
    const scale = isPolicyLetter ? 0.75 : 1.0;
    drawVectorLogo(doc, margin, logoY, scale);
  }

  // 2. Date and ID (Top Right)
  const today = new Date();
  
  let langLocale = es;
  let datePattern = "eeee, d 'de' MMMM 'de' yyyy";
  let locationPrefix = 'Monterrey, NL a ';
  let presentLabel = 'Presente';
  let policyNumLabel = 'El número de póliza es';
  let featuresLabel = 'Características y detalle del Seguro Internacional CareMed:';
  let genericCoverageLabel = 'Los detalles de cobertura se especifican en los documentos de la póliza.';
  let deductibleLabel = 'Deducible';
  let insuranceCompanyLabel = 'Compañía de Seguros';
  let emergencyUSALabel = 'Centro de Emergencia USA/Canada';
  let emergencyGlobalLabel = 'Centro de Emergencia Mundial';
  let emailLabel = 'Correo Electrónico';
  let moreInfoLabel = 'Si necesita más información, por favor contacte nuestra oficina.';
  let sincerelyLabel = 'Atentamente,';
  let directorLabel = 'Director General';
  let enrollmentCertificateLabel = 'CERTIFICADO DE COBERTURA';

  if (template?.language === 'en') {
    langLocale = undefined as any;
    datePattern = "eeee, MMMM d, yyyy";
    locationPrefix = 'Monterrey, NL on ';
    presentLabel = 'Present';
    policyNumLabel = 'Policy number';
    featuresLabel = 'CareMed International Insurance Features & Details:';
    genericCoverageLabel = 'Coverage details specified in policy documents.';
    deductibleLabel = 'Deductible';
    insuranceCompanyLabel = 'Insurance Company';
    emergencyUSALabel = 'Emergency Center USA/Canada';
    emergencyGlobalLabel = 'Global Emergency Center';
    emailLabel = 'Email';
    moreInfoLabel = 'If you need more information, please contact our office.';
    sincerelyLabel = 'Sincerely,';
    directorLabel = 'General Director';
    enrollmentCertificateLabel = 'ENROLLMENT CERTIFICATE';
  } else if (template?.language === 'de') {
    langLocale = de;
    datePattern = "eeee, d. MMMM yyyy";
    locationPrefix = 'Monterrey, NL, ';
    presentLabel = 'Anwesend';
    policyNumLabel = 'Die Versicherungsnummer lautet';
    featuresLabel = 'CareMed International Insurance Merkmale & Details:';
    genericCoverageLabel = 'Einzelheiten zum Versicherungsschutz sind in den Versicherungsunterlagen aufgeführt.';
    deductibleLabel = 'Selbstbeteiligung';
    insuranceCompanyLabel = 'Versicherungsgesellschaft';
    emergencyUSALabel = 'Notrufzentrale USA/Kanada';
    emergencyGlobalLabel = 'Globale Notrufzentrale';
    emailLabel = 'E-Mail';
    moreInfoLabel = 'Wenn Sie weitere Informationen benötigen, kontaktieren Sie bitte unser Büro.';
    sincerelyLabel = 'Mit freundlichen Grüßen,';
    directorLabel = 'Generaldirektor';
    enrollmentCertificateLabel = 'VERSICHERUNGSBESCHEINIGUNG';
  } else if (template?.language === 'it') {
    langLocale = it;
    datePattern = "eeee d MMMM yyyy";
    locationPrefix = 'Monterrey, NL, ';
    presentLabel = 'Presente';
    policyNumLabel = 'Il numero di polizza è';
    featuresLabel = 'Caratteristiche e dettagli dell\'assicurazione internazionale CareMed:';
    genericCoverageLabel = 'I dettagli della copertura sono specificati nei documenti della polizza.';
    deductibleLabel = 'Franchigia';
    insuranceCompanyLabel = 'Compagnia di assicurazioni';
    emergencyUSALabel = 'Centro emergenze USA/Canada';
    emergencyGlobalLabel = 'Centro emergenze globale';
    emailLabel = 'E-mail';
    moreInfoLabel = 'Se avete bisogno di ulteriori informazioni, contattate il nostro ufficio.';
    sincerelyLabel = 'Cordiali saluti,';
    directorLabel = 'Direttore Generale';
    enrollmentCertificateLabel = 'CERTIFICATO DI COPERTURA';
  } else if (template?.language === 'fr') {
    langLocale = fr;
    datePattern = "eeee d MMMM yyyy";
    locationPrefix = 'Monterrey, NL, le ';
    presentLabel = 'Présent';
    policyNumLabel = 'Le numéro de police est';
    featuresLabel = 'Caractéristiques et détails de l\'assurance internationale CareMed :';
    genericCoverageLabel = 'Les détails de la couverture sont spécifiés dans les documents de la police.';
    deductibleLabel = 'Franchise';
    insuranceCompanyLabel = 'Compagnie d\'assurance';
    emergencyUSALabel = 'Centre d\'urgence USA/Canada';
    emergencyGlobalLabel = 'Centre d\'urgence mondial';
    emailLabel = 'E-mail';
    moreInfoLabel = 'Si vous avez besoin de plus d\'informations, veuillez contacter notre bureau.';
    sincerelyLabel = 'Cordialement,';
    directorLabel = 'Directeur Général';
    enrollmentCertificateLabel = 'CERTIFICAT D\'ASSURANCE';
  }

  const dateStr = format(today, datePattern, { locale: langLocale });
  const capitalizedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  
  const birthDateObj = parseISO(insurance.birthDate);
  const birthDateStr = format(birthDateObj, isPolicyLetter ? "dd/MMM/yy" : (template?.language === 'en' ? "MMMM d, yyyy" : (template?.language === 'de' ? "d. MMMM yyyy" : "d MMMM yyyy")), { locale: langLocale });
  
  const startDateObj = parseISO(insurance.startDate);
  const endDateObj = parseISO(insurance.endDate);
  const startDateStr = format(startDateObj, isPolicyLetter ? "dd/MMM/yy" : (template?.language === 'en' ? "MMMM d, yyyy" : (template?.language === 'de' ? "d. MMMM yyyy" : "d MMMM yyyy")), { locale: langLocale });
  const endDateStr = format(endDateObj, isPolicyLetter ? "dd/MMM/yy" : (template?.language === 'en' ? "MMMM d, yyyy" : (template?.language === 'de' ? "d. MMMM yyyy" : "d MMMM yyyy")), { locale: langLocale });

  const clientName = `${insurance.firstName} ${insurance.lastName}`;
  const idStr = `ID: ${format(new Date(), 'yyyyMMdd')}.${insurance.id?.slice(0, 8).toUpperCase()}`;

  // Pre-calculate intro text with replacements for all letter types
  let introText = '';
  if (template) {
    const datesJoinWord = template.language === 'en' ? 'to' : (template.language === 'de' ? 'bis' : (template.language === 'it' ? 'al' : (template.language === 'fr' ? 'au' : 'hasta')));
    introText = template.content
      .replace(/{nombre}/gi, clientName)
      .replace(/{name}/gi, clientName)
      .replace(/{fecha_nacimiento}/gi, birthDateStr)
      .replace(/{dob}/gi, birthDateStr)
      .replace(/{date_of_birth}/gi, birthDateStr)
      .replace(/{pais}/gi, insurance.destinationCountry)
      .replace(/{country}/gi, insurance.destinationCountry)
      .replace(/{destino}/gi, insurance.destinationCountry)
      .replace(/{destination}/gi, insurance.destinationCountry)
      .replace(/{fechas}/gi, `${startDateStr} ${datesJoinWord} ${endDateStr}`)
      .replace(/{dates}/gi, `${startDateStr} ${datesJoinWord} ${endDateStr}`)
      .replace(/{fecha_inicio}/gi, startDateStr)
      .replace(/{start_date}/gi, startDateStr)
      .replace(/{fecha_fin}/gi, endDateStr)
      .replace(/{end_date}/gi, endDateStr)
      .replace(/{dias}/gi, insurance.days.toString())
      .replace(/{days}/gi, insurance.days.toString())
      .replace(/{duracion}/gi, insurance.days.toString())
      .replace(/{duration}/gi, insurance.days.toString())
      .replace(/{policy}/gi, policy?.CodigoPoliza || insurance.policyId)
      .replace(/{poliza}/gi, policy?.CodigoPoliza || insurance.policyId)
      .replace(/{plan}/gi, insurance.plan || '');
  } else if (!isPolicyLetter) {
    // Default fallback (Spanish)
    introText = `Por medio de la presente, certifico que ${insurance.firstName} ${insurance.lastName}. Fecha de Nacimiento: ${birthDateStr} adquirió un seguro internacional válido en todo el mundo excepto en su pais de residencia oficial, por el siguiente periodo de tiempo: ${insurance.days} Dias empezando el ${startDateStr} hasta ${endDateStr} durante su estancia en ${insurance.destinationCountry}. En Europa, incluye todos los países Schengen.`;
  }

  if (isPolicyLetter) {
    // ---------------------------------------------------------
    // SPECIAL POLICY ID CARD / CONFIRMATION LAYOUT
    // ---------------------------------------------------------
    const policyNum = policy?.CodigoPoliza || insurance.policyId;
    const yOffset = 18; // Offset to accommodate logo at top left
    const cardY = 24;
    const cardHeight = 52;
    const cardWidth = contentWidth / 2 - 2; // 93

    // Left Card Background & Border
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.35);
    doc.roundedRect(margin, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Left Card Content
    let leftY = cardY + 4;
    const leftX = margin + 3.5;
    const leftInnerWidth = cardWidth - 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(29, 78, 216); // blue-700
    doc.text('GROUP SPONSOR: SETMEX', leftX, leftY);
    
    doc.setDrawColor(219, 234, 254); // light blue-100 divider
    doc.setLineWidth(0.2);
    doc.line(leftX, leftY + 1.5, leftX + leftInnerWidth, leftY + 1.5);
    
    leftY += 4.8;
    doc.setFontSize(7);
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text('Subscriber:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(`${insurance.lastName}, ${insurance.firstName}`, leftX + 16, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Group #:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text('0863971-021-00100', leftX + 16, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Member ID:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(policyNum, leftX + 16, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Dates:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(`${startDateStr} - ${endDateStr}`, leftX + 16, leftY);

    doc.setDrawColor(226, 232, 240);
    doc.line(leftX, leftY + 2.0, leftX + leftInnerWidth, leftY + 2.0);
    
    leftY += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text('For Travellers in the United States:', leftX, leftY);
    
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.text('Aetna Provider Service:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.text('1-800-414-0596', leftX + 27, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.text('Submit Claims to:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    const splitAetna = doc.splitTextToSize('Aetna, PO Box 981543, El Paso TX 79998-1543', leftInnerWidth - 21);
    doc.text(splitAetna, leftX + 20, leftY);
    
    leftY += 3.2 * splitAetna.length;
    doc.setFont('helvetica', 'bold');
    doc.text('Electronic Payer ID:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.text('60054', leftX + 22, leftY);

    // Right Card Background & Border
    const rightCardX = margin + contentWidth / 2 + 2; // 107
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.35);
    doc.roundedRect(rightCardX, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Right Card Content
    let rightY = cardY + 4;
    const rightX = rightCardX + 3.5;
    const rightInnerWidth = cardWidth - 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text('MEMBER & CONTACT INFO', rightX, rightY);
    
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('Keep this card at all times', rightX + rightInnerWidth, rightY, { align: 'right' });
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(rightX, rightY + 1.5, rightX + rightInnerWidth, rightY + 1.5);
    
    rightY += 4.8;
    doc.setFontSize(6.5);
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Plan Policy #:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(policyNum, rightX + 16, rightY);
    
    rightY += 3.2;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(6);
    doc.text('Underwritten by CUC, Administered by CareMed USA', rightX, rightY);
    
    rightY += 5.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text('Coverage & Claim Questions?', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    rightY += 3.2;
    doc.text('Contact CareMed USA: Phone +1 203 399 5130 | claimhelp@mycisi.com', rightX, rightY);
    
    doc.setDrawColor(226, 232, 240);
    doc.line(rightX, rightY + 2.0, rightX + rightInnerWidth, rightY + 2.0);

    rightY += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(220, 38, 38); // Red-600
    doc.text('FOR EMERGENCIES (24/7/365) - Contact Team Assist', rightX, rightY);
    
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);
    doc.setTextColor(100, 116, 139);
    rightY += 2.8;
    doc.text('(Inpatient or Emergency Care)', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    rightY += 3.2;
    const splitEmergency = doc.splitTextToSize('Call ON CALL INTERNATIONAL at +1 877 714 8179 (in US), +1 603 952 2660 (call collect from outside US). Email: mail@ONCALLINTERNATIONAL.COM', rightInnerWidth);
    doc.text(splitEmergency, rightX, rightY);
    
    rightY += 2.8 * splitEmergency.length + 1;
    doc.setDrawColor(226, 232, 240);
    doc.line(rightX, rightY, rightX + rightInnerWidth, rightY);
    
    rightY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(21, 128, 61); // Green-700
    doc.text('Non-Life Threatening Care: Call-A-Doc is FREE', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(71, 85, 105);
    rightY += 2.8;
    doc.text('You will be connected right away. Phone 925-732-4701', rightX, rightY);

    doc.setTextColor(0, 0, 0);
    
    // Insurance Confirmation section
    const confirmY = 78; 
    doc.setFillColor(29, 78, 216); // blue-700 primary banner
    doc.rect(margin, confirmY, contentWidth, 6.0, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255); // White text
    doc.text('Insurance Confirmation', margin + 4, confirmY + 4.2); 
    
    const confirmTableY = confirmY + 14; 
    const footerTextY = confirmTableY + 22; 
    doc.setFontSize(6);
    const splitBlock = doc.splitTextToSize(introText, contentWidth - 8);
    const blockHeight = splitBlock.length * 2.4; 
    const boxPadding = 3; 
    const calculatedBoxHeight = (footerTextY + blockHeight + boxPadding) - (confirmY + 6);
 
    doc.setDrawColor(203, 213, 225); // Slate-300 elegant border
    doc.setLineWidth(0.35);
    doc.roundedRect(margin, confirmY + 6, contentWidth, calculatedBoxHeight, 1.5, 1.5, 'D');
    
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('We hereby confirm that the person listed below is insured with CareMed®.', margin + 4, confirmY + 10.5); 
    
    const col1 = margin + 4;
    const col2 = margin + 35;
    const col3 = margin + 95;
    const col4 = margin + 145;
    
    // Horizontal row dividers for the confirmation table
    doc.setDrawColor(241, 245, 249); // slate-100 very elegant dividers
    doc.setLineWidth(0.25);
    for (let i = 0; i < 4; i++) {
      const lineY = confirmTableY + 1.2 + (i * 4.5);
      doc.line(margin + 4, lineY, margin + contentWidth - 4, lineY);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text('Mr. / Ms:', col1, confirmTableY);
    doc.text('First name:', col1, confirmTableY + 4.5);
    doc.text('Last name:', col1, confirmTableY + 9);
    doc.text('Date of birth:', col1, confirmTableY + 13.5);
    doc.text('Policy number:', col1, confirmTableY + 18);
 
    doc.text('Start date of insurance:', col3, confirmTableY);
    doc.text('End date of insurance:', col3, confirmTableY + 4.5);
    doc.text('Home country:', col3, confirmTableY + 9);
    doc.text('Destination:', col3, confirmTableY + 13.5);
 
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42); // slate-900
    const genderStr = insurance.gender === 'F' ? 'Ms' : 'Mr';
    doc.text(genderStr, col2, confirmTableY);
    doc.text(insurance.firstName, col2, confirmTableY + 4.5);
    doc.text(insurance.lastName, col2, confirmTableY + 9);
    doc.text(birthDateStr, col2, confirmTableY + 13.5);
    doc.text(policyNum, col2, confirmTableY + 18);
 
    doc.text(startDateStr, col4, confirmTableY);
    doc.text(endDateStr, col4, confirmTableY + 4.5);
    doc.text(insurance.originCountry || 'Mexico', col4, confirmTableY + 9);
    doc.text(insurance.destinationCountry, col4, confirmTableY + 13.5);
 
    // Separator line before the paragraph block
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.line(margin + 4, footerTextY - 2.5, margin + contentWidth - 4, footerTextY - 2.5);

    // Text block below table
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.setLineHeightFactor(1.15); // Elegant spacing
    doc.text(splitBlock, margin + 4, footerTextY, { align: 'left', maxWidth: contentWidth - 8 });
 
    // Schedule of Benefits
    const benefitsHeaderY = confirmY + 6 + calculatedBoxHeight + 3.5; 
    doc.setFillColor(29, 78, 216); // blue-700 primary banner
    doc.rect(margin, benefitsHeaderY, contentWidth, 6.0, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255); // White text
    doc.text('Schedule of Benefits', margin + 4, benefitsHeaderY + 4.2); 
    
    if (template?.benefits && template.benefits.length > 0) {
      const body = template.benefits.map(b => [b.label, b.value]);
      autoTable(doc, {
        startY: benefitsHeaderY + 7.0,
        margin: { left: margin, right: margin },
        styles: { 
          fontSize: 7.0, 
          cellPadding: 0.9, 
          minCellHeight: 3.2,
          textColor: [51, 65, 85], // slate-700
          lineColor: [241, 245, 249], // slate-100 table lines
          lineWidth: 0.1 
        },
        columnStyles: { 
          0: { cellWidth: contentWidth * 0.7 }, 
          1: { cellWidth: contentWidth * 0.3, halign: 'right', fontStyle: 'bold', textColor: [15, 23, 42] } 
        },
        body: body,
        theme: 'striped',
        alternateRowStyles: {
          fillColor: [248, 250, 252] // slate-50 subtle stripes
        },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const b = template.benefits[data.row.index];
            if (b.isBold) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = [15, 23, 42]; // slate-900
            }
            const shadedLabels = [
              'Travel Health Insurance (HA)',
              'Travel Accident Insurance (I)',
              'Travel Assistance (T)',
              'Travel Luggage Insurance (L)',
              'Travel Third Party Liability Insurance (3)'
            ];
            if (shadedLabels.some(s => b.label.includes(s))) {
              data.cell.styles.fillColor = [219, 234, 254]; // blue-100 highlight banner
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = [30, 58, 138]; // blue-900
            }
          }
        }
      });
    }
 
    if (returnRaw) return doc;
    doc.save(`Certificado_Policy_${insurance.firstName}_${insurance.lastName}.pdf`);
    return;
  }

  if (!isPolicyLetter) {
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`${locationPrefix}${capitalizedDate}`, pageWidth - margin, 18, { align: 'right' });
    
    // 2. Date and ID (Top Right)
    doc.setFont('helvetica', 'bold');
    doc.text(idStr, pageWidth - margin, 22, { align: 'right' });

    // 3. Letter Title (Centered)
    const policyName = insurance.policyName || policy?.name || plan;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    const letterHeading = `${policyName.toUpperCase()} ${enrollmentCertificateLabel}`;
    doc.text(letterHeading, pageWidth / 2, 35, { align: 'center' });
    doc.setTextColor(0, 0, 0);

    // 4. Salutation (Centered)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (!isCovidLetter) {
      const salutation = template?.title || (sincerelyLabel === 'Sincerely,' ? 'To Whom It May Concern:' : 'A quien corresponda');
      doc.text(salutation, pageWidth / 2, 44, { align: 'center' });
      doc.text(presentLabel, pageWidth / 2, 48, { align: 'center' });
    }

    let yAfterIntro = 58;

    if (isCovidLetter) {
      const paragraphs = introText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
      const englishStartIndex = paragraphs.findIndex(p => p.toLowerCase().includes('this is to certify'));
      
      let currentY = 44; // Start Y for covid cards
      
      if (englishStartIndex !== -1) {
        const spanishParas = paragraphs.slice(0, englishStartIndex);
        const englishParas = paragraphs.slice(englishStartIndex);
        
        // Draw Spanish Card
        const h1 = drawCovidCard(
          doc,
          contentWidth,
          margin,
          'CERTIFICADO DE COBERTURA (ESPAÑOL)',
          spanishParas,
          currentY,
          [191, 219, 254], // blue-200 border
          [248, 250, 252], // slate-50 bg
          [29, 78, 216]    // blue-700 header
        );
        
        currentY += h1 + 5; // Spacing between cards
        
        // Draw English Card
        drawCovidCard(
          doc,
          contentWidth,
          margin,
          'ENROLLMENT & COVERAGE CERTIFICATE (ENGLISH)',
          englishParas,
          currentY,
          [226, 232, 240], // gray-200 border
          [248, 250, 252], // slate-50 bg
          [71, 85, 105]     // slate-600 header
        );
      } else {
        // Render all in a single elegant card
        drawCovidCard(
          doc,
          contentWidth,
          margin,
          template?.title?.toUpperCase() || 'CERTIFICADO DE COBERTURA / COBERTURA COVID-19',
          paragraphs,
          currentY,
          [191, 219, 254],
          [248, 250, 252],
          [29, 78, 216]
        );
      }
    } else {
      // 5. Intro Paragraph
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const splitIntro = doc.splitTextToSize(introText, contentWidth);
      doc.text(splitIntro, margin, 58, { align: 'justify', maxWidth: contentWidth });
      
      // 6. Plan and Policy Number Line
      const introHeight = (splitIntro.length * 4);
      yAfterIntro = 58 + introHeight + 6;
    }
  
  if (!isCovidLetter) {
    doc.setFont('helvetica', 'bold');
    const planLabelLine = 'Plan';
    doc.text(`${planLabelLine} : ${policy?.name || plan}`, margin, yAfterIntro);
    doc.setFont('helvetica', 'normal');
    doc.text(`${policyNumLabel}: ${policy?.CodigoPoliza || insurance.policyId}`, pageWidth - margin, yAfterIntro, { align: 'right' });
    
    // 6. Benefits List (Categorized like in PDF)
    doc.setFont('helvetica', 'bold');
    doc.text(featuresLabel, margin, yAfterIntro + 10);
    
    let benefitsY = yAfterIntro + 15;
    doc.setFontSize(7.2);
    
    if (template?.benefits && template.benefits.length > 0) {
      template.benefits.forEach((b) => {
        // Don't overflow
        if (benefitsY > pageHeight - 85) return;
        
        if (b.isBold) doc.setFont('helvetica', 'bold');
        else doc.setFont('helvetica', 'normal');
        
        // If it's a category/title (no value)
        if (!b.value || b.value.trim() === '') {
          benefitsY += 2;
          doc.setFont('helvetica', 'bold');
          doc.text(b.label, margin, benefitsY);
          benefitsY += 4;
        } else {
          doc.text(b.label, margin, benefitsY);
          doc.text(b.value, pageWidth - margin, benefitsY, { align: 'right' });
          benefitsY += 3.5;
        }
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.text(genericCoverageLabel, margin, benefitsY);
      benefitsY += 5;
    }
  
    // 7. Legal and Contact Information (Replacing Dynamic Info and Table Footer)
    benefitsY += 4;
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  
  const legalText = template?.language === 'en' 
    ? "It is the insured's responsibility to read to know the benefits, terms, conditions, limitations and exclusions of the policy they are acquiring. To obtain an electronic copy and more information about it, it is recommended to consult the website: http://www.misegurointernacional.com/sblock/www/web.php where you can consult the policy in detail."
    : (template?.language === 'de' 
      ? "Es liegt in der Verantwortung des Versicherten, die Leistungen, Bedingungen, Einschränkungen und Ausschlüsse der von ihm erworbenen Police zu lesen und zu kennen. Um eine elektronische Kopie und weitere Informationen zu erhalten, wird empfohlen, die Website zu besuchen: http://www.misegurointernacional.com/sblock/www/web.php, wo Sie die Police im Detail einsehen können."
      : (template?.language === 'it'
        ? "È responsabilità dell'assicurato leggere per conoscere benefici, termini, condizioni, limitazioni ed esclusioni della polizza che sta acquistando. Per ottenere una copia elettronica e maggiori informazioni al riguardo, si consiglia di consultare il sito internet: http://www.misegurointernacional.com/sblock/www/web.php dove è possibile consultare la polizza in dettaglio."
        : (template?.language === 'fr'
          ? "Il est de la responsabilité de l'assuré de lire pour connaître les avantages, les termes, les conditions, les limitations et les exclusions de la police qu'il acquiert. Pour obtenir une copie électronique et plus d'informations à ce sujet, il est recommandé de consulter le site internet : http://www.misegurointernacional.com/sblock/www/web.php où vous pourrez consulter la police en détail."
          : "Es responsabilidad del asegurado leer para conocer los beneficios, términos, condiciones, limitaciones y exclusiones de la póliza que está adquiriendo. Para obtener una copia electrónica y mayor información de la misma se recomienda consultar la página de internet:\nhttp://www.misegurointernacional.com/sblock/www/web.php donde podrá consultar la póliza en detalle.")));
  
  const splitLegal = doc.splitTextToSize(legalText, contentWidth);
  doc.text(splitLegal, margin, benefitsY);
  benefitsY += (splitLegal.length * 3.5) + 3;

  const infoRows = [
    [deductibleLabel, insurance.policyId.includes('sin') ? 'US $ 0' : 'US $ 100'],
    [insuranceCompanyLabel, 'CAREMED & Cultural Insurance Services International'],
    [emergencyUSALabel, '+ 1 888 505 2774 gratuito desde EUA'],
    [emergencyGlobalLabel, '+ 1 743 244 2474 (Mundial, llamada a cobro revertido posible)'],
    [emailLabel, 'CISIAssist@robinassist.com']
  ];

  infoRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, margin, benefitsY);
    doc.setFont('helvetica', 'normal');
    doc.text(value, margin + 45, benefitsY);
    benefitsY += 3.5;
  });

  benefitsY += 3;
  doc.text(moreInfoLabel, margin, benefitsY);
  }

  // 9. Signature
  const sY = pageHeight - 40;
  doc.setFontSize(8.5);
  doc.text(sincerelyLabel, margin, sY);
  
  let signatureOffset = 0;
  if (directorSignatureData) {
    try {
      doc.addImage(directorSignatureData, 'PNG', margin, sY + 1, 40, 12);
      signatureOffset = 10;
    } catch (sigErr) {
      console.error("Error rendering signature image in PDF:", sigErr);
    }
  }
  
  doc.setFont('helvetica', 'bold');
  doc.text('Lic. Renán E. Herrera Garza', margin, sY + 10 + signatureOffset);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(directorLabel, margin, sY + 14 + signatureOffset);

  // 10. Page Footer
  const pFY = pageHeight - 12;
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, pFY - 6, pageWidth - margin, pFY - 6);
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Calzada San Pedro 217 local 23 Col. del Valle San Pedro Garza García, NL 66220', pageWidth / 2, pFY - 2, { align: 'center' });
  doc.text('Tel: 81 8335 2701 / 8002861010  www.misegurointernacional.com  info@misegurointernacional.com', pageWidth / 2, pFY + 2, { align: 'center' });
  
  if (returnRaw) return doc;
  doc.save(`Carta_Seguro_${insurance.firstName}_${insurance.lastName}_${template?.language || 'es'}.pdf`);
  }
};

export const generateReceiptPDF = async (payment: any, insurance: any, customLogo?: string, customLogoDark?: string) => {
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'letter'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // Load Logo
  let logoData = null;
  try {
    const img = new Image();
    // Use Dark background logo for the blue header if available, otherwise fallback to primary
    img.src = customLogoDark || customLogo || APP_LOGO;
    img.crossOrigin = "Anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
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
    ctx?.drawImage(img, 0, 0, w, h);
    logoData = {
      url: canvas.toDataURL('image/png'),
      width: w,
      height: h
    };
  } catch (e) {
    console.error("Error loading logo for receipt:", e);
  }

  // Header
  doc.setFillColor(37, 99, 235); // blue-600
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  if (logoData) {
    const ratio = logoData.width / logoData.height;
    const maxWidth = 45;
    const maxHeight = 25;
    
    let renderWidth = maxWidth;
    let renderHeight = maxWidth / ratio;
    
    if (renderHeight > maxHeight) {
      renderHeight = maxHeight;
      renderWidth = maxHeight * ratio;
    }

    doc.addImage(logoData.url, 'PNG', 20, (40 - renderHeight) / 2, renderWidth, renderHeight);
  } else {
    // Beautiful vector logo fallback on the blue header
    drawVectorLogo(doc, 20, 13, 0.9, true);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.text('RECIBO DE PAGO', pageWidth - 20, 25, { align: 'right' });
  
  // Client Info
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMACIÓN DEL CLIENTE', 20, 55);
  doc.setFont('helvetica', 'normal');
  doc.text(`Nombre: ${insurance.firstName} ${insurance.lastName}`, 20, 65);
  doc.text(`Email: ${insurance.email}`, 20, 72);
  doc.text(`Póliza: ${insurance.policyName || 'N/A'}`, 20, 79);
  
  // Receipt Info
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLES DEL RECIBO', 120, 55);
  doc.setFont('helvetica', 'normal');
  doc.text(`No. Recibo: ${payment.id?.substring(0, 8).toUpperCase()}`, 120, 65);
  doc.text(`Fecha: ${payment.date?.toDate ? format(payment.date.toDate(), 'dd/MM/yyyy') : format(new Date(payment.date), 'dd/MM/yyyy')}`, 120, 72);
  doc.text(`Método: ${payment.paymentMethod}`, 120, 79);
  
  // Payment Table
  autoTable(doc, {
    startY: 95,
    head: [['Descripción', 'Monto (USD)', 'Estado']],
    body: [
      [
        payment.type === 'client_payment' ? 'Cobro a Cliente' : 
        payment.type === 'agent_commission' ? 'Comisión Agente' : 'Pago a Proveedor',
        `$${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        payment.status.toUpperCase()
      ]
    ],
    headStyles: { fillColor: [37, 99, 235] },
    theme: 'grid'
  });
  
  // Totals
  const finalReceiptY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL PAGADO: $${payment.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, pageWidth - 20, finalReceiptY, { align: 'right' });
  
  if (payment.amountMXP) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Equivalente a: $${payment.amountMXP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXP`, pageWidth - 20, finalReceiptY + 7, { align: 'right' });
    doc.text(`(Tipo de Cambio: ${payment.exchangeRate?.toFixed(2)})`, pageWidth - 20, finalReceiptY + 12, { align: 'right' });
  }
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Gracias por su preferencia.', pageWidth / 2, pageHeight - 15, { align: 'center' });
  doc.text('Este documento es un comprobante de pago oficial.', pageWidth / 2, pageHeight - 10, { align: 'center' });
  
  doc.save(`Recibo_Pago_${payment.id?.substring(0, 8)}.pdf`);
};
