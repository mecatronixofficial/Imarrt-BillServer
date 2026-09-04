import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType, Prisma } from '@prisma/client';
import { AuditService } from '../common/utils/audit.service';
import { decryptField } from '../common/utils/encryption.util';
import { computeInvoiceTotals } from '../invoices/invoice-calc.util';
import { InvoicesService } from '../invoices/invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

const NUMBER_PREFIX: Record<DocumentType, string> = {
  QUOTATION: 'QUO',
  PROFORMA_INVOICE: 'PRO',
  PURCHASE_INVOICE: 'PUR',
  DELIVERY_CHALLAN: 'DC',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

const PARTY_DOCUMENTS = new Set<DocumentType>([
  DocumentType.QUOTATION,
  DocumentType.PROFORMA_INVOICE,
  DocumentType.DELIVERY_CHALLAN,
  DocumentType.CREDIT_NOTE,
  DocumentType.DEBIT_NOTE,
]);

function isOneOf<T>(value: T, options: readonly T[]) {
  return options.includes(value);
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async create(dto: CreateDocumentDto, userId: string, businessId: string, branchId: string) {
    this.validateParty(dto);
    if (dto.status && !isOneOf(dto.status, [DocumentStatus.DRAFT, DocumentStatus.ISSUED])) {
      throw new BadRequestException('New documents can only be saved as draft or issued');
    }

    const [business, party, supplier, referenceInvoice, sourceDocument] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: businessId } }),
      dto.partyId
        ? this.prisma.party.findFirst({ where: { id: dto.partyId, businessId, deletedAt: null } })
        : null,
      dto.supplierId
        ? this.prisma.supplier.findFirst({ where: { id: dto.supplierId, businessId, deletedAt: null } })
        : null,
      dto.referenceInvoiceId
        ? this.prisma.invoice.findFirst({ where: { id: dto.referenceInvoiceId, businessId, branchId, deletedAt: null } })
        : null,
      dto.sourceDocumentId
        ? this.prisma.businessDocument.findFirst({ where: { id: dto.sourceDocumentId, businessId, branchId, deletedAt: null } })
        : null,
    ]);

    if (!business) throw new NotFoundException('Business not found');
    if (dto.partyId && !party) throw new NotFoundException('Party not found');
    if (dto.supplierId && !supplier) throw new NotFoundException('Supplier not found');
    if (dto.referenceInvoiceId && !referenceInvoice) throw new NotFoundException('Reference invoice not found');
    if (dto.sourceDocumentId && !sourceDocument) throw new NotFoundException('Source document not found');
    if (isOneOf(dto.type, [DocumentType.CREDIT_NOTE, DocumentType.DEBIT_NOTE]) && !referenceInvoice) {
      throw new BadRequestException('Credit and debit notes must reference an invoice');
    }

    const itemIds = dto.items.flatMap((item) => (item.itemId ? [item.itemId] : []));
    if (itemIds.length > 0) {
      const validItems = await this.prisma.item.count({
        where: { id: { in: [...new Set(itemIds)] }, businessId, deletedAt: null },
      });
      if (validItems !== new Set(itemIds).size) {
        throw new BadRequestException('One or more items do not belong to this business');
      }
    }

    const totals = computeInvoiceTotals(
      dto.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 0,
      })),
      dto.discount ?? 0,
    );
    if (totals.grandTotal < 0) throw new BadRequestException('Discount cannot exceed the document total');

    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const year = issueDate.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const startOfNextYear = new Date(year + 1, 0, 1);
    const prefix = NUMBER_PREFIX[dto.type];

    const document = await this.prisma.$transaction(async (tx) => {
      const sequence = await tx.businessDocument.count({
        where: { businessId, branchId, type: dto.type, issueDate: { gte: startOfYear, lt: startOfNextYear } },
      });
      const documentNumber = `${prefix}-${year}-${String(sequence + 1).padStart(6, '0')}`;
      const shouldAdjustStock = dto.type === DocumentType.PURCHASE_INVOICE && dto.status === DocumentStatus.ISSUED;

      const created = await tx.businessDocument.create({
        data: {
          businessId,
          branchId,
          type: dto.type,
          documentNumber,
          status: dto.status ?? DocumentStatus.DRAFT,
          partyId: dto.partyId,
          supplierId: dto.supplierId,
          referenceInvoiceId: dto.referenceInvoiceId,
          sourceDocumentId: dto.sourceDocumentId,
          issueDate,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          placeOfSupply: dto.placeOfSupply,
          transportName: dto.transportName,
          vehicleNumber: dto.vehicleNumber,
          eWayBillNumber: dto.eWayBillNumber,
          referenceNumber: dto.referenceNumber,
          reason: dto.reason,
          terms: dto.terms,
          notes: dto.notes,
          subTotal: totals.subTotal,
          taxTotal: totals.taxTotal,
          discount: totals.discount,
          grandTotal: totals.grandTotal,
          stockAdjusted: shouldAdjustStock,
          createdById: userId,
          items: {
            create: totals.lines.map((line, index) => ({
              itemId: dto.items[index].itemId,
              description: dto.items[index].description,
              hsnSac: dto.items[index].hsnSac,
              quantity: line.quantity,
              unit: dto.items[index].unit ?? 'pcs',
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              lineTotal: line.lineTotal,
            })),
          },
        },
        include: { items: true, party: true, supplier: true, branch: true },
      });

      if (shouldAdjustStock) await this.adjustPurchaseStock(tx, dto.items, 'increment');
      return created;
    }, { timeout: 15_000, maxWait: 10_000 });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'DOCUMENT_CREATED',
      entityType: 'BusinessDocument',
      entityId: document.id,
      metadata: { type: document.type, documentNumber: document.documentNumber, total: totals.grandTotal },
    });
    return document;
  }

  findAll(
    businessId: string,
    branchId: string | undefined,
    { type, status, q: query, limit, offset }: ListDocumentsQueryDto,
  ) {
    const where: Prisma.BusinessDocumentWhereInput = {
      businessId,
      ...(branchId ? { branchId } : {}),
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(query
        ? {
            OR: [
              { documentNumber: { contains: query } },
              { party: { name: { contains: query } } },
              { supplier: { name: { contains: query } } },
            ],
          }
        : {}),
    };
    return this.prisma.businessDocument.findMany({
      where,
      include: { party: true, supplier: true, branch: true, referenceInvoice: { select: { id: true, invoiceNumber: true } } },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const document = await this.prisma.businessDocument.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: {
        items: true,
        party: true,
        supplier: true,
        business: true,
        branch: true,
        createdBy: { select: { id: true, name: true, email: true } },
        referenceInvoice: { select: { id: true, invoiceNumber: true, grandTotal: true, issueDate: true } },
        sourceDocument: { select: { id: true, documentNumber: true, type: true } },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    return {
      ...document,
      party: document.party
        ? { ...document.party, gstin: document.party.gstin ? decryptField(document.party.gstin) : null }
        : null,
      supplier: document.supplier
        ? { ...document.supplier, gstin: document.supplier.gstin ? decryptField(document.supplier.gstin) : null }
        : null,
      business: { ...document.business, gstin: document.business.gstin ? decryptField(document.business.gstin) : null },
    };
  }

  async updateStatus(id: string, status: DocumentStatus, userId: string, businessId: string, branchId: string) {
    const document = await this.findOne(id, businessId, branchId);
    if (document.status === DocumentStatus.CONVERTED || document.status === DocumentStatus.CANCELLED) {
      throw new BadRequestException('This document is already closed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let stockAdjusted = document.stockAdjusted;
      const shouldIssuePurchase =
        document.type === DocumentType.PURCHASE_INVOICE &&
        !stockAdjusted &&
        isOneOf(status, [DocumentStatus.ISSUED, DocumentStatus.ACCEPTED]);
      const shouldReversePurchase =
        document.type === DocumentType.PURCHASE_INVOICE && stockAdjusted && status === DocumentStatus.CANCELLED;

      if (shouldIssuePurchase) {
        await this.adjustPurchaseStock(tx, document.items.map((item) => ({ itemId: item.itemId ?? undefined, quantity: Number(item.quantity) })), 'increment');
        stockAdjusted = true;
      } else if (shouldReversePurchase) {
        await this.adjustPurchaseStock(tx, document.items.map((item) => ({ itemId: item.itemId ?? undefined, quantity: Number(item.quantity) })), 'decrement');
        stockAdjusted = false;
      }

      return tx.businessDocument.update({ where: { id }, data: { status, stockAdjusted } });
    });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'DOCUMENT_STATUS_CHANGED',
      entityType: 'BusinessDocument',
      entityId: id,
      metadata: { from: document.status, to: status },
    });
    return updated;
  }

  async convertToInvoice(id: string, userId: string, businessId: string, branchId: string) {
    const document = await this.findOne(id, businessId, branchId);
    if (!isOneOf(document.type, [DocumentType.QUOTATION, DocumentType.PROFORMA_INVOICE])) {
      throw new BadRequestException('Only quotations and proforma invoices can be converted to an invoice');
    }
    if (!document.partyId) throw new BadRequestException('A party is required for invoice conversion');
    if (isOneOf(document.status, [DocumentStatus.CONVERTED, DocumentStatus.CANCELLED])) {
      throw new BadRequestException('This document cannot be converted');
    }

    const invoice = await this.invoices.create({
      partyId: document.partyId,
      dueDate: document.dueDate?.toISOString(),
      discount: Number(document.discount),
      notes: [document.notes, `Converted from ${document.documentNumber}`].filter(Boolean).join('\n'),
      items: document.items.map((item) => ({
        itemId: item.itemId ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
      })),
    }, userId, businessId, branchId);

    await this.prisma.businessDocument.update({
      where: { id },
      data: { status: DocumentStatus.CONVERTED, convertedInvoiceId: invoice.id },
    });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'DOCUMENT_CONVERTED_TO_INVOICE',
      entityType: 'BusinessDocument',
      entityId: id,
      metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
    });
    return invoice;
  }

  async convertToProforma(id: string, userId: string, businessId: string, branchId: string) {
    const document = await this.findOne(id, businessId, branchId);
    if (document.type !== DocumentType.QUOTATION) throw new BadRequestException('Only quotations can be converted to a proforma invoice');
    if (isOneOf(document.status, [DocumentStatus.CONVERTED, DocumentStatus.CANCELLED])) throw new BadRequestException('This quotation cannot be converted');

    const proforma = await this.create({
      type: DocumentType.PROFORMA_INVOICE,
      status: DocumentStatus.DRAFT,
      partyId: document.partyId ?? undefined,
      sourceDocumentId: document.id,
      validUntil: document.validUntil?.toISOString(),
      dueDate: document.dueDate?.toISOString(),
      placeOfSupply: document.placeOfSupply ?? undefined,
      terms: document.terms ?? undefined,
      notes: document.notes ?? undefined,
      discount: Number(document.discount),
      items: document.items.map((item) => ({
        itemId: item.itemId ?? undefined,
        description: item.description,
        hsnSac: item.hsnSac ?? undefined,
        quantity: Number(item.quantity),
        unit: item.unit,
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
      })),
    }, userId, businessId, branchId);
    await this.prisma.businessDocument.update({ where: { id }, data: { status: DocumentStatus.CONVERTED } });
    return proforma;
  }

  async remove(id: string, userId: string, businessId: string, branchId: string) {
    const document = await this.findOne(id, businessId, branchId);
    if (!isOneOf(document.status, [DocumentStatus.DRAFT, DocumentStatus.CANCELLED])) {
      throw new BadRequestException('Issue a cancellation before deleting a financial document');
    }
    await this.prisma.businessDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'DOCUMENT_DELETED',
      entityType: 'BusinessDocument',
      entityId: id,
    });
    return { success: true };
  }

  private validateParty(dto: CreateDocumentDto) {
    if (dto.type === DocumentType.PURCHASE_INVOICE && !dto.supplierId) {
      throw new BadRequestException('Purchase invoices require a supplier');
    }
    if (PARTY_DOCUMENTS.has(dto.type) && !dto.partyId) {
      throw new BadRequestException('This document requires a party');
    }
  }

  private async adjustPurchaseStock(
    tx: Prisma.TransactionClient,
    items: Array<{ itemId?: string; quantity: number }>,
    operation: 'increment' | 'decrement',
  ) {
    await Promise.all(items.map((item) => {
      if (!item.itemId) return undefined;
      return tx.item.update({
        where: { id: item.itemId },
        data: { stockQty: { [operation]: item.quantity } },
      });
    }));
  }
}
