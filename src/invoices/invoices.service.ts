import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvoiceDeliveryChannel, InvoiceStatus, PartyDeliveryChannel, PartyDeliveryMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { computeInvoiceTotals, generateInvoiceNumber } from './invoice-calc.util';
import { AuditService } from '../common/utils/audit.service';
import { decryptField } from '../common/utils/encryption.util';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private delivery: InvoiceDeliveryService,
  ) {}

  async create(dto: CreateInvoiceDto, userId: string, businessId: string, branchId: string) {
    const [party, business, branch] = await Promise.all([
      this.prisma.party.findFirst({
        where: { id: dto.partyId, businessId, deletedAt: null },
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
        where: { id: { in: itemIds }, businessId, deletedAt: null },
      });
      if (validItems !== new Set(itemIds).size) {
        throw new BadRequestException('One or more invoice items do not belong to this business');
      }
    }

    const normalizedItems = dto.items.map((item) => ({
      ...item,
      taxRate: business.gstRegistered ? item.taxRate ?? 0 : 0,
    }));

    const totals = computeInvoiceTotals(
      normalizedItems.map((i) => ({
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate ?? 0,
      })),
      dto.discount ?? 0,
    );

    // Everything below happens in a single DB transaction:
    // if stock update or invoice-number generation fails, nothing is partially saved.
    const invoice = await this.prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const countThisYear = await tx.invoice.count({
        where: { branchId, invoiceNumber: { startsWith: `${branch.code}-INV-${year}-` } },
      });
      const invoiceNumber = `${branch.code}-${generateInvoiceNumber(year, countThisYear + 1)}`;

      const created = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          invoiceNumber,
          partyId: dto.partyId,
          createdById: userId,
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
    }, { timeout: 15000, maxWait: 10000 });

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

  async findOne(id: string, businessId: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: { items: true, party: true, payments: true, deliveries: { orderBy: { createdAt: 'desc' } }, createdBy: true, business: true, branch: true },
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
