import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';
import QRCode from 'qrcode';
import { resolvePreferences, type BusinessPreferences } from '../businesses/business-preferences.js';
import { amountToWords } from './amount-words.js';
import { PDF_LABELS, PdfLabels } from './pdf-labels.js';

type PdfBusiness = {
  name: string;
  legalName?: string | null;
  gstRegistered: boolean;
  gstin?: string | null;
  tin?: string | null;
  stateCode?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  preferences?: unknown;
  createdBy?: { name: string } | null;
};

type PdfPerson = { name: string; billingAddr?: string | null; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null; tin?: string | null };

type PdfItem = {
  description: string;
  hsnSac?: string | null;
  quantity: unknown;
  unit?: string | null;
  unitPrice: unknown;
  taxRate: unknown;
  lineTotal: unknown;
  item?: { sku?: string | null; description?: string | null } | null;
};

type PdfInvoice = {
  invoiceNumber: string;
  status: string;
  issueDate: string | Date;
  dueDate?: string | Date | null;
  subTotal: unknown;
  taxTotal: unknown;
  discount: unknown;
  grandTotal: unknown;
  amountPaid: unknown;
  notes?: string | null;
  business?: PdfBusiness | null;
  party: PdfPerson;
  items: PdfItem[];
  payments?: Array<{ method?: string | null }> | null;
  /** Set by the caller when the company prints the party's running balance. */
  partyBalance?: number;
};

type PdfDocument = {
  documentNumber: string;
  type: string;
  status: string;
  issueDate: string | Date;
  validUntil?: string | Date | null;
  dueDate?: string | Date | null;
  placeOfSupply?: string | null;
  transportName?: string | null;
  vehicleNumber?: string | null;
  eWayBillNumber?: string | null;
  referenceNumber?: string | null;
  reason?: string | null;
  terms?: string | null;
  notes?: string | null;
  paymentMethod?: string | null;
  subTotal: unknown;
  taxTotal: unknown;
  discount: unknown;
  grandTotal: unknown;
  business: PdfBusiness;
  party?: PdfPerson | null;
  supplier?: PdfPerson | null;
  referenceInvoice?: { invoiceNumber: string } | null;
  items: PdfItem[];
};

/** Everything a printed page needs, whether it started as a sale invoice or a business document. */
export type PrintModel = {
  invoiceLike: boolean;
  sale: boolean;
  nameKey?: keyof typeof DEFAULT_NAMES;
  docType?: string;
  number: string;
  status: string;
  issueDate: string | Date;
  validUntil?: string | Date | null;
  dueDate?: string | Date | null;
  referenceNumber?: string | null;
  againstInvoice?: string | null;
  logistics: Array<[string, string]>;
  business: PdfBusiness;
  party?: PdfPerson | null;
  partyLabel: 'billedTo' | 'billTo' | 'supplier';
  lines: PdfItem[];
  subTotal: number;
  taxTotal: number;
  discount: number;
  grandTotal: number;
  paid: number;
  paymentMode: string;
  partyBalance?: number;
  notes?: string | null;
  terms?: string | null;
  reason?: string | null;
};

const DEFAULT_NAMES = {
  saleInvoice: 'Tax Invoice',
  estimateQuotation: 'Estimate / Quotation',
  proformaInvoice: 'Proforma Invoice',
  deliveryChallan: 'Delivery Challan',
  creditNote: 'Credit Note',
  debitNote: 'Debit Note',
} as const;

const NAME_KEY_BY_TYPE: Record<string, PrintModel['nameKey']> = {
  QUOTATION: 'estimateQuotation',
  PROFORMA_INVOICE: 'proformaInvoice',
  DELIVERY_CHALLAN: 'deliveryChallan',
  CREDIT_NOTE: 'creditNote',
  DEBIT_NOTE: 'debitNote',
};

