import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceAttachmentKind, InvoiceDeliveryChannel, InvoiceStatus, PartyBalanceType, PartyDeliveryChannel, PartyDeliveryMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { RecordPaymentDto } from './dto/record-payment.dto.js';
import { computeInvoiceTotals, generateInvoiceNumber, invoiceNumberPrefix, NUMBERING_LABELS, totalsOptionsFor } from './invoice-calc.util.js';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { currentPartyBalance } from '../common/utils/party-balance.util.js';
import { AuditService } from '../common/utils/audit.service.js';
import { decryptField } from '../common/utils/encryption.util.js';
import { InvoiceDeliveryService } from './invoice-delivery.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util.js';

export interface UploadedInvoiceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_ATTACHMENTS_PER_INVOICE = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private delivery: InvoiceDeliveryService,
  ) {}

  /** Rejects the sale when a catalogue item would go below zero stock (only when the company disallows negative stock). */
  private async assertStockAvailable(
    tx: Prisma.TransactionClient,
    lines: Array<{ quantity: number }>,
    items: Array<{ itemId?: string }>,
  ) {
    const required = new Map<string, number>();
    lines.forEach((line, index) => {
      const itemId = items[index].itemId;
      if (itemId) required.set(itemId, (required.get(itemId) ?? 0) + line.quantity);
    });
    if (!required.size) return;
    const stocks = await tx.item.findMany({ where: { id: { in: [...required.keys()] } }, select: { id: true, name: true, stockQty: true } });
    for (const stock of stocks) {
      const needed = required.get(stock.id) ?? 0;
      if (Number(stock.stockQty) < needed) {
        throw new BadRequestException(`Not enough stock for "${stock.name}": ${Number(stock.stockQty)} available, ${needed} needed`);
      }
    }
  }

  /** The party's running balance, only worked out when the company prints it on invoices. */
  async partyBalanceForPrint(businessId: string, invoice: { party: { id: string; openingBalance: unknown; openingBalanceType: PartyBalanceType }; business?: { preferences?: unknown } | null }) {
    if (!resolvePreferences(invoice.business?.preferences).printRegular.currentBalanceOfParty) return undefined;
    return currentPartyBalance(this.prisma, businessId, invoice.party);
  }

  async nextInvoiceNumber(businessId: string, branchId: string) {
    const [branch, business] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true } }),
      this.prisma.business.findUnique({ where: { id: businessId }, select: { preferences: true } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    const { transaction } = resolvePreferences(business?.preferences);
    const year = new Date().getFullYear();
    const label = NUMBERING_LABELS[transaction.numberingPrefix as keyof typeof NUMBERING_LABELS];
    const countThisYear = await this.prisma.invoice.count({
      where: { branchId, invoiceNumber: { startsWith: `${branch.code}-${invoiceNumberPrefix(year, label)}` } },
    });
    return {
      invoiceNumber: `${branch.code}-${generateInvoiceNumber(year, countThisYear + 1, label)}`,
      manual: !transaction.autoNumbering,
    };
  }

  async create(dto: CreateInvoiceDto, userId: string, businessId: string, branchId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    const [party, business, branch] = await Promise.all([
      this.prisma.party.findFirst({
        where: { id: dto.partyId, businessId: { in: workspaceBusinessIds }, deletedAt: null },
      }),
      this.prisma.business.findUnique({ where: { id: businessId } }),
      this.prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true } }),
    ]);
    if (!party) throw new NotFoundException('Party not found');
    if (!business) throw new NotFoundException('Business not found');
    if (!branch) throw new NotFoundException('Branch not found');

    const itemIds = dto.items.flatMap((item) => (item.itemId ? [item.itemId] : []));
    if (itemIds.length > 0) {
      const validItems = await this.prisma.item.count({
        where: { id: { in: itemIds }, businessId: { in: workspaceBusinessIds }, deletedAt: null },
      });
      if (validItems !== new Set(itemIds).size) {
        throw new BadRequestException('One or more invoice items do not belong to this workspace');
      }
    }

    const normalizedItems = dto.items.map((item) => ({
      ...item,
      taxRate: business.gstRegistered ? item.taxRate ?? 0 : 0,
    }));

    const preferences = resolvePreferences(business.preferences);
    const manualNumber = dto.invoiceNumber?.trim();
    if (!preferences.transaction.autoNumbering && !manualNumber) {
      throw new BadRequestException('Enter an invoice number');
    }

    const totals = computeInvoiceTotals(
      normalizedItems.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate ?? 0,
      })),
      dto.discount ?? 0,
      totalsOptionsFor(preferences, true),
    );

    // Everything below happens in a single DB transaction:
    // if stock update or invoice-number generation fails, nothing is partially saved.
    const invoice = await this.prisma.$transaction(async (tx) => {
      if (!preferences.transaction.negativeStock) await this.assertStockAvailable(tx, totals.lines, normalizedItems);

      let invoiceNumber: string;
      if (!preferences.transaction.autoNumbering && manualNumber) {
        const duplicate = await tx.invoice.findFirst({ where: { branchId, invoiceNumber: manualNumber }, select: { id: true } });
        if (duplicate) throw new ConflictException(`Invoice number ${manualNumber} is already used in this branch`);
        invoiceNumber = manualNumber;
      } else {
        const year = new Date().getFullYear();
        const label = NUMBERING_LABELS[preferences.transaction.numberingPrefix as keyof typeof NUMBERING_LABELS];
        const countThisYear = await tx.invoice.count({
          where: { branchId, invoiceNumber: { startsWith: `${branch.code}-${invoiceNumberPrefix(year, label)}` } },
        });
        invoiceNumber = `${branch.code}-${generateInvoiceNumber(year, countThisYear + 1, label)}`;
      }

      const created = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          invoiceNumber,
          partyId: dto.partyId,
          createdById: userId,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: InvoiceStatus.UNPAID,
          subTotal: totals.subTotal,
          taxTotal: totals.taxTotal,
          discount: totals.discount,
          grandTotal: totals.grandTotal,
          notes: dto.notes,
          items: {
            create: totals.lines.map((line, idx) => ({
              itemId: normalizedItems[idx].itemId,
              description: normalizedItems[idx].description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: { items: true, party: true, branch: true },
      });

      // Deduct stock for catalog items (skip ad-hoc line items without itemId)
      await Promise.all(
        totals.lines.map((line, idx) => {
          const itemId = normalizedItems[idx].itemId;
          if (!itemId) return undefined;
          return tx.item.update({
            where: { id: itemId },
            data: { stockQty: { decrement: line.quantity } },
          });
        }),
      );

      return created;
    }, { timeout: 30_000, maxWait: 15_000 });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, grandTotal: totals.grandTotal },
    });

    const deliveryMode = dto.deliveryMode ?? party.invoiceDeliveryMode;
    const deliveryChannels = dto.deliveryChannels?.length
      ? dto.deliveryChannels
      : party.invoiceDeliveryChannel === PartyDeliveryChannel.BOTH
        ? [InvoiceDeliveryChannel.EMAIL, InvoiceDeliveryChannel.WHATSAPP]
        : [party.invoiceDeliveryChannel as InvoiceDeliveryChannel];
    const deliveryAttempts = deliveryMode === PartyDeliveryMode.AUTOMATIC
      ? await this.delivery.deliver(invoice.id, businessId, deliveryChannels, userId, branchId)
      : [];

    return { ...invoice, deliveryAttempts };
  }

  findAll(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    return this.prisma.invoice.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: { party: true, branch: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  listPayments(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    return this.prisma.paymentRecord.findMany({
      where: { invoice: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null } },
      include: { invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, amountPaid: true, party: { select: { id: true, name: true } } } } },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: {
        items: { include: { item: { select: { sku: true, description: true } } } },
        party: true,
        payments: true,
        deliveries: { orderBy: { createdAt: 'desc' } },
        attachments: {
          select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        createdBy: true,
        business: { include: { createdBy: { select: { name: true } } } },
        branch: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      ...invoice,
      party: {
        ...invoice.party,
        gstin: invoice.party.gstin ? decryptField(invoice.party.gstin) : null,
      },
      business: invoice.business
        ? {
            ...invoice.business,
            gstin: invoice.business.gstin ? decryptField(invoice.business.gstin) : null,
          }
        : null,
    };
  }

  async addAttachments(
    invoiceId: string,
    files: UploadedInvoiceFile[],
    userId: string,
    businessId: string,
    branchId: string,
  ) {
    if (!files?.length) throw new BadRequestException('Select at least one file to upload');

    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId, branchId, deletedAt: null },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const existing = await this.prisma.invoiceAttachment.aggregate({
      where: { invoiceId },
      _count: { id: true },
      _sum: { size: true },
    });
    if (existing._count.id + files.length > MAX_ATTACHMENTS_PER_INVOICE) {
      throw new BadRequestException(`An invoice can have up to ${MAX_ATTACHMENTS_PER_INVOICE} attachments`);
    }

    const totalNewBytes = files.reduce((sum, file) => sum + file.size, 0);
    if ((existing._sum.size ?? 0) + totalNewBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new BadRequestException('Invoice attachments cannot exceed 25 MB in total');
    }

    const uploads = files.map((file) => {
      if (!file.buffer || file.size <= 0) throw new BadRequestException('Empty files cannot be uploaded');
      if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`${file.originalname} exceeds the 10 MB file limit`);

      const kind = IMAGE_MIME_TYPES.has(file.mimetype)
        ? InvoiceAttachmentKind.IMAGE
        : DOCUMENT_MIME_TYPES.has(file.mimetype)
          ? InvoiceAttachmentKind.DOCUMENT
          : null;
      if (!kind) throw new BadRequestException(`${file.originalname} is not a supported image or document`);

      const fileName = file.originalname
        .replace(/[\r\n]/g, '')
        .replace(/[^\p{L}\p{N}._() -]/gu, '_')
        .slice(0, 191) || 'attachment';

      return { kind, fileName, mimeType: file.mimetype, size: file.size, data: Uint8Array.from(file.buffer) };
    });

    const created = await this.prisma.$transaction(
      uploads.map((upload) => this.prisma.invoiceAttachment.create({
        data: { invoiceId, ...upload },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      })),
    );

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_ATTACHMENTS_ADDED',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { files: created.map(({ id, fileName, kind, size }) => ({ id, fileName, kind, size })) },
    });

    return created;
  }

  async listAttachments(invoiceId: string, businessId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return this.prisma.invoiceAttachment.findMany({
      where: { invoiceId },
      select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAttachment(invoiceId: string, attachmentId: string, businessId: string, branchId?: string) {
    const attachment = await this.prisma.invoiceAttachment.findFirst({
      where: {
        id: attachmentId,
        invoiceId,
        invoice: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto, userId: string, businessId: string, branchId: string) {
    const invoice = await this.findOne(invoiceId, businessId, branchId);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Cannot record payment on a cancelled invoice');
    }

    const newAmountPaid = Number(invoice.amountPaid) + dto.amount;
    if (newAmountPaid > Number(invoice.grandTotal) + 0.01) {
      throw new BadRequestException('Payment amount exceeds the outstanding balance');
    }

    const newStatus =
      newAmountPaid >= Number(invoice.grandTotal)
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIALLY_PAID;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.create({
        data: {
          invoiceId,
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
        },
      });
      return tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newAmountPaid, status: newStatus },
        include: { items: true, party: true, payments: true },
      });
    });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PAYMENT_RECORDED',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: { amount: dto.amount, method: dto.method },
    });

    return updated;
  }

  async cancel(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_CANCELLED',
      entityType: 'Invoice',
      entityId: id,
    });
    return invoice;
  }

  // Soft delete - invoices are financial records and are never hard-deleted
  async remove(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    await this.prisma.invoice.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'INVOICE_DELETED',
      entityType: 'Invoice',
      entityId: id,
    });
    return { success: true };
  }
}
