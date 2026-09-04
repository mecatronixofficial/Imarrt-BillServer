import { computeInvoiceTotals, generateInvoiceNumber } from './invoice-calc.util';

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
