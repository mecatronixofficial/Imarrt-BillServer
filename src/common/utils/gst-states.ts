/**
 * GST state codes (first two digits of a GSTIN) and the place-of-supply rule that decides whether a
 * supply is intra-state (CGST + SGST) or inter-state (IGST).
 */
export const GST_STATE_CODES: Record<string, string> = {
  'Jammu and Kashmir': '01',
  'Himachal Pradesh': '02',
  Punjab: '03',
  Chandigarh: '04',
  Uttarakhand: '05',
  Haryana: '06',
  Delhi: '07',
  Rajasthan: '08',
  'Uttar Pradesh': '09',
  Bihar: '10',
  Sikkim: '11',
  'Arunachal Pradesh': '12',
  Nagaland: '13',
  Manipur: '14',
  Mizoram: '15',
  Tripura: '16',
  Meghalaya: '17',
  Assam: '18',
  'West Bengal': '19',
  Jharkhand: '20',
  Odisha: '21',
  Chhattisgarh: '22',
  'Madhya Pradesh': '23',
  Gujarat: '24',
  'Dadra and Nagar Haveli and Daman and Diu': '26',
  Maharashtra: '27',
  Karnataka: '29',
  Goa: '30',
  Lakshadweep: '31',
  Kerala: '32',
  'Tamil Nadu': '33',
  Puducherry: '34',
  'Andaman and Nicobar Islands': '35',
  Telangana: '36',
  'Andhra Pradesh': '37',
  Ladakh: '38',
  'Other Territory': '97',
};

const BY_LOWER_NAME = new Map(Object.entries(GST_STATE_CODES).map(([name, code]) => [name.toLowerCase(), code]));

/** State code for a state name ("Karnataka"), a code ("29") or a "29-Karnataka" style value; null when unknown. */
export function gstStateCode(value?: string | null): string | null {
  const text = value?.trim();
  if (!text) return null;
  const leading = text.match(/^(\d{2})(?:\b|$)/)?.[1];
  if (leading) return leading;
  return BY_LOWER_NAME.get(text.toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

/** State code of a GSTIN (its first two digits), or null when the GSTIN is missing or malformed. */
export function gstinStateCode(gstin?: string | null): string | null {
  const code = gstin?.trim().slice(0, 2);
  return code && /^\d{2}$/.test(code) ? code : null;
}

/**
 * Inter-state when the seller's state differs from the place of supply. The place of supply is the
 * state chosen on the transaction; without one, the buyer's GSTIN state is used. Unknown either way
 * means intra-state (the safe default for a local sale).
 */
export function isInterStateSupply(input: { sellerStateCode?: string | null; sellerGstin?: string | null; placeOfSupply?: string | null; buyerGstin?: string | null }): boolean {
  const seller = gstStateCode(input.sellerStateCode) ?? gstinStateCode(input.sellerGstin);
  const buyer = gstStateCode(input.placeOfSupply) ?? gstinStateCode(input.buyerGstin);
  return Boolean(seller && buyer && seller !== buyer);
}
