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

interface WooCommerceConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  mappings: Record<string, string>;
  defaultStartDate: string;
  defaultDurationDays: number;
}

/**
 * Utility to extract details from Woo Order & Line Item meta_data arrays.
 */
function parseWooMetadata(order: any, lineItem: any, defaultConfig: WooCommerceConfig) {
  const combinedMetaData = [
    ...(order.meta_data || []),
    ...(lineItem.meta_data || [])
  ];

  let extractedStartDate = '';
  let extractedEndDate = '';
  let extractedBirthDate = '';
  let originCountry = '';
  let destinationCountry = '';
  let isExtreme = false;

  combinedMetaData.forEach((meta: any) => {
    const key = String(meta.key || '').toLowerCase();
    const val = String(meta.value || '').trim();

    if (key.includes('inicio') || key.includes('start_date') || key.includes('fecha_inicio')) {
      extractedStartDate = val.split(' ')[0];
    }
    if (key.includes('fin') || key.includes('end_date') || key.includes('fecha_fin')) {
      extractedEndDate = val.split(' ')[0];
    }
    if (key.includes('nacimiento') || key.includes('birth_date') || key.includes('fecha_nacimiento') || key.includes('birthdate')) {
      extractedBirthDate = val.split(' ')[0];
    }
    if (key.includes('origen') || key.includes('origin')) {
      originCountry = val;
    }
    if (key.includes('destino') || key.includes('destination')) {
      destinationCountry = val;
    }
    if (key.includes('extremo') || key.includes('extreme')) {
      isExtreme = val.toLowerCase() === 'yes' || val.toLowerCase() === 'si' || val === '1' || val.toLowerCase() === 'true';
    }
  });

  const isoDateReg = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateReg.test(extractedStartDate)) extractedStartDate = '';
  if (!isoDateReg.test(extractedEndDate)) extractedEndDate = '';
  if (!isoDateReg.test(extractedBirthDate)) extractedBirthDate = '';

  return {
    startDate: extractedStartDate || defaultConfig.defaultStartDate,
    endDate: extractedEndDate,
    birthDate: extractedBirthDate,
    originCountry: originCountry || order.billing?.country || 'MX',
    destinationCountry: destinationCountry || 'US',
    isExtreme
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

  // 3. Setup or fetch Client profile inside Firestore
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

    let clientBirthStr = metaDetails.birthDate || config.defaultStartDate;
    let calculatedAge = 30;
    try {
      const birthY = new Date(clientBirthStr).getFullYear();
      if (birthY > 1900) {
        calculatedAge = new Date().getFullYear() - birthY;
      }
    } catch (_) {}

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
      const newStatus = order.status === 'completed' ? 'paid' : 'pending';
      
      await updateDoc(doc(db, 'insurances', existingDoc.id), {
        status: newStatus,
        totalPrice: itemTotal || existingDoc.data().totalPrice,
        days: calculatedDays,
        startDate: startDateVal,
        endDate: endDateVal
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
        firstName: order.billing?.first_name || 'Woo',
        lastName: order.billing?.last_name || 'Customer',
        email: email,
        birthDate: clientBirthStr,
        age: calculatedAge,
        originCountry: metaDetails.originCountry,
        destinationCountry: metaDetails.destinationCountry,
        city: order.billing?.city || '',
        policyId: resolvedPolicy.id,
        plan: resolvedPolicy.plan,
        policyName: resolvedPolicy.name,
        actionType: 'NEW',
        isExtremeSports: metaDetails.isExtreme,
        startDate: startDateVal,
        endDate: endDateVal,
        days: calculatedDays,
        totalPrice: itemTotal || (resolvedPolicy.pricePerDay * calculatedDays),
        totalCost: calculatedTotalCost,
        status: order.status === 'completed' ? 'paid' : 'pending',
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
