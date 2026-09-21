import { computeInvoiceTotals, generateInvoiceNumber, invoiceNumberPrefix, totalsOptionsFor } from './invoice-calc.util.js';
import { resolvePreferences } from '../businesses/business-preferences.js';

describe('computeInvoiceTotals', () => {
  it('calculates a single line item with tax correctly', () => {
    const result = computeInvoiceTotals([{ quantity: 2, unitPrice: 100, taxRate: 18 }]);
    expect(result.subTotal).toBe(200);
    expect(result.taxTotal).toBe(36);
    expect(result.grandTotal).toBe(236);
  });

  it('handles multiple line items with different tax rates', () => {
    const result = computeInvoiceTotals([
      { quantity: 1, unitPrice: 500, taxRate: 18 }, // 90 tax
      { quantity: 3, unitPrice: 50, taxRate: 5 }, // 7.5 tax
    ]);
    expect(result.subTotal).toBe(650);
    expect(result.taxTotal).toBe(97.5);
    expect(result.grandTotal).toBe(747.5);
  });

  it('applies a flat discount after tax', () => {
    const result = computeInvoiceTotals([{ quantity: 1, unitPrice: 1000, taxRate: 18 }], 100);
    expect(result.grandTotal).toBe(1080); // 1180 - 100
  });

  it('handles zero tax rate items', () => {
    const result = computeInvoiceTotals([{ quantity: 1, unitPrice: 100, taxRate: 0 }]);
    expect(result.taxTotal).toBe(0);
    expect(result.grandTotal).toBe(100);
  });

  it('avoids floating point rounding artifacts', () => {
    const result = computeInvoiceTotals([{ quantity: 3, unitPrice: 19.99, taxRate: 12 }]);
    // 3 * 19.99 = 59.97, tax = 7.1964 -> rounds to 7.2
    expect(result.subTotal).toBe(59.97);
    expect(result.taxTotal).toBe(7.2);
    expect(Number.isInteger(result.grandTotal * 100)).toBe(true); // no float noise
  });
});

describe('generateInvoiceNumber', () => {
  it('formats with zero-padded sequence', () => {
    expect(generateInvoiceNumber(2026, 123)).toBe('INV-2026-000123');
  });

  it('handles large sequence numbers without truncation', () => {
    expect(generateInvoiceNumber(2026, 1234567)).toBe('INV-2026-1234567');
  });
});

describe('computeInvoiceTotals options', () => {
  const line = [{ quantity: 1, unitPrice: 99.5, taxRate: 18 }]; // tax 17.91, total 117.41

  it('leaves totals untouched by default', () => {
    expect(computeInvoiceTotals(line).grandTotal).toBe(117.41);
  });

  it('rounds the grand total to a whole rupee', () => {
    expect(computeInvoiceTotals(line, 0, { roundOff: true }).grandTotal).toBe(117);
  });

  it('rounds the tax first, then the total', () => {
    const result = computeInvoiceTotals(line, 0, { roundTax: true });
    expect(result.taxTotal).toBe(18);
    expect(result.grandTotal).toBe(117.5);
  });

  it('charges no tax under the composition scheme', () => {
    const result = computeInvoiceTotals(line, 0, { noTax: true });
    expect(result.taxTotal).toBe(0);
    expect(result.lines[0].lineTotal).toBe(99.5);
    expect(result.grandTotal).toBe(99.5);
  });

  it('does not round a negative total away', () => {
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 10, taxRate: 0 }], 25.4, { roundOff: true }).grandTotal).toBe(-15.4);
  });

  it('derives options from company preferences, applying composition to sales only', () => {
    const prefs = resolvePreferences({ taxes: { compositionScheme: true, roundOffTax: true }, transaction: { autoRoundOff: true } });
    expect(totalsOptionsFor(prefs, true)).toEqual({ roundOff: true, roundTax: true, noTax: true });
    expect(totalsOptionsFor(prefs, false)).toEqual({ roundOff: true, roundTax: true, noTax: false });
  });
});

describe('invoice numbering', () => {
  it('keeps the classic INV format by default', () => {
    expect(generateInvoiceNumber(2026, 7)).toBe('INV-2026-000007');
  });

  it('supports the BILL and no-prefix formats', () => {
    expect(generateInvoiceNumber(2026, 7, 'BILL')).toBe('BILL-2026-000007');
    expect(generateInvoiceNumber(2026, 7, '')).toBe('2026-000007');
    expect(invoiceNumberPrefix(2026, '')).toBe('2026-');
  });
});
