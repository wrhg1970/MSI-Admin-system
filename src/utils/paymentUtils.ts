export const isCardPaymentMethod = (pm?: string | null): boolean => {
  if (!pm) return false;
  const lower = pm.trim().toLowerCase();
  return (
    lower.includes('tarjeta') ||
    lower.includes('card') ||
    lower.includes('amex') ||
    lower.includes('visa') ||
    lower.includes('mastercard') ||
    lower.includes('cr?dito') ||
    lower.includes('credito') ||
    lower.includes('d?bito') ||
    lower.includes('debito') ||
    lower.includes('stripe')
  );
};

export const safeNum = (val: any, fallback = 0): number => {
  if (val === null || val === undefined || val === '') return fallback;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isNaN(n) || !Number.isFinite(n) ? fallback : n;
};

export type PaymentDisplayStatus = 'paid' | 'partially_paid' | 'pending' | 'cancelled';

/** Same expected amount as Cuentas por Cobrar: prefer totalFinal even when it is 0. */
export const getInsuranceExpectedAmount = (ins: { totalFinal?: any; totalPrice?: any } | null | undefined): number => {
  if (!ins) return 0;
  if (ins.totalFinal !== undefined && ins.totalFinal !== null && ins.totalFinal !== '') {
    return safeNum(ins.totalFinal);
  }
  return safeNum(ins.totalPrice);
};

export const getInsurancePaymentBalance = (ins: { totalFinal?: any; totalPrice?: any; totalPaid?: any } | null | undefined): number => {
  return getInsuranceExpectedAmount(ins) - safeNum(ins?.totalPaid);
};

/** Outstanding receivable: positive debtor balance, not cancelled, not closed. */
export const isInsuranceDeudor = (ins: {
  status?: string;
  actionType?: string;
  closed?: any;
  totalFinal?: any;
  totalPrice?: any;
  totalPaid?: any;
} | null | undefined): boolean => {
  if (!ins) return false;
  const action = String(ins.actionType || '').toUpperCase();
  const raw = String(ins.status || '').toLowerCase().trim();
  if (action === 'CAN' || raw === 'cancelled' || raw === 'cancelado') return false;
  if (ins.closed) return false;
  return getInsurancePaymentBalance(ins) > 0.01;
};

/**
 * Payment badge for Gesti?n de P?lizas and Detalles del Seguro.
 * Balance is the source of truth so a stale `status: paid` cannot show PAGADO
 * while the list still shows PENDIENTE (or the reverse).
 */
export const getInsurancePaymentDisplayStatus = (ins: {
  status?: string;
  actionType?: string;
  totalFinal?: any;
  totalPrice?: any;
  totalPaid?: any;
} | null | undefined): PaymentDisplayStatus => {
  if (!ins) return 'pending';
  const action = String(ins.actionType || '').toUpperCase();
  const raw = String(ins.status || '').toLowerCase().trim();
  if (action === 'CAN' || raw === 'cancelled' || raw === 'cancelado') return 'cancelled';

  const paid = safeNum(ins.totalPaid);
  const balance = getInsurancePaymentBalance(ins);
  if (balance < 2) return 'paid';
  if (paid > 0.01) return 'partially_paid';
  return 'pending';
};

export const getInsurancePaymentStatusLabel = (status: PaymentDisplayStatus): string => {
  if (status === 'paid') return 'PAGADO';
  if (status === 'partially_paid') return 'PAGO PARCIAL';
  if (status === 'pending') return 'PENDIENTE';
  return 'CANCELADO';
};

export const getInsurancePaymentStatusBadgeClass = (status: PaymentDisplayStatus): string => {
  if (status === 'paid') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'pending') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  if (status === 'partially_paid') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-red-100 text-red-700 border-red-200';
};

/** Kept so older callers on GitHub still compile after the deudor helpers. */
export const getInsuranceFinalPrice = getInsuranceExpectedAmount;
export const getInsuranceDisplayStatus = getInsurancePaymentDisplayStatus;

export const DEFAULT_PAYMENT_METHODS = [
  { id: 'pm_card_credito', name: 'Tarjeta de Cr?dito', status: 'active' },
  { id: 'pm_card_debito', name: 'Tarjeta de D?bito', status: 'active' },
  { id: 'pm_card_visa_mc', name: 'Tarjeta VISA/MC', status: 'active' },
  { id: 'pm_card_amex', name: 'Tarjeta AMEX', status: 'active' },
  { id: 'pm_transferencia', name: 'Transferencia Bancaria', status: 'active' },
  { id: 'pm_deposito', name: 'Dep?sito Bancario', status: 'active' },
  { id: 'pm_efectivo', name: 'Efectivo', status: 'active' },
  { id: 'pm_stripe', name: 'Stripe (Pago en l?nea)', status: 'active' }
];
