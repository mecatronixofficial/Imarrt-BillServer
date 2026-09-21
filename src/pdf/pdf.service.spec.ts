import { describe, expect, it } from 'vitest';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { buildPrintHtml, taxBreakup, type PrintModel } from './pdf.service.js';

const business = { name: 'Acme', gstRegistered: true, gstin: '27AAAAA0000A1Z5', stateCode: '27', address: '1 Road', phone: '999', email: 'a@acme.test' };

function model(overrides: Partial<PrintModel> = {}): PrintModel {
  return {
    invoiceLike: true,
    sale: true,
    nameKey: 'saleInvoice',
    number: 'MAIN-INV-2026-000001',
    status: 'UNPAID',
    issueDate: '2026-09-21',
    logistics: [],
    business,
    party: { name: 'Buyer', gstin: '27BBBBB1111B1Z5' },
    partyLabel: 'billedTo',
    lines: [{ description: 'Cloth', quantity: 2, unit: 'pcs', unitPrice: 100, taxRate: 18, lineTotal: 236 }],
    subTotal: 200,
    taxTotal: 36,
    discount: 0,
    grandTotal: 236,
    paid: 100,
    paymentMode: 'cash',
    ...overrides,
  };
}

const html = (prefs: unknown, overrides: Partial<PrintModel> = {}) => {
  const m = model(overrides);
  return buildPrintHtml({ ...m, business: { ...m.business, preferences: prefs } }, resolvePreferences(prefs));
};

describe('taxBreakup', () => {
  const lines = model().lines;
  it('splits into CGST and SGST for a buyer in the same state', () => {
    expect(taxBreakup({ lines, business, party: { name: 'B', gstin: '27BBBBB1111B1Z5' } }, 'igst-cgst-sgst')).toEqual([
      { kind: 'cgst', rate: 9, amount: 18 },
      { kind: 'sgst', rate: 9, amount: 18 },
    ]);
  });

  it('uses IGST for a buyer in another state, or when IGST is forced', () => {
    expect(taxBreakup({ lines, business, party: { name: 'B', gstin: '29BBBBB1111B1Z5' } }, 'igst-cgst-sgst')).toEqual([{ kind: 'igst', rate: 18, amount: 36 }]);
    expect(taxBreakup({ lines, business, party: { name: 'B', gstin: '27BBBBB1111B1Z5' } }, 'igst')).toEqual([{ kind: 'igst', rate: 18, amount: 36 }]);
  });

  it('falls back to CGST + SGST when a state is unknown', () => {
    expect(taxBreakup({ lines, business, party: { name: 'B' } }, 'igst-cgst-sgst')).toHaveLength(2);
  });
});

describe('buildPrintHtml', () => {
  it('prints a tax invoice with defaults', async () => {
    const out = await html({});
    expect(out).toContain('TAX INVOICE');
    expect(out).toContain('&#8377;236.00');
    expect(out).toContain('Balance due');
  });

  it('honours company header switches', async () => {
    const out = await html({ printRegular: { showCompanyName: false, showAddress: false, showPhone: false, showGstin: false } });
    expect(out).not.toContain('class="brand"');
    expect(out).not.toContain('1 Road');
    expect(out).not.toContain('27AAAAA0000A1Z5');
  });

  it('uses the custom document name and language labels', async () => {
    expect(await html({ printNames: { saleInvoice: 'Cash Memo' } })).toContain('CASH MEMO');
    const hindi = await html({ general: { language: 'hindi' } });
    expect(hindi).toContain('कर चालान');
    expect(hindi).toContain('lang="hi"');
  });

  it('applies decimals, date format and grouping', async () => {
    const out = await html({ general: { dateFormat: 'dd/mm/yyyy', amountDecimals: 0 }, printRegular: { amountWithGrouping: true } }, { grandTotal: 123456 });
    expect(out).toContain('21/09/2026');
    expect(out).toContain('&#8377;1,23,456');
  });

  it('shows the composition scheme as a bill of supply with no tax', async () => {
    const out = await html({ taxes: { compositionScheme: true } });
    expect(out).toContain('BILL OF SUPPLY');
    expect(out).toContain('Composition taxable person');
    expect(out).not.toContain('Tax @');
  });

  it('prints reverse charge, amount in words, signature and owner name when asked', async () => {
    const out = await html(
      { taxes: { reverseCharge: true }, general: { ownerNameOnPrint: true }, printRegular: { signatureText: 'For Acme', printReceivedBy: true } },
      { business: { ...business, createdBy: { name: 'Riya Owner' } } },
    );
    expect(out).toContain('Tax payable on reverse charge: Yes');
    expect(out).toContain('Rupees Two Hundred Thirty Six Only');
    expect(out).toContain('For Acme');
    expect(out).toContain('Riya Owner');
    expect(out).toContain('Received by');
  });

  it('shows the tax breakup rows and a round-off row', async () => {
    const out = await html({ printRegular: { taxDetails: true } }, { taxTotal: 36, grandTotal: 237 });
    expect(out).toContain('CGST @ 9%');
    expect(out).toContain('SGST @ 9%');
    expect(out).toContain('Round off');
  });

  it('hides party GSTIN and terms when switched off', async () => {
    const out = await html({ party: { showGstinOnPrint: false }, printRegular: { printTerms: false } }, { terms: 'Pay in 7 days' });
    expect(out).not.toContain('27BBBBB1111B1Z5');
    expect(out).not.toContain('Pay in 7 days');
  });

  it('prints bank details and a UPI QR for sale documents only', async () => {
    const prefs = { printRegular: { bankName: 'HDFC', bankAccountNumber: '123456', upiId: 'acme@upi' } };
    const sale = await html(prefs);
    expect(sale).toContain('HDFC');
    expect(sale).toContain('data:image/png;base64');
    const purchase = await html(prefs, { sale: false, invoiceLike: false, nameKey: undefined, docType: 'PURCHASE_INVOICE', partyLabel: 'supplier' });
    expect(purchase).not.toContain('HDFC');
  });

  it('pads blank rows up to the minimum and prints the total quantity', async () => {
    const out = await html({ printRegular: { minRows: 4 } });
    expect(out.match(/class="blank"/g)).toHaveLength(3);
    expect(out).toContain('Total quantity');
  });
});
