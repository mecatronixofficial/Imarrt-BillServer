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
export function computeInvoiceTotals(items: LineItemInput[], discount = 0): InvoiceTotals {
  const lines = items.map((item) => {
    const lineSubTotal = round2(item.quantity * item.unitPrice);
    const lineTax = round2(lineSubTotal * (item.taxRate / 100));
    const lineTotal = round2(lineSubTotal + lineTax);
    return { ...item, lineSubTotal, lineTax, lineTotal };
  });

  const subTotal = round2(lines.reduce((sum, l) => sum + l.lineSubTotal, 0));
  const taxTotal = round2(lines.reduce((sum, l) => sum + l.lineTax, 0));
  const grandTotal = round2(subTotal + taxTotal - discount);

  return { lines, subTotal, taxTotal, discount: round2(discount), grandTotal };
}

/**
 * Generates a sequential, human-readable invoice number, e.g. INV-2026-000123
 * `count` should be the number of invoices created so far this year.
 */
export function generateInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(6, '0')}`;
}
