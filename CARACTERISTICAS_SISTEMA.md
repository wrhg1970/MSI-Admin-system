# MiSeguroInternacional Admin — Especificación Integral y Características del Sistema

Plataforma de gestión empresarial (ERP/CRM) de grado corporativo especializada en la administración integral, cotización, emisión, cobranza, conciliación bancaria inteligente y seguimiento post-venta de pólizas de seguros internacionales y asistencias de viaje para modelos de negocio **B2B, B2B2C y B2C**.

---

## 1. Resumen Ejecutivo y Arquitectura

* **Stack Tecnológico**: React 18+ con TypeScript, Tailwind CSS, Vite, Express (Node.js) con esbuild, Firebase Firestore / Firebase Auth.
* **Integración de Inteligencia Artificial**: Google Gemini API (modelos `gemini-3.1-flash-lite`, `gemini-flash-latest`, `gemini-3.7-flash` con arquitectura de failover automático y procesamiento OCR de facturas y estados de cuenta bancarios).
* **Multi-Divisa Nativa**: Soporte unificado de operaciones en **USD (Dólares)** y **MXP / MXN (Pesos Mexicanos)** con conversión dinámica basada en tipo de cambio diario editable o automatizado.
* **Seguridad y Roles (RBAC)**: Autenticación por correo y contraseña con asignación granular de perfiles (`Super Admin`, `Admin`, `Agent`, `Staff`, `Auditor`).

---

## 2. Módulos Principales del Sistema

### 2.1. Gestión de Pólizas y Certificados (`PoliciesManager`)
* **Ciclo de Vida Completo**: Registro, cotización, emisión activa, cancelaciones, renovaciones y archivo histórico de pólizas.
* **Soporte Multi-Producto**: Seguros de Gastos Médicos Internacionales, Asistencias de Viaje, Coberturas Estudiantiles y Pólizas Corporativas (CareMed, IMG, Best Doctors, VUMI, Redbridge, Allianz, etc.).
* **Filtros Avanzados y Vistas**: Búsqueda por número de póliza, cliente, proveedor, fechas de vigencia, estatus de pago y canal de venta.
* **Cálculo Financiero Automatizado**:
  * Precio Público Final (con descuentos o ajustes aplicados).
  * Costo Neto del Proveedor y Comisiones de Agente.
  * Margen de ganancia bruta y neta calculado en tiempo real.
* **Descarga Masiva y Generación de Documentos**:
  * Emisión automática de cartas de bienvenida / certificaciones de póliza en PDF.
  * Generador de recibos de pago con desglose fiscal y notas personalizadas.
  * Exportación en ZIP masivo de certificados y expedientes por lote (`BulkZipDownloadModal`).

---

### 2.2. Conciliación Bancaria Inteligente con IA (`StatementOCRManager`)
* **Extracción OCR de Estados de Cuenta (PDF e Imágenes)**:
  * Procesamiento inteligente mediante Gemini Vision para bancos de Estados Unidos (Chase, Wells Fargo, BofA, Wise, Mercury) y México (BBVA, Banorte, Santander, Banamex, Intercam).
  * Clasificación automática de movimientos en **Ingresos (Abonos)** y **Egresos (Cargos)**.
  * Normalización de fechas (`YYYY-MM-DD`), limpieza de signos y validación de montos.
* **Conciliación 1-Clic contra Cuentas por Cobrar y Pagar**:
  * Emparejamiento automático con pagos de clientes, comisiones de agentes y facturas de proveedores.
  * Detección preventiva de pagos duplicados (validación de monto, fecha y tipo).
  * Filtros de vista por divisa (**USD / MXP**) y buscador en tiempo real de archivos subidos.

---

### 2.3. Gestión de Clientes y CRM (`ClientsManager` & `ClientDetailModal`)
* **Expediente Digital 360°**: Historial unificado de pólizas contratadas, pagos realizados, saldos pendientes, siniestros y notas de seguimiento.
* **Importación Masiva y Contactos**:
  * Importación desde archivos Excel/CSV con mapeo dinámico de columnas y validación de duplicados.
  * Sincronización e importación directa desde Google Contacts (`GoogleContactsImportModal`).
* **Canales de Comunicación Integrados**: Envío directo de cotizaciones, recordatorios de pago y pólizas vía **WhatsApp** y correo electrónico con plantillas enriquecidas.

---

### 2.4. Control de Proveedores y Aseguradoras (`ProvidersManager`)
* **Catálogo de Aseguradoras**: Registro de contactos, condiciones comerciales, comisiones negociadas y datos bancarios para liquidación.
* **OCR de Facturas de Proveedores**: Carga de facturas (ej. facturas globales CareMed) para extracción automática de número de factura, importe total en USD/EUR y conciliación contra costos de pólizas emitidas.
* **Monitoreo de Cuentas por Pagar (AP)**: Desglose de saldos pendientes por liquidar a cada aseguradora.

