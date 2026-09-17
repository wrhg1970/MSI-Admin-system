export const isCardPaymentMethod = (pm?: string | null): boolean => {
  if (!pm) return false;
  const lower = pm.trim().toLowerCase();
  return (
    lower.includes('tarjeta') ||
    lower.includes('card') ||
    lower.includes('amex') ||
    lower.includes('visa') ||
    lower.includes('mastercard') ||
    lower.includes('crédito') ||
    lower.includes('credito') ||
    lower.includes('débito') ||
    lower.includes('debito') ||
    lower.includes('stripe')
  );
};

export const safeNum = (val: any, fallback = 0): number => {
  if (val === null || val === undefined || val === '') return fallback;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return Number.isNaN(n) || !Number.isFinite(n) ? fallback : n;
};

export const DEFAULT_PAYMENT_METHODS = [
  { id: 'pm_card_credito', name: 'Tarjeta de Crédito', status: 'active' },
  { id: 'pm_card_debito', name: 'Tarjeta de Débito', status: 'active' },
  { id: 'pm_card_visa_mc', name: 'Tarjeta VISA/MC', status: 'active' },
  { id: 'pm_card_amex', name: 'Tarjeta AMEX', status: 'active' },
  { id: 'pm_transferencia', name: 'Transferencia Bancaria', status: 'active' },
  { id: 'pm_deposito', name: 'Depósito Bancario', status: 'active' },
  { id: 'pm_efectivo', name: 'Efectivo', status: 'active' },
  { id: 'pm_stripe', name: 'Stripe (Pago en línea)', status: 'active' }
];

export interface InsuranceFinancialRecord {
  actionType?: string | null;
  status?: string | null;
  totalPrice?: number | null;
  totalFinal?: number | null;
  discount?: number | null;
  adjustment?: number | null;
  totalPaid?: number | null;
}

export const getInsuranceFinalPrice = (ins: InsuranceFinancialRecord): number => {
  const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can';
  if (isCan) {
    return ins.totalPrice !== undefined && ins.totalPrice !== null && ins.totalPrice !== 0
      ? ins.totalPrice
      : (ins.totalFinal || 0);
  }
  const base = safeNum(ins.totalPrice, 0);
  const disc = safeNum(ins.discount, 0);
  const adj = safeNum(ins.adjustment, 0);
  return Math.round((base - disc - adj) * 100) / 100;
};

export const getInsuranceDisplayStatus = (ins: InsuranceFinancialRecord): 'paid' | 'pending' | 'partially_paid' | 'cancelled' => {
  const isCan = ins.actionType?.toUpperCase() === 'CAN' || ins.actionType === 'Can' || ins.status === 'cancelled';
  if (isCan) {
    return 'cancelled';
  }

  const finalPrice = getInsuranceFinalPrice(ins);
  const totalPaid = safeNum(ins.totalPaid, 0);
  const balanceToPay = finalPrice - totalPaid;

  if (ins.status === 'paid' || balanceToPay < 2) {
    return 'paid';
  }

  if (ins.status === 'partially_paid' || (totalPaid > 0 && balanceToPay >= 2)) {
    return 'partially_paid';
  }

  return 'pending';
};

