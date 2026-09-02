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
