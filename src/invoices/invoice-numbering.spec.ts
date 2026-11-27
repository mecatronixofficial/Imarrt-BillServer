import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber, highestSequence, isValidInvoicePrefix, resolveInvoicePrefix } from './invoice-numbering.js';

describe('resolveInvoicePrefix', () => {
  it('fills the date tokens from the invoice date', () => {
    expect(resolveInvoicePrefix('INV-{YYYY}-', new Date('2026-11-27'))).toBe('INV-2026-');
    expect(resolveInvoicePrefix('INV{YY}/', new Date('2026-11-27'))).toBe('INV26/');
    expect(resolveInvoicePrefix('INV/{FY}/', new Date('2026-04-01'))).toBe('INV/26-27/');
    expect(resolveInvoicePrefix('INV/{FY}/', new Date('2026-03-31'))).toBe('INV/25-26/');
    expect(resolveInvoicePrefix('', new Date('2026-11-27'))).toBe('');
  });
});

describe('formatInvoiceNumber', () => {
  it('pads the running number to the chosen digits (two by default)', () => {
    expect(formatInvoiceNumber('INV-', 1)).toBe('INV-01');
    expect(formatInvoiceNumber('INV-', 123)).toBe('INV-123');
    expect(formatInvoiceNumber('INV-2026-', 42, 6)).toBe('INV-2026-000042');
    expect(formatInvoiceNumber('', 1234567)).toBe('1234567');
  });
});

describe('isValidInvoicePrefix', () => {
  it.each(['', 'INV-', 'INV-{YYYY}-', 'SV/{FY}/', '{YY}A', 'BILL_1.'])('accepts %s', (value) => expect(isValidInvoicePrefix(value)).toBe(true));
  it.each(['-INV', 'INV {YYYY}', 'INV-{MM}-', 'INV"', 'A'.repeat(25), 'INV\n'])('rejects %j', (value) => expect(isValidInvoicePrefix(value)).toBe(false));
});

describe('highestSequence', () => {
  it('reads current and legacy branch-prefixed numbers, ignoring other prefixes', () => {
    const numbers = ['INV-2026-000004', 'MAIN-INV-2026-000011', 'BR2-INV-2026-000009', 'INV-2025-000099', 'BILL-2026-000050', 'XYZ-INV-2026-000080', 'INV-2026-ABC'];
    expect(highestSequence(numbers, 'INV-2026-', ['MAIN', 'BR2'])).toBe(11);
    expect(highestSequence([], 'INV-2026-', [])).toBe(0);
  });
  it('compares case-insensitively like the database collation', () => {
    expect(highestSequence(['inv-2026-000003'], 'INV-2026-', [])).toBe(3);
  });
});