---

### 2.5. Comisiones de Agentes y Socios B2B (`CommissionsManager`)
* **Esquemas Flexibles de Comisión**: Porcentajes fijos o montos escalonados por proveedor, producto o agente.
* **Estados de Cuenta de Agentes**: Generación de reportes de comisiones generadas, cobradas y pendientes de dispersión.
* **Registro y Dispersión de Pagos**: Asignación de moneda de pago de comisión (USD / MXP) con cálculo automático de tipo de cambio y generación de comprobantes.

---

### 2.6. Siniestros y Reclamaciones (`ClaimsManager` & `ClaimEmailModal`)
* **Seguimiento de Incidencias**: Apertura de casos de siniestro, registro de diagnósticos, clínicas u hospitales atendidos y montos reclamados.
* **Bitácora y Estados**: Flujo de estados (`Abierto`, `En Revisión Médica`, `Documentación Pendiente`, `Aprobado`, `Liquidado`, `Rechazado`).
* **Comunicación con Ajustadores**: Envío de expedientes médicos y solicitudes de reembolso por correo electrónico integrado.

---

### 2.7. Integraciones de Comercio y Pasarelas de Pago

#### A. WooCommerce (`WooCommerceManager`)
* **Sincronización Bidireccional**: Importación en tiempo real de órdenes de compra y cotizaciones desde tiendas WordPress / WooCommerce.
* **Conversión Automática a Pólizas**: Mapeo de campos de pasajeros, fechas de viaje y generación de registros de pago correspondientes.

#### B. Pasarela Stripe (`StripeIntegration`)
* **Generación de Enlaces de Cobro (Payment Links)**: Creación de ligas seguras de pago con tarjeta de crédito/débito en USD o MXP enviables por WhatsApp o Email.
* **Webhooks y Auto-Conciliación**: Actualización automática del estatus de la póliza y registro del abono en Firestore al confirmarse el cobro por Stripe.

#### C. Mensajería WhatsApp & Email
* **WhatsApp API / Web Integration**: Notificaciones automáticas de emisión, cobro, vencimiento y recordatorios con plantillas dinámicas y enlace de pago.
* **Motor de Correo Masivo y Plantillas**: Configuración de remitentes, variables (`{{nombre}}`, `{{poliza}}`, `{{monto}}`) y adjuntos PDF (`BulkEmailConfigModal`).

---

### 2.8. Reportes Financieros y Business Intelligence (`ReportsManager` & `Dashboard`)
* **Métricas Clave (KPIs)**:
  * Ventas Totales Brutas vs. Netas (desglosadas en USD y MXP).
  * Margen de Utilidad Bruta y Comisiones por Agente/Canal.
  * Cuentas por Cobrar (AR) y Cuentas por Pagar (AP) envejecidas.
  * Ratio de retención y renovaciones de clientes.
* **Gráficas Interactivas**: Tendencias mensuales, distribución por aseguradora y ventas por destino geográfico.
* **Exportación de Datos**: Descarga de reportes en formato Excel, CSV y PDF listos para contabilidad y auditoría.

---

### 2.9. Catálogos, Parámetros y Configuración (`ConfigPanel` & `CatalogsManager`)
* **Planes y Coberturas**: Catálogo de tipos de seguro (`InsuranceTypesManager`), planes (`InsurancePlansManager`), categorías y subcategorías.
* **Métodos de Pago**: Configuración de cuentas bancarias (USD y MXP), pasarelas y términos de crédito.
* **Tipo de Cambio Diario**: Control centralizado de tasa de cambio para conversiones operativas y financieras (`DailyExchangeRateWidget`).
* **Gestión de Tareas y Alertas**: Recordatorios automáticos de renovaciones, pagos vencidos y tareas de seguimiento de asesores (`TaskModal` & `NotificationsManager`).

---

## 3. Seguridad, Persistencia y Reglas de Negocio

* **Base de Datos en Tiempo Real**: Firebase Firestore estructurado con colecciones seguras (`insurances`, `clients`, `providers`, `payments`, `statementUploads`, `claims`, `users`, `catalogs`).
* **Reglas de Acceso (Firestore Rules)**: Validación estricta a nivel de documento para evitar accesos no autorizados o modificaciones cruzadas de datos sensibles.
* **Registro de Auditoría e Historial**: Trazabilidad completa de modificaciones en pólizas, pagos y conciliaciones bancarias (`HistoricoManager`).
