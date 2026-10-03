import { 
  collection, 
  getDocs, 
  getDoc, 
  query, 
  where, 
  doc, 
  addDoc, 
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Policy, Client, InsuranceRequest } from '../types';

export interface WooCommerceConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  mappings: Record<string, string>;
  defaultStartDate: string;
  defaultDurationDays: number;
  autoSyncEnabled?: boolean;
  syncSchedules?: { time: string; enabled: boolean }[];
  webhookSecret?: string;
}

/**
 * Utility to parse Spanish/English dates into YYYY-MM-DD standard format.
 * Supports strings like "(mayo 6, 1994)", "6 de mayo de 1994", "(julio 3, 2026 - julio 5, 2026) 3", etc.
 */
export function parseSpanishDate(str: string): string {
  if (!str) return '';
  let s = str.trim().toLowerCase();
  
  // Remove wrapping parentheses and everything after a closing parenthesis (e.g. ") 3")
  s = s.replace(/\).*$/, ''); 
  s = s.replace(/^\s*\(\s*/, ''); 
  s = s.trim();
  
  // Replace " de " with space
  s = s.replace(/\s+de\s+/g, ' ');

  const monthMap: Record<string, string> = {
    enero: 'January',
    febrero: 'February',
    marzo: 'March',
    abril: 'April',
    mayo: 'May',
    junio: 'June',
    julio: 'July',
    agosto: 'August',
    septiembre: 'September',
    octubre: 'October',
    noviembre: 'November',
    diciembre: 'December'
  };

  Object.keys(monthMap).forEach(m => {
    s = s.replace(new RegExp(m, 'g'), monthMap[m]);
  });

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  // Fallback: regex for DD/MM/YYYY
  const dmY = s.match(/(\d{1,2})[\/\- ](\d{1,2})[\/\- ](\d{4})/);
  if (dmY) {
    const day = String(dmY[1]).padStart(2, '0');
    const month = String(dmY[2]).padStart(2, '0');
    const year = dmY[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback: regex for YYYY-MM-DD
  const Ymd = s.match(/(\d{4})[\/\- ](\d{1,2})[\/\- ](\d{1,2})/);
  if (Ymd) {
    const year = Ymd[1];
    const month = String(Ymd[2]).padStart(2, '0');
    const day = String(Ymd[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

/**
 * Helper to fetch a value from the calc_data object.
 * Checks for stable labels using keywords first, then falls back to precise field key IDs.
 */
export function getCalcValue(calcData: any, labelKeywords: string[], fallbackId: string): string {
  if (!calcData) return '';
  
  // 1. Try to find by matching label keywords (most stable across form edits)
  for (const fieldKey of Object.keys(calcData)) {
    const field = calcData[fieldKey];
    if (field && typeof field === 'object' && field.label) {
      const labelLower = String(field.label).toLowerCase();
      const match = labelKeywords.some(keyword => labelLower.includes(keyword.toLowerCase()));
      if (match && field.value !== undefined) {
        return String(field.value).trim();
      }
    }
  }

  // 2. Fallback to specific field key ID
  if (fallbackId && calcData[fallbackId] && calcData[fallbackId].value !== undefined) {
    return String(calcData[fallbackId].value).trim();
  }

  return '';
}

/**
 * Utility to extract details from Woo Order & Line Item meta_data arrays.
 * Handles the nested ccb_calculator structure and parses stable labels for high accuracy.
 */
export function parseWooMetadata(order: any, lineItem: any, defaultConfig: WooCommerceConfig) {
  const combinedMetaData = [
    ...(order.meta_data || []),
    ...(lineItem.meta_data || [])
  ];

  // Search for ccb_calculator within meta_data list
  let calcData: any = null;
  combinedMetaData.forEach((meta: any) => {
    const key = String(meta.key || '').toLowerCase();
    if (key === 'ccb_calculator' || key === '_ccb_calculator') {
      if (meta.value) {
        if (meta.value.calc_data) {
          calcData = meta.value.calc_data;
        } else if (typeof meta.value === 'string') {
          try {
            const parsedVal = JSON.parse(meta.value);
            if (parsedVal && parsedVal.calc_data) {
              calcData = parsedVal.calc_data;
            }
          } catch (_) {}
        }
      }
    }
  });

  let extractedStartDate = '';
  let extractedEndDate = '';
  let extractedBirthDate = '';
  let originCountry = '';
  let destinationCountry = '';
  let isExtreme = false;
  let insuredFirstName = '';
  let insuredLastName = '';
  let insuredEmail = '';
  let insuredPhone = '';
  let extractedAge: number | null = null;
  let city = '';

  if (calcData) {
    // Extract Insured's Name
    insuredFirstName = getCalcValue(calcData, ['nombre'], 'text_field_id_17');
    insuredLastName = getCalcValue(calcData, ['apellido'], 'text_field_id_18');
    
    // Extract email & phone
    insuredEmail = getCalcValue(calcData, ['correo', 'email'], 'text_field_id_20');
    insuredPhone = getCalcValue(calcData, ['teléfono', 'telefono', 'phone'], 'text_field_id_21');

    // Extract Birth Date
    const birthRaw = getCalcValue(calcData, ['nacimiento'], 'datePicker_field_id_19');
    if (birthRaw) {
      extractedBirthDate = parseSpanishDate(birthRaw);
    }

    // Extract Age
    const ageRaw = getCalcValue(calcData, ['edad'], 'quantity_field_id_8');
    if (ageRaw) {
      const match = ageRaw.match(/\d+/);
      if (match) {
        extractedAge = parseInt(match[0], 10);
      }
    }

    // Extract Travel Dates
    const travelDatesRaw = getCalcValue(calcData, ['fecha de viaje', 'fechas', 'viaje'], 'datePicker_field_id_4');
    if (travelDatesRaw) {
      const parts = travelDatesRaw.split(/[-–—]| a /);
      if (parts.length >= 2) {
        extractedStartDate = parseSpanishDate(parts[0]);
        extractedEndDate = parseSpanishDate(parts[1]);
      } else {
        extractedStartDate = parseSpanishDate(travelDatesRaw);
      }
    }

    // Extract Destination Country
    const destRaw = getCalcValue(calcData, ['país destino', 'pais destino', 'destino'], 'dropDown_field_id_16');
    if (destRaw) {
      destinationCountry = destRaw;
      const parentheticalMatch = destinationCountry.match(/\(([^)]+)\)/);
      if (parentheticalMatch) {
        destinationCountry = parentheticalMatch[1].trim();
      }
    }

    // Extract Destination City
    city = getCalcValue(calcData, ['ciudad destino', 'ciudad'], 'text_field_id_5');
  }

  // Fallbacks using standard flat meta keys if fields are still empty
  combinedMetaData.forEach((meta: any) => {
    const key = String(meta.key || '').toLowerCase();
    const val = String(meta.value || '').trim();

    if (!extractedStartDate && (key.includes('inicio') || key.includes('start_date') || key.includes('fecha_inicio'))) {
      extractedStartDate = val.split(' ')[0];
    }
    if (!extractedEndDate && (key.includes('fin') || key.includes('end_date') || key.includes('fecha_fin'))) {
      extractedEndDate = val.split(' ')[0];
    }
    if (!extractedBirthDate && (key.includes('nacimiento') || key.includes('birth_date') || key.includes('fecha_nacimiento') || key.includes('birthdate'))) {
      extractedBirthDate = val.split(' ')[0];
    }
    if (!originCountry && (key.includes('origen') || key.includes('origin'))) {
      originCountry = val;
    }
    if (!destinationCountry && (key.includes('destino') || key.includes('destination'))) {
      destinationCountry = val;
    }
    if (!isExtreme && (key.includes('extremo') || key.includes('extreme'))) {
      isExtreme = val.toLowerCase() === 'yes' || val.toLowerCase() === 'si' || val === '1' || val.toLowerCase() === 'true';
    }
  });

  // Strict ISO date format validation
  const isoDateReg = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateReg.test(extractedStartDate)) extractedStartDate = '';
  if (!isoDateReg.test(extractedEndDate)) extractedEndDate = '';
  if (!isoDateReg.test(extractedBirthDate)) extractedBirthDate = '';

  // Default parameters
  if (!extractedBirthDate) {
    extractedBirthDate = defaultConfig.defaultStartDate;
  }

  if (extractedAge === null && extractedBirthDate) {
    try {
      const birthY = new Date(extractedBirthDate).getFullYear();
      if (birthY > 1900) {
        extractedAge = new Date().getFullYear() - birthY;
      }
    } catch (_) {}
  }
  if (extractedAge === null) {
    extractedAge = 30;
  }

  return {
    startDate: extractedStartDate || defaultConfig.defaultStartDate,
    endDate: extractedEndDate,
    birthDate: extractedBirthDate,
    age: extractedAge,
    originCountry: originCountry || order.billing?.country || 'MX',
    destinationCountry: destinationCountry || 'US',
    city: city || order.billing?.city || '',
    isExtreme,
    insuredFirstName: insuredFirstName || order.billing?.first_name || 'Woo',
    insuredLastName: insuredLastName || order.billing?.last_name || 'Customer',
    insuredEmail: insuredEmail || order.billing?.email || '',
    insuredPhone: insuredPhone || order.billing?.phone || ''
  };
}

/**
 * Core handler to process incoming WooCommerce order webhook payloads.
 * Upserts clients, maps purchased products to correct policies, manages dates,
 * prevents duplicates, and updates status values securely.
 */
export async function handleWooCommerceWebhook(order: any) {
  if (!order || !order.id) {
    throw new Error("Payload de orden de WooCommerce inválido: falta ID");
  }

  const orderIdStr = String(order.id);
  const email = (order.billing?.email || '').trim().toLowerCase();
  
  if (!email) {
    return {
      success: false,
      message: `La orden Woo #${order.id} no contiene correo de facturación.`
    };
  }

  // 1. Retrieve the saved WooCommerce integration configuration
  const configDoc = await getDoc(doc(db, 'settings', 'woocommerce'));
  if (!configDoc.exists()) {
    return {
      success: false,
      message: "Configuración de integración con WooCommerce no inicializada."
    };
  }
  const config = configDoc.data() as WooCommerceConfig;

  // 2. Fetch all system active policies to resolve the mappings
  const policySnap = await getDocs(collection(db, 'policies'));
  const policiesList = policySnap.docs
    .map(d => ({ id: d.id, ...d.data() } as Policy))
    .filter(p => p.status !== 'archived');

  if (policiesList.length === 0) {
    return {
      success: false,
      message: "No se encontraron pólizas de seguro activas en la base de datos."
    };
  }

  // 3. Setup or fetch Client profile inside Firestore (represents buyer/billing info)
  const clientQuery = query(collection(db, 'clients'), where('email', '==', email));
  const clientSnap = await getDocs(clientQuery);
  let clientId = '';

  if (!clientSnap.empty) {
    clientId = clientSnap.docs[0].id;
  } else {
    // Create new client profile
    const newClient: Client = {
      type: 'Individual',
      firstName: order.billing?.first_name || 'Woo',
      lastName: order.billing?.last_name || 'Customer',
      email: email,
      phone: order.billing?.phone || '',
      address: order.billing?.address_1 || '',
      city: order.billing?.city || '',
      state: order.billing?.state || '',
      zip: order.billing?.postcode || '',
      country: order.billing?.country || 'MX',
      rfc: 'XAXX010101000',
      birthDate: config.defaultStartDate,
      createdAt: serverTimestamp()
    };
    const clientRef = await addDoc(collection(db, 'clients'), newClient);
    clientId = clientRef.id;
  }

  const results: any[] = [];

  // 4. Iterate over line items to handle insurance requests matching each product
  for (const item of (order.line_items || [])) {
    const itemPid = String(item.product_id);
    const mappedPolicyId = config.mappings[itemPid] || config.mappings[item.name];
    
    // Resolve which active product layout map to use (fallback to the first active policy if unmapped)
    const resolvedPolicy = policiesList.find(p => p.id === mappedPolicyId) || policiesList[0];
    
    const metaDetails = parseWooMetadata(order, item, config);
    const startDateVal = metaDetails.startDate;
    let endDateVal = metaDetails.endDate;

    if (!endDateVal) {
      const start = new Date(startDateVal);
      start.setDate(start.getDate() + (config.defaultDurationDays || 30));
      endDateVal = start.toISOString().split('T')[0];
    }

    const datesDiff = new Date(endDateVal).getTime() - new Date(startDateVal).getTime();
    const calculatedDays = Math.max(1, Math.ceil(datesDiff / (1000 * 60 * 60 * 24)));

    const itemTotal = parseFloat(String(item.total || 0));
    const dailyCost = resolvedPolicy.costPerDay || 1;
    const calculatedTotalCost = dailyCost * calculatedDays;

    const externalIdMark = `woocommerce_order_${orderIdStr}`;

    // 5. Query if we already have an imported insurance request for this Order Item
    const insuranceQuery = query(
      collection(db, 'insurances'), 
      where('externalId', '==', externalIdMark)
    );
    const insuranceSnap = await getDocs(insuranceQuery);

    if (!insuranceSnap.empty) {
      // Record already exists - perform update scenario (avoid creating duplicate profiles)
      const existingDoc = insuranceSnap.docs[0];
      const isOrderPaid = order.status === 'completed' || order.status === 'processing';
      const newStatus = isOrderPaid ? 'paid' : (existingDoc.data().status || 'pending');
      const resolvedPrice = itemTotal || existingDoc.data().totalFinal || existingDoc.data().totalPrice;
      
      await updateDoc(doc(db, 'insurances', existingDoc.id), {
        status: newStatus,
        totalPrice: resolvedPrice,
        totalFinal: resolvedPrice,
        totalPaid: isOrderPaid ? resolvedPrice : (existingDoc.data().totalPaid || 0),
        days: calculatedDays,
        startDate: startDateVal,
        endDate: endDateVal,
        firstName: metaDetails.insuredFirstName,
        lastName: metaDetails.insuredLastName,
        email: metaDetails.insuredEmail || email,
        birthDate: metaDetails.birthDate,
        age: metaDetails.age,
        originCountry: metaDetails.originCountry,
        destinationCountry: metaDetails.destinationCountry,
        city: metaDetails.city,
        isExtremeSports: metaDetails.isExtreme
      });

      // If transition to paid, record payments if none registered yet
      if (newStatus === 'paid') {
        const payQuery = query(
          collection(db, 'payments'), 
          where('receiptNumber', '==', `WOO-#${orderIdStr}`)
        );
        const paySnap = await getDocs(payQuery);
        if (paySnap.empty) {
          const paymentRecord = {
            insuranceId: existingDoc.id,
            amount: itemTotal || (resolvedPolicy.pricePerDay * calculatedDays),
            currency: 'USD',
            type: 'client_payment',
            status: 'completed',
            date: serverTimestamp(),
            notes: `Pago procesado vía Webhook para Pedido #${order.id}. Ref: ${item.name}`,
            receiptNumber: `WOO-#${orderIdStr}`
          };
          await addDoc(collection(db, 'payments'), paymentRecord);
        }
      }

      results.push({
        id: existingDoc.id,
        action: 'UPDATE',
        status: newStatus
      });
    } else {
      // First time importing this order item - create insurance log
      const insuranceRecord: InsuranceRequest = {
        clientType: 'Individual',
        clientId,
        firstName: metaDetails.insuredFirstName,
        lastName: metaDetails.insuredLastName,
        email: metaDetails.insuredEmail || email,
        birthDate: metaDetails.birthDate,
        age: metaDetails.age,
        originCountry: metaDetails.originCountry,
        destinationCountry: metaDetails.destinationCountry,
        city: metaDetails.city,
        policyId: resolvedPolicy.id,
        plan: resolvedPolicy.plan,
        policyName: resolvedPolicy.name,
        actionType: 'NEW',
        isExtremeSports: metaDetails.isExtreme,
        startDate: startDateVal,
        endDate: endDateVal,
        days: calculatedDays,
        totalPrice: itemTotal || (resolvedPolicy.pricePerDay * calculatedDays),
        totalFinal: itemTotal || (resolvedPolicy.pricePerDay * calculatedDays),
        totalCost: calculatedTotalCost,
        totalPaid: (order.status === 'completed' || order.status === 'processing') ? (itemTotal || (resolvedPolicy.pricePerDay * calculatedDays)) : 0,
        status: (order.status === 'completed' || order.status === 'processing') ? 'paid' : 'pending',
        imported: true,
        externalId: externalIdMark,
        createdAt: serverTimestamp()
      };

      const insRef = await addDoc(collection(db, 'insurances'), insuranceRecord);

      // Create Payment log if paid
      if (order.status === 'completed' || order.status === 'processing') {
        const paymentRecord = {
          insuranceId: insRef.id,
          amount: insuranceRecord.totalPrice,
          currency: 'USD',
          type: 'client_payment',
          status: 'completed',
          date: serverTimestamp(),
          notes: `Pago registrado vía Webhook para Pedido #${order.id}. Ref: ${item.name}`,
          receiptNumber: `WOO-#${orderIdStr}`
        };
        await addDoc(collection(db, 'payments'), paymentRecord);
      }

      results.push({
        id: insRef.id,
        action: 'CREATE',
        status: insuranceRecord.status
      });
    }
  }

  return {
    success: true,
    message: `Procesamiento completado para orden #${order.id}`,
    results
  };
}
