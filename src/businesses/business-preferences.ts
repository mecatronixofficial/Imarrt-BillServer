import { BadRequestException } from '@nestjs/common';

/**
 * Per-company preferences live in one JSON column on `businesses`, grouped in
 * sections that mirror the Settings pages. Each field is declared once here:
 * that declaration provides the defaults, the validation of incoming values and
 * the typed reader used by PDFs and business rules.
 */
type BooleanField = { kind: 'boolean'; default: boolean };
type IntField = { kind: 'int'; default: number; min: number; max: number };
type EnumField = { kind: 'enum'; default: string; values: readonly string[] };
type TextField = { kind: 'text'; default: string; max: number };
type FieldSpec = BooleanField | IntField | EnumField | TextField;
type SectionSpec = Record<string, FieldSpec>;

const bool = (value: boolean): BooleanField => ({ kind: 'boolean', default: value });
const int = (value: number, min: number, max: number): IntField => ({ kind: 'int', default: value, min, max });
const oneOf = (value: string, values: readonly string[]): EnumField => ({ kind: 'enum', default: value, values });
const text = (value: string, max = 200): TextField => ({ kind: 'text', default: value, max });

export const DATE_FORMATS = ['dd-mm-yyyy', 'mm-dd-yyyy', 'dd/mm/yyyy'] as const;
export const PRINT_LANGUAGES = ['english', 'hindi', 'gujarati', 'marathi'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type PrintLanguage = (typeof PRINT_LANGUAGES)[number];

const IMAGE_MAX = 350_000; // a data URL of a downscaled logo or signature
const MESSAGE_MAX = 1000;

export const PREFERENCE_SPECS = {
  general: {
    tinNumber: bool(false),
    itemDescription: bool(true),
    compressImages: bool(true),
    ownerNameOnPrint: bool(false),
    quantityDecimals: int(2, 0, 4),
    amountDecimals: int(2, 0, 4),
    dateFormat: oneOf('dd-mm-yyyy', DATE_FORMATS),
    language: oneOf('english', PRINT_LANGUAGES),
  },
  transaction: {
    autoRoundOff: bool(false),
    negativeStock: bool(true),
    showTimeOnTransaction: bool(false),
    editPriceOnInvoice: bool(true),
    additionalCharges: bool(false),
    autoNumbering: bool(true),
    numberingPrefix: oneOf('invoice', ['invoice', 'bill', 'none']),
  },
  taxes: {
    taxType: oneOf('igst-cgst-sgst', ['igst-cgst-sgst', 'igst', 'cgst-sgst']),
    roundOffTax: bool(false),
    compositionScheme: bool(false),
    reverseCharge: bool(false),
  },
  message: {
    autoShareOnSave: bool(false),
    invoiceMessage: text('Dear {PartyName}, thank you for your business. Your invoice {InvoiceNumber} of {Amount} is attached. — {FirmName}', MESSAGE_MAX),
    paymentReminderMessage: text('Dear {PartyName}, this is a reminder that {Amount} is due against invoice {InvoiceNumber}. Please pay at your earliest convenience. — {FirmName}', MESSAGE_MAX),
    estimateMessage: text('Dear {PartyName}, please find the estimate {EstimateNumber} for {Amount}. — {FirmName}', MESSAGE_MAX),
  },
  party: {
    openingBalance: bool(true),
    partyCategories: bool(true),
    paymentReminders: bool(true),
    defaultPaymentTermDays: int(15, 0, 180),
    showGstinOnPrint: bool(true),
  },
  item: {
    itemCategories: bool(true),
    wholesalePrice: bool(false),
    lowStockAlert: bool(true),
    lowStockThreshold: int(5, 0, 1000),
  },
  printRegular: {
    makeDefault: bool(true),
    repeatHeader: bool(false),
    showCompanyName: bool(true),
    companyLogo: text('', IMAGE_MAX),
    showAddress: bool(true),
    showEmail: bool(false),
    showPhone: bool(true),
    showGstin: bool(true),
    paperSize: oneOf('a4', ['a4', 'a5', 'letter']),
    orientation: oneOf('portrait', ['portrait', 'landscape']),
    companyNameTextSize: int(4, 1, 5),
    invoiceTextSize: int(3, 1, 5),
    printOriginalDuplicate: bool(true),
    extraSpaceTop: int(0, 0, 100),
    expandTable: bool(false),
    minRows: int(0, 0, 40),
    totalItemQuantity: bool(true),
    amountWithDecimal: bool(true),
    receivedAmount: bool(true),
    balanceAmount: bool(true),
    currentBalanceOfParty: bool(false),
    taxDetails: bool(true),
    youSaved: bool(true),
    amountWithGrouping: bool(false),
    amountInWords: bool(true),
    amountInWordsFormat: oneOf('indian', ['indian', 'international']),
    printDescription: bool(true),
    printTerms: bool(true),
    printReceivedBy: bool(false),
    printDeliveredBy: bool(false),
    signatureText: text('Authorized Signatory', 80),
    signatureImage: text('', IMAGE_MAX),
    paymentMode: bool(true),
    printAcknowledgement: bool(false),
    showBankDetails: bool(true),
    bankName: text('', 120),
    bankAccountNumber: text('', 40),
    bankIfsc: text('', 20),
    upiId: text('', 80),
    showUpiQrCode: bool(true),
  },
  printThermal: {
    theme: int(1, 1, 5),
    makeDefault: bool(false),
    pageSize: oneOf('2in', ['2in', '3in', '4in', 'custom']),
    customWidthChars: int(48, 20, 96),
    printingType: oneOf('text', ['text', 'image']),
    boldText: bool(false),
    autoCutPaper: bool(true),
    openCashDrawer: bool(false),
    extraLinesAtEnd: int(0, 0, 20),
    numberOfCopies: int(1, 1, 5),
    showCompanyName: bool(true),
    companyLogo: text('', IMAGE_MAX),
    showAddress: bool(true),
    showEmail: bool(false),
    showPhone: bool(true),
    showGstin: bool(true),
    showSerialNo: bool(true),
    showHsn: bool(false),
    showUnitOfMeasurement: bool(true),
    showMrp: bool(false),
    showItemDescription: bool(false),
    showBatchNo: bool(false),
    showExpDate: bool(false),
    showMfgDate: bool(false),
    showSize: bool(false),
    showModelNo: bool(false),
    showItemSerialNo: bool(false),
    totalItemQuantity: bool(true),
    amountWithDecimal: bool(true),
    receivedAmount: bool(true),
    balanceAmount: bool(true),
    currentBalanceOfParty: bool(false),
    taxDetails: bool(false),
    youSaved: bool(false),
    amountWithGrouping: bool(false),
    amountInWords: bool(false),
    amountInWordsFormat: oneOf('indian', ['indian', 'international']),
    printDescription: bool(false),
    printTerms: bool(true),
  },
  printNames: {
    saleInvoice: text('Tax Invoice', 60),
    estimateQuotation: text('Estimate / Quotation', 60),
    proformaInvoice: text('Proforma Invoice', 60),
    purchaseOrder: text('Purchase Order', 60),
    saleOrder: text('Sale Order', 60),
    deliveryChallan: text('Delivery Challan', 60),
    creditNote: text('Credit Note', 60),
    debitNote: text('Debit Note', 60),
    paymentIn: text('Payment-In Receipt', 60),
    paymentOut: text('Payment-Out Receipt', 60),
  },
  printColumns: {
    showHsnColumn: bool(true),
    showDiscountColumn: bool(true),
    showGstColumn: bool(true),
    showItemCode: bool(false),
    showItemDescription: bool(false),
  },
} as const satisfies Record<string, SectionSpec>;

export type PreferenceSection = keyof typeof PREFERENCE_SPECS;
export const PREFERENCE_SECTIONS = Object.keys(PREFERENCE_SPECS) as PreferenceSection[];

type FieldValue<F> = F extends BooleanField ? boolean : F extends IntField ? number : string;
export type SectionValues<S extends PreferenceSection> = { -readonly [K in keyof (typeof PREFERENCE_SPECS)[S]]: FieldValue<(typeof PREFERENCE_SPECS)[S][K]> };
export type BusinessPreferences = { [S in PreferenceSection]: SectionValues<S> };

export type GeneralPreferences = Omit<SectionValues<'general'>, 'dateFormat' | 'language'> & { dateFormat: DateFormat; language: PrintLanguage };

type Primitive = boolean | number | string;

function readField(spec: FieldSpec, stored: unknown): Primitive {
  switch (spec.kind) {
    case 'boolean':
      return typeof stored === 'boolean' ? stored : spec.default;
    case 'int':
      return typeof stored === 'number' && Number.isInteger(stored) && stored >= spec.min && stored <= spec.max ? stored : spec.default;
    case 'enum':
      return typeof stored === 'string' && spec.values.includes(stored) ? stored : spec.default;
    case 'text':
      return typeof stored === 'string' && stored.length <= spec.max ? stored : spec.default;
  }
}

/** Merges stored JSON over the defaults and drops anything that is not a valid value. */
export function resolveSection<S extends PreferenceSection>(section: S, raw: unknown): SectionValues<S> {
  const stored = raw && typeof raw === 'object' ? ((raw as Record<string, unknown>)[section] as Record<string, unknown> | undefined) : undefined;
  const spec: SectionSpec = PREFERENCE_SPECS[section];
  return Object.fromEntries(Object.entries(spec).map(([key, field]) => [key, readField(field, stored?.[key])])) as SectionValues<S>;
}

export function resolvePreferences(raw: unknown): BusinessPreferences {
  return Object.fromEntries(PREFERENCE_SECTIONS.map((section) => [section, resolveSection(section, raw)])) as BusinessPreferences;
}

export function resolveGeneralPreferences(raw: unknown): GeneralPreferences {
  return resolveSection('general', raw) as GeneralPreferences;
}

export type PreferencePatch = Partial<Record<PreferenceSection, Record<string, Primitive>>>;

/** Strictly validates a client patch; unknown sections, fields and invalid values are rejected. */
export function validatePreferencePatch(body: unknown): PreferencePatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Send an object of preference sections');
  const result: PreferencePatch = {};
  for (const [section, patch] of Object.entries(body as Record<string, unknown>)) {
    if (!(section in PREFERENCE_SPECS)) throw new BadRequestException(`Unknown preference section "${section}"`);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequestException(`"${section}" must be an object`);
    const spec: SectionSpec = PREFERENCE_SPECS[section as PreferenceSection];
    const clean: Record<string, Primitive> = {};
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      const field = spec[key];
      if (!field) throw new BadRequestException(`Unknown preference "${section}.${key}"`);
      // readField falls back to the default for invalid input, so a mismatch means the value was rejected.
      if (readField(field, value) !== value) throw new BadRequestException(`Invalid value for "${section}.${key}"`);
      clean[key] = value as Primitive;
    }
    result[section as PreferenceSection] = clean;
  }
  return result;
}
