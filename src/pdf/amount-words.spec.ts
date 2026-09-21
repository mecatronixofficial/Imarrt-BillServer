import { describe, expect, it } from 'vitest';
import { amountToWords } from './amount-words.js';

describe('amountToWords', () => {
  it('writes Indian grouping', () => {
    expect(amountToWords(1234, 'indian')).toBe('Rupees One Thousand Two Hundred Thirty Four Only');
    expect(amountToWords(123456, 'indian')).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only');
    expect(amountToWords(12_345_678, 'indian')).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  });

  it('writes international grouping', () => {
    expect(amountToWords(1_234_567, 'international')).toBe('Rupees One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven Only');
  });

  it('includes paise and handles rounding up to the next rupee', () => {
    expect(amountToWords(10.5)).toBe('Rupees Ten and Fifty Paise Only');
    expect(amountToWords(9.999)).toBe('Rupees Ten Only');
  });

  it('handles zero and round numbers', () => {
    expect(amountToWords(0)).toBe('Rupees Zero Only');
    expect(amountToWords(100000)).toBe('Rupees One Lakh Only');
  });
});
