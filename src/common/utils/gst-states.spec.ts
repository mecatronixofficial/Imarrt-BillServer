import { describe, expect, it } from 'vitest';
import { gstinStateCode, gstStateCode, isInterStateSupply } from './gst-states.js';

describe('gstStateCode', () => {
  it('reads state names, codes and "code-name" values', () => {
    expect(gstStateCode('Karnataka')).toBe('29');
    expect(gstStateCode(' tamil  nadu ')).toBe('33');
    expect(gstStateCode('27')).toBe('27');
    expect(gstStateCode('29-Karnataka')).toBe('29');
    expect(gstStateCode('Dadra and Nagar Haveli and Daman and Diu')).toBe('26');
    expect(gstStateCode('Atlantis')).toBeNull();
    expect(gstStateCode('')).toBeNull();
    expect(gstStateCode(null)).toBeNull();
  });
  it('reads the state of a GSTIN', () => {
    expect(gstinStateCode('33AAAAA0000A1Z5')).toBe('33');
    expect(gstinStateCode('XX')).toBeNull();
    expect(gstinStateCode(undefined)).toBeNull();
  });
});

describe('isInterStateSupply', () => {
  it('uses the place of supply first, even for an unregistered buyer', () => {
    expect(isInterStateSupply({ sellerStateCode: '33', placeOfSupply: 'Karnataka' })).toBe(true);
    expect(isInterStateSupply({ sellerStateCode: '33', placeOfSupply: 'Tamil Nadu', buyerGstin: '29BBBBB1111B1Z5' })).toBe(false);
  });
  it('falls back to the buyer GSTIN, then to intra-state when nothing is known', () => {
    expect(isInterStateSupply({ sellerGstin: '33AAAAA0000A1Z5', buyerGstin: '29BBBBB1111B1Z5' })).toBe(true);
    expect(isInterStateSupply({ sellerGstin: '33AAAAA0000A1Z5', buyerGstin: '33BBBBB1111B1Z5' })).toBe(false);
    expect(isInterStateSupply({ sellerStateCode: '33' })).toBe(false);
    expect(isInterStateSupply({ placeOfSupply: 'Kerala' })).toBe(false);
  });
});
