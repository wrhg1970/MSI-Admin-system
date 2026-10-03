export type UserRole = 'super_admin' | 'director' | 'seguros' | 'administracion' | 'agent' | 'client' | string;

export interface Permission {
  id: string;
  name: string;
  description: string;
}

export interface MenuPermission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  menuPermissions: {
    [menuId: string]: MenuPermission;
  };
  permissions?: string[];
  createdAt: any;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  commission?: number;
  createdAt: any;
  parentAgentId?: string;
}

export type PlanType = string;

export interface Policy {
  id: string;
  plan: PlanType;
  name: string;
  deductible: boolean;
  region: 1 | 2;
  costPerDay: number;
  pricePerDay: number;
  pricePerMonth?: number;
  discountPercentage?: number;
  startDate?: string; // ISO date string YYYY-MM-DD
  endDate?: string;   // ISO date string YYYY-MM-DD
  status?: 'active' | 'inactive' | 'archived';
  createdAt?: any;
  // Administration fields
  NombrePoliza?: string;
  CodigoPoliza?: string;
  CantidadDeducible?: number;
  Insurance_Type?: string;
  E_Mail_Address?: string;
  CodigoExportacion?: string;
  SponsorCode?: string;
  imported?: boolean;
}

export type ClientType = 'Agent' | 'Corporate' | 'Individual';

export interface LinkedAgent {
  id: string;
  name: string;
  phone: string;
  email: string;
  commission: number;
  discountPercentage?: number;
}

export interface Client {
  id?: string;
  type: ClientType;
  // Common fields
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  rfc: string;
  documents?: string[]; // URLs to documents
  
  // Corporate/Agent specific
  legalName?: string;
  commercialName?: string;
  mainContact?: string;
  linkedAgents?: LinkedAgent[];
  discountPercentage?: number;
  commission?: number;
  
  // Individual specific
  firstName?: string;
  lastName?: string;
  gender?: 'M' | 'F';
  birthDate?: string;
  sendBirthdayGreeting?: boolean;
  
  notes?: string;
  regimenFiscal?: string;
  cfdiUse?: string;
  createdAt: any;
}

export interface FacturaData {
  rfc?: string;
  razonSocial?: string;
  direccion?: string;
  ciudad?: string;
  state?: string;
  zip?: string;
  country?: string;
  email?: string;
  regimenFiscal?: string;
  cfdiUse?: string;
}

export interface InsuranceRequest {
  id?: string;
  IDseg?: string;
  clientType: ClientType;
  clientId?: string;
  linkedAgentId?: string;
  agentId?: string;
  firstName: string;
  lastName: string;
  gender?: 'M' | 'F';
  email: string;
  birthDate: string;
  age: number;
  originCountry: string;
  destinationCountry: string;
  city: string;
  policyId: string;
  plan?: string;
  policyName?: string;
  actionType?: string;
  categoryId?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  isExtremeSports?: boolean;
  startDate: string;
  endDate: string;
  days: number;
  totalPrice: number;
  totalCost: number;
  discount?: number;
  adjustment?: number;
  agentCommission?: number;
  comision?: number;
  iva?: number;
  totalFinal?: number;
  totalPaid?: number;
  paymentMethod?: string;
  receiptNumber?: string;
  commissionStatus?: 'pending' | 'confirmed' | 'paid';
  commissionPaymentDate?: string;
  commissionPaymentMethod?: string;
  commissionPaymentReceipt?: string;
  commissionPaymentCurrency?: 'USD' | 'MXP';
  commissionPaymentAmount?: number;
  commissionPaymentExchangeRate?: number;
  providerPaymentStatus?: 'pending' | 'paid';
  providerPaymentDate?: string;
  providerPaymentMethod?: string;
  providerPaymentReceipt?: string;
  status: 'pending' | 'partially_paid' | 'paid' | 'cancelled';
  userId?: string;
  closed?: boolean;
  notes?: string;
  imported?: boolean;
  isCorrected?: boolean;
  isCancelled?: boolean;
  cancellationInsuranceId?: string;
  cancelledFromInsuranceId?: string;
  externalId?: string;
  requestDate?: string;
  Caremed?: string;
  InvoiceCaremed?: string;
  stripePaymentLink?: string;
  phone?: string;
  policyNumber?: string;
  currency?: 'USD' | 'MXP';
  paymentCurrency?: string;
  exchangeRate?: number;
  solicitudFactura?: boolean;
  facturaData?: FacturaData;
  rfcFactura?: string;
  razonSocialFactura?: string;
  createdAt: any;
}