const PRINT_FONT_STACK = "Arial, 'Noto Sans Devanagari', 'Noto Sans Gujarati', 'Nirmala UI', 'Mangal', 'Shruti', sans-serif";
const HTML_LANG = { english: 'en', hindi: 'hi', gujarati: 'gu', marathi: 'mr' } as const;
const BASE_FONT_PX: Record<number, number> = { 1: 9, 2: 10, 3: 11, 4: 12.5, 5: 14 };
const COMPANY_FONT_PX: Record<number, number> = { 1: 16, 2: 19, 3: 22, 4: 26, 5: 30 };
const PAPER_FORMAT = { a4: 'A4', a5: 'A5', letter: 'Letter' } as const;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class PdfService implements OnModuleDestroy {
  private browserPromise?: Promise<Browser>;

  constructor(private readonly config: ConfigService) {}

  async generateInvoicePdf(invoice: PdfInvoice): Promise<Buffer> {
    const business = invoice.business ?? { name: 'Your Business', gstRegistered: false };
    const model: PrintModel = {
      invoiceLike: true,
      sale: true,
      nameKey: 'saleInvoice',
      number: invoice.invoiceNumber,
      status: invoice.status.replaceAll('_', ' '),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      logistics: [],
      business,
      party: invoice.party,
      partyLabel: 'billedTo',
      lines: invoice.items,
      subTotal: num(invoice.subTotal),
      taxTotal: num(invoice.taxTotal),
      discount: num(invoice.discount),
      grandTotal: num(invoice.grandTotal),
      paid: num(invoice.amountPaid),
      paymentMode: invoice.payments?.length ? String(invoice.payments[invoice.payments.length - 1].method ?? '') : '',
      partyBalance: invoice.partyBalance,
      notes: invoice.notes,
    };
    return this.render(model);
  }

  async generateDocumentPdf(document: PdfDocument): Promise<Buffer> {
    const supplierDocument = Boolean(document.supplier);
    const logistics = [
      document.placeOfSupply ? ['placeOfSupply', document.placeOfSupply] : null,
      document.transportName ? ['transport', document.transportName] : null,
      document.vehicleNumber ? ['vehicleNumber', document.vehicleNumber] : null,
      document.eWayBillNumber ? ['eWayBill', document.eWayBillNumber] : null,
    ].filter(Boolean) as Array<[string, string]>;
    const model: PrintModel = {
      invoiceLike: false,
      sale: !['PURCHASE_INVOICE', 'DEBIT_NOTE'].includes(document.type),
      nameKey: NAME_KEY_BY_TYPE[document.type],
      docType: document.type,
      number: document.documentNumber,
      status: document.status,
      issueDate: document.issueDate,
      validUntil: document.validUntil,
      dueDate: document.dueDate,
      referenceNumber: document.referenceNumber,
      againstInvoice: document.referenceInvoice?.invoiceNumber,
      logistics,
      business: document.business,
      party: document.supplier || document.party,
      partyLabel: supplierDocument ? 'supplier' : 'billTo',
      lines: document.items,
      subTotal: num(document.subTotal),
      taxTotal: num(document.taxTotal),
      discount: num(document.discount),
      grandTotal: num(document.grandTotal),
      paid: 0,
      paymentMode: document.paymentMethod ?? '',
      notes: document.notes,
      terms: document.terms,
      reason: document.reason,
    };
    return this.render(model);
  }

  async onModuleDestroy() {
    const browser = await this.browserPromise?.catch(() => undefined);
    await browser?.close();
    this.browserPromise = undefined;
  }

  private async render(model: PrintModel): Promise<Buffer> {
    const preferences = resolvePreferences(model.business.preferences);
    const { printRegular: print } = preferences;
    const html = await buildPrintHtml(model, preferences);
    const margin: PDFOptions['margin'] = { top: '13mm', bottom: '14mm', left: '13mm', right: '13mm' };
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: PAPER_FORMAT[print.paperSize as keyof typeof PAPER_FORMAT] ?? 'A4',
        landscape: print.orientation === 'landscape',
        printBackground: true,
        margin,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      const disableSandbox = this.config.get<string>('PUPPETEER_NO_SANDBOX') === 'true';
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          args: disableSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
        })
        .then((browser) => {
          browser.on('disconnected', () => {
            this.browserPromise = undefined;
          });
          return browser;
        })
        .catch((error) => {
          this.browserPromise = undefined;
          throw error;
        });
    }
    return this.browserPromise;
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** Tax split for the printed breakup: one row set per tax rate, intra-state (CGST+SGST) or inter-state (IGST). */
export type BreakupRow = { kind: 'cgst' | 'sgst' | 'igst'; rate: number; amount: number };

