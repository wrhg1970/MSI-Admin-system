import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import { handleWooCommerceWebhook } from "./src/services/woocommerce";
import Stripe from "stripe";
import { doc, getDoc, updateDoc, addDoc, collection, setDoc, deleteDoc, getDocs } from "firebase/firestore";
import { db } from "./src/firebase";
import { triggerWhatsAppNotification } from "./src/services/whatsapp";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig.projectId
  });
}
const adminDb = getFirestore(undefined, firebaseConfig.firestoreDatabaseId);

const isAlreadyLoadedLocal = (insurance: any) => {
  if (!insurance) return true;
  if (!insurance.createdAt) return true;
  const createdDate = insurance.createdAt.toDate ? insurance.createdAt.toDate() : new Date(insurance.createdAt);
  const cutoffDate = new Date("2026-06-19T17:55:00Z");
  return createdDate < cutoffDate;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use larger limit for PDF attachments
  app.use(express.json({ limit: '50mb' }));

  // In-memory OTP storage (Email -> {code, expires})
  const otpStore = new Map<string, { code: string, expires: number }>();

  // API Route: Request OTP
  app.post("/api/auth/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requerido" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(email, { code, expires });

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[AUTH] OTP for ${email}: ${code}`);
      return res.status(200).json({ 
        success: true, 
        message: `En modo desarrollo. Código de acceso: ${code}`,
        devCode: code
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: `"Acceso MSI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: email,
        subject: "Tu Código de Acceso Temporal - MSI",
        text: `Tu código de acceso es: ${code}. Este código expirará en 10 minutos.`,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #1A2138; text-align: center;">Acceso al Sistema</h2>
            <p style="color: #666; text-align: center;">Usa el siguiente código para iniciar sesión en MSI Admin:</p>
            <div style="background: #f1f5f9; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; border-radius: 8px; letter-spacing: 5px; color: #3b82f6;">
              ${code}
            </div>
            <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 20px;">
              Este código expirará en 10 minutos. Si no solicitaste este código, ignora este mensaje.
            </p>
          </div>
        `
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error sending OTP:", error);
      res.status(500).json({ error: "No se pudo enviar el código de acceso" });
    }
  });

  // API Route: Verify OTP
  app.post("/api/auth/verify-otp", async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email y código requeridos" });

    const stored = otpStore.get(email);
    if (!stored) return res.status(400).json({ error: "No se encontró un código para este email" });

    if (Date.now() > stored.expires) {
      otpStore.delete(email);
      return res.status(400).json({ error: "El código ha expirado" });
    }

    if (stored.code !== code) {
      return res.status(400).json({ error: "Código incorrecto" });
    }

    // Success - clear OTP
    otpStore.delete(email);
    res.json({ success: true });
  });

  // API Route: Send Email
  app.post("/api/send-certificate", async (req, res) => {
    const { to, cc, bcc, subject, body, pdfs } = req.body;

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ 
        error: "Servicios de correo no configurados. Por favor contacte al administrador." 
      });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    try {
      if (!to || !Array.isArray(to) || to.length === 0) {
        return res.status(400).json({ error: "Destinatario no válido" });
      }

      const ccList = Array.isArray(cc) ? cc.filter((e: any) => e && typeof e === 'string' && e.trim() !== '') : [];
      const bccList = Array.isArray(bcc) ? bcc.filter((e: any) => e && typeof e === 'string' && e.trim() !== '') : [];

      await transporter.sendMail({
        from: `"Mi Seguro Internacional" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: to.filter((e: any) => e && typeof e === 'string' && e.trim() !== '').join(', '),
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
        subject: subject || 'Certificados de Seguro - Mi Seguro Internacional',
        text: body || 'Adjunto enviamos el certificado de tu seguro. Gracias por confiar en nosotros.',
        attachments: pdfs.map((pdf: any) => ({
          filename: pdf.filename,
          content: Buffer.from(pdf.data, 'base64'),
        })),
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      
      let clientError = "Fallo al enviar el correo";
      if (error.code === 'EAUTH') {
        clientError = "Error de autenticación: El usuario o contraseña de correo son incorrectos. Si usa Gmail, asegúrese de usar una 'Contraseña de Aplicación'.";
      } else if (error.code === 'ESOCKET') {
        clientError = "Error de conexión: No se pudo conectar al servidor de correo.";
      }

      const debugDetails = `${error.message || String(error)}${error.code ? ` (Code: ${error.code})` : ''}${error.command ? ` (Command: ${error.command})` : ''}`;
      res.status(500).json({ 
        error: clientError,
        details: debugDetails
      });
    }
  });

  // API Route: Send Test Notification Email
  app.post("/api/send-test-email", async (req, res) => {
    const { to, subject, body } = req.body;

    if (!to || !Array.isArray(to) || to.length === 0) {
      return res.status(400).json({ error: "Debe especificar al menos un destinatario de correo electrónico." });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[TEST EMAIL] Simulated send to ${to.join(', ')}:
Subject: ${subject}
Body:
${body}`);
      return res.status(200).json({ 
        success: true, 
        simulated: true,
        message: "Modo desarrollo: El correo de prueba se ha simulado con éxito en consola (SMTP no configurado)." 
      });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    try {
      await transporter.sendMail({
        from: `"Prueba de Configuración MSI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: to.join(', '),
        subject: `[PRUEBA] ${subject}`,
        text: body,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
            <div style="background-color: #3b82f6; padding: 15px; border-radius: 8px 8px 0 0; text-align: center; color: white;">
              <h2 style="margin: 0; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Correo de Prueba de Notificaciones</h2>
              <span style="font-size: 11px; opacity: 0.85;">Para verificar plantillas y configuración actual</span>
            </div>
            
            <div style="padding: 20px; color: #334155;">
              <p style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">Contenido de la Plantilla:</p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: #1e293b;">
                ${body.replace(/\n/g, '<br>')}
              </div>
            </div>

            <div style="padding: 10px 20px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 11px; color: #94a3b8;">
              <p style="margin: 4px 0;">Este es un correo automático de prueba generado desde el panel de administración.</p>
              <strong style="color: #3b82f6;">Mi Seguro Internacional</strong>
            </div>
          </div>
        `
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending test email:", error);
      
      let clientError = "Fallo al enviar el correo de prueba";
      if (error.code === 'EAUTH') {
        clientError = "Error de autenticación: El usuario o contraseña de correo son incorrectos.";
      } else if (error.code === 'ESOCKET') {
        clientError = "Error de conexión: No se pudo conectar al servidor de correo.";
      }

      const debugDetails = `${error.message || String(error)}${error.code ? ` (Code: ${error.code})` : ''}${error.command ? ` (Command: ${error.command})` : ''}`;
      res.status(500).json({ 
        error: clientError,
        details: debugDetails
      });
    }
  });

  // ===============================================================
  // WooCommerce Integration Proxy Endpoints
  // ===============================================================

  const getWooAuthHeader = (key: string, secret: string) => {
    const token = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
    return `Basic ${token}`;
  };

  const cleanUrl = (url: string) => {
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      clean = 'https://' + clean;
    }
    return clean.replace(/[\/]+$/, '');
  };

  app.post("/api/woocommerce/test", async (req, res) => {
    const { storeUrl, consumerKey, consumerSecret } = req.body;
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: "Faltan parámetros de conexión" });
    }
    const base = cleanUrl(storeUrl);
    const authHeader = getWooAuthHeader(consumerKey, consumerSecret);
    try {
      const response = await fetch(`${base}/wp-json/wc/v3?per_page=1`, {
        headers: {
          'Authorization': authHeader
        }
      });
      if (!response.ok) {
        let errMessage = `Error de WooCommerce: ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && errData.message) {
            errMessage = errData.message;
          }
        } catch (_) {}
        return res.status(400).json({ error: errMessage });
      }
      res.json({ success: true, message: "Conexión a WooCommerce establecida correctamente." });
    } catch (error: any) {
      console.error("WooCommerce Test Error:", error);
      res.status(500).json({ error: `No se pudo conectar a ${base}: ${error.message}` });
    }
  });

  app.post("/api/woocommerce/fetch-products", async (req, res) => {
    const { storeUrl, consumerKey, consumerSecret } = req.body;
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: "Faltan parámetros de conexión" });
    }
    const base = cleanUrl(storeUrl);
    const authHeader = getWooAuthHeader(consumerKey, consumerSecret);
    try {
      const response = await fetch(`${base}/wp-json/wc/v3/products?per_page=100`, {
        headers: {
          'Authorization': authHeader
        }
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Error de WooCommerce: ${response.statusText}` });
      }
      const products = await response.json();
      res.json({ success: true, products });
    } catch (error: any) {
      console.error("WooCommerce Products Fetch Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/woocommerce/fetch-orders", async (req, res) => {
    const { storeUrl, consumerKey, consumerSecret, status, startDate, endDate } = req.body;
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return res.status(400).json({ error: "Faltan parámetros de conexión" });
    }
    const base = cleanUrl(storeUrl);
    const authHeader = getWooAuthHeader(consumerKey, consumerSecret);
    
    // Construct query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('per_page', '100'); // fetch recent 100 orders
    if (status && status !== 'all') {
      queryParams.append('status', status);
    }
    if (startDate) {
      queryParams.append('after', startDate + 'T00:00:00');
    }
    if (endDate) {
      queryParams.append('before', endDate + 'T23:59:59');
    }
    
    try {
      const endpoint = `${base}/wp-json/wc/v3/orders?${queryParams.toString()}`;
      console.log(`[WOOCOMMERCE] Fetching orders from: ${endpoint}`);
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': authHeader
        }
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Error de WooCommerce: ${response.statusText}` });
      }
      const orders = await response.json();
      res.json({ success: true, orders });
    } catch (error: any) {
      console.error("WooCommerce Orders Fetch Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===============================================================
  // WooCommerce Real-time Webhook Receiver endpoint
  // ===============================================================
  app.post("/api/woocommerce/webhook", async (req, res) => {
    const topic = req.headers['x-wc-webhook-topic']; // webhook event type (e.g., order.created, order.updated)
    const orderPayload = req.body;
    
    console.log(`[WOO_WEBHOOK] Received Webhook Event Topic: ${topic}. Order ID: ${orderPayload?.id}`);

    // WooCommerce can send ping webhook on creation or non-order signals
    if (!orderPayload || !orderPayload.id) {
      console.log("[WOO_WEBHOOK] Empty or handshaking webhook received.");
      return res.status(200).json({ success: true, message: "Ping/Handshake acknowledged" });
    }

    try {
      const outcome = await handleWooCommerceWebhook(orderPayload);
      console.log(`[WOO_WEBHOOK] Sync outcome:`, outcome);
      return res.status(200).json(outcome);
    } catch (error: any) {
      console.error(`[WOO_WEBHOOK] System operational error processing webhook:`, error);
      // Return 200 so WooCommerce won't retry or trigger webhook failure counts
      return res.status(200).json({ 
        success: false, 
        error: error.message || "Fallo inesperado al procesar el webhook." 
      });
    }
  });

  // ===============================================================
  // CareMed Invoice AI Reading endpoint
  // ===============================================================
  app.post("/api/caremed/parse-invoice", async (req, res) => {
    const { fileData, fileName, fileType } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: "No se proporcionaron datos de archivo" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY no configurado. Usando fallback de extracción simulada...");
      const simulatedInvoice = "INV-" + Math.floor(100000 + Math.random() * 900000);
      const simulatedAmount = 1250.00;
      return res.json({
        success: true,
        simulated: true,
        invoiceNumber: simulatedInvoice,
        amount: simulatedAmount,
        notes: "Modo de simulación (GEMINI_API_KEY no configurado). Se generaron datos de ejemplo."
      });
    }

    try {
      const { GoogleGenAI, Type } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const filePart = {
        inlineData: {
          mimeType: fileType || "application/pdf",
          data: fileData
        }
      };

      const promptPart = {
        text: "Analyze this CareMed invoice document (PDF or image). Extract the main invoice reference or number (look for invoice ID, reference, invoice#, etc.), and extract the grand total amount to pay (usually in USD or EUR, return as a number). Provide a short notes summary."
      };

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: [filePart, promptPart] },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              invoiceNumber: {
                type: Type.STRING,
                description: "The extracted invoice ID/number (e.g., INV-1004). Keep clean, no extra text."
              },
              amount: {
                type: Type.NUMBER,
                description: "The grand total amount on the invoice as a decimal number. (e.g. 1500.50)"
              },
              notes: {
                type: Type.STRING,
                description: "A very brief explanation of what was extracted."
              }
            },
            required: ["invoiceNumber", "amount"]
          }
        }
      });

      const bodyText = response.text;
      if (!bodyText) {
        throw new Error("El modelo no devolvió ningún contenido");
      }

      const parsed = JSON.parse(bodyText.trim());
      res.json({
        success: true,
        invoiceNumber: parsed.invoiceNumber || "",
        amount: parsed.amount || 0,
        notes: parsed.notes || ""
      });

    } catch (error: any) {
      console.error("Error parsing invoice with Gemini:", error);
      res.status(500).json({
        error: "Fallo al procesar la factura con Gemini: " + error.message
      });
    }
  });

  // ===============================================================
  // Stripe Gateway integration
  // ===============================================================

  async function getStripeInstance() {
    let secretKey = process.env.STRIPE_SECRET_KEY;
    
    if (!secretKey) {
      try {
        const stripeSettingsDoc = await adminDb.collection('settings').doc('stripe').get();
        if (stripeSettingsDoc.exists) {
          secretKey = stripeSettingsDoc.data()?.secretKey;
        }
      } catch (e) {
        console.error("Error fetching stripe settings from Firestore:", e);
      }
    }

    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY no está configurado en las variables de entorno ni en la base de datos.");
    }

    return new Stripe(secretKey, {
      apiVersion: '2023-10-16' as any
    });
  }

  app.get("/api/stripe/config", async (req, res) => {
    let hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
    let publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";

    try {
      const stripeSettingsDoc = await adminDb.collection('settings').doc('stripe').get();
      if (stripeSettingsDoc.exists) {
        const data = stripeSettingsDoc.data();
        if (data?.secretKey) hasSecretKey = true;
        if (data?.publishableKey) publishableKey = data.publishableKey;
      }
    } catch (e) {}

    res.json({
      configured: hasSecretKey,
      publishableKey
    });
  });

  app.post("/api/stripe/create-payment-link", async (req, res) => {
    const { amount, currency, description, clientEmail, insuranceId, origin } = req.body;

    if (!amount || !currency || !insuranceId) {
      return res.status(400).json({ error: "Faltan parámetros requeridos: amount, currency, insuranceId" });
    }

    try {
      const stripe = await getStripeInstance();
      const cleanCurrency = currency.toUpperCase() === 'MXP' || currency.toUpperCase() === 'MXN' ? 'mxn' : 'usd';
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: cleanCurrency,
              product_data: {
                name: description || `Pago de Póliza de Seguro`,
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: clientEmail || undefined,
        success_url: `${origin || 'http://localhost:3000'}/?stripe_status=success&insuranceId=${insuranceId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin || 'http://localhost:3000'}/?stripe_status=cancel&insuranceId=${insuranceId}`,
        metadata: {
          insuranceId,
          description: description || `Pago de Póliza`,
          amount: String(amount),
          currency: currency.toUpperCase()
        }
      });

      res.json({ success: true, url: session.url });
    } catch (error: any) {
      console.error("Stripe Session Creation Error:", error);
      res.status(500).json({ error: error.message || "Error al crear la sesión de cobro con Stripe" });
    }
  });

  app.post("/api/stripe/send-payment-link-email", async (req, res) => {
    const { to, clientName, paymentUrl, amount, currency, description } = req.body;

    if (!to || !paymentUrl || !amount) {
      return res.status(400).json({ error: "Faltan parámetros para el envío del correo" });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[STRIPE EMAIL SIMULATION] To: ${to}, URL: ${paymentUrl}`);
      return res.json({ 
        success: true, 
        simulated: true,
        message: `Modo desarrollo: Enlace de pago simulado enviado a ${to}. Enlace: ${paymentUrl}`
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const currSymbol = currency === 'USD' ? 'USD' : 'MXN';

      await transporter.sendMail({
        from: `"Cobros - Mi Seguro Internacional" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: to,
        subject: `Liga de Cobro Segura - ${description || 'Pago de Póliza'}`,
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border: 1px solid #f1f5f9; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 25px;">
              <h2 style="color: #1e3a8a; font-size: 20px; margin: 0; font-weight: 800;">Liga de Pago Segura</h2>
              <p style="color: #64748b; font-size: 13px; margin-top: 5px;">Mi Seguro Internacional & Stripe</p>
            </div>
            <p style="font-size: 14px; color: #334155;">Hola <strong>${clientName || 'Cliente'}</strong>,</p>
            <p style="font-size: 14px; color: #334155; line-height: 1.5;">
              Se ha generado una liga de pago segura para cubrir el saldo pendiente de tu póliza de seguro. 
              Por favor, utiliza el siguiente enlace para realizar tu pago con tarjeta de crédito o débito de forma 100% segura.
            </p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin: 20px 0; text-align: center;">
              <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Monto a pagar</div>
              <div style="font-size: 24px; font-weight: 900; color: #2563eb;">$${parseFloat(amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${currSymbol}</div>
              <div style="font-size: 12px; color: #475569; margin-top: 5px;">${description || 'Concepto general'}</div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${paymentUrl}" target="_blank" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 14px; font-weight: bold; border-radius: 10px; display: inline-block; box-shadow: 0 4px 10px rgba(37,99,235,0.25);">
                Pagar con Tarjeta de Crédito/Débito
              </a>
            </div>

            <p style="font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5; margin-top: 30px; border-top: 1px solid #f1f5f9; padding-top: 20px;">
              Este enlace expira pronto. Al realizar el pago, el sistema registrará tu abono automáticamente y se te enviará tu recibo digital por esta misma vía.
            </p>
          </div>
        `
      });

      res.json({ success: true, message: "Enlace de pago enviado correctamente por correo electrónico." });
    } catch (error: any) {
      console.error("Error sending payment link email:", error);
      res.status(500).json({ error: "Fallo al enviar correo electrónico: " + error.message });
    }
  });

  app.post("/api/stripe/webhook", async (req, res) => {
    let event: any = req.body;
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && sig) {
      try {
        const stripe = await getStripeInstance();
        event = stripe.webhooks.constructEvent((req as any).rawBody || JSON.stringify(req.body), sig, webhookSecret);
      } catch (err: any) {
        console.warn(`[STRIPE_WEBHOOK] Signature verification failed: ${err.message}. Processing payload in development fallback mode.`);
      }
    } else {
      console.log(`[STRIPE_WEBHOOK] Processing payload directly (no verification).`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const metadata = session.metadata || {};
      const insuranceId = metadata.insuranceId;

      console.log(`[STRIPE_WEBHOOK] Session complete ID: ${session.id}, Insurance ID: ${insuranceId}`);

      if (insuranceId) {
        try {
          const insSnap = await adminDb.collection('insurances').doc(insuranceId).get();

          if (insSnap.exists) {
            const insurance = { id: insuranceId, ...insSnap.data() } as any;

            if (insurance.closed) {
              console.log(`[STRIPE_WEBHOOK] Policy is already closed. Skipping.`);
              return res.json({ received: true, message: "Póliza ya cerrada" });
            }

            const paymentAmount = parseFloat(metadata.amount || String(session.amount_total / 100));
            const paymentCurrency = metadata.currency || session.currency?.toUpperCase() || 'USD';
            
            let paymentExchangeRate = 17.5;
            let paymentAmountMXP = 0;
            if (paymentCurrency === 'MXP' || paymentCurrency === 'MXN') {
              paymentAmountMXP = paymentAmount;
            } else {
              paymentAmountMXP = paymentAmount * paymentExchangeRate;
            }

            const isNewIns = !isAlreadyLoadedLocal(insurance);
            let cardCommission = insurance.comision || 0;
            let finalTotalFinal = insurance.totalFinal !== undefined && insurance.totalFinal !== null
              ? insurance.totalFinal
              : (insurance.totalPrice || 0);

            let extraUp: any = {};

            if (isNewIns) {
              cardCommission = Math.round((insurance.totalPrice * 0.045) * 100) / 100;
              finalTotalFinal = Math.round((insurance.totalPrice - (insurance.discount || 0) - (insurance.adjustment || 0) + cardCommission) * 100) / 100;
              
              extraUp.comision = cardCommission;
              extraUp.totalFinal = finalTotalFinal;
            }

            const receiptNumber = `REC-STRIPE-${Math.floor(1000 + Math.random() * 9000)}`;
            const newTotalPaid = (insurance.totalPaid || 0) + paymentAmount;
            const status = newTotalPaid >= finalTotalFinal ? 'paid' : 'partially_paid';

            const newBalance = finalTotalFinal - newTotalPaid;
            const shouldClose = -5 < newBalance && newBalance < 5;

            const updateFields: any = { 
              status, 
              totalPaid: newTotalPaid,
              paymentMethod: 'Tarjeta Stripe',
              receiptNumber,
              paymentDate: new Date().toISOString().split('T')[0],
              depositAccount: 'Stripe Account',
              paymentCurrency,
              paymentExchangeRate,
              paymentAmountMXP,
              amountPaid: paymentAmount,
              ...extraUp 
            };

            if (shouldClose) {
              updateFields.closed = true;
            }

            await adminDb.collection('insurances').doc(insuranceId).update(updateFields);
            console.log(`[STRIPE_WEBHOOK] Updated insurance ${insuranceId} to ${status}. Total paid: ${newTotalPaid}`);

            // Trigger automatic WhatsApp notifications
            try {
              const fullInsObj = { ...insurance, id: insuranceId, status, totalPaid: newTotalPaid, ...updateFields };
              if (status === 'paid') {
                triggerWhatsAppNotification('estado_poliza', fullInsObj);
              } else if (status === 'partially_paid') {
                triggerWhatsAppNotification('recordatorio_pago', fullInsObj);
              }
            } catch (waErr) {
              console.error("[STRIPE_WEBHOOK] WhatsApp notify err:", waErr);
            }

            // Record payment in payments collection
            await adminDb.collection('payments').add({
              insuranceId: insuranceId,
              amount: paymentAmount,
              currency: paymentCurrency,
              exchangeRate: paymentExchangeRate,
              amountMXP: paymentAmountMXP,
              type: 'client_payment',
              paymentMethod: 'Tarjeta Stripe',
              depositAccount: 'Stripe Gateway',
              status: 'completed',
              date: new Date(),
              notes: `Pago en línea vía Stripe. Session ID: ${session.id}. Recibo: ${receiptNumber}`
            });

            console.log(`[STRIPE_WEBHOOK] Recorded payment for insurance ${insuranceId}.`);
          }
        } catch (dbErr: any) {
          console.error(`[STRIPE_WEBHOOK] DB update fail: ${dbErr.message}`);
          return res.status(500).json({ error: "Database error" });
        }
      }
    }

    res.json({ received: true });
  });

  // --- Automated Database Backup and Rotation system (Keeping last 5) ---
  const EXPORTABLE_COLLECTIONS_LIST = [
    'users', 'clients', 'insurances', 'policies', 'policyLetters', 'payments',
    'claims', 'claimActivities', 'insuranceActivities', 'notificationLogs',
    'insuranceTypes', 'actionTypes', 'paymentMethods', 'categories', 'subcategories',
    'providers', 'exchangeRates', 'countries'
  ];

  function serializeFirestoreObject(data: any): any {
    if (data === null || data === undefined) return '';
    if (typeof data === 'object' && data.seconds !== undefined && data.nanoseconds !== undefined) {
      try {
        const d = new Date(data.seconds * 1000);
        return d.toISOString();
      } catch (_) {
        return '';
      }
    }
    if (data instanceof Date) {
      return data.toISOString();
    }
    if (Array.isArray(data)) {
      return data.map(item => typeof item === 'object' ? serializeFirestoreObject(item) : item);
    }
    if (typeof data === 'object') {
      const cleanObj: any = {};
      for (const key of Object.keys(data)) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          const val = data[key];
          if (val === null || val === undefined) {
            cleanObj[key] = '';
          } else if (typeof val === 'object' && val.seconds !== undefined) {
            cleanObj[key] = serializeFirestoreObject(val);
          } else if (typeof val === 'object') {
            cleanObj[key] = serializeFirestoreObject(val);
          } else {
            cleanObj[key] = val;
          }
        }
      }
      return cleanObj;
    }
    return data;
  }

  async function runAutomaticBackup(triggeredBy: string) {
    console.log(`[BACKUP ENGINE] Initiating cloud backup requested by: ${triggeredBy}`);
    const backupData: Record<string, any[]> = {};
    const recordCounts: Record<string, number> = {};

    for (const colName of EXPORTABLE_COLLECTIONS_LIST) {
      try {
        const snap = await adminDb.collection(colName).get();
        backupData[colName] = snap.docs.map(doc => {
          const serialized = serializeFirestoreObject(doc.data());
          return {
            id: doc.id,
            ...serialized
          };
        });
        recordCounts[colName] = backupData[colName].length;
      } catch (err: any) {
        console.error(`[BACKUP ENGINE] Failed to query collection ${colName}:`, err);
      }
    }

    const backupDoc = {
      meta: {
        appId: "mi-seguro-internacional",
        version: "2.0-full-backup",
        exportedAt: new Date().toISOString(),
        exportedBy: triggeredBy,
        totalCollectionsCount: EXPORTABLE_COLLECTIONS_LIST.length,
        recordCounts: recordCounts
      },
      databaseJson: JSON.stringify(backupData)
    };

    const backupId = `backup_${Date.now()}`;
    await adminDb.collection("backups").doc(backupId).set(backupDoc);
    console.log(`[BACKUP ENGINE] Successfully stored backup document: ${backupId}`);

    // ROTATION LOGIC: Keep only last 5 backups
    try {
      const backupsSnap = await adminDb.collection("backups").get();
      const backupsList = backupsSnap.docs.map(d => ({
        id: d.id,
        exportedAt: d.data().meta?.exportedAt || ""
      }));

      // Sort chronological (oldest first)
      backupsList.sort((a, b) => a.exportedAt.localeCompare(b.exportedAt));

      if (backupsList.length > 5) {
        const toDelete = backupsList.slice(0, backupsList.length - 5);
        for (const oldBackup of toDelete) {
          await adminDb.collection("backups").doc(oldBackup.id).delete();
          console.log(`[BACKUP ENGINE] Rotated and deleted old backup: ${oldBackup.id}`);
        }
      }
    } catch (rotErr: any) {
      console.error("[BACKUP ENGINE] Error rotating older backups:", rotErr);
    }

    return backupDoc.meta;
  }

  // Scheduler interval to check and run automatic backups (Disabled on server due to environment-specific IAM database restrictions)
  setInterval(async () => {
    // Disabled server-side due to sandbox credential limitations. Backups are managed securely on the client-side.
  }, 24 * 60 * 60 * 1000);

  // --- Backup API Routes ---

  // Get list of all cloud backups (metadata only, no bulky JSON payloads)
  app.get("/api/backups", async (req, res) => {
    try {
      const snap = await adminDb.collection("backups").get();
      const list = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          meta: data.meta
        };
      });
      // Sort newest first
      list.sort((a, b) => (b.meta?.exportedAt || "").localeCompare(a.meta?.exportedAt || ""));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al obtener copias de seguridad" });
    }
  });

  // Get single backup full content (for download)
  app.get("/api/backups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const backupSnap = await adminDb.collection("backups").doc(id).get();
      if (!backupSnap.exists) {
        return res.status(404).json({ error: "Copia de seguridad no encontrada" });
      }
      const data = backupSnap.data()!;
      res.json({
        meta: data.meta,
        database: JSON.parse(data.databaseJson || "{}")
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al obtener detalles del backup" });
    }
  });

  // Manually trigger a backup saved to cloud
  app.post("/api/backups/run", async (req, res) => {
    try {
      const { triggeredBy } = req.body;
      const meta = await runAutomaticBackup(triggeredBy || "Administrador (Manual)");
      res.json({ success: true, meta });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al iniciar backup en la nube" });
    }
  });

  // Restore cloud backup
  app.post("/api/backups/restore/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const backupSnap = await adminDb.collection("backups").doc(id).get();
      if (!backupSnap.exists) {
        return res.status(404).json({ error: "Copia de seguridad no encontrada" });
      }
      const data = backupSnap.data()!;
      const database = JSON.parse(data.databaseJson || "{}");
      
      let restoredCount = 0;
      const collectionsToRestore = Object.keys(database);

      for (const colName of collectionsToRestore) {
        const docList = database[colName];
        if (!Array.isArray(docList)) continue;

        for (const docObj of docList) {
          const { id: docId, ...docData } = docObj;
          if (!docId) continue;

          const processedData = { ...docData };

          // Reconstruct Date fields if they are ISO strings
          for (const field of Object.keys(processedData)) {
            const val = processedData[field];
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(val)) {
              processedData[field] = new Date(val);
            }
          }

          await adminDb.collection(colName).doc(docId).set(processedData);
          restoredCount++;
        }
      }

      res.json({ 
        success: true, 
        message: `Base de datos restaurada con éxito. Se importaron ${restoredCount} documentos pertenecientes a ${collectionsToRestore.length} colecciones.`
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al restaurar base de datos" });
    }
  });

  // Delete a specific backup
  app.delete("/api/backups/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await adminDb.collection("backups").doc(id).delete();
      res.json({ success: true, message: "Copia de seguridad eliminada exitosamente." });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al eliminar backup" });
    }
  });

  // Get backup schedule configuration
  app.get("/api/backups/schedule", async (req, res) => {
    try {
      const scheduleSnap = await adminDb.collection("settings").doc("backup_schedule").get();
      if (scheduleSnap.exists) {
        res.json(scheduleSnap.data());
      } else {
        res.json({ enabled: false, frequency: "daily", lastBackupTime: null });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al cargar programación" });
    }
  });

  // Save/Update backup schedule configuration
  app.post("/api/backups/schedule", async (req, res) => {
    try {
      const { enabled, frequency } = req.body;
      const scheduleSnap = await adminDb.collection("settings").doc("backup_schedule").get();
      const currentData = scheduleSnap.exists ? scheduleSnap.data() : { lastBackupTime: null };
      
      const newSchedule = {
        enabled: !!enabled,
        frequency: frequency || "daily",
        lastBackupTime: currentData?.lastBackupTime || null
      };

      await adminDb.collection("settings").doc("backup_schedule").set(newSchedule);
      res.json({ success: true, schedule: newSchedule });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al guardar configuración" });
    }
  });

  // Global JSON error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Unhandled server error:", err);
    res.status(err.status || err.statusCode || 500).json({
      error: err.message || "Error interno del servidor",
      details: String(err)
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
