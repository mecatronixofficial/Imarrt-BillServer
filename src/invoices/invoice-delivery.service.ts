import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceDeliveryChannel, InvoiceDeliveryStatus } from '@prisma/client';
import { Resend } from 'resend';
import { AuditService } from '../common/utils/audit.service';
import { decryptField } from '../common/utils/encryption.util';
import { PdfService } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoiceDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async deliver(invoiceId: string, businessId: string, channels: InvoiceDeliveryChannel[], userId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: { items: true, party: true, business: true, branch: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('A cancelled invoice cannot be sent');

    const uniqueChannels = [...new Set(channels)];
    if (uniqueChannels.length === 0) throw new BadRequestException('Select at least one delivery channel');

    const party = {
      ...invoice.party,
      gstin: invoice.party.gstin ? decryptField(invoice.party.gstin) : null,
    };
    const business = invoice.business
      ? { ...invoice.business, gstin: invoice.business.gstin ? decryptField(invoice.business.gstin) : null }
      : null;
    const pdfBuffer = await this.pdf.generateInvoicePdf({ ...invoice, party, business });

    const results = [];
    for (const channel of uniqueChannels) {
      if (channel === InvoiceDeliveryChannel.WHATSAPP && !party.whatsappOptIn) {
        results.push(await this.recordFailure(invoiceId, channel, '', 'Party WhatsApp opt-in has not been recorded'));
        continue;
      }
      const recipient = channel === InvoiceDeliveryChannel.EMAIL
        ? party.email?.trim().toLowerCase()
        : normalizeWhatsAppNumber(party.whatsappNumber || party.phone);
      if (!recipient) {
        results.push(await this.recordFailure(invoiceId, channel, '', channel === InvoiceDeliveryChannel.EMAIL
          ? 'Party email is missing'
          : 'Party WhatsApp number is missing'));
        continue;
      }

      const attempt = await this.prisma.invoiceDelivery.create({
        data: { invoiceId, channel, recipient, status: InvoiceDeliveryStatus.PENDING },
      });
      try {
        const providerMessageId = channel === InvoiceDeliveryChannel.EMAIL
          ? await this.sendEmail(invoice, party, business, recipient, pdfBuffer)
          : await this.sendWhatsApp(invoice, party, business, recipient, pdfBuffer);
        const sent = await this.prisma.invoiceDelivery.update({
          where: { id: attempt.id },
          data: { status: InvoiceDeliveryStatus.SENT, providerMessageId, sentAt: new Date(), errorMessage: null },
        });
        results.push(sent);
        await this.audit.log({
          businessId, branchId: invoice.branchId ?? undefined, userId, action: 'INVOICE_DELIVERED', entityType: 'Invoice', entityId: invoiceId,
          metadata: { channel, recipient, deliveryId: sent.id },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Delivery provider rejected the request';
        const failed = await this.prisma.invoiceDelivery.update({
          where: { id: attempt.id },
          data: { status: InvoiceDeliveryStatus.FAILED, errorMessage: message.slice(0, 2000) },
        });
        results.push(failed);
        await this.audit.log({
          businessId, branchId: invoice.branchId ?? undefined, userId, action: 'INVOICE_DELIVERY_FAILED', entityType: 'Invoice', entityId: invoiceId,
          metadata: { channel, recipient, deliveryId: failed.id, error: message.slice(0, 300) },
        });
      }
    }
    return results;
  }

  history(invoiceId: string, businessId: string, branchId?: string) {
    return this.prisma.invoiceDelivery.findMany({
      where: { invoiceId, invoice: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async recordFailure(invoiceId: string, channel: InvoiceDeliveryChannel, recipient: string, errorMessage: string) {
    return this.prisma.invoiceDelivery.create({
      data: { invoiceId, channel, recipient, status: InvoiceDeliveryStatus.FAILED, errorMessage },
    });
  }

  private async sendEmail(
    invoice: { invoiceNumber: string; grandTotal: unknown; amountPaid: unknown; dueDate: Date | null },
    party: { name: string },
    business: { name: string; legalName: string | null } | null,
    recipient: string,
    pdfBuffer: Buffer,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const fromEmail = this.config.get<string>('RESEND_FROM_EMAIL')?.trim();
    if (!apiKey || !fromEmail) throw new Error('Automatic email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.');
    const businessName = business?.legalName || business?.name || 'Your Business';
    const balance = Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid));
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: `${businessName} <${fromEmail}>`,
      to: [recipient],
      subject: `Invoice ${invoice.invoiceNumber} from ${businessName}`,
      html: `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="height:7px;background:#2563eb"></div><div style="padding:30px"><p style="font-size:12px;color:#2563eb;font-weight:700;text-transform:uppercase">${escapeHtml(businessName)}</p><h1 style="font-size:24px;margin:8px 0">Your invoice is ready</h1><p style="color:#64748b;line-height:1.6">Hello ${escapeHtml(party.name)}, please find invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> attached as a PDF.</p><div style="margin:24px 0;padding:18px;border-radius:10px;background:#f8fafc"><table style="width:100%;font-size:14px"><tr><td style="padding:5px;color:#64748b">Invoice total</td><td style="padding:5px;text-align:right;font-weight:700">${formatMoney(invoice.grandTotal)}</td></tr><tr><td style="padding:5px;color:#64748b">Balance due</td><td style="padding:5px;text-align:right;font-weight:700;color:#dc2626">${formatMoney(balance)}</td></tr>${invoice.dueDate ? `<tr><td style="padding:5px;color:#64748b">Due date</td><td style="padding:5px;text-align:right">${invoice.dueDate.toLocaleDateString('en-IN')}</td></tr>` : ''}</table></div><p style="font-size:12px;color:#94a3b8">Please contact ${escapeHtml(businessName)} if you have any questions about this invoice.</p></div></div></body></html>`,
      attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdfBuffer.toString('base64') }],
      tags: [{ name: 'invoice_id', value: invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) }],
    });
    if (error) throw new Error(error.message || 'Resend rejected the email');
    if (!data?.id) throw new Error('Email provider did not return a message ID');
    return data.id;
  }

  private async sendWhatsApp(
    invoice: { invoiceNumber: string; grandTotal: unknown; amountPaid: unknown },
    party: { name: string },
    business: { name: string; legalName: string | null } | null,
    recipient: string,
    pdfBuffer: Buffer,
  ) {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim();
    const version = this.config.get<string>('WHATSAPP_API_VERSION')?.trim() || 'v20.0';
    const templateName = this.config.get<string>('WHATSAPP_TEMPLATE_NAME')?.trim();
    const templateLanguage = this.config.get<string>('WHATSAPP_TEMPLATE_LANGUAGE')?.trim() || 'en_US';
    if (!token || !phoneNumberId) throw new Error('Automatic WhatsApp is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.');
    const endpoint = `https://graph.facebook.com/${version}/${phoneNumberId}`;
    const media = new FormData();
    const pdfArrayBuffer = new ArrayBuffer(pdfBuffer.byteLength);
    new Uint8Array(pdfArrayBuffer).set(pdfBuffer);
    media.append('messaging_product', 'whatsapp');
    media.append('type', 'application/pdf');
    media.append('file', new Blob([pdfArrayBuffer], { type: 'application/pdf' }), `${invoice.invoiceNumber}.pdf`);
    const uploadResponse = await fetch(`${endpoint}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: media });
    const upload = await uploadResponse.json() as { id?: string; error?: { message?: string } };
    if (!uploadResponse.ok || !upload.id) throw new Error(upload.error?.message || 'WhatsApp media upload failed');

    const businessName = business?.legalName || business?.name || 'Your Business';
    const balance = Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid));
    const message = templateName
      ? {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'template',
          template: {
            name: templateName,
            language: { code: templateLanguage },
            components: [
              { type: 'header', parameters: [{ type: 'document', document: { id: upload.id, filename: `${invoice.invoiceNumber}.pdf` } }] },
              { type: 'body', parameters: [
                { type: 'text', text: party.name },
                { type: 'text', text: invoice.invoiceNumber },
                { type: 'text', text: formatMoney(invoice.grandTotal) },
                { type: 'text', text: businessName },
              ] },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'document',
          document: {
            id: upload.id,
            filename: `${invoice.invoiceNumber}.pdf`,
            caption: `Hello ${party.name}, invoice ${invoice.invoiceNumber} from ${businessName}. Total ${formatMoney(invoice.grandTotal)} · Balance ${formatMoney(balance)}.`,
          },
        };
    const messageResponse = await fetch(`${endpoint}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    const sent = await messageResponse.json() as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!messageResponse.ok || !sent.messages?.[0]?.id) throw new Error(sent.error?.message || 'WhatsApp rejected the message');
    return sent.messages[0].id;
  }
}

function normalizeWhatsAppNumber(value?: string | null) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value) || 0);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
