import { doc, getDoc, setDoc, addDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface WhatsAppTemplates {
  bienvenidaBody: string;
  bienvenidaActive: boolean;
  estadoBody: string;
  estadoActive: boolean;
  recordatorioBody: string;
  recordatorioActive: boolean;
  renovacionBody: string;
  renovacionActive: boolean;
}

export interface WhatsAppSettings {
  phoneId: string;
  businessAccountId: string;
  accessToken: string;
  templates: WhatsAppTemplates;
}

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplates = {
  bienvenidaBody: "¡Hola {nombre}! Bienvenido/a a MiSeguroInternacional. Estamos emocionados de tenerte con nosotros. Tu solicitud se ha registrado con éxito con estado: {estado}. Si tienes alguna pregunta, no dudes en contactarnos. ¡Tu tranquilidad es nuestra prioridad!",
  bienvenidaActive: true,
  estadoBody: "Hola {nombre}, te informamos sobre el estado de tu póliza {plan}: {estado}. Para más detalles, visita tu portal o contáctanos. #MiSeguroInternacional",
  estadoActive: true,
  recordatorioBody: "Recordatorio de Pago: Hola {nombre}, tu pago de la póliza {plan} vence el {fecha_vencimiento}. Puedes realizar tu pago aquí o contactarnos. ¡Evita interrupciones en tu cobertura! #PagoSeguro",
  recordatorioActive: true,
  renovacionBody: "¡Tu póliza {plan} está próxima a renovarse! Hola {nombre}, te recordamos que tu cobertura actual finaliza el {fecha_vencimiento}. Contáctanos para asegurar tu continuidad y conocer las mejores opciones. #RenuevaTuSeguro",
  renovacionActive: true,
};

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  phoneId: '',
  businessAccountId: '',
  accessToken: '',
  templates: DEFAULT_WHATSAPP_TEMPLATES,
};

// Clean and normalize phone number for Meta API format
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (!cleaned) return '';
  // Meta API expects country code without leading plus/zeros. 
  // If number does not start with a country code, or is 10 digits (common for Mexico without prefix), prefix with '52' for MX
  if (cleaned.length === 10) {
    cleaned = '52' + cleaned;
  }
  return cleaned;
}

