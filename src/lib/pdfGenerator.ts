import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { es, de, it, fr } from 'date-fns/locale';
import { InsuranceRequest, PolicyLetter, Policy } from '../types';
import { getPolicyNumber, findPolicyPrioritized, formatDisplayDate } from './policyUtils';
import { APP_LOGO, LOGO_LINK, COUNTRIES } from '../constants';
import { doc as firestoreDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export const drawVectorLogo = (doc: jsPDF, x: number, y: number, scale: number = 1.0, isDarkBg: boolean = false) => {
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
  let currentY = startY + 9; // Title space + padding
  const paddingX = 5;
  const innerWidth = contentWidth - (paddingX * 2);
  
  const parsedParas = paras.map(p => {
    const isHeading = p.length < 50 && (
      p.toLowerCase().includes('información') || 
      p.toLowerCase().includes('information') || 
      p.toLowerCase().includes('póliza') || 
      p.toLowerCase().includes('policy number')
    );
    doc.setFontSize(isHeading ? 9.2 : 8.8);
    const split = doc.splitTextToSize(p, innerWidth);
    return { text: p, split, isHeading };
  });

  // Calculate total height
  parsedParas.forEach((p, idx) => {
    const lineHeight = p.isHeading ? 4.0 : 3.4;
    const height = p.split.length * lineHeight;
    currentY += height;
    if (idx < parsedParas.length - 1) {
      currentY += p.isHeading ? 1.8 : 2.2; // Gap between paragraphs
    }
  });
  
  const cardHeight = (currentY + 4) - startY; // Add bottom padding

  // Background and border
  doc.setFillColor(...bgColor);
  doc.setDrawColor(...borderColor);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, startY, contentWidth, cardHeight, 2, 2, 'FD');

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.0);
  doc.setTextColor(...headerColor);
  doc.text(title, margin + paddingX, startY + 6.0);

  // Divider line
  doc.setDrawColor(...borderColor);
  doc.setLineWidth(0.2);
  doc.line(margin + paddingX, startY + 8.0, margin + contentWidth - paddingX, startY + 8.0);

  // Draw Paragraphs
  let textY = startY + 12;
  parsedParas.forEach((p) => {
    if (p.isHeading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.2);
      doc.setTextColor(30, 41, 59); // Slate-800
      doc.text(p.split, margin + paddingX, textY, { align: 'left' });
      textY += (p.split.length * 4.0) + 1.8;
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      doc.setTextColor(51, 65, 85); // Slate-700
      doc.text(p.split, margin + paddingX, textY, { align: 'left' });
      textY += (p.split.length * 3.4) + 2.2;
    }
  });

  return cardHeight;
};

/**
 * Helper to load logo image safely with dimension normalization and CORS fallback
 */
export const loadLogoData = async (logoSrc: string): Promise<{ url: string, width: number, height: number } | null> => {
  if (!logoSrc) return null;
  const isDataUrl = logoSrc.startsWith('data:image/');

  return new Promise((resolve) => {
    const img = new Image();
    if (!isDataUrl) {
      img.crossOrigin = "anonymous";
    }

    img.onload = () => {
      try {
        const maxDim = 600;
        let w = img.naturalWidth || img.width || 200;
        let h = img.naturalHeight || img.height || 60;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        if (isDataUrl) {
          resolve({ url: logoSrc, width: w, height: h });
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve({
            url: canvas.toDataURL('image/png'),
            width: w,
            height: h
          });
        } else {
          resolve({ url: logoSrc, width: w, height: h });
        }
      } catch (canvasErr) {
        console.warn("Canvas export warning in loadLogoData (using direct url):", canvasErr);
        resolve({ url: logoSrc, width: img.naturalWidth || 200, height: img.naturalHeight || 60 });
      }
    };

    img.onerror = () => {
      // If remote image failed with crossOrigin, try loading without crossOrigin
      if (!isDataUrl && img.crossOrigin) {
        const fallbackImg = new Image();
        fallbackImg.onload = () => {
          resolve({
            url: logoSrc,
            width: fallbackImg.naturalWidth || 200,
            height: fallbackImg.naturalHeight || 60
          });
        };
        fallbackImg.onerror = (e) => {
          console.error("Failed to load logo image even without CORS:", e);
          resolve(null);
        };
        fallbackImg.src = logoSrc;
      } else {
        resolve(null);
      }
    };

    img.src = logoSrc;
  });
};

