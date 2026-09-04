import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';

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
  business?: {
    name: string;
    legalName?: string | null;
    gstRegistered: boolean;
    gstin?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  party: { name: string; billingAddr?: string | null; phone?: string | null; gstin?: string | null };
  items: Array<{ description: string; quantity: unknown; unitPrice: unknown; taxRate: unknown; lineTotal: unknown }>;
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
  subTotal: unknown;
  taxTotal: unknown;
  discount: unknown;
  grandTotal: unknown;
  business: {
    name: string;
    legalName?: string | null;
    gstRegistered: boolean;
    gstin?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  party?: { name: string; billingAddr?: string | null; phone?: string | null; email?: string | null; gstin?: string | null } | null;
  supplier?: { name: string; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null } | null;
  referenceInvoice?: { invoiceNumber: string } | null;
  items: Array<{
    description: string;
    hsnSac?: string | null;
    quantity: unknown;
    unit: string;
    unitPrice: unknown;
    taxRate: unknown;
    lineTotal: unknown;
  }>;
};

const DOCUMENT_TITLES: Record<string, string> = {
  QUOTATION: 'QUOTATION',
  PROFORMA_INVOICE: 'PROFORMA INVOICE',
  PURCHASE_INVOICE: 'PURCHASE INVOICE',
  DELIVERY_CHALLAN: 'DELIVERY CHALLAN',
  CREDIT_NOTE: 'CREDIT NOTE',
  DEBIT_NOTE: 'DEBIT NOTE',
};

@Injectable()
export class PdfService implements OnModuleDestroy {
  private browserPromise?: Promise<Browser>;

  constructor(private readonly config: ConfigService) {}

  async generateInvoicePdf(invoice: PdfInvoice): Promise<Buffer> {
    return this.renderPdf(this.buildInvoiceHtml(invoice), {
      top: '16mm',
      bottom: '16mm',
      left: '14mm',
      right: '14mm',
    });
  }

  async generateDocumentPdf(document: PdfDocument): Promise<Buffer> {
    return this.renderPdf(this.buildDocumentHtml(document), {
      top: '13mm',
      bottom: '14mm',
      left: '13mm',
      right: '13mm',
    });
  }

  async onModuleDestroy() {
    const browser = await this.browserPromise?.catch(() => undefined);
    await browser?.close();
    this.browserPromise = undefined;
  }

  private async renderPdf(html: string, margin: PDFOptions['margin']): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
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

  private buildDocumentHtml(document: PdfDocument) {
    const businessName = escapeHtml(document.business.legalName || document.business.name);
    const party = document.supplier || document.party;
    const partyLabel = document.supplier ? 'Supplier' : 'Bill to';
    const title = DOCUMENT_TITLES[document.type] || escapeHtml(document.type.replaceAll('_', ' '));
    const gstLabel = document.business.gstRegistered && document.business.gstin
      ? `<div><strong>GSTIN:</strong> ${escapeHtml(document.business.gstin)}</div>`
      : '<div>Non-GST business</div>';
    const rows = document.items.map((item, index) => `
      <tr>
        <td class="muted">${index + 1}</td>
        <td><strong>${escapeHtml(item.description)}</strong>${item.hsnSac ? `<small>HSN/SAC: ${escapeHtml(item.hsnSac)}</small>` : ''}</td>
        <td class="right">${escapeHtml(String(item.quantity))} ${escapeHtml(item.unit)}</td>
        <td class="right">${formatMoney(item.unitPrice)}</td>
        <td class="right">${Number(item.taxRate).toFixed(2)}%</td>
        <td class="right strong">${formatMoney(item.lineTotal)}</td>
      </tr>`).join('');
    const logistics = [
      document.placeOfSupply ? ['Place of supply', document.placeOfSupply] : null,
      document.transportName ? ['Transport', document.transportName] : null,
      document.vehicleNumber ? ['Vehicle number', document.vehicleNumber] : null,
      document.eWayBillNumber ? ['E-way bill', document.eWayBillNumber] : null,
    ].filter(Boolean) as Array<[string, string]>;

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
      * { box-sizing: border-box; }
      body { margin: 0; color: #172033; font-family: Arial, sans-serif; font-size: 11px; }
      .topbar { height: 7px; margin-bottom: 22px; border-radius: 20px; background: linear-gradient(90deg,#2563eb,#4f46e5); }
      .header,.parties,.info-grid { display: flex; justify-content: space-between; gap: 30px; }
      .header { align-items: flex-start; padding-bottom: 18px; }
      .brand { color: #1d4ed8; font-size: 23px; font-weight: 800; }
      .subtle { color: #64748b; line-height: 1.65; }
      .title { text-align: right; }
      .title h1 { margin: 0 0 6px; color: #0f172a; font-size: 23px; letter-spacing: .02em; }
      .number { color: #2563eb; font-size: 12px; font-weight: 700; }
      .status { display: inline-block; margin-top: 9px; border-radius: 99px; background: #eff6ff; color: #1d4ed8; padding: 4px 9px; font-size: 9px; font-weight: 800; letter-spacing: .06em; }
      .parties { border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 15px; margin-bottom: 16px; }
      .party { width: 50%; line-height: 1.6; }
      .party:last-child { text-align: right; }
      .eyebrow { margin-bottom: 5px; color: #94a3b8; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
      .party-name { color: #0f172a; font-size: 13px; font-weight: 700; }
      .info-grid { margin-bottom: 18px; border-bottom: 1px solid #e2e8f0; padding: 0 2px 13px; }
      .info { flex: 1; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
      th { background: #172033; color: #fff; padding: 9px 8px; text-align: left; font-size: 9px; letter-spacing: .05em; text-transform: uppercase; }
      th:first-child { border-radius: 7px 0 0 7px; } th:last-child { border-radius: 0 7px 7px 0; }
      td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; vertical-align: top; }
      td small { display: block; margin-top: 3px; color: #94a3b8; font-size: 8px; }
      .right { text-align: right; } .strong { font-weight: 700; } .muted { color: #94a3b8; }
      .bottom { display: flex; align-items: flex-start; justify-content: space-between; gap: 30px; }
      .terms { width: 55%; color: #64748b; line-height: 1.6; white-space: pre-line; }
      .totals { width: 270px; border-radius: 10px; background: #f8fafc; padding: 11px 14px; }
      .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
      .totals .grand { border-top: 2px solid #2563eb; margin-top: 5px; padding-top: 9px; color: #0f172a; font-size: 14px; font-weight: 800; }
      .note { margin-top: 18px; border-left: 3px solid #818cf8; background: #f5f3ff; padding: 10px 12px; line-height: 1.6; }
      .footer { margin-top: 34px; border-top: 1px solid #e2e8f0; padding-top: 11px; color: #94a3b8; text-align: center; font-size: 9px; }
    </style></head><body>
      <div class="topbar"></div>
      <div class="header">
        <div><div class="brand">${businessName}</div><div class="subtle">
          ${document.business.address ? `<div>${escapeHtml(document.business.address)}</div>` : ''}${gstLabel}
          ${document.business.phone ? `<div>${escapeHtml(document.business.phone)}</div>` : ''}
          ${document.business.email ? `<div>${escapeHtml(document.business.email)}</div>` : ''}
        </div></div>
        <div class="title"><h1>${title}</h1><div class="number">${escapeHtml(document.documentNumber)}</div><span class="status">${escapeHtml(document.status)}</span></div>
      </div>
      <div class="parties">
        <div class="party"><div class="eyebrow">${partyLabel}</div><div class="party-name">${escapeHtml(party?.name || '—')}</div>
          <div>${escapeHtml(('billingAddr' in (party || {}) ? (party as PdfDocument['party'])?.billingAddr : (party as PdfDocument['supplier'])?.address) || '')}</div>
          <div>${escapeHtml(party?.phone || '')}</div><div>${escapeHtml(party?.email || '')}</div>
          ${party?.gstin ? `<div><strong>GSTIN:</strong> ${escapeHtml(party.gstin)}</div>` : ''}
        </div>
        <div class="party"><div class="eyebrow">Issued by</div><div class="party-name">${businessName}</div><div>${escapeHtml(document.business.address || '')}</div></div>
      </div>
      <div class="info-grid">
        <div class="info"><div class="eyebrow">Issue date</div><strong>${formatDate(document.issueDate)}</strong></div>
        ${document.validUntil ? `<div class="info"><div class="eyebrow">Valid until</div><strong>${formatDate(document.validUntil)}</strong></div>` : ''}
        ${document.dueDate ? `<div class="info"><div class="eyebrow">Due date</div><strong>${formatDate(document.dueDate)}</strong></div>` : ''}
        ${document.referenceInvoice ? `<div class="info"><div class="eyebrow">Against invoice</div><strong>${escapeHtml(document.referenceInvoice.invoiceNumber)}</strong></div>` : ''}
        ${document.referenceNumber ? `<div class="info"><div class="eyebrow">Reference</div><strong>${escapeHtml(document.referenceNumber)}</strong></div>` : ''}
      </div>
      ${logistics.length ? `<div class="info-grid">${logistics.map(([label,value]) => `<div class="info"><div class="eyebrow">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : ''}
      <table><thead><tr><th>#</th><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Tax</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="bottom"><div class="terms">${document.reason ? `<div><strong>Reason</strong><br>${escapeHtml(document.reason)}</div><br>` : ''}${document.terms ? `<div><strong>Terms &amp; conditions</strong><br>${escapeHtml(document.terms)}</div>` : ''}</div>
        <div class="totals"><div><span>Subtotal</span><span>${formatMoney(document.subTotal)}</span></div><div><span>Tax</span><span>${formatMoney(document.taxTotal)}</span></div><div><span>Discount</span><span>-${formatMoney(document.discount)}</span></div><div class="grand"><span>Total</span><span>${formatMoney(document.grandTotal)}</span></div></div>
      </div>
      ${document.notes ? `<div class="note"><strong>Notes:</strong> ${escapeHtml(document.notes)}</div>` : ''}
      <div class="footer">This is a computer-generated ${title.toLowerCase()} from ${businessName}.</div>
    </body></html>`;
  }

  private buildInvoiceHtml(invoice: PdfInvoice) {
    const businessName = escapeHtml(invoice.business?.legalName || invoice.business?.name || 'Your Business');
    const gstLabel = invoice.business?.gstRegistered && invoice.business.gstin
      ? `<div>GSTIN: ${escapeHtml(invoice.business.gstin)}</div>`
      : '<div>Non-GST business</div>';
    const rows = invoice.items.map((item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td class="right">${escapeHtml(String(item.quantity))}</td>
        <td class="right">${formatMoney(item.unitPrice)}</td>
        <td class="right">${Number(item.taxRate).toFixed(2)}%</td>
        <td class="right strong">${formatMoney(item.lineTotal)}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
      <html><head><meta charset="utf-8" /><style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #172033; font-size: 12px; margin: 0; }
        .header { display: flex; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 16px; margin-bottom: 22px; }
        .brand { font-size: 22px; font-weight: 700; color: #1d4ed8; }
        .business-meta, .meta { color: #64748b; font-size: 11px; line-height: 1.6; margin-top: 5px; }
        .invoice-title { text-align: right; }
        .invoice-title h1 { margin: 0 0 4px; font-size: 24px; color: #0f172a; }
        .parties { display: flex; justify-content: space-between; margin-bottom: 22px; }
        .party { width: 46%; line-height: 1.6; }
        .party.right { text-align: right; }
        .eyebrow { margin-bottom: 5px; color: #94a3b8; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        th { background: #f1f5f9; color: #64748b; padding: 9px; text-align: left; font-size: 10px; text-transform: uppercase; }
        td { border-bottom: 1px solid #e2e8f0; padding: 9px; }
        .right { text-align: right; }
        .strong { font-weight: 700; }
        .totals { width: 285px; margin-left: auto; }
        .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
        .totals .grand { border-top: 2px solid #2563eb; margin-top: 5px; padding-top: 9px; font-size: 15px; font-weight: 700; }
        .status { display: inline-block; margin-top: 6px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; padding: 4px 9px; font-size: 10px; font-weight: 700; }
        .notes { margin-top: 24px; border-radius: 8px; background: #f8fafc; padding: 12px; }
        .footer { margin-top: 36px; color: #94a3b8; text-align: center; font-size: 10px; }
      </style></head><body>
        <div class="header">
          <div>
            <div class="brand">${businessName}</div>
            <div class="business-meta">
              ${invoice.business?.address ? `<div>${escapeHtml(invoice.business.address)}</div>` : ''}
              ${gstLabel}
              ${invoice.business?.phone ? `<div>${escapeHtml(invoice.business.phone)}</div>` : ''}
            </div>
          </div>
          <div class="invoice-title">
            <h1>${invoice.business?.gstRegistered ? 'TAX INVOICE' : 'INVOICE'}</h1>
            <div class="meta">${escapeHtml(invoice.invoiceNumber)}</div>
            <span class="status">${escapeHtml(invoice.status.replaceAll('_', ' '))}</span>
          </div>
        </div>
        <div class="parties">
          <div class="party">
            <div class="eyebrow">Billed to</div>
            <div class="strong">${escapeHtml(invoice.party.name)}</div>
            <div>${escapeHtml(invoice.party.billingAddr || '')}</div>
            <div>${escapeHtml(invoice.party.phone || '')}</div>
            ${invoice.party.gstin ? `<div>GSTIN: ${escapeHtml(invoice.party.gstin)}</div>` : ''}
          </div>
          <div class="party right">
            <div class="eyebrow">Invoice date</div>
            <div>${formatDate(invoice.issueDate)}</div>
            <div class="eyebrow" style="margin-top:10px">Due date</div>
            <div>${invoice.dueDate ? formatDate(invoice.dueDate) : '&mdash;'}</div>
          </div>
        </div>
        <table><thead><tr>
          <th>Description</th><th class="right">Qty</th><th class="right">Unit price</th>
          <th class="right">${invoice.business?.gstRegistered ? 'GST' : 'Tax'}</th><th class="right">Amount</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="totals">
          <div><span>Subtotal</span><span>${formatMoney(invoice.subTotal)}</span></div>
          <div><span>${invoice.business?.gstRegistered ? 'GST' : 'Tax'}</span><span>${formatMoney(invoice.taxTotal)}</span></div>
          <div><span>Discount</span><span>-${formatMoney(invoice.discount)}</span></div>
          <div class="grand"><span>Total</span><span>${formatMoney(invoice.grandTotal)}</span></div>
          <div><span>Paid</span><span>${formatMoney(invoice.amountPaid)}</span></div>
          <div class="strong"><span>Balance due</span><span>${formatMoney(Number(invoice.grandTotal) - Number(invoice.amountPaid))}</span></div>
        </div>
        ${invoice.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</div>` : ''}
        <div class="footer">Thank you for your business &mdash; generated by ${businessName}</div>
      </body></html>`;
  }
}

function formatMoney(value: unknown) {
  const amount = Number(value);
  return `&#8377;${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
