import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import JSZip from "jszip";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { handleWooCommerceWebhook } from "./src/services/woocommerce";
import Stripe from "stripe";
import { triggerWhatsAppNotification } from "./src/services/whatsapp";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const defaultApp = getApps().length === 0
  ? initializeApp({
      projectId: firebaseConfig.projectId
    })
  : getApps()[0];

const adminDb = getFirestore(defaultApp, firebaseConfig.firestoreDatabaseId || undefined);

const isAlreadyLoadedLocal = (insurance: any) => {
  if (!insurance) return true;
  if (!insurance.createdAt) return true;
  const createdDate = insurance.createdAt.toDate ? insurance.createdAt.toDate() : new Date(insurance.createdAt);
  const cutoffDate = new Date("2026-06-19T17:55:00Z");
  return createdDate < cutoffDate;
};

async function startServer() {
  const app = express();
  let portArg: number | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--port" && process.argv[i + 1]) {
      portArg = parseInt(process.argv[i + 1], 10);
      break;
    } else if (/^\d{4,5}$/.test(arg)) {
      portArg = parseInt(arg, 10);
      break;
    }
  }
  const PORT = portArg || parseInt(process.env.PORT || '3000', 10);

  // Use larger limit for PDF attachments and capture rawBody for webhook signature validation
  app.use(express.json({ 
    limit: '50mb',
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }));

  // In-memory OTP storage (Email -> {code, expires})
  const otpStore = new Map<string, { code: string, expires: number }>();

  // API Route: Request OTP
  app.post("/api/auth/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requerido" });

    const emailLower = email.trim().toLowerCase();
    const superAdmins = ['ventas@misegurointernacional.com', 'wrhg1970@gmail.com'];
    const isSuperAdmin = superAdmins.includes(emailLower);

    let userExists = isSuperAdmin;
    if (!userExists) {
      try {
        const userSnap = await adminDb.collection('users').where('email', '==', emailLower).get();
        if (!userSnap.empty) {
          userExists = true;
        }
      } catch (dbErr) {
        console.error("Error querying users collection for OTP request:", dbErr);
      }
    }

    if (!userExists) {
      return res.status(403).json({ error: "El correo electrónico no está registrado en el sistema. Solicite registro a un Administrador." });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(emailLower, { code, expires });

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[AUTH] OTP for ${emailLower}: ${code}`);
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

    const emailLower = email.trim().toLowerCase();
    const superAdmins = ['ventas@misegurointernacional.com', 'wrhg1970@gmail.com'];
    const isSuperAdmin = superAdmins.includes(emailLower);

    let userExists = isSuperAdmin;
    if (!userExists) {
      try {
        const userSnap = await adminDb.collection('users').where('email', '==', emailLower).get();
        if (!userSnap.empty) {
          userExists = true;
        }
      } catch (dbErr) {
        console.error("Error querying users collection for OTP verification:", dbErr);
      }
    }

    if (!userExists) {
      return res.status(403).json({ error: "El correo electrónico no está registrado en el sistema." });
    }

    const stored = otpStore.get(emailLower);
    if (!stored) return res.status(400).json({ error: "No se encontró un código para este email" });

    if (Date.now() > stored.expires) {
      otpStore.delete(emailLower);
      return res.status(400).json({ error: "El código ha expirado" });
    }

    if (stored.code !== code) {
      return res.status(400).json({ error: "Código incorrecto" });
    }

    // Success - clear OTP
    otpStore.delete(emailLower);
    res.json({ success: true });
  });

  // API Route: Send Email
  app.post("/api/send-certificate", async (req, res) => {
    const { to, cc, bcc, subject, body, html, pdfs, attachments } = req.body;

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ 
        error: "Servicios de correo no configurados. Por favor configure las credenciales SMTP_USER y SMTP_PASS." 
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
      // Robust recipient sanitization & extraction
      const cleanEmailList = (input: any): string[] => {
        if (!input) return [];
        const raw = Array.isArray(input) ? input : [input];
        const flat: string[] = [];
        raw.forEach((item: any) => {
          if (typeof item === 'string') {
            item.split(/[,;]/).forEach(e => {
              const cleaned = e.trim();
              if (cleaned && cleaned.includes('@')) {
                flat.push(cleaned);
              }
            });
          }
        });
        return Array.from(new Set(flat));
      };

      const toList = cleanEmailList(to);
      const ccList = cleanEmailList(cc);
      const bccList = cleanEmailList(bcc);

      if (toList.length === 0) {
        return res.status(400).json({ error: "Destinatario no válido. Verifique la dirección de correo." });
      }

      const rawAttachments = attachments || pdfs || [];
      const formattedAttachments = rawAttachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.data || att.content, 'base64'),
      }));

      const emailSubject = subject || 'Certificados de Seguro - Mi Seguro Internacional';
      const emailBody = body || 'Adjunto enviamos los documentos solicitados.';
      
      // Generate clean HTML layout if none provided to boost deliverability and avoid spam filters
      const emailHtml = html || `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc; color: #1e293b; }
            .container { max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 28px 24px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
            .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.9; }
            .content { padding: 28px 24px; font-size: 14px; line-height: 1.65; color: #334155; }
            .message-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 16px 0; white-space: pre-wrap; font-size: 14px; color: #1e293b; }
            .footer { padding: 20px 24px; background-color: #f1f5f9; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
            .footer a { color: #2563eb; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Mi Seguro Internacional</h1>
              <p>Protección y Asistencia Global en Viajes</p>
            </div>
            <div class="content">
              <div class="message-box">${emailBody.replace(/\n/g, '<br>')}</div>
              <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
                📎 <strong>Archivos adjuntos:</strong> Por favor revise el o los archivos PDF adjuntos a este mensaje con su certificado y detalles de póliza.
              </p>
            </div>
            <div class="footer">
              <p style="margin: 0 0 6px 0;"><strong>SETMEX S.A. de C.V. / Mi Seguro Internacional</strong></p>
              <p style="margin: 0;">Para dudas o aclaraciones responda directamente a este correo o contacte a su asesor de viajes.</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
      const replyToAddress = process.env.SMTP_REPLY_TO || fromAddress;

      const info = await transporter.sendMail({
        from: `"Mi Seguro Internacional" <${fromAddress}>`,
        replyTo: replyToAddress,
        to: toList.join(', '),
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
        bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
        subject: emailSubject,
        text: emailBody,
        html: emailHtml,
        attachments: formattedAttachments,
      });

      console.log(`[EMAIL DISPATCH] Sent to ${toList.join(', ')}. MessageId: ${info.messageId}`);
      res.json({ success: true, messageId: info.messageId });
    } catch (error: any) {
      console.error("Error sending email:", error);
      
      let clientError = "Fallo al enviar el correo";
      if (error.code === 'EAUTH') {
        clientError = "Error de autenticación: El usuario o contraseña de correo son incorrectos. Si usa Gmail, asegúrese de usar una 'Contraseña de Aplicación' de 16 caracteres.";
      } else if (error.code === 'ESOCKET') {
        clientError = "Error de conexión: No se pudo conectar al servidor de correo.";
      } else if (error.responseCode === 550 || error.responseCode === 553) {
        clientError = "Dirección de destinatario rechazada por el servidor de correo.";
      }

      const debugDetails = `${error.message || String(error)}${error.code ? ` (Code: ${error.code})` : ''}${error.response ? ` (Response: ${error.response})` : ''}`;
      res.status(500).json({ 
        error: clientError,
        details: debugDetails
      });
    }
  });

  // API Route: Test direct SMTP sending
  app.post("/api/smtp-test-send", async (req, res) => {
    const { to } = req.body;
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      return res.status(400).json({ error: "Debe proporcionar una dirección de correo válida para la prueba." });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ error: "SMTP no configurado en variables de entorno." });
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

      const now = new Date();
      const info = await transporter.sendMail({
        from: `"Prueba de Conexión MSI" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        replyTo: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: to.trim(),
        subject: `[DIAGNÓSTICO] Prueba de Envío de Correo MSI - ${now.toLocaleTimeString()}`,
        text: `Esta es una prueba de envío en vivo desde el servidor MSI para verificar que el servicio SMTP funciona correctamente. Fecha: ${now.toISOString()}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #cbd5e1; border-radius: 8px; max-width: 500px;">
            <h3 style="color: #1e3a8a; margin-top: 0;">Prueba de Diagnóstico SMTP Exitosa</h3>
            <p>Este correo confirma que el servidor de correo está correctamente autenticado y puede entregar mensajes sin problemas.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
            <p style="font-size: 12px; color: #64748b;">
              <strong>Host SMTP:</strong> ${process.env.SMTP_HOST || 'smtp.gmail.com'}<br>
              <strong>Remitente:</strong> ${process.env.SMTP_FROM || process.env.SMTP_USER}<br>
              <strong>Hora:</strong> ${now.toLocaleString()}
            </p>
          </div>
        `
      });

      res.json({ success: true, messageId: info.messageId, response: info.response });
    } catch (err: any) {
      console.error("[SMTP TEST ERROR]", err);
      res.status(500).json({ error: err.message || 'Fallo en la prueba de envío', details: err });
    }
  });

  // API Route: Check SMTP Configuration & Diagnostics
  app.get("/api/smtp-status", async (req, res) => {
    const isConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587');
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER ? `${process.env.SMTP_USER.slice(0, 3)}***@${process.env.SMTP_USER.split('@')[1] || ''}` : null;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || null;
    const passLength = process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0;

    if (!isConfigured) {
      return res.json({
        configured: false,
        verified: false,
        host,
        port,
        secure,
        user: null,
        from,
        passConfigured: false,
        message: "Las credenciales SMTP (SMTP_USER y SMTP_PASS) no están configuradas en las variables de entorno del servidor.",
        recommendations: [
          "Defina SMTP_USER con su dirección de correo (ej. ventas@misegurointernacional.com o cuenta de Gmail).",
          "Defina SMTP_PASS con la 'Contraseña de aplicación' de 16 caracteres de Google (App Password) generada en myaccount.google.com/apppasswords.",
          "Defina SMTP_FROM con el remitente deseado (ej. ventas@misegurointernacional.com)."
        ]
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.verify();

      return res.json({
        configured: true,
        verified: true,
        host,
        port,
        secure,
        user,
        from,
        passConfigured: true,
        passLength,
        message: "Conexión y autenticación con el servidor SMTP verificadas con éxito. El servicio de correo está listo para enviar."
      });
    } catch (error: any) {
      console.error("[SMTP DIAGNOSTICS] Verification failed:", error);
      let advice = "Verifique sus credenciales SMTP.";
      if (error.code === 'EAUTH') {
        advice = "Error de autenticación: Credenciales rechazadas por el proveedor. En Gmail debe tener verificación en 2 pasos activada y generar una 'Contraseña de Aplicación' de 16 caracteres.";
      } else if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
        advice = `Error de conexión con ${host}:${port}. Verifique si el puerto o host están bloqueados o use puerto 587 con secure=false.`;
      }

      return res.json({
        configured: true,
        verified: false,
        host,
        port,
        secure,
        user,
        from,
        passConfigured: true,
        error: error.message || String(error),
        code: error.code || null,
        advice
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
    const signature = req.headers['x-wc-webhook-signature'] as string;
    const orderPayload = req.body;
    
    console.log(`[WOO_WEBHOOK] Received Webhook Event Topic: ${topic}. Order ID: ${orderPayload?.id}`);

    // WooCommerce can send ping webhook on creation or non-order signals
    if (!orderPayload || !orderPayload.id) {
      console.log("[WOO_WEBHOOK] Empty or handshaking webhook received.");
      return res.status(200).json({ success: true, message: "Ping/Handshake acknowledged" });
    }

    try {
      // Fetch saved WooCommerce integration configuration from Firestore to retrieve webhookSecret
      const configDoc = await adminDb.collection('settings').doc('woocommerce').get();
      if (configDoc.exists) {
        const configData = configDoc.data();
        const secret = configData?.webhookSecret;
        if (secret && secret.trim() !== '') {
          // Calculate HMAC-SHA256 of the raw body
          const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
          const computedSignature = crypto
            .createHmac('sha256', secret.trim())
            .update(rawBody)
            .digest('base64');

          if (computedSignature !== signature) {
            console.error(`[WOO_WEBHOOK] Signature verification failed. Expected: ${computedSignature}, Received: ${signature}`);
            return res.status(401).json({ 
              success: false, 
              error: "Firma de webhook inválida. Acceso no autorizado." 
            });
          }
          console.log(`[WOO_WEBHOOK] Signature verified successfully.`);
        } else {
          console.log(`[WOO_WEBHOOK] Webhook secret not configured in Settings. Skipping validation (optional mode).`);
        }
      }
    } catch (error: any) {
      console.error(`[WOO_WEBHOOK] Error during signature validation:`, error);
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

  // Resilient Gemini generator with multiple fallback models, fast backoff, and instant model failover on 503/429 demand spikes
  async function generateWithFallback(ai: any, params: any, candidateModels = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.7-flash"]) {
    let lastError: any = null;
    
    for (const model of candidateModels) {
      // Fast attempts per model on 503 demand spikes before switching to next candidate model
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            ...params,
            model: model,
          });
          if (response && (response.text || response.candidates?.[0]?.content?.parts?.[0]?.text)) {
            return response;
          }
        } catch (err: any) {
          lastError = err;
          const errStr = String(err?.message || err);
          console.warn(`[Gemini Fallback] Model ${model} (attempt ${attempt + 1}) encountered error:`, errStr);
          
          // If model is not found (404), do not retry this model
          if (errStr.includes("404") || errStr.includes("NOT_FOUND")) {
            break;
          }

          // If quota exceeded or hard rate limit (429), switch immediately to next candidate model
          if (errStr.includes("429") || errStr.includes("RESOURCE_EXHAUSTED") || errStr.includes("Quota exceeded") || errStr.includes("quota")) {
            break;
          }

          // If 503 (high demand) or transient unavailable, pause briefly on attempt 0, then switch model on attempt 1
          if (errStr.includes("503") || errStr.includes("UNAVAILABLE") || errStr.includes("high demand")) {
            if (attempt === 0) {
              const backoffMs = 500 + Math.floor(Math.random() * 300);
              console.log(`[Gemini Retry] Model ${model} busy. Waiting ${backoffMs}ms before fast retry...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
              // Switch immediately to next model in candidateModels
              break;
            }
          } else {
            // Other errors: proceed to next candidate
            break;
          }
        }
      }
    }

    const lastErrMessage = lastError?.message || String(lastError || "");
    if (lastErrMessage.includes("429") || lastErrMessage.includes("RESOURCE_EXHAUSTED") || lastErrMessage.includes("Quota exceeded")) {
      throw new Error("Se ha alcanzado temporalmente el límite de cuota de IA. Por favor reintenta en unos instantes.");
    }
    if (lastErrMessage.includes("503") || lastErrMessage.includes("UNAVAILABLE") || lastErrMessage.includes("high demand")) {
      throw new Error("Los servidores de IA están experimentando alta demanda momentáneamente. Por favor reintenta en unos momentos.");
    }

    throw lastError || new Error("No se pudo obtener respuesta de ningún modelo de IA disponible.");
  }

  // ===============================================================
  // CareMed Invoices AI OCR parsing endpoint
  // ===============================================================
  app.post("/api/caremed/parse-invoice", async (req, res) => {
    try {
      const { fileData, fileName, fileType } = req.body || {};
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

      const response = await generateWithFallback(ai, {
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

      const bodyText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!bodyText) {
        throw new Error("El modelo no devolvió ningún contenido");
      }

      let cleaned = bodyText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      }

      const parsed = JSON.parse(cleaned);
      res.json({
        success: true,
        invoiceNumber: parsed.invoiceNumber || "",
        amount: parsed.amount || 0,
        notes: parsed.notes || ""
      });

    } catch (error: any) {
      console.error("Error parsing invoice with Gemini:", error);
      res.status(500).json({
        error: "Fallo al procesar la factura con Gemini: " + (error.message || String(error))
      });
    }
  });

  // ===============================================================
  // Bank Statement AI OCR parsing endpoint
  // ===============================================================
  app.post("/api/statement/parse-statement", async (req, res) => {
    try {
      const { fileData, fileName, fileType, currency } = req.body || {};
      if (!fileData) {
        return res.status(400).json({ error: "No se proporcionaron datos de archivo para el estado de cuenta" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("GEMINI_API_KEY no configurado en servidor. Generando datos de extracción...");
        const today = new Date().toISOString().split('T')[0];
        const sampleRecords = [
          { date: today, description: "DEPÓSITO TRANSFERENCIA SPEI / CLIENTE", amount: 1500.00, type: "income" },
          { date: today, description: "PAGO SERVICIOS Y COMISIÓN BANCARIA", amount: 120.50, type: "expense" },
          { date: today, description: "ABONO PRIMA DE SEGURO INTERNACIONAL", amount: 890.00, type: "income" }
        ];
        return res.json({
          success: true,
          records: sampleRecords,
          notes: "Modo simulado por ausencia de GEMINI_API_KEY."
        });
      }

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

      const isUSD = currency === 'USD';

      const promptPart = {
        text: `Extract ALL individual financial transaction lines from this bank account statement (Estado de Cuenta Bancario / Bank Statement) document (PDF or image).
${isUSD ? 'IMPORTANT: This is a US Dollar (USD / US$) account statement (e.g. US Banks like Chase, Bank of America, Wells Fargo, Citibank, Mercury, Wise, Stripe, or Mexican USD dollar accounts like Banorte USD, BBVA USD, Santander USD, Intercam USD).' : 'This is a Mexican Pesos (MXP / MXN) account statement.'}

EXTRACTION INSTRUCTIONS:
1. Transaction Classification:
   - 'income': All money deposits / additions / credits entering the account. Look for terms in English or Spanish: Deposits, Credits, Electronic Deposits, Wires In, ACH Credit, Direct Deposit, Mobile Check Deposit, Transfers Received, Depósitos, Abonos, Créditos, Intereses a favor, Dividendos, Reembolsos, Devolución.
   - 'expense': All money withdrawals / debits / charges leaving the account. Look for terms in English or Spanish: Withdrawals, Debits, Electronic Withdrawals, Checks Paid, Purchases, Debit Card / POS, Wires Out, ACH Debit, Bank Fees, Service Charge, Monthly Maintenance Fee, Cargos, Retiros, Egresos, Pagos a Proveedores, Comisiones, Cheques Cobrados, Transferencias enviadas.
2. The 'amount' field:
   - Must ALWAYS be a positive number greater than 0 (e.g. 1250.50).
   - Strip all dollar/currency signs ($), commas (,), or negative signs (-).
3. The 'date' field:
   - Must be formatted as YYYY-MM-DD (e.g. 2026-08-15).
   - For US bank statements with MM/DD/YYYY or MM/DD, convert accurately to YYYY-MM-DD.
   - For Latin American bank statements with DD/MM/YYYY or DD/MM, convert accurately to YYYY-MM-DD.
   - Infer the year from the statement header or statement date period if missing on individual lines.
4. The 'description' field:
   - Clean, concise text with the merchant name, beneficiary, or movement description.
5. EXCLUSION:
   - DO NOT include summary rows or balances (e.g. "Beginning balance", "Ending balance", "Total deposits", "Total withdrawals", "Saldo anterior", "Saldo actual", "Total abonos", "Total cargos"). Only extract individual line item transactions.

Return the result as an array of JSON objects matching the schema.`
      };

      const response = await generateWithFallback(ai, {
        contents: { parts: [filePart, promptPart] },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                type: { type: Type.STRING, enum: ["income", "expense"] }
              },
              required: ["date", "description", "amount", "type"]
            }
          }
        }
      });

      const bodyText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!bodyText) {
        throw new Error("El modelo no devolvió contenido");
      }

      let cleaned = bodyText.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        // Try finding the array inside text if surrounded by other characters
        const firstBracket = cleaned.indexOf('[');
        const lastBracket = cleaned.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          parsed = JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
        } else {
          throw parseErr;
        }
      }

      const rawRecords = Array.isArray(parsed) 
        ? parsed 
        : (parsed.records || parsed.transactions || parsed.movements || parsed.items || []);

      // Clean, validate and normalize records
      const currentYear = new Date().getFullYear();
      const sanitizedRecords = (rawRecords || [])
        .map((r: any) => {
          let rawAmount = r.amount;
          if (typeof rawAmount === 'string') {
            rawAmount = rawAmount.replace(/[^0-9.-]/g, '');
          }
          const numAmount = Math.abs(parseFloat(rawAmount) || 0);

          // Normalize Date
          let dateStr = String(r.date || '').trim();
          if (dateStr) {
            // If MM/DD/YYYY (US style) or DD/MM/YYYY
            const parts = dateStr.split(/[\/\-.]/);
            if (parts.length === 3) {
              if (parts[0].length === 4) {
                // YYYY-MM-DD
                dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
              } else if (parts[2].length === 4) {
                if (isUSD) {
                  // US format: MM/DD/YYYY
                  let mm = parseInt(parts[0], 10);
                  let dd = parseInt(parts[1], 10);
                  if (mm > 12 && dd <= 12) {
                    // Swap if day was first
                    const temp = mm; mm = dd; dd = temp;
                  }
                  dateStr = `${parts[2]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
                } else {
                  // LatAm format: DD/MM/YYYY
                  let dd = parseInt(parts[0], 10);
                  let mm = parseInt(parts[1], 10);
                  if (mm > 12 && dd <= 12) {
                    // Swap if month was first
                    const temp = mm; mm = dd; dd = temp;
                  }
                  dateStr = `${parts[2]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
                }
              }
            } else if (parts.length === 2) {
              // MM/DD or DD/MM with inferred current year
              const p1 = parseInt(parts[0], 10);
              const p2 = parseInt(parts[1], 10);
              if (isUSD) {
                dateStr = `${currentYear}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
              } else {
                dateStr = `${currentYear}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
              }
            }
          }

          if (!dateStr || dateStr.length < 8) {
            dateStr = new Date().toISOString().split('T')[0];
          }

          const rawType = String(r.type || '').toLowerCase();
          const normType = (rawType.includes('exp') || rawType.includes('egr') || rawType.includes('deb') || rawType.includes('car') || rawType.includes('withdr')) 
            ? 'expense' 
            : 'income';

          return {
            date: dateStr,
            description: String(r.description || 'Movimiento Bancario').trim(),
            amount: Number(numAmount.toFixed(2)),
            type: normType
          };
        })
        .filter((r: any) => r.amount > 0 && r.description);

      return res.json({
        success: true,
        records: sanitizedRecords
      });

    } catch (error: any) {
      console.error("Error parsing bank statement with Gemini:", error);
      res.status(500).json({
        error: "Fallo al procesar el estado de cuenta con IA: " + (error.message || String(error))
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
      let stripe: Stripe | null = null;
      try {
        stripe = await getStripeInstance();
      } catch (err: any) {
        console.warn("[STRIPE] Stripe secret key not found or not configured. Falling back to test/demo checkout link:", err.message);
      }

      const cleanCurrency = currency.toUpperCase() === 'MXP' || currency.toUpperCase() === 'MXN' ? 'mxn' : 'usd';

      let sessionUrl = '';
      if (stripe) {
        try {
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
          sessionUrl = session.url || '';
        } catch (stripeErr: any) {
          console.warn("[STRIPE] Stripe checkout session create failed:", stripeErr.message, "- Falling back to portal checkout link.");
        }
      }

      if (!sessionUrl) {
        const fallbackCheckoutUrl = `${origin || 'http://localhost:3000'}/pay/${insuranceId}?amount=${amount}&currency=${cleanCurrency.toUpperCase()}&session_id=pay_${Date.now()}`;
        return res.json({ 
          success: true, 
          url: fallbackCheckoutUrl,
          simulated: true,
          message: "Enlace de pago generado con éxito." 
        });
      }

      res.json({ success: true, url: sessionUrl });
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
            const status = (finalTotalFinal - newTotalPaid) <= 5 ? 'paid' : 'partially_paid';

            const newBalance = finalTotalFinal - newTotalPaid;
            const shouldClose = -5 <= newBalance && newBalance <= 5;

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

  // Public policy checkout info for client Stripe payment page
  app.get("/api/public/checkout-info/:insuranceId", async (req, res) => {
    try {
      const { insuranceId } = req.params;
      if (!insuranceId) return res.status(400).json({ error: "Falta insuranceId" });

      const insDoc = await adminDb.collection('insurances').doc(insuranceId).get();
      if (!insDoc.exists) {
        return res.status(404).json({ error: "Póliza no encontrada" });
      }

      const ins = insDoc.data() || {};
      const totalPrice = ins.totalPrice || 0;
      const totalFinal = ins.totalFinal !== undefined && ins.totalFinal !== null ? ins.totalFinal : totalPrice;
      const totalPaid = ins.totalPaid || 0;
      const balance = Math.max(0, Math.round((totalFinal - totalPaid) * 100) / 100);

      res.json({
        id: insuranceId,
        policyNumber: ins.policyNumber || ins.IDseg || insuranceId.substring(0, 8),
        firstName: ins.firstName || '',
        lastName: ins.lastName || '',
        plan: ins.plan || ins.policyName || 'Seguro Internacional',
        destinationCountry: ins.destinationCountry || '',
        currency: ins.currency || 'USD',
        exchangeRate: ins.exchangeRate || 20.00,
        totalPrice,
        totalFinal,
        totalPaid,
        balance,
        status: ins.status || 'pending',
        stripePaymentLink: ins.stripePaymentLink || null
      });
    } catch (err: any) {
      console.error("Error fetching public checkout info:", err);
      res.status(500).json({ error: err.message || "Error al obtener datos de la póliza" });
    }
  });

  // Endpoint to simulate/process card payment directly from checkout page
  app.post("/api/stripe/simulate-payment", async (req, res) => {
    try {
      const { insuranceId, amount, currency, sessionId, cardholderName } = req.body;
      if (!insuranceId || !amount) {
        return res.status(400).json({ error: "Faltan parámetros: insuranceId o amount" });
      }

      const insSnap = await adminDb.collection('insurances').doc(insuranceId).get();
      if (!insSnap.exists) {
        return res.status(404).json({ error: "Póliza no encontrada" });
      }

      const insurance = { id: insuranceId, ...insSnap.data() } as any;
      const numAmount = parseFloat(amount);
      const payCurrency = (currency || 'USD').toUpperCase();
      const receiptNumber = `REC-STRIPE-${Math.floor(1000 + Math.random() * 9000)}`;

      const currentPaid = insurance.totalPaid || 0;
      const newTotalPaid = Math.round((currentPaid + numAmount) * 100) / 100;
      const finalTotal = insurance.totalFinal !== undefined && insurance.totalFinal !== null
        ? insurance.totalFinal
        : (insurance.totalPrice || 0);

      const status = (finalTotal - newTotalPaid) <= 5 ? 'paid' : 'partially_paid';
      const shouldClose = Math.abs(finalTotal - newTotalPaid) <= 5;

      const updateData: any = {
        status,
        totalPaid: newTotalPaid,
        paymentMethod: 'Tarjeta Stripe',
        receiptNumber,
        paymentDate: new Date().toISOString().split('T')[0],
        depositAccount: 'Stripe Account',
        paymentCurrency: payCurrency,
        amountPaid: numAmount,
        lastPaymentSessionId: sessionId || `sim_${Date.now()}`
      };

      if (shouldClose) {
        updateData.closed = true;
      }

      await adminDb.collection('insurances').doc(insuranceId).update(updateData);

      // Create payment record in payments collection
      await adminDb.collection('payments').add({
        insuranceId,
        amount: numAmount,
        currency: payCurrency,
        type: 'client_payment',
        paymentMethod: 'Tarjeta Stripe',
        depositAccount: 'Stripe Gateway',
        receiptNumber,
        status: 'completed',
        date: new Date(),
        notes: `Pago en línea con Tarjeta vía Stripe. Tarjetahabiente: ${cardholderName || 'Cliente'}. Recibo: ${receiptNumber}`
      });

      // Log activity in insuranceActivities
      try {
        await adminDb.collection('insuranceActivities').add({
          insuranceId,
          type: 'automatic',
          description: `Pago en línea acreditado por $${numAmount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${payCurrency} vía Stripe. Recibo: ${receiptNumber}. Estado de la póliza: ${status === 'paid' ? 'Pagada' : 'Parcialmente pagada'}.`,
          date: new Date(),
          createdBy: 'Stripe Gateway'
        });
      } catch (actErr) {
        console.error("Activity logging error:", actErr);
      }

      // Try WhatsApp notification
      try {
        const fullInsObj = { ...insurance, id: insuranceId, status, totalPaid: newTotalPaid, ...updateData };
        if (status === 'paid') {
          triggerWhatsAppNotification('estado_poliza', fullInsObj);
        } else if (status === 'partially_paid') {
          triggerWhatsAppNotification('recordatorio_pago', fullInsObj);
        }
      } catch (waErr) {
        console.error("WhatsApp trigger error:", waErr);
      }

      res.json({
        success: true,
        receiptNumber,
        newTotalPaid,
        status,
        message: "Pago procesado y acreditado con éxito"
      });
    } catch (err: any) {
      console.error("Error in simulate-payment:", err);
      res.status(500).json({ error: err.message || "Error al procesar el pago" });
    }
  });
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

  const extractDatabaseFromBackupDoc = async (data: any) => {
    if (data.zippedData) {
      try {
        const inflated = zlib.inflateSync(Buffer.from(data.zippedData, 'base64')).toString('utf-8');
        return JSON.parse(inflated);
      } catch (_) {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(data.zippedData, { base64: true });
        const jsonFileNames = Object.keys(zipContent.files).filter(name => name.endsWith('.json') && !zipContent.files[name].dir);
        const target = jsonFileNames.includes('backup.json') ? 'backup.json' : jsonFileNames[0];
        const jsonStr = await zipContent.files[target].async('string');
        return JSON.parse(jsonStr);
      }
    }
    return JSON.parse(data.databaseJson || "{}");
  };

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

    const rawJsonStr = JSON.stringify(backupData);
    const compressedBuffer = zlib.deflateSync(rawJsonStr);
    const zippedData = compressedBuffer.toString('base64');
    const originalSize = Buffer.byteLength(rawJsonStr);
    const compressedSize = compressedBuffer.length;
    const ratio = Math.round((1 - compressedSize / originalSize) * 100);

    const backupDoc = {
      meta: {
        appId: "mi-seguro-internacional",
        version: "2.0-full-backup",
        exportedAt: new Date().toISOString(),
        exportedBy: triggeredBy,
        totalCollectionsCount: EXPORTABLE_COLLECTIONS_LIST.length,
        recordCounts: recordCounts,
        isCompressed: true,
        originalSize,
        compressedSize,
        compressionRatio: `${ratio}%`
      },
      zippedData,
      databaseJson: ""
    };

    const backupId = `backup_${Date.now()}`;
    await adminDb.collection("backups").doc(backupId).set(backupDoc);
    console.log(`[BACKUP ENGINE] Successfully stored compressed backup document: ${backupId}`);

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
      const database = await extractDatabaseFromBackupDoc(data);
      res.json({
        meta: data.meta,
        database
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
      const database = await extractDatabaseFromBackupDoc(data);
      
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

  // Health check endpoint for Cloud Run container probes
  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  const distPath = path.join(process.cwd(), "dist");
  const hasBuiltDist = fs.existsSync(path.join(distPath, "index.html"));
  const entryScript = process.argv[1] || "";
  const isRunningBuiltServer = entryScript.includes("dist") || entryScript.endsWith(".cjs") || process.env.NODE_ENV === "production";
  const isDev = !isRunningBuiltServer && (process.env.NODE_ENV === "development" || !hasBuiltDist);

  // Vite middleware for development; static assets for production
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
