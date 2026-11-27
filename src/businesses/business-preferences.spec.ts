import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PREFERENCE_SECTIONS, PREFERENCE_SPECS, resolveGeneralPreferences, resolvePreferences, resolveSection, validatePreferencePatch } from './business-preferences.js';

describe('resolveSection', () => {
  it('returns defaults when nothing is stored', () => {
    expect(resolveSection('general', null)).toMatchObject({ tinNumber: false, amountDecimals: 2, dateFormat: 'dd-mm-yyyy', language: 'english' });
    expect(Object.keys(resolvePreferences({}))).toEqual(PREFERENCE_SECTIONS);
  });

  it('keeps valid stored values', () => {
    const result = resolveGeneralPreferences({ general: { tinNumber: true, amountDecimals: 3, dateFormat: 'dd/mm/yyyy', language: 'hindi' } });
    expect(result).toMatchObject({ tinNumber: true, amountDecimals: 3, dateFormat: 'dd/mm/yyyy', language: 'hindi', quantityDecimals: 2 });
  });

  it('drops invalid stored values instead of trusting stored JSON', () => {
    const result = resolveSection('general', { general: { tinNumber: 'yes', amountDecimals: 9, quantityDecimals: 1.5, dateFormat: 'x', language: 'klingon' } });
    expect(result).toEqual(resolveSection('general', null));
  });

  it('every section has defaults that satisfy their own rules', () => {
    for (const section of PREFERENCE_SECTIONS) {
      const defaults = resolveSection(section, null);
      expect(() => validatePreferencePatch({ [section]: defaults })).not.toThrow();
      expect(Object.keys(defaults)).toEqual(Object.keys(PREFERENCE_SPECS[section]));
    }
  });
});

describe('validatePreferencePatch', () => {
  it('accepts valid partial updates across sections', () => {
    expect(validatePreferencePatch({ transaction: { autoRoundOff: false, numberingPrefix: 'bill' }, item: { lowStockThreshold: 10 } })).toEqual({
      transaction: { autoRoundOff: false, numberingPrefix: 'bill' },
      item: { lowStockThreshold: 10 },
    });
  });

  it.each([
    [{ nope: {} }],
    [{ general: { nope: true } }],
    [{ general: { amountDecimals: 9 } }],
    [{ general: { tinNumber: 'true' } }],
    [{ transaction: { numberingPrefix: 'x' } }],
    [{ general: 'x' }],
    [[]],
    [null],
  ])('rejects %j', (body) => {
    expect(() => validatePreferencePatch(body)).toThrow(BadRequestException);
  });
});

describe('transaction.invoicePrefix', () => {
  it('keeps the older numbering choice for companies that never set a prefix', () => {
    expect(resolveSection('transaction', null).invoicePrefix).toBe('INV-');
    expect(resolveSection('transaction', { transaction: { numberingPrefix: 'bill' } }).invoicePrefix).toBe('BILL-');
    expect(resolveSection('transaction', { transaction: { numberingPrefix: 'none' } }).invoicePrefix).toBe('');
  });

  it('uses each company\'s own valid prefix, including an empty one', () => {
    expect(resolveSection('transaction', { transaction: { numberingPrefix: 'bill', invoicePrefix: 'SV/{FY}/' } }).invoicePrefix).toBe('SV/{FY}/');
    expect(resolveSection('transaction', { transaction: { invoicePrefix: '' } }).invoicePrefix).toBe('');
    expect(resolveSection('transaction', { transaction: { numberingPrefix: 'bill', invoicePrefix: 'bad prefix"' } }).invoicePrefix).toBe('BILL-');
  });

  it('rejects unsafe prefixes in a settings patch', () => {
    expect(validatePreferencePatch({ transaction: { invoicePrefix: 'INV/{FY}/' } })).toEqual({ transaction: { invoicePrefix: 'INV/{FY}/' } });
    expect(() => validatePreferencePatch({ transaction: { invoicePrefix: 'INV {MM}' } })).toThrow(BadRequestException);
  });
});