export interface Payment {
  id: string;
  insuranceId: string;
  originalInsuranceId?: string;
  amount: number;
  currency: 'USD' | 'MXP';
  exchangeRate?: number;
  amountMXP?: number;
  type: 'client_payment' | 'provider_payment' | 'agent_commission';
  paymentMethod?: string;
  depositAccount?: string;
  status: 'pending' | 'completed';
  date: any;
  notes?: string;
  categoryId?: string;
  subcategoryId?: string;
  clientId?: string;
  providerId?: string;
  providerName?: string;
  receiptUrl?: string;
  receiptNumber?: string;
  invoiceNumber?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export interface Country {
  id?: string;
  code: string;
  name: string;
  region: 1 | 2;
  language?: string;
  imported?: boolean;
  capital?: string;
}

export interface Category {
  id?: string;
  name: string;
  description: string;
  createdAt?: any;
}

export interface Subcategory {
  id?: string;
  name: string;
  categoryId: string;
  description: string;
  createdAt?: any;
}

export interface StatementUpload {
  id?: string;
  fileName: string;
  uploadDate: any;
  totalIncomes: number;
  totalExpenses: number;
  reconciledIncomes?: number;
  reconciledExpenses?: number;
  currency?: 'USD' | 'MXP';
  status: 'pending' | 'processed' | 'reconciled';
  userId: string;
}

export interface StatementRecord {
  id?: string;
  uploadId: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency?: 'USD' | 'MXP';
  exchangeRate?: number;
  categoryId?: string;
  subcategoryId?: string;
  isClientIncome?: boolean;
  clientId?: string;
  isProviderExpense?: boolean;
  providerId?: string;
  reconciled: boolean;
  reconciledAt?: any;
  createdAt: any;
}

export interface ExchangeRate {
  id?: string;
  rate: number;
  cardFee?: number;
  cargoTarjeta?: number;
  date: string; // ISO date string YYYY-MM-DD
  createdAt: any;
}

export interface SystemDocument {
  id: string;
  name: string;
  url: string;
  size: string;
  type: string;
  date: string;
  validity?: string;
  storagePath?: string;
  createdAt: any;
}

export interface Provider {
  id?: string;
  legalName: string;
  commercialName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  rfc: string;
  mainContact: string;
  phone: string;
  email: string;
  documentUrl?: string;
  categoryId: string;
  subcategoryId: string;
  createdAt: any;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  clabe?: string;
  swift?: string;
  abaNumber?: string;
  reference?: string;
}

export interface PolicyLetter {
  id?: string;
  policyId: string;
  language: string;
  title: string;
  content: string;
  benefits: { label: string; value: string; isBold?: boolean }[];
  footer: string;
  createdAt: any;
}

export interface ClaimDocument {
  id: string;
  name: string;
  url: string;
  description: string;
  date: any;
}

export interface Claim {
  id?: string;
  date: any;
  insuranceId: string;
  reference?: string;
  claimAmount?: number;
  description: string;
  documents: ClaimDocument[];
  sentToInsurerDate?: any;
  insurerResponse?: 'Pendiente' | 'Rechazado' | 'Aprobado' | string;
  resolutionDate?: string;
  resolutionDescription?: string;
  reimbursedAmount?: number;
  isClosed: boolean;
  closedAt?: any;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  // Operación fields
  calledCentral?: boolean;
  calledCentralDate?: string;
  docsDelivered?: boolean;
  docsDeliveredDate?: string;
  isComplete?: boolean;
  isCompleteDate?: string;
  sentToInsurer?: boolean;
  sentToInsurerDateChecked?: string;
  isExpedienteCompletoConfirmed?: boolean;
  expedienteCompletoConfirmedAt?: string;
}

export interface ClaimActivity {
  id?: string;
  claimId: string;
  type: 'automatic' | 'call' | 'zoom' | 'email' | 'comment' | 'other';
  description: string;
  date: any;
  createdBy: string;
  createdAt: any;
}

export interface Task {
  id?: string;
  title: string;
  description?: string;
  dueDate?: any;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assignedTo: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface HistoricalRecord {
  id?: string;
  tipoCliente: string;
  cliente: string;
  agente: string;
  fechaAlta: string;
  transactionType: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  edad: string | number;
  gender: string;
  email: string;
  tipoPoliza: string;
  tipoCobertura: string;
  origen: string;
  destino: string;
  ciudad: string;
  startDate: string;
  endDate: string;
  comentarios: string;
  cantidadAPagar: string | number;
  cargoAdministrativo: string | number;
  precioPublicoFinalMN: string | number;
  precioPublicoFinalUSD: string | number;
  fechaPagoSetmex: string;
  formadePago: string;
  noRecibo: string;
  costoFinalUSD: string | number;
  fechaInvoice: string;
  invoice: string;
  comisionUSD: string | number;
  comisionFinalMXP: string | number;
  comisionFinalAPagar: string | number;
  comisionPagada: string;
  comisionFechaPago: string;
  comisionFormaPago: string;
  comisionComentario: string;
  createdAt?: any;
}