export function taxBreakup(model: Pick<PrintModel, 'lines' | 'business' | 'party'>, taxType: string): BreakupRow[] {
  const taxable = new Map<number, number>();
  for (const line of model.lines) {
    const rate = num(line.taxRate);
    if (rate <= 0) continue;
    taxable.set(rate, (taxable.get(rate) ?? 0) + num(line.quantity) * num(line.unitPrice));
  }
  const sellerState = model.business.stateCode?.trim() || model.business.gstin?.slice(0, 2);
  const buyerState = model.party?.gstin?.slice(0, 2);
  const interState = taxType === 'igst' || (taxType === 'igst-cgst-sgst' && Boolean(sellerState) && Boolean(buyerState) && sellerState !== buyerState);
  return [...taxable.entries()].sort(([a], [b]) => a - b).flatMap(([rate, base]): BreakupRow[] => {
    const amount = round2(base * rate / 100);
    if (interState) return [{ kind: 'igst', rate, amount }];
    const half = round2(amount / 2);
    return [{ kind: 'cgst', rate: rate / 2, amount: half }, { kind: 'sgst', rate: rate / 2, amount: round2(amount - half) }];
  });
}

export async function buildPrintHtml(model: PrintModel, preferences: BusinessPreferences): Promise<string> {
  const { general, taxes, party: partyPrefs, printRegular: p, printNames: names, printColumns: columns } = preferences;
  const t: PdfLabels = PDF_LABELS[general.language as keyof typeof PDF_LABELS];
  const business = model.business;
  const composition = model.sale && taxes.compositionScheme;
  const taxApplies = !composition && (model.sale ? business.gstRegistered : true);

  const decimals = p.amountWithDecimal ? general.amountDecimals : 0;
  const money = (value: number) => {
    const text = p.amountWithGrouping
      ? value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : value.toFixed(decimals);
    return `&#8377;${text}`;
  };
  const qty = (value: unknown) => num(value).toFixed(general.quantityDecimals);
  const date = (value: string | Date) => formatDate(value, general.dateFormat);
  const tinLine = (tin: string | null | undefined) => (general.tinNumber && tin ? `<div>${t.tin}: ${escapeHtml(tin)}</div>` : '');

  // ---- title
  let title: string;
  const customName = model.nameKey ? names[model.nameKey] : undefined;
  const usesDefaultName = !model.nameKey || customName === DEFAULT_NAMES[model.nameKey];
  if (composition && model.nameKey === 'saleInvoice' && usesDefaultName) title = t.billOfSupply;
  else if (model.nameKey === 'saleInvoice' && usesDefaultName) title = business.gstRegistered ? t.taxInvoice : t.invoice;
  else if (model.docType && usesDefaultName) title = t.documentTitles[model.docType] ?? model.docType.replaceAll('_', ' ');
  else if (customName) title = customName.toUpperCase();
  else title = t.documentTitles[model.docType ?? ''] ?? (model.docType ?? '').replaceAll('_', ' ');
  const safeTitle = escapeHtml(title);

  // ---- header
  const businessName = escapeHtml(business.legalName || business.name);
  const logo = p.companyLogo.startsWith('data:image/') ? `<img class="logo" src="${escapeHtml(p.companyLogo)}" alt="" />` : '';
  const gstLine = p.showGstin
    ? (business.gstRegistered && business.gstin ? `<div><strong>${t.gstin}:</strong> ${escapeHtml(business.gstin)}</div>` : `<div>${t.nonGst}</div>`) + tinLine(business.tin)
    : '';
  const contact = [p.showPhone && business.phone ? escapeHtml(business.phone) : '', p.showEmail && business.email ? escapeHtml(business.email) : ''].filter(Boolean).join(' &middot; ');
  const header = `
    <div class="header">
      <div class="brandrow">${logo}<div>
        ${p.showCompanyName ? `<div class="brand">${businessName}</div>` : ''}
        <div class="subtle">${p.showAddress && business.address ? `<div>${escapeHtml(business.address)}</div>` : ''}${gstLine}${contact ? `<div>${contact}</div>` : ''}</div>
      </div></div>
      <div class="title"><h1>${safeTitle}</h1><div class="number">${escapeHtml(model.number)}</div><span class="status">${escapeHtml(model.status)}</span>${p.printOriginalDuplicate ? `<div class="original">${t.originalForRecipient}</div>` : ''}</div>
    </div>`;

  // ---- parties
  const party = model.party;
  const partyAddress = party ? party.billingAddr || party.address || '' : '';
  const partyBlock = `
    <div class="parties">
      <div class="party"><div class="eyebrow">${t[model.partyLabel]}</div><div class="party-name">${escapeHtml(party?.name || '—')}</div>
        <div>${escapeHtml(partyAddress)}</div><div>${escapeHtml(party?.phone || '')}</div><div>${escapeHtml(party?.email || '')}</div>
        ${partyPrefs.showGstinOnPrint && party?.gstin ? `<div><strong>${t.gstin}:</strong> ${escapeHtml(party.gstin)}</div>` : ''}${tinLine(party?.tin)}
      </div>
      <div class="party"><div class="eyebrow">${t.issuedBy}</div><div class="party-name">${businessName}</div><div>${p.showAddress ? escapeHtml(business.address || '') : ''}</div></div>
    </div>`;

  const infos: Array<[string, string]> = [[model.invoiceLike ? t.invoiceDate : t.issueDate, date(model.issueDate)]];
  if (model.validUntil) infos.push([t.validUntil, date(model.validUntil)]);
  if (model.dueDate) infos.push([t.dueDate, date(model.dueDate)]);
  if (model.againstInvoice) infos.push([t.againstInvoice, model.againstInvoice]);
  if (model.referenceNumber) infos.push([t.reference, model.referenceNumber]);
  const infoGrid = `<div class="info-grid">${infos.map(([label, value]) => `<div class="info"><div class="eyebrow">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`;
  const logisticsGrid = model.logistics.length
    ? `<div class="info-grid">${model.logistics.map(([key, value]) => `<div class="info"><div class="eyebrow">${t[key as keyof PdfLabels] as string}</div><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`
    : '';

  // ---- items
  const showTaxColumn = taxApplies && columns.showGstColumn;
  const rows = model.lines.map((line, index) => {
    const detail = [
      columns.showItemCode && line.item?.sku ? `${t.itemCode}: ${escapeHtml(line.item.sku)}` : '',
      columns.showItemDescription && line.item?.description ? escapeHtml(line.item.description) : '',
      columns.showHsnColumn && line.hsnSac ? `${t.hsnSac}: ${escapeHtml(line.hsnSac)}` : '',
    ].filter(Boolean).map((text) => `<small>${text}</small>`).join('');
    return `<tr><td class="muted">${index + 1}</td><td><strong>${escapeHtml(line.description)}</strong>${detail}</td>
      <td class="right">${qty(line.quantity)}${line.unit ? ` ${escapeHtml(line.unit)}` : ''}</td><td class="right">${money(num(line.unitPrice))}</td>
      ${showTaxColumn ? `<td class="right">${num(line.taxRate).toFixed(2)}%</td>` : ''}<td class="right strong">${money(num(line.lineTotal))}</td></tr>`;
  });
  const columnCount = showTaxColumn ? 6 : 5;
  for (let index = model.lines.length; index < p.minRows; index += 1) rows.push(`<tr class="blank">${'<td>&nbsp;</td>'.repeat(columnCount)}</tr>`);
  const totalQuantity = model.lines.reduce((sum, line) => sum + num(line.quantity), 0);
  const footRow = p.totalItemQuantity
    ? `<tfoot><tr><td></td><td class="strong">${t.totalQty}</td><td class="right strong">${qty(totalQuantity)}</td><td colspan="${columnCount - 3}"></td></tr></tfoot>`
    : '';
  const table = `<table class="items${p.expandTable ? ' expand' : ''}"><thead><tr><th>#</th><th>${t.description}</th><th class="right">${t.qty}</th><th class="right">${t.rate}</th>${showTaxColumn ? `<th class="right">${model.sale && model.invoiceLike && business.gstRegistered ? t.gst : t.tax}</th>` : ''}<th class="right">${t.amount}</th></tr></thead><tbody>${rows.join('')}</tbody>${footRow}</table>`;

  // ---- totals
  const totalRows: string[] = [`<div><span>${t.subtotal}</span><span>${money(model.subTotal)}</span></div>`];
  let breakupSum = 0;
  if (taxApplies) {
    if (p.taxDetails) {
      const breakup = taxBreakup(model, taxes.taxType);
      if (breakup.length) totalRows.push(`<div><span>${t.taxableAmount}</span><span>${money(model.subTotal)}</span></div>`);
      for (const row of breakup) {
        breakupSum += row.amount;
        totalRows.push(`<div class="sub"><span>${t[row.kind]} @ ${row.rate}%</span><span>${money(row.amount)}</span></div>`);
      }
      const taxDifference = round2(model.taxTotal - breakupSum);
      if (Math.abs(taxDifference) >= 0.005) totalRows.push(`<div class="sub"><span>${breakup.length ? t.taxRoundOff : t.tax}</span><span>${money(taxDifference)}</span></div>`);
    } else {
      totalRows.push(`<div><span>${model.sale && business.gstRegistered ? t.gst : t.tax}</span><span>${money(model.taxTotal)}</span></div>`);
    }
  }
  totalRows.push(`<div><span>${t.discount}</span><span>-${money(model.discount)}</span></div>`);
  const roundOff = round2(model.grandTotal - (model.subTotal + model.taxTotal - model.discount));
  if (Math.abs(roundOff) >= 0.005) totalRows.push(`<div class="sub"><span>${t.roundOff}</span><span>${roundOff < 0 ? '-' : ''}${money(Math.abs(roundOff))}</span></div>`);
  totalRows.push(`<div class="grand"><span>${t.total}</span><span>${money(model.grandTotal)}</span></div>`);
  if (p.youSaved && model.discount > 0) totalRows.push(`<div class="sub"><span>${t.youSaved}</span><span>${money(model.discount)}</span></div>`);
  if (model.invoiceLike) {
    if (p.receivedAmount) totalRows.push(`<div><span>${t.received}</span><span>${money(model.paid)}</span></div>`);
    if (p.balanceAmount) totalRows.push(`<div class="strong"><span>${t.balanceDue}</span><span>${money(Math.max(0, model.grandTotal - model.paid))}</span></div>`);
  }
  if (p.currentBalanceOfParty && model.partyBalance !== undefined) totalRows.push(`<div class="sub"><span>${t.partyBalance}</span><span>${money(model.partyBalance)}</span></div>`);
  if (p.paymentMode && model.paymentMode) totalRows.push(`<div class="sub"><span>${t.paymentMode}</span><span>${escapeHtml(model.paymentMode)}</span></div>`);

  const words = p.amountInWords ? `<div class="words"><span class="eyebrow">${t.amountInWords}</span><br>${escapeHtml(amountToWords(model.grandTotal, p.amountInWordsFormat as 'indian' | 'international'))}</div>` : '';

  // ---- notes, terms and tax notices
  const notices: string[] = [];
  if (composition) notices.push(`<div class="notice">${t.compositionNote}</div>`);
  if (model.sale && taxes.reverseCharge && !composition) notices.push(`<div class="notice">${t.reverseCharge}: ${t.yes}</div>`);
  const terms = [
    model.reason ? `<div><strong>${t.reason}</strong><br>${escapeHtml(model.reason)}</div><br>` : '',
    p.printTerms && model.terms ? `<div><strong>${t.terms}</strong><br>${escapeHtml(model.terms)}</div>` : '',
  ].join('');

  // ---- bank and UPI
  let bank = '';
  const hasBank = Boolean(p.bankName || p.bankAccountNumber || p.bankIfsc);
  if (model.sale && p.showBankDetails && (hasBank || p.upiId)) {
    let qr = '';
    if (p.showUpiQrCode && p.upiId) {
      const due = model.invoiceLike ? Math.max(0, model.grandTotal - model.paid) : model.grandTotal;
      const link = `upi://pay?pa=${encodeURIComponent(p.upiId)}&pn=${encodeURIComponent(business.legalName || business.name)}&cu=INR${due > 0 ? `&am=${due.toFixed(2)}` : ''}&tn=${encodeURIComponent(model.number)}`;
      qr = `<div class="qr"><img src="${await QRCode.toDataURL(link, { margin: 1, width: 150 })}" alt="" /><div>${t.scanToPay}</div></div>`;
    }
    bank = `<div class="bank"><div><div class="eyebrow">${t.bankDetails}</div>
      ${p.bankName ? `<div>${t.bankName}: <strong>${escapeHtml(p.bankName)}</strong></div>` : ''}${p.bankAccountNumber ? `<div>${t.accountNumber}: <strong>${escapeHtml(p.bankAccountNumber)}</strong></div>` : ''}${p.bankIfsc ? `<div>${t.ifsc}: <strong>${escapeHtml(p.bankIfsc)}</strong></div>` : ''}${p.upiId ? `<div>${t.upiId}: <strong>${escapeHtml(p.upiId)}</strong></div>` : ''}
    </div>${qr}</div>`;
  }

  // ---- signatures
  const signBoxes = [
    p.printReceivedBy ? `<div class="sign"><div class="line"></div>${t.receivedBy}</div>` : '',
    p.printDeliveredBy ? `<div class="sign"><div class="line"></div>${t.deliveredBy}</div>` : '',
  ].join('');
  const signatureImage = p.signatureImage.startsWith('data:image/') ? `<img class="signature" src="${escapeHtml(p.signatureImage)}" alt="" />` : '';
  const signatoryLabel = p.signatureText === 'Authorized Signatory' ? t.signatory : escapeHtml(p.signatureText);
  const ownerName = general.ownerNameOnPrint && business.createdBy?.name ? `<strong>${escapeHtml(business.createdBy.name)}</strong>` : '';
  const signatory = `<div class="sign right-sign">${signatureImage}<div class="line"></div>${signatoryLabel}${ownerName}</div>`;
  const acknowledgement = p.printAcknowledgement ? `<div class="ack">${t.acknowledgement}<div class="ack-sign">${t.receivedBy}: ____________________</div></div>` : '';

  const body = `
    ${partyBlock}${infoGrid}${logisticsGrid}${table}
    <div class="bottom"><div class="terms">${terms}${notices.join('')}${bank}</div><div class="totals">${totalRows.join('')}</div></div>
    ${words}
    ${p.printDescription && model.notes ? `<div class="note"><strong>${t.notes}:</strong> ${escapeHtml(model.notes)}</div>` : ''}
    <div class="signs">${signBoxes}${signatory}</div>
    ${acknowledgement}
    <div class="footer">${model.invoiceLike && !model.docType ? t.thanks(businessName) : t.computerGenerated(safeTitle, businessName)}</div>`;

  const content = p.repeatHeader
    ? `<table class="wrap"><thead><tr><td>${header}</td></tr></thead><tbody><tr><td>${body}</td></tr></tbody></table>`
    : `${header}${body}`;

  const baseSize = BASE_FONT_PX[p.invoiceTextSize] ?? 11;
  const companySize = COMPANY_FONT_PX[p.companyNameTextSize] ?? 26;
  const small = Math.max(8, baseSize - 2);
  return `<!DOCTYPE html><html lang="${HTML_LANG[general.language as keyof typeof HTML_LANG]}"><head><meta charset="utf-8" /><style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #172033; font-family: ${PRINT_FONT_STACK}; font-size: ${baseSize}px; }
      .wrap { width: 100%; border-collapse: collapse; } .wrap > thead > tr > td, .wrap > tbody > tr > td { padding: 0; border: 0; }
      .topbar { height: 7px; margin-bottom: 18px; border-radius: 20px; background: linear-gradient(90deg,#2563eb,#4f46e5); }
      .header,.parties,.info-grid,.bank { display: flex; justify-content: space-between; gap: 30px; }
      .header { align-items: flex-start; padding-bottom: 16px; }
      .brandrow { display: flex; align-items: center; gap: 12px; } .logo { max-height: 56px; max-width: 120px; object-fit: contain; }
      .brand { color: #1d4ed8; font-size: ${companySize}px; font-weight: 800; }
      .subtle { color: #64748b; line-height: 1.65; }
      .title { text-align: right; }
      .title h1 { margin: 0 0 6px; color: #0f172a; font-size: ${Math.round(baseSize * 2.1)}px; letter-spacing: .02em; }
      .number { color: #2563eb; font-size: ${baseSize + 1}px; font-weight: 700; }
      .status { display: inline-block; margin-top: 8px; border-radius: 99px; background: #eff6ff; color: #1d4ed8; padding: 4px 9px; font-size: ${small}px; font-weight: 800; letter-spacing: .06em; }
      .original { margin-top: 6px; color: #64748b; font-size: ${small}px; font-weight: 700; letter-spacing: .08em; }
      .parties { border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 14px; margin-bottom: 14px; }
      .party { width: 50%; line-height: 1.6; } .party:last-child { text-align: right; }
      .eyebrow { margin-bottom: 4px; color: #94a3b8; font-size: ${small}px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      .party-name { color: #0f172a; font-size: ${baseSize + 2}px; font-weight: 700; }
      .info-grid { margin-bottom: 14px; border-bottom: 1px solid #e2e8f0; padding: 0 2px 12px; } .info { flex: 1; }
      table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      table.items.expand tbody { height: 90mm; } table.items.expand td { border-right: 1px solid #f1f5f9; }
      th { background: #172033; color: #fff; padding: 8px; text-align: left; font-size: ${small}px; letter-spacing: .05em; text-transform: uppercase; }
      th:first-child { border-radius: 7px 0 0 7px; } th:last-child { border-radius: 0 7px 7px 0; }
      td { border-bottom: 1px solid #e2e8f0; padding: 9px 8px; vertical-align: top; }
      tr.blank td { height: 26px; }
      tfoot td { border-bottom: 0; border-top: 2px solid #172033; }
      td small { display: block; margin-top: 3px; color: #94a3b8; font-size: ${Math.max(7, baseSize - 3)}px; }
      .right { text-align: right; } .strong { font-weight: 700; } .muted { color: #94a3b8; }
      .bottom { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
      .terms { width: 55%; color: #64748b; line-height: 1.6; white-space: pre-line; }
      .totals { width: 280px; border-radius: 10px; background: #f8fafc; padding: 10px 14px; }
      .totals div { display: flex; justify-content: space-between; padding: 4px 0; } .totals .sub { color: #64748b; font-size: ${Math.max(8, baseSize - 1)}px; padding-left: 8px; }
      .totals .grand { border-top: 2px solid #2563eb; margin-top: 5px; padding-top: 8px; color: #0f172a; font-size: ${baseSize + 3}px; font-weight: 800; }
      .words { margin-top: 12px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-weight: 700; }
      .notice { margin-top: 8px; color: #92400e; font-weight: 700; white-space: normal; }
      .bank { margin-top: 12px; align-items: center; justify-content: flex-start; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; white-space: normal; color: #172033; }
      .qr { text-align: center; font-size: ${small}px; } .qr img { width: 90px; height: 90px; }
      .note { margin-top: 14px; border-left: 3px solid #818cf8; background: #f5f3ff; padding: 9px 12px; line-height: 1.6; }
      .signs { display: flex; justify-content: flex-end; gap: 40px; margin-top: 34px; }
      .sign { min-width: 150px; text-align: center; } .sign .line { border-top: 1px solid #94a3b8; margin-bottom: 4px; }
      .sign strong { display: block; margin-top: 2px; } .right-sign { margin-left: auto; } .signature { max-height: 50px; max-width: 150px; display: block; margin: 0 auto 2px; }
      .ack { margin-top: 22px; border: 1px dashed #94a3b8; border-radius: 8px; padding: 10px 12px; } .ack-sign { margin-top: 18px; text-align: right; }
      .footer { margin-top: 26px; border-top: 1px solid #e2e8f0; padding-top: 10px; color: #94a3b8; text-align: center; font-size: ${small}px; }
    </style></head><body>
      ${p.extraSpaceTop > 0 ? `<div style="height:${p.extraSpaceTop}mm"></div>` : ''}<div class="topbar"></div>
      ${content}
    </body></html>`;
}

function formatDate(value: string | Date, format: string) {
  const date = new Date(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  if (format === 'mm-dd-yyyy') return `${month}-${day}-${year}`;
  if (format === 'dd/mm/yyyy') return `${day}/${month}/${year}`;
  return `${day}-${month}-${year}`;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
