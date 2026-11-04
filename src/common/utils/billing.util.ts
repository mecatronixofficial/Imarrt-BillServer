/** Exact base-10 arithmetic. Monetary intermediates remain integer paise. */
export type DecimalValue = number | string;
function fraction(value: DecimalValue): [bigint, bigint] {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Amount must be finite');
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new RangeError('Invalid decimal amount');
  const exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (Math.abs(exponent) > 100) throw new RangeError('Amount is out of range');
  const numerator = BigInt((match[1] === '-' ? '-' : '') + match[2] + (match[3] || ''));
  return exponent >= 0 ? [numerator * 10n ** BigInt(exponent), 1n] : [numerator, 10n ** BigInt(-exponent)];
}
function divideRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Divisor must be positive');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}
export function scaled(value: DecimalValue, digits = 2): bigint {
  const [n, d] = fraction(value);
  return divideRound(n * 10n ** BigInt(digits), d);
}
export function unscaled(value: bigint, digits = 2): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Amount is out of range');
  return Number(value) / 10 ** digits;
}
export function money(value: DecimalValue): number { return unscaled(scaled(value)); }
export function sumMoney(values: DecimalValue[]): number { return unscaled(values.reduce<bigint>((sum, value) => sum + scaled(value), 0n)); }
export function subtractMoney(left: DecimalValue, right: DecimalValue): number { return unscaled(scaled(left) - scaled(right)); }
export function multiplyMoney(left: DecimalValue, right: DecimalValue): number {
  const [a, b] = fraction(left); const [c, d] = fraction(right);
  return unscaled(divideRound(a * c * 100n, b * d));
}
export function percentMoney(value: DecimalValue, rate: DecimalValue): number {
  const [n, d] = fraction(rate);
  return unscaled(divideRound(scaled(value) * n, d * 100n));
}
export type BillingLine = { quantity: number; unitPrice: number; taxRate: number; taxInclusive?: boolean };
export type BillingOptions = { roundOff?: boolean; roundTax?: boolean; noTax?: boolean };
export function computeBilling(items: BillingLine[], discount = 0, options: BillingOptions = {}) {
  const lines = items.map((raw) => {
    const item = options.noTax ? { ...raw, taxRate: 0 } : raw;
    const gross = scaled(multiplyMoney(item.quantity, item.unitPrice));
    const [rate, denominator] = fraction(item.taxRate);
    const base = item.taxInclusive && item.taxRate > 0 ? divideRound(gross * 100n * denominator, 100n * denominator + rate) : gross;
    const tax = item.taxInclusive ? gross - base : scaled(percentMoney(unscaled(base), item.taxRate));
    return { ...item, lineSubTotal: unscaled(base), lineTax: unscaled(tax), lineTotal: unscaled(base + tax) };
  });
  const subTotal = sumMoney(lines.map((line) => line.lineSubTotal));
  const summedTax = sumMoney(lines.map((line) => line.lineTax));
  const taxTotal = options.roundTax ? Math.round(summedTax) : summedTax;
  const total = subtractMoney(sumMoney([subTotal, taxTotal]), discount);
  const grandTotal = options.roundOff && total > 0 ? Math.round(total) : total;
  return { lines, subTotal, taxTotal, discount: money(discount), grandTotal, roundOff: subtractMoney(grandTotal, total) };
}
