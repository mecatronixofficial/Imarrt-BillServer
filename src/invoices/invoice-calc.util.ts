import { computeBilling } from '../common/utils/billing.util.js';
import type { BusinessPreferences } from '../businesses/business-preferences.js';

export interface LineItemInput {
  quantity: number;
  unitPrice: number;
  taxRate: number; // percentage, e.g. 18 for 18%
  taxInclusive?: boolean;
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

export function computeInvoiceTotals(items: LineItemInput[], discount = 0, options: TotalsOptions = {}): InvoiceTotals {
  return computeBilling(items, discount, options);
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