// Personalize message text by replacing placeholders
export function personalizeWhatsAppMessage(template: string, insurance: any): string {
  if (!template) return '';
  const fullName = `${insurance.firstName || ''} ${insurance.lastName || ''}`.trim() || 'Asegurado';
  const plan = insurance.plan || insurance.policyName || 'Seguro';
  
  let statusText = 'Pendiente';
  if (insurance.status === 'paid') statusText = 'Pagada';
  else if (insurance.status === 'partially_paid') statusText = 'Parcialmente Pagada';
  else if (insurance.status === 'cancelled') statusText = 'Cancelada';
  else if (insurance.status === 'reviewed') statusText = 'Revisada';
  else if (insurance.status === 'issued') statusText = 'Emitida';

  const formatMoney = (val: number) => `$${(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  
  return template
    .replace(/{nombre}/g, fullName)
    .replace(/{plan}/g, plan)
    .replace(/{estado}/g, statusText)
    .replace(/{monto}/g, formatMoney(insurance.totalFinal || insurance.totalPrice || 0))
    .replace(/{pagado}/g, formatMoney(insurance.totalPaid || 0))
    .replace(/{fecha_vencimiento}/g, insurance.endDate || 'N/A');
}

// Fetch settings from Firestore
export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  try {
    const configDoc = await getDoc(doc(db, 'settings', 'whatsapp'));
    if (configDoc.exists()) {
      const data = configDoc.data();
      return {
        phoneId: data.phoneId || '',
        businessAccountId: data.businessAccountId || '',
        accessToken: data.accessToken || '',
        templates: {
          ...DEFAULT_WHATSAPP_TEMPLATES,
          ...(data.templates || {})
        }
      };
    }
  } catch (error) {
    console.error("Error reading WhatsApp settings:", error);
  }
  return DEFAULT_WHATSAPP_SETTINGS;
}

// Save settings to Firestore
export async function updateWhatsAppSettings(settings: WhatsAppSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'whatsapp'), settings, { merge: true });
}

// Trigger real/simulated notification
export async function triggerWhatsAppNotification(
  event: 'bienvenida' | 'estado_poliza' | 'recordatorio_pago' | 'renovacion',
  insurance: any
): Promise<{ success: boolean; message: string; payload?: any }> {
  try {
    // 1. Fetch settings
    const settings = await getWhatsAppSettings();
    if (!settings.phoneId || !settings.accessToken) {
      return {
        success: false,
        message: "WhatsApp Integration is not configured. Missing Phone ID or Access Token."
      };
    }

    // 2. Identify the active template
    const templateKeyMap = {
      bienvenida: { body: 'bienvenidaBody', active: 'bienvenidaActive' },
      estado_poliza: { body: 'estadoBody', active: 'estadoActive' },
      recordatorio_pago: { body: 'recordatorioBody', active: 'recordatorioActive' },
      renovacion: { body: 'renovacionBody', active: 'renovacionActive' },
    } as const;

    const keyConfig = templateKeyMap[event];
    if (!keyConfig) {
      return { success: false, message: `Unknown WhatsApp event type: ${event}` };
    }

    const { body, active } = keyConfig;
    const isActive = settings.templates[active as keyof WhatsAppTemplates] ?? false;
    const rawTemplate = settings.templates[body as keyof WhatsAppTemplates] as string;

    if (!isActive || !rawTemplate) {
      return {
        success: false,
        message: `Template for event '${event}' is inactive or empty.`
      };
    }

    // 3. Find phone number
    let recipientPhone = insurance.phone || '';
    if (!recipientPhone && insurance.clientId) {
      const clientDoc = await getDoc(doc(db, 'clients', insurance.clientId));
      if (clientDoc.exists()) {
        recipientPhone = clientDoc.data().phone || '';
      }
    }

    // Fallback search by email if still empty
    if (!recipientPhone && insurance.email) {
      const clientsQ = query(collection(db, 'clients'), where('email', '==', insurance.email));
      const clientsSnapshot = await getDocs(clientsQ);
      if (!clientsSnapshot.empty) {
        recipientPhone = clientsSnapshot.docs[0].data().phone || '';
      }
    }

    // Default testing number if totally empty
    if (!recipientPhone) {
      recipientPhone = '+52 81 8185 0121'; // Fallback to provided number for testing
    }

    const cleanedPhone = formatPhoneNumber(recipientPhone);
    if (!cleanedPhone) {
      return {
        success: false,
        message: "No phone number available on Client profile or Insurance record."
      };
    }

    // 4. Personalize template
    const personalizedMessage = personalizeWhatsAppMessage(rawTemplate, insurance);

    // 5. Send POST to Meta Cloud API
    const url = `https://graph.facebook.com/v17.0/${settings.phoneId}/messages`;
    
    const bodyPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleanedPhone,
      type: "text",
      text: {
        preview_url: false,
        body: personalizedMessage
      }
    };

    console.log(`Sending WhatsApp Request to ${url} for ${cleanedPhone}...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyPayload)
    });

    const isSuccess = response.ok;
    const responseData = await response.json().catch(() => ({}));

    // 6. Log Activity in insuranceActivities so it's super visible
    if (insurance.id) {
      await addDoc(collection(db, 'insuranceActivities'), {
        insuranceId: insurance.id,
        type: 'automatic',
        description: isSuccess 
          ? `WhatsApp enviado con éxito al número +${cleanedPhone} (Evento: ${event}). Mensaje: "${personalizedMessage}"`
          : `Fallo al enviar WhatsApp al número +${cleanedPhone} (Evento: ${event}). Código: ${response.status}. Detalle: ${JSON.stringify(responseData)}`,
        date: new Date(),
        createdBy: 'WhatsApp Integración'
      });
    }

    // Log Activity in notificationLogs
    await addDoc(collection(db, 'notificationLogs'), {
      recipient: recipientPhone,
      subject: `WhatsApp: ${event}`,
      status: isSuccess ? 'success' : 'failed',
      errorMessage: isSuccess ? '' : `Meta WhatsApp API error: ${JSON.stringify(responseData)}`,
      createdAt: new Date().toISOString(),
      triggerType: `whatsapp_${event}`,
      sentBy: 'WhatsApp Service'
    });

    return {
      success: isSuccess,
      message: isSuccess ? "Message sent successfully" : `API Error: ${response.status}`,
      payload: responseData
    };

  } catch (err: any) {
    console.error("WhatsApp integration error:", err);
    
    // Attempt logging error on insurance
    if (insurance && insurance.id) {
      try {
        await addDoc(collection(db, 'insuranceActivities'), {
          insuranceId: insurance.id,
          type: 'automatic',
          description: `Error del sistema enviando WhatsApp (Evento: ${event}): ${err.message || err}`,
          date: new Date(),
          createdBy: 'WhatsApp Integración'
        });
      } catch (logErr) {
        console.error("Error logging failure in activity log:", logErr);
      }
    }

    return {
      success: false,
      message: err.message || JSON.stringify(err)
    };
  }
}