export const generatePDF = async (
  insurance: InsuranceRequest,
  template?: PolicyLetter,
  policies: Policy[] = [],
  customLogo?: string,
  returnRaw: boolean = false,
  existingDoc?: jsPDF
) => {
  const doc = existingDoc || new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'letter'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - (margin * 2);
  const isCovidLetter = template?.language === 'covid';
  const isPolicyLetter = template?.language === 'policy';
  const isSpainLetter = template?.language === 'es_spain' || template?.language === 'embajada_spain';

  let firestoreCountries: any[] = [];
  try {
    const countriesSnap = await getDocs(collection(db, 'countries'));
    firestoreCountries = countriesSnap.docs.map(doc => doc.data());
  } catch (err) {
    console.error("Error fetching countries in pdfGenerator:", err);
  }

  const getCountryName = (code: string) => {
    if (!code) return '';
    const found = firestoreCountries.find((c: any) => c.code === code) || COUNTRIES.find(c => c.code === code);
    return found ? found.name : code;
  };

  // Find policy with robust prioritized matching
  const policy = findPolicyPrioritized(insurance.policyId, policies) || 
                 findPolicyPrioritized(insurance.policyNumber, policies) ||
                 findPolicyPrioritized(insurance.policyName, policies);
  
  const plan = insurance.plan || policy?.plan || insurance.policyId.split('-')[0];
  
  // 1. Company settings & Logo resolution from Firestore (Primary source of truth)
  let companySettings: any = {};
  try {
    const companySnap = await getDoc(firestoreDoc(db, 'settings', 'company'));
    if (companySnap.exists()) {
      companySettings = companySnap.data() || {};
    }
  } catch (err) {
    console.error("Error loading company settings in generatePDF:", err);
  }

  const effectiveLogo = (customLogo && customLogo.trim() !== '')
    ? customLogo
    : (companySettings.logoUrl || APP_LOGO);

  const directorSignatureData: string | null = companySettings.directorSignature || null;

  // Load Logo Data
  const logoData = await loadLogoData(effectiveLogo);

  if (logoData) {
    const ratio = logoData.width / logoData.height;
    const maxWidth = isPolicyLetter ? 38 : 46;
    const maxHeight = isPolicyLetter ? 12 : 18;
    let renderWidth = maxWidth;
    let renderHeight = maxWidth / ratio;
    
    if (renderHeight > maxHeight) {
      renderHeight = maxHeight;
      renderWidth = maxHeight * ratio;
    }
    const logoY = isPolicyLetter ? 6 : 9;
    doc.addImage(logoData.url, 'PNG', margin, logoY, renderWidth, renderHeight);
    
    // Add clickable link over the logo
    doc.link(margin, logoY, renderWidth, renderHeight, { url: LOGO_LINK });
  } else {
    // Beautiful vector logo fallback
    const logoY = isPolicyLetter ? 6 : 9;
    const scale = isPolicyLetter ? 0.7 : 0.85;
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
      .replace(/{pais}/gi, getCountryName(insurance.destinationCountry))
      .replace(/{country}/gi, getCountryName(insurance.destinationCountry))
      .replace(/{destino}/gi, getCountryName(insurance.destinationCountry))
      .replace(/{destination}/gi, getCountryName(insurance.destinationCountry))
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
      .replace(/{policy}/gi, insurance.policyNumber || getPolicyNumber(policy, insurance.age) || policy?.id || insurance.policyId)
      .replace(/{poliza}/gi, insurance.policyNumber || getPolicyNumber(policy, insurance.age) || policy?.id || insurance.policyId)
      .replace(/{plan}/gi, insurance.plan || '');
  } else if (!isPolicyLetter) {
    // Default fallback (Spanish)
    introText = `Por medio de la presente, certifico que ${insurance.firstName} ${insurance.lastName}. Fecha de Nacimiento: ${birthDateStr} adquirió un seguro internacional válido en todo el mundo excepto en su pais de residencia oficial, por el siguiente periodo de tiempo: ${insurance.days} Dias empezando el ${startDateStr} hasta ${endDateStr} durante su estancia en ${getCountryName(insurance.destinationCountry)}. En Europa, incluye todos los países Schengen.`;
  }

  if (isPolicyLetter) {
    // ---------------------------------------------------------
    // SPECIAL POLICY ID CARD / CONFIRMATION LAYOUT
    // ---------------------------------------------------------
    const policyNum = insurance.policyNumber || getPolicyNumber(policy, insurance.age) || policy?.id || insurance.policyId;
    const cardY = 20;
    const cardHeight = 48;
    const cardWidth = contentWidth / 2 - 2;

    // Left Card Background & Border
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.35);
    doc.roundedRect(margin, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Left Card Content
    let leftY = cardY + 3.5;
    const leftX = margin + 3.5;
    const leftInnerWidth = cardWidth - 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(29, 78, 216); // blue-700
    doc.text('GROUP SPONSOR: SETMEX', leftX, leftY);
    
    doc.setDrawColor(219, 234, 254); // light blue-100 divider
    doc.setLineWidth(0.2);
    doc.line(leftX, leftY + 1.2, leftX + leftInnerWidth, leftY + 1.2);
    
    leftY += 4.2;
    doc.setFontSize(8.8);
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text('Subscriber:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(`${insurance.lastName}, ${insurance.firstName}`, leftX + 18, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Group #:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text('0863971-021-00100', leftX + 18, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Member ID:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(policyNum, leftX + 18, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Dates:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(`${startDateStr} - ${endDateStr}`, leftX + 18, leftY);

    doc.setDrawColor(226, 232, 240);
    doc.line(leftX, leftY + 1.8, leftX + leftInnerWidth, leftY + 1.8);
    
    leftY += 4.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text('For Travellers in the United States:', leftX, leftY);
    
    doc.setFontSize(7.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.text('Aetna Provider Service:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.text('1-800-414-0596', leftX + 32, leftY);
    
    leftY += 3.2;
    doc.setFont('helvetica', 'bold');
    doc.text('Submit Claims to:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    const splitAetna = doc.splitTextToSize('Aetna, PO Box 981543, El Paso TX 79998-1543', leftInnerWidth - 25);
    doc.text(splitAetna, leftX + 24, leftY);
    
    leftY += 3.2 * splitAetna.length;
    doc.setFont('helvetica', 'bold');
    doc.text('Electronic Payer ID:', leftX, leftY);
    doc.setFont('helvetica', 'normal');
    doc.text('60054', leftX + 26, leftY);

    // Right Card Background & Border
    const rightCardX = margin + contentWidth / 2 + 2;
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.35);
    doc.roundedRect(rightCardX, cardY, cardWidth, cardHeight, 1.5, 1.5, 'FD');

    // Right Card Content
    let rightY = cardY + 3.5;
    const rightX = rightCardX + 3.5;
    const rightInnerWidth = cardWidth - 7;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.0);
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text('MEMBER & CONTACT INFO', rightX, rightY);
    
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text('Keep this card at all times', rightX + rightInnerWidth, rightY, { align: 'right' });
    
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(rightX, rightY + 1.2, rightX + rightInnerWidth, rightY + 1.2);
    
    rightY += 4.2;
    doc.setFontSize(8.2);
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text('Plan Policy #:', rightX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(policyNum, rightX + 18, rightY);
    
    rightY += 3.0;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.text('Underwritten by CUC, Administered by CareMed USA', rightX, rightY);
    
    rightY += 4.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text('Coverage & Claim Questions?', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    rightY += 3.0;
    doc.text('Contact CareMed USA: Phone +1 203 399 5130 | claimhelp@mycisi.com', rightX, rightY);
    
    doc.setDrawColor(226, 232, 240);
    doc.line(rightX, rightY + 1.5, rightX + rightInnerWidth, rightY + 1.5);

    rightY += 4.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(220, 38, 38); // Red-600
    doc.text('FOR EMERGENCIES (24/7/365) - Contact Team Assist', rightX, rightY);
    
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    rightY += 2.8;
    doc.text('(Inpatient or Emergency Care)', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    rightY += 3.0;
    const splitEmergency = doc.splitTextToSize('Call ON CALL INTERNATIONAL at +1 877 714 8179 (in US), +1 603 952 2660 (call collect from outside US). Email: mail@ONCALLINTERNATIONAL.COM', rightInnerWidth);
    doc.text(splitEmergency, rightX, rightY);
    
    rightY += 2.8 * splitEmergency.length + 0.8;
    doc.setDrawColor(226, 232, 240);
    doc.line(rightX, rightY, rightX + rightInnerWidth, rightY);
    
    rightY += 3.0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(21, 128, 61); // Green-700
    doc.text('Non-Life Threatening Care: Call-A-Doc is FREE', rightX, rightY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    rightY += 2.8;
    doc.text('You will be connected right away. Phone 925-732-4701', rightX, rightY);

    doc.setTextColor(0, 0, 0);
    
    // Insurance Confirmation section
    const confirmY = 70; 
    doc.setFillColor(29, 78, 216); // blue-700 primary banner
    doc.rect(margin, confirmY, contentWidth, 5.5, 'F');
    doc.setFontSize(10.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255); // White text
    doc.text('Insurance Confirmation', margin + 4, confirmY + 3.8); 
    
    const confirmTableY = confirmY + 11; 
    const footerTextY = confirmTableY + 19; 
    doc.setFontSize(7.8);
    const splitBlock = doc.splitTextToSize(introText, contentWidth - 8);
    const blockHeight = splitBlock.length * 2.8; 
    const boxPadding = 2.5; 
    const calculatedBoxHeight = (footerTextY + blockHeight + boxPadding) - (confirmY + 5.5);
 
    doc.setDrawColor(203, 213, 225); // Slate-300 elegant border
    doc.setLineWidth(0.35);
    doc.roundedRect(margin, confirmY + 5.5, contentWidth, calculatedBoxHeight, 1.5, 1.5, 'D');
    
    doc.setFontSize(9.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text('We hereby confirm that the person listed below is insured with CareMed®.', margin + 4, confirmY + 9.5); 
    
    const col1 = margin + 4;
    const col2 = margin + 35;
    const col3 = margin + 95;
    const col4 = margin + 145;
    
    // Horizontal row dividers for the confirmation table
    doc.setDrawColor(241, 245, 249); // slate-100 very elegant dividers
    doc.setLineWidth(0.25);
    for (let i = 0; i < 4; i++) {
      const lineY = confirmTableY + 1.0 + (i * 4.0);
      doc.line(margin + 4, lineY, margin + contentWidth - 4, lineY);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.text('Mr. / Ms:', col1, confirmTableY);
    doc.text('First name:', col1, confirmTableY + 4.0);
    doc.text('Last name:', col1, confirmTableY + 8.0);
    doc.text('Date of birth:', col1, confirmTableY + 12.0);
    doc.text('Policy number:', col1, confirmTableY + 16.0);
 
    doc.text('Start date of insurance:', col3, confirmTableY);
    doc.text('End date of insurance:', col3, confirmTableY + 4.0);
    doc.text('Home country:', col3, confirmTableY + 8.0);
    doc.text('Destination:', col3, confirmTableY + 12.0);
 
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42); // slate-900
    const genderStr = insurance.gender === 'F' ? 'Ms' : 'Mr';
    doc.text(genderStr, col2, confirmTableY);
    doc.text(insurance.firstName, col2, confirmTableY + 4.0);
    doc.text(insurance.lastName, col2, confirmTableY + 8.0);
    doc.text(birthDateStr, col2, confirmTableY + 12.0);
    doc.text(policyNum, col2, confirmTableY + 16.0);
 
    doc.text(startDateStr, col4, confirmTableY);
    doc.text(endDateStr, col4, confirmTableY + 4.0);
    doc.text(getCountryName(insurance.originCountry || 'MX'), col4, confirmTableY + 8.0);
    doc.text(getCountryName(insurance.destinationCountry), col4, confirmTableY + 12.0);
 
    // Separator line before the paragraph block
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.line(margin + 4, footerTextY - 2.0, margin + contentWidth - 4, footerTextY - 2.0);

    // Text block below table
    doc.setFontSize(8.0);
    doc.setTextColor(71, 85, 105); // slate-600
    doc.setLineHeightFactor(1.1);
    doc.text(splitBlock, margin + 4, footerTextY, { align: 'left', maxWidth: contentWidth - 8 });
 
    // Schedule of Benefits
    const benefitsHeaderY = confirmY + 5.5 + calculatedBoxHeight + 3.0; 
    doc.setFillColor(29, 78, 216); // blue-700 primary banner
    doc.rect(margin, benefitsHeaderY, contentWidth, 5.5, 'F');
    doc.setFontSize(10.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255); // White text
    doc.text('Schedule of Benefits', margin + 4, benefitsHeaderY + 3.8); 
    
    if (template?.benefits && template.benefits.length > 0) {
      const body = template.benefits.map(b => [b.label, b.value]);
      autoTable(doc, {
        startY: benefitsHeaderY + 6.0,
        margin: { left: margin, right: margin },
        pageBreak: 'avoid',
        styles: { 
          fontSize: 8.2, 
          cellPadding: 0.6,  
          minCellHeight: 2.5,
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
    // 1. Top Header Divider & Right Align Date/ID
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`${locationPrefix}${capitalizedDate}`, pageWidth - margin, 12, { align: 'right' });
    
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59); // slate-800
    doc.text(idStr, pageWidth - margin, 16.5, { align: 'right' });

    // Subtle header line separator
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.line(margin, 24.5, pageWidth - margin, 24.5);

    // 2. Letter Title (Centered, Navy Blue)
    const policyName = insurance.policyName || policy?.name || plan;
    doc.setFontSize(11.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(29, 78, 216); // blue-700
    const letterHeading = `${policyName.toUpperCase()} ${enrollmentCertificateLabel}`;
    doc.text(letterHeading, pageWidth / 2, 31, { align: 'center' });

    // 3. Salutation (Centered)
    let curY = 37;
    doc.setFontSize(10.0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    if (!isCovidLetter) {
      const salutation = template?.title || (sincerelyLabel === 'Sincerely,' ? 'To Whom It May Concern:' : 'A quien corresponda');
      doc.text(salutation, pageWidth / 2, curY, { align: 'center' });
      curY += 4.5;
      doc.text(presentLabel, pageWidth / 2, curY, { align: 'center' });
      curY += 6.5;
    }

    let benefitsY = 0;
    let footerSignOffName = '';
    let footerSignOffTitle = '';

    if (isCovidLetter) {
      const paragraphs = introText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
      const englishStartIndex = paragraphs.findIndex(p => p.toLowerCase().includes('this is to certify'));
      
      let covidY = 34; // Start Y for covid cards
      
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
          covidY,
          [191, 219, 254],
          [248, 250, 252],
          [29, 78, 216]
        );
        
        covidY += h1 + 4;
        
        // Draw English Card
        const h2 = drawCovidCard(
          doc,
          contentWidth,
          margin,
          'ENROLLMENT & COVERAGE CERTIFICATE (ENGLISH)',
          englishParas,
          covidY,
          [226, 232, 240],
          [248, 250, 252],
          [71, 85, 105]
        );
        covidY += h2;
      } else {
        const h1 = drawCovidCard(
          doc,
          contentWidth,
          margin,
          template?.title?.toUpperCase() || 'CERTIFICADO DE COBERTURA / COBERTURA COVID-19',
          paragraphs,
          covidY,
          [191, 219, 254],
          [248, 250, 252],
          [29, 78, 216]
        );
        covidY += h1;
      }
      benefitsY = covidY + 4;
    } else {
      // 4. Intro Paragraph
      doc.setFontSize(10.0);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.setLineHeightFactor(1.15);

      if (isSpainLetter) {
        const paragraphs = introText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
        paragraphs.forEach((p, idx) => {
          const split = doc.splitTextToSize(p, contentWidth);
          doc.text(split, margin, curY, { align: 'left', maxWidth: contentWidth });
          const pH = split.length * 4.2;
          curY += pH + (idx < paragraphs.length - 1 ? 3 : 0);
        });
        curY += 4;
      } else {
        const splitIntro = doc.splitTextToSize(introText, contentWidth);
        doc.text(splitIntro, margin, curY, { align: 'justify', maxWidth: contentWidth });
        
        const introHeight = (splitIntro.length * 4.2);
        curY += introHeight + 4;
      }

      // 5. Plan & Policy Summary Box (Sleek Banner)
      const policyVal = insurance.policyNumber || getPolicyNumber(policy, insurance.age) || policy?.id || insurance.policyId;
      const summaryBoxY = curY;
      const summaryBoxHeight = 9.5;
      doc.setFillColor(248, 250, 252); // slate-50
      doc.setDrawColor(219, 234, 254); // blue-100
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, summaryBoxY, contentWidth, summaryBoxHeight, 1.5, 1.5, 'FD');

      // Left: Plan
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text('Plan: ', margin + 4, summaryBoxY + 6.2);
      const planLabelW = doc.getTextWidth('Plan: ');
      doc.setTextColor(29, 78, 216); // blue-700
      doc.text(`${policy?.name || plan}`, margin + 4 + planLabelW, summaryBoxY + 6.2);

      // Right: Policy Number
      const polTextVal = `${policyVal}`;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text(polTextVal, pageWidth - margin - 4, summaryBoxY + 6.2, { align: 'right' });
      const polValW = doc.getTextWidth(polTextVal);
      doc.setTextColor(71, 85, 105); // slate-600
      doc.text(`${policyNumLabel}: `, pageWidth - margin - 4 - polValW, summaryBoxY + 6.2, { align: 'right' });

      curY = summaryBoxY + summaryBoxHeight + 6;

      // 6. Benefits List (Categorized)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.0);
      doc.setTextColor(29, 78, 216); // blue-700
      doc.text(featuresLabel, margin, curY);
      
      doc.setDrawColor(219, 234, 254);
      doc.setLineWidth(0.3);
      doc.line(margin, curY + 2, pageWidth - margin, curY + 2);

      curY += 6.5;

      const benefitsList = template?.benefits || [];
      const benefitsCount = benefitsList.length;

      // Dynamic spacing calculation based on remaining space to fit strictly on 1 page
      const pageFooterLineY = pageHeight - 14;
      const sigHeightEstimate = directorSignatureData ? 22 : 16;
      const maxAllowedContentY = pageFooterLineY - sigHeightEstimate - 8;

      // Calculate legal text height estimate
      let customFooterText = '';
      if (template?.footer && template.footer !== 'UNDEFINED' && template.footer.trim() !== '') {
        const datesJoinWord = template.language === 'en' ? 'to' : (template.language === 'de' ? 'bis' : (template.language === 'it' ? 'al' : (template.language === 'fr' ? 'au' : 'hasta')));
        const processedFooter = template.footer
          .replace(/{nombre}/gi, clientName)
          .replace(/{name}/gi, clientName)
          .replace(/{fecha_nacimiento}/gi, birthDateStr)
          .replace(/{dob}/gi, birthDateStr)
          .replace(/{date_of_birth}/gi, birthDateStr)
          .replace(/{pais}/gi, getCountryName(insurance.destinationCountry))
          .replace(/{country}/gi, getCountryName(insurance.destinationCountry))
          .replace(/{destino}/gi, getCountryName(insurance.destinationCountry))
          .replace(/{destination}/gi, getCountryName(insurance.destinationCountry))
          .replace(/{fechas}/gi, `${startDateStr} ${datesJoinWord} ${endDateStr}`)
          .replace(/{dates}/gi, `${startDateStr} ${datesJoinWord} ${endDateStr}`)
          .replace(/{fecha_inicio}/gi, startDateStr)
          .replace(/{start_date}/gi, startDateStr)
          .replace(/{fecha_fin}/gi, endDateStr)
          .replace(/{end_date}/gi, endDateStr)
          .replace(/{dias}/gi, String(insurance.days || 0))
          .replace(/{days}/gi, String(insurance.days || 0))
          .replace(/{poliza}/gi, insurance.policyName || policy?.name || plan)
          .replace(/{policy}/gi, insurance.policyName || policy?.name || plan);

        const footerLines = processedFooter.split('\n');
        const signOffKeywords = ['atentamente', 'sincerely', 'cordialement', 'mit freundlichen', 'cordiali saluti'];
        let splitIndex = -1;
        for (let i = 0; i < footerLines.length; i++) {
          if (signOffKeywords.some(kw => footerLines[i].toLowerCase().includes(kw))) {
            splitIndex = i;
            break;
          }
        }
        if (splitIndex !== -1) {
          customFooterText = footerLines.slice(0, splitIndex).join('\n').trim();
          const signOffLines = footerLines.slice(splitIndex).map(l => l.trim()).filter(l => l !== '');
          if (signOffLines.length > 0) sincerelyLabel = signOffLines[0];
          if (signOffLines.length > 1) footerSignOffName = signOffLines[1];
          if (signOffLines.length > 2) footerSignOffTitle = signOffLines.slice(2).join('\n');
        } else {
          customFooterText = processedFooter.trim();
        }
      }

      const estimatedLegalHeight = customFooterText !== '' ? 20 : 38;
      const spaceForBenefits = maxAllowedContentY - curY - estimatedLegalHeight - 6;

      let bStep = 4.0;
      let titleStep = 4.8;
      let bFontSize = 9.0;

      if (benefitsCount > 0) {
        const rawStep = spaceForBenefits / benefitsCount;
        bStep = Math.min(4.8, Math.max(2.8, rawStep));
        titleStep = Math.min(5.4, Math.max(3.4, bStep + 0.8));
        bFontSize = bStep >= 4.0 ? 9.2 : (bStep >= 3.4 ? 8.5 : 8.0);
      }

      doc.setFontSize(bFontSize);

      if (benefitsCount > 0) {
        benefitsList.forEach((b) => {
          if (!b.value || b.value.trim() === '') {
            curY += 1.2;
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(29, 78, 216); // blue-700 category header
            doc.text(b.label, margin, curY);
            curY += titleStep;
          } else {
            doc.setFont('helvetica', b.isBold ? 'bold' : 'normal');
            doc.setTextColor(15, 23, 42); // slate-900
            
            // Label on left
            doc.text(b.label, margin, curY);
            
            // Value on right
            doc.setFont('helvetica', 'bold');
            doc.text(b.value, pageWidth - margin, curY, { align: 'right' });
            
            curY += bStep;
          }
        });
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(71, 85, 105);
        doc.text(genericCoverageLabel, margin, curY);
        curY += 5;
      }

      curY += 2;

      // 7. Legal Disclaimer & Contact / Deductible Block
      const hasNoDeductible = (policy && policy.deductible === false) ||
                              (policy && policy.CantidadDeducible === 0) ||
                              (policy && policy.name && policy.name.toLowerCase().includes('sin')) ||
                              (insurance.policyId && insurance.policyId.toLowerCase().includes('sin')) ||
                              (insurance.policyName && insurance.policyName.toLowerCase().includes('sin'));

      const deductibleValue = hasNoDeductible 
        ? 'US $ 0' 
        : (policy?.CantidadDeducible !== undefined ? `US $ ${policy.CantidadDeducible}` : 'US $ 100');

      if (customFooterText !== '') {
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        const splitCustomFooter = doc.splitTextToSize(customFooterText, contentWidth);
        splitCustomFooter.forEach((line: string) => {
          doc.text(line, margin, curY);
          curY += 3.4;
        });
      } else {
        const legalText = template?.language === 'en' 
          ? "It is the insured's responsibility to read to know the benefits, terms, conditions, limitations and exclusions of the policy they are acquiring. To obtain an electronic copy and more information about it, it is recommended to consult the website: http://www.misegurointernacional.com/sblock/www/web.php where you can consult the policy in detail."
          : (template?.language === 'de' 
            ? "Es liegt in der Verantwortung des Versicherten, die Leistungen, Bedingungen, Einschränkungen und Ausschlüsse der von ihm erworbenen Police zu lesen und zu kennen. Um eine elektronische Kopie und weitere Informationen zu erhalten, wird empfohlen, die Website zu besuchen: http://www.misegurointernacional.com/sblock/www/web.php, wo Sie die Police im Detail einsehen können."
            : (template?.language === 'it'
              ? "È responsabilità dell'assicurato leggere per conoscere benefici, termini, condizioni, limitazioni ed esclusioni della polizza che sta acquistando. Per ottenere una copia elettronica e maggiori informazioni al riguardo, si consiglia di consultare il sito internet: http://www.misegurointernacional.com/sblock/www/web.php dove è possible consultare la polizza in dettaglio."
              : (template?.language === 'fr'
                ? "Il est de la responsabilité de l'assuré de lire pour connaître les avantages, les termes, les conditions, les limitations et les exclusions de la police qu'il acquiert. Pour obtenir une copie électronique et plus d'informations à ce sujet, il est recommandé de consulter le site internet : http://www.misegurointernacional.com/sblock/www/web.php où vous pourrez consulter la police en detail."
                : "Es responsabilidad del asegurado leer para conocer los beneficios, términos, condiciones, limitaciones y exclusiones de la póliza que está adquiriendo. Para obtener una copia electrónica y mayor información de la misma se recomienda consultar la página de internet:\nhttp://www.misegurointernacional.com/sblock/www/web.php donde podrá consultar la póliza en detalle.")));
        
        doc.setFontSize(8.0);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139); // slate-500
        const splitLegal = doc.splitTextToSize(legalText, contentWidth);
        splitLegal.forEach((line: string) => {
          doc.text(line, margin, curY);
          curY += 3.2;
        });

        curY += 2;

        const infoRows = [
          [deductibleLabel, deductibleValue],
          [insuranceCompanyLabel, 'CAREMED & Cultural Insurance Services International'],
          [emergencyUSALabel, '+ 1 888 505 2774 gratuito desde EUA'],
          [emergencyGlobalLabel, '+ 1 743 244 2474 (Mundial, llamada a cobro revertido posible)'],
          [emailLabel, 'CISIAssist@robinassist.com']
        ];

        // Render info box
        const infoBoxY = curY;
        const infoBoxHeight = (infoRows.length * 4.0) + 3;
        doc.setFillColor(248, 250, 252); // slate-50
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, infoBoxY, contentWidth, infoBoxHeight, 1.5, 1.5, 'FD');

        let infoRowY = infoBoxY + 4.0;
        infoRows.forEach(([label, value]) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(71, 85, 105); // slate-600
          doc.text(`${label}:`, margin + 4, infoRowY);
          
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42); // slate-900
          doc.text(value, margin + 56, infoRowY);
          infoRowY += 4.0;
        });

        curY = infoBoxY + infoBoxHeight + 3;
      }
      benefitsY = curY;
    }

    // 8. Signature Placement (Dynamic Proportional Spacing)
    const neededSigHeight = directorSignatureData ? 20 : 14;
    const pageFooterY = pageHeight - 14;
    const maxSigY = pageFooterY - neededSigHeight - 2;
    
    // Proportional positioning: anchor cleanly below content with comfortable breathing space
    let sY = benefitsY + 6;
    if (sY > maxSigY) {
      sY = maxSigY;
    }

    doc.setFontSize(10.0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(sincerelyLabel, margin, sY);
    
    let signatureOffset = 0;
    if (directorSignatureData) {
      try {
        doc.addImage(directorSignatureData, 'PNG', margin, sY + 1.5, 38, 11);
        signatureOffset = 10;
      } catch (sigErr) {
        console.error("Error rendering signature image in PDF:", sigErr);
      }
    }
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.0);
    doc.setTextColor(15, 23, 42);
    doc.text(footerSignOffName || 'Lic. Renán E. Herrera Garza', margin, sY + 7 + signatureOffset);
    
    doc.setFontSize(8.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(footerSignOffTitle || directorLabel, margin, sY + 11 + signatureOffset);

    // 9. Page Footer
    const pFY = pageHeight - 10;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pFY - 4, pageWidth - margin, pFY - 4);
    doc.setFontSize(7.0);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text('Calzada San Pedro 217 local 23 Col. del Valle San Pedro Garza García, NL 66220', pageWidth / 2, pFY - 1, { align: 'center' });
    doc.text('Tel: 81 8335 2701 / 8002861010  www.misegurointernacional.com  info@misegurointernacional.com', pageWidth / 2, pFY + 2.5, { align: 'center' });
    
    if (returnRaw) return doc;
    doc.save(`Carta_Seguro_${insurance.firstName}_${insurance.lastName}_${template?.language || 'es'}.pdf`);
  }
};

export const generateMergedLettersPDF = async (
  insurance: InsuranceRequest,
  templates: (PolicyLetter | undefined)[],
  policies: Policy[] = [],
  customLogo?: string,
  returnRaw: boolean = true
) => {
  if (!templates || templates.length === 0) {
    return generatePDF(insurance, undefined, policies, customLogo, returnRaw);
  }

  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'letter'
  });

  for (let i = 0; i < templates.length; i++) {
    if (i > 0) {
      doc.addPage('letter', 'p');
    }
    await generatePDF(insurance, templates[i], policies, customLogo, true, doc);
  }

  if (returnRaw) return doc;
  doc.save(`Cartas_Seguro_Integradas_${insurance.firstName}_${insurance.lastName}.pdf`);
  return doc;
};

export const generateReceiptPDF = async (payment: any, insurance: any, customLogo?: string, customLogoDark?: string) => {
  const doc = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'letter'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // 1. Company settings & Logo resolution from Firestore
  let companySettings: any = {};
  try {
    const companySnap = await getDoc(firestoreDoc(db, 'settings', 'company'));
    if (companySnap.exists()) {
      companySettings = companySnap.data() || {};
    }
  } catch (err) {
    console.error("Error loading company settings in generateReceiptPDF:", err);
  }

  const effectiveLogo = customLogoDark || customLogo || companySettings.logoUrlDark || companySettings.logoUrl || APP_LOGO;
  const logoData = await loadLogoData(effectiveLogo);

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
  doc.text(`Fecha: ${formatDisplayDate(payment.date)}`, 120, 72);
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
