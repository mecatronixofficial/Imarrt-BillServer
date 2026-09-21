import type { BusinessPreferences } from '../businesses/business-preferences.js';

export interface LineItemInput {
  quantity: number;
  unitPrice: number;
  taxRate: number; // percentage, e.g. 18 for 18%
}

export interface LineItemComputed extends LineItemInput {
  lineSubTotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface TotalsOptions {
  /** Round the grand total to the nearest whole rupee. */
  roundOff?: boolean;
  /** Round the total tax to the nearest whole rupee. */
  roundTax?: boolean;
  /** Charge no tax at all (composition scheme). */
  noTax?: boolean;
}

export interface InvoiceTotals {
  lines: LineItemComputed[];
  subTotal: number;
  taxTotal: number;
  discount: number;
  grandTotal: number;
}

// Round to 2 decimal places safely (avoids floating point artifacts like 10.000000004)
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Computes per-line and invoice-level totals.
 * Kept as a pure function (no DB/IO) so it can be unit tested in isolation -
 * tax math bugs are a real business risk, this is the one place they can happen.
 */
export function computeInvoiceTotals(items: LineItemInput[], discount = 0, options: TotalsOptions = {}): InvoiceTotals {
  const lines = items.map((rawItem) => {
    const item = options.noTax ? { ...rawItem, taxRate: 0 } : rawItem;
    const lineSubTotal = round2(item.quantity * item.unitPrice);
    const lineTax = round2(lineSubTotal * (item.taxRate / 100));
    const lineTotal = round2(lineSubTotal + lineTax);
    return { ...item, lineSubTotal, lineTax, lineTotal };
  });

  const subTotal = round2(lines.reduce((sum, l) => sum + l.lineSubTotal, 0));
  const summedTax = round2(lines.reduce((sum, l) => sum + l.lineTax, 0));
  const taxTotal = options.roundTax ? Math.round(summedTax) : summedTax;
  const unroundedTotal = round2(subTotal + taxTotal - discount);
  // Only round positive totals; a negative total is rejected by callers and must stay visible.
  const grandTotal = options.roundOff && unroundedTotal > 0 ? Math.round(unroundedTotal) : unroundedTotal;

  return { lines, subTotal, taxTotal, discount: round2(discount), grandTotal };
}

/**
 * Generates a sequential, human-readable invoice number, e.g. INV-2026-000123
 * `count` should be the number of invoices created so far this year.
 */
export function generateInvoiceNumber(year: number, sequence: number, label = 'INV'): string {
  return `${invoiceNumberPrefix(year, label)}${String(sequence).padStart(6, '0')}`;
}

/** Leading part shared by every number of a year, e.g. "INV-2026-" (used to count the running sequence). */
export function invoiceNumberPrefix(year: number, label = 'INV'): string {
  return `${label ? `${label}-` : ''}${year}-`;
}

export const NUMBERING_LABELS = { invoice: 'INV', bill: 'BILL', none: '' } as const;

/** Calculation options a company's preferences ask for. Composition only affects sales (outward) transactions. */
export function totalsOptionsFor(preferences: BusinessPreferences, sales: boolean): TotalsOptions {
  return {
    roundOff: preferences.transaction.autoRoundOff,
    roundTax: preferences.taxes.roundOffTax,
    noTax: sales && preferences.taxes.compositionScheme,
  };
}
