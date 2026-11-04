import { transactionDetails } from '../common/dto/transaction-details.dto.js';
import { trackingFields } from '../common/dto/tracking-fields.dto.js';
import { adjustStock, billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { money, subtractMoney, sumMoney } from '../common/utils/billing.util.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType, InvoiceAttachmentKind, Prisma } from '@prisma/client';
import { AuditService } from '../common/utils/audit.service.js';
import { decryptField } from '../common/utils/encryption.util.js';
import { computeInvoiceTotals, totalsOptionsFor } from '../invoices/invoice-calc.util.js';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentOutService } from '../payment-out/payment-out.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto.js';
import { RecordPurchasePaymentDto } from './dto/record-purchase-payment.dto.js';
import { getLogicalBranchIds, getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util.js';

const NUMBER_PREFIX: Record<DocumentType, string> = {
  QUOTATION: 'QUO',
  SALES_ORDER: 'SO',
  PROFORMA_INVOICE: 'PRO',
  PURCHASE_INVOICE: 'PUR',
  DELIVERY_CHALLAN: 'DC',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

const PARTY_DOCUMENTS = new Set<DocumentType>([
  DocumentType.QUOTATION,
  DocumentType.SALES_ORDER,
  DocumentType.PROFORMA_INVOICE,
  DocumentType.DELIVERY_CHALLAN,
  DocumentType.CREDIT_NOTE,
]);

export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const MAX_DOCUMENT_ATTACHMENTS = 10;
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

function isOneOf<T>(value: T, options: readonly T[]) {
  return options.includes(value);
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  other: 'Other',
  credit: 'Credit',
};

/** How a bill was paid: the latest payment's bank account, else its method, else the method chosen on the bill. */
export function purchasePaymentType(document: { paymentMethod: string | null; payments?: Array<{ method: string; account: { bankName: string } | null }> }) {
  const latest = document.payments?.[0];
  if (latest?.account?.bankName) return latest.account.bankName;
  const method = latest?.method ?? document.paymentMethod;
  return method ? PAYMENT_METHOD_LABELS[method] ?? method : null;
}

/** `to` is inclusive, so the range ends at the start of the following day. */
function issueDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const end = to ? new Date(`${to}T00:00:00.000Z`) : undefined;
  end?.setUTCDate(end.getUTCDate() + 1);
  return { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(end ? { lt: end } : {}) };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly paymentOut: PaymentOutService,
  ) {}

  async create(dto: CreateDocumentDto, userId: string, businessId: string, branchId: string, transaction?: Prisma.TransactionClient) {
    const db = transaction ?? this.prisma;
    if (dto.status && !isOneOf(dto.status, [DocumentStatus.DRAFT, DocumentStatus.ISSUED])) {
      throw new BadRequestException('New documents can only be saved as draft or issued');
    }
    const totals = await this.priceDocument(dto, businessId, branchId, db);

    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const year = issueDate.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const startOfNextYear = new Date(year + 1, 0, 1);
    const prefix = NUMBER_PREFIX[dto.type];

    let replayed=false;
    const persist = async (tx: Prisma.TransactionClient) => {
      await lockBillingRecord(tx, 'branch', branchId);
      if(dto.requestId){const previous=await tx.businessDocument.findFirst({where:{businessId,branchId,requestId:dto.requestId},include:{items:true,party:true,supplier:true,branch:true}});if(previous){replayed=true;return previous;}}
      if(dto.warehouseId && !await tx.warehouse.findFirst({where:{id:dto.warehouseId,businessId,branchId,isActive:true}}))throw new BadRequestException('Godown not found in this branch');
      const sequence = await tx.businessDocument.count({
        where: { businessId, branchId, type: dto.type, issueDate: { gte: startOfYear, lt: startOfNextYear } },
      });
      const documentNumber = `${prefix}-${year}-${String(sequence + 1).padStart(6, '0')}`;
      if (dto.status === DocumentStatus.ISSUED) await this.validateReturn(tx, { ...dto, businessId }, totals.grandTotal);
      const shouldAdjustStock = dto.status === DocumentStatus.ISSUED && this.movesStock(dto.type, dto.returnStock);

      const created = await tx.businessDocument.create({
        data: {
          businessId,
          branchId,
          type: dto.type,
          ...transactionDetails(dto),
          requestId:dto.requestId,
          warehouseId: dto.warehouseId,
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
          paymentMethod: dto.paymentMethod,
          reason: dto.reason,
          terms: dto.terms,
          notes: dto.notes,
          subTotal: totals.subTotal,
          taxTotal: totals.taxTotal,
          discount: totals.discount,
          grandTotal: totals.grandTotal,
          stockAdjusted: shouldAdjustStock,
          returnStock: dto.returnStock ?? false,
          createdById: userId,
          items: { create: this.documentLines(dto, totals) },
        },
        include: { items: true, party: true, supplier: true, branch: true },
      });

      if (shouldAdjustStock) await this.applyDocumentStock(tx, { ...created, items: dto.items });
      return created;
    };
    const document = transaction ? await persist(transaction) : await billingTransaction(this.prisma, persist);
    if (transaction || replayed) return document;

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

  /**
   * Edits a document in place, keeping its number. Stock moved by the old version is
   * reversed and the new version applied. Paid bills and documents that others were
   * made from must be unlinked first, because their totals feed those records.
   */
  async update(id: string, dto: CreateDocumentDto, userId: string, businessId: string, branchId: string) {
    if (dto.status && !isOneOf(dto.status, [DocumentStatus.DRAFT, DocumentStatus.ISSUED])) {
      throw new BadRequestException('Documents can only be saved as draft or issued');
    }
    const document = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      await lockBillingRecord(tx, 'document', id);
      const existing = await tx.businessDocument.findFirst({ where: { id, businessId, branchId, deletedAt: null }, include: { items: true } });
      if (!existing) throw new NotFoundException('Document not found');
      if (existing.type !== dto.type) throw new BadRequestException('A document cannot change its type');
      if (!isOneOf(existing.status, [DocumentStatus.DRAFT, DocumentStatus.ISSUED, DocumentStatus.ACCEPTED])) throw new BadRequestException('Converted, cancelled or rejected documents cannot be edited');
      if (existing.status !== DocumentStatus.DRAFT && dto.status === DocumentStatus.DRAFT) throw new BadRequestException('An issued document cannot be reset to draft');
      if (Number(existing.paidAmount) > 0) throw new BadRequestException('Void the payments on this bill before editing it');
      if (await tx.businessDocument.count({ where: { sourceDocumentId: id, deletedAt: null, status: { notIn: [DocumentStatus.DRAFT, DocumentStatus.CANCELLED, DocumentStatus.REJECTED] } } })) {
        throw new BadRequestException('Cancel the returns or documents made from this one before editing it');
      }
      // Links to an original invoice or bill only change on returns; other documents keep theirs.
      const links = {
        referenceInvoiceId: dto.type === DocumentType.CREDIT_NOTE ? dto.referenceInvoiceId ?? null : existing.referenceInvoiceId,
        sourceDocumentId: dto.type === DocumentType.DEBIT_NOTE ? dto.sourceDocumentId ?? null : existing.sourceDocumentId,
      };
      const totals = await this.priceDocument({ ...dto, ...links, referenceInvoiceId: links.referenceInvoiceId ?? undefined, sourceDocumentId: links.sourceDocumentId ?? undefined }, businessId, branchId, tx);
      if (dto.warehouseId && !await tx.warehouse.findFirst({ where: { id: dto.warehouseId, businessId, branchId, isActive: true } })) throw new BadRequestException('Godown not found in this branch');

      const status = existing.status === DocumentStatus.DRAFT ? dto.status ?? DocumentStatus.DRAFT : existing.status;
      const posted = status !== DocumentStatus.DRAFT;
      const returnStock = dto.returnStock ?? existing.returnStock;
      if (existing.stockAdjusted) await this.applyDocumentStock(tx, existing, true);
      if (posted) await this.validateReturn(tx, { ...dto, ...links, returnStock, businessId }, totals.grandTotal, id);
      const shouldAdjustStock = posted && this.movesStock(dto.type, returnStock);
      const issueDate = dto.issueDate ? new Date(dto.issueDate) : existing.issueDate;
      if (dto.dueDate && new Date(dto.dueDate) < issueDate) throw new BadRequestException('Due date cannot be before issue date');

      const updated = await tx.businessDocument.update({
        where: { id },
        data: {
          ...transactionDetails(dto),
          ...links,
          status,
          warehouseId: dto.warehouseId ?? null,
          partyId: dto.partyId ?? null,
          supplierId: dto.supplierId ?? null,
          issueDate,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          placeOfSupply: dto.placeOfSupply ?? null,
          transportName: dto.transportName ?? null,
          vehicleNumber: dto.vehicleNumber ?? null,
          eWayBillNumber: dto.eWayBillNumber ?? null,
          referenceNumber: dto.referenceNumber ?? null,
          paymentMethod: dto.paymentMethod ?? existing.paymentMethod,
          reason: dto.reason ?? null,
          terms: dto.terms ?? null,
          notes: dto.notes ?? null,
          subTotal: totals.subTotal,
          taxTotal: totals.taxTotal,
          discount: totals.discount,
          grandTotal: totals.grandTotal,
          stockAdjusted: shouldAdjustStock,
          returnStock,
          items: { deleteMany: {}, create: this.documentLines(dto, totals) },
        },
        include: { items: true, party: true, supplier: true, branch: true },
      });
      if (shouldAdjustStock) await this.applyDocumentStock(tx, { ...updated, items: dto.items });
      return { updated, previousTotal: Number(existing.grandTotal) };
    });
    await this.audit.log({ businessId, branchId, userId, action: 'DOCUMENT_UPDATED', entityType: 'BusinessDocument', entityId: id, metadata: { type: dto.type, documentNumber: document.updated.documentNumber, previousTotal: document.previousTotal, total: Number(document.updated.grandTotal) } });
    return document.updated;
  }

  private movesStock(type: DocumentType, returnStock?: boolean) {
    return isOneOf(type, [DocumentType.PURCHASE_INVOICE, DocumentType.DELIVERY_CHALLAN]) || (Boolean(returnStock) && isOneOf(type, [DocumentType.CREDIT_NOTE, DocumentType.DEBIT_NOTE]));
  }

  private documentLines(dto: CreateDocumentDto, totals: ReturnType<typeof computeInvoiceTotals>) {
    return totals.lines.map((line, index) => ({
      ...trackingFields(dto.items[index]),
      itemId: dto.items[index].itemId,
      description: dto.items[index].description,
      hsnSac: dto.items[index].hsnSac,
      quantity: line.quantity,
      unit: dto.items[index].unit ?? 'pcs',
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      lineTotal: line.lineTotal,
      taxInclusive: Boolean(dto.items[index].taxInclusive),
    }));
  }

  /** Checks the party, references and items, then prices the lines. Shared by create and update. */
  private async priceDocument(dto: CreateDocumentDto, businessId: string, branchId: string, db: Prisma.TransactionClient | PrismaService) {
    this.validateParty(dto);
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const [business, party, supplier, referenceInvoice, sourceDocument] = await Promise.all([
      db.business.findUnique({ where: { id: businessId } }),
      dto.partyId
        ? db.party.findFirst({ where: { id: dto.partyId, branchId: { in: logicalBranchIds }, deletedAt: null } })
        : null,
      dto.supplierId
        ? db.supplier.findFirst({ where: { id: dto.supplierId, branchId: { in: logicalBranchIds }, deletedAt: null } })
        : null,
      dto.referenceInvoiceId
        ? db.invoice.findFirst({ where: { id: dto.referenceInvoiceId, businessId, branchId, deletedAt: null } })
        : null,
      dto.sourceDocumentId
        ? db.businessDocument.findFirst({ where: { id: dto.sourceDocumentId, businessId, branchId, deletedAt: null } })
        : null,
    ]);

    if (!business) throw new NotFoundException('Business not found');
    if (dto.partyId && !party) throw new NotFoundException('Party not found');
    if (dto.supplierId && !supplier) throw new NotFoundException('Supplier not found');
    if (dto.referenceInvoiceId && !referenceInvoice) throw new NotFoundException('Reference invoice not found');
    if (dto.sourceDocumentId && !sourceDocument) throw new NotFoundException('Source document not found');
    if (dto.dueDate && dto.issueDate && new Date(dto.dueDate) < new Date(dto.issueDate)) throw new BadRequestException('Due date cannot be before issue date');
    if (referenceInvoice && referenceInvoice.partyId !== dto.partyId) throw new BadRequestException('Credit note customer must match its invoice');
    if (referenceInvoice && ['DRAFT', 'CANCELLED'].includes(referenceInvoice.status)) throw new BadRequestException('Returns require an issued invoice');
    if (dto.type === DocumentType.CREDIT_NOTE && !referenceInvoice) {
      throw new BadRequestException('Credit notes must reference a sale invoice');
    }
    if (dto.type === DocumentType.DEBIT_NOTE) {
      if (!sourceDocument || sourceDocument.type !== DocumentType.PURCHASE_INVOICE) {
        throw new BadRequestException('Debit notes must reference a purchase bill');
      }
      if (sourceDocument.supplierId !== dto.supplierId) {
        throw new BadRequestException('Debit note supplier must match the referenced purchase bill');
      }
    }

    const itemIds = dto.items.flatMap((item) => (item.itemId ? [item.itemId] : []));
    if (itemIds.length > 0) {
      const validItems = await db.item.count({
        where: { id: { in: [...new Set(itemIds)] }, branchId: { in: logicalBranchIds }, deletedAt: null },
      });
      if (validItems !== new Set(itemIds).size) {
        throw new BadRequestException('One or more items do not belong to this workspace');
      }
    }

    const totals = computeInvoiceTotals(
      dto.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: business.gstRegistered || isOneOf(dto.type, [DocumentType.PURCHASE_INVOICE, DocumentType.DEBIT_NOTE]) ? item.taxRate ?? 0 : 0,
        taxInclusive: item.taxInclusive,
      })),
      dto.discount ?? 0,
      { ...totalsOptionsFor(resolvePreferences(business.preferences), !isOneOf(dto.type, [DocumentType.PURCHASE_INVOICE, DocumentType.DEBIT_NOTE])), ...(dto.roundOff === undefined ? {} : { roundOff: dto.roundOff }) },
    );
    if (totals.grandTotal < 0) throw new BadRequestException('Discount cannot exceed the document total');
    return totals;
  }

  async findAll(
    businessId: string,
    branchId: string | undefined,
    { type, status, q: query, from, to, warehouseId, limit, offset }: ListDocumentsQueryDto,
  ) {
    if (from && to && from > to) throw new BadRequestException('from must be on or before to');
    const issueDate = issueDateRange(from, to);
    const where: Prisma.BusinessDocumentWhereInput = {
      businessId,
      ...(branchId ? { branchId } : {}),
      deletedAt: null,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(issueDate ? { issueDate } : {}),
      ...(warehouseId ? { warehouseId } : {}),
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
    const documents = await this.prisma.businessDocument.findMany({
      where,
      include: {
        party: true, supplier: true, branch: true,
        business: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        sourceDocument: { select: { id: true, documentNumber: true, type: true } },
        convertedDocuments: { where: { type: 'DEBIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, select: { grandTotal: true } },
        referenceInvoice: { select: { id: true, invoiceNumber: true } },
        // Only the latest live payment is needed, to label how the bill was paid.
        payments: { where: { voidedAt: null }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: 1, select: { method: true, account: { select: { bankName: true } } } },
      },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
    return documents.map(({ payments, ...document }) => ({ ...this.withReturnBalance(document), paymentType: purchasePaymentType({ paymentMethod: document.paymentMethod, payments }) }));
  }

  private withReturnBalance<T extends { grandTotal: Prisma.Decimal; paidAmount: Prisma.Decimal; convertedDocuments: Array<{grandTotal:Prisma.Decimal}> }>(document:T) {
    const debitTotal=sumMoney(document.convertedDocuments.map((note)=>Number(note.grandTotal)));
    return {...document,debitTotal,balanceDue:subtractMoney(subtractMoney(Number(document.grandTotal),debitTotal),Number(document.paidAmount))};
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const document = await this.prisma.businessDocument.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      include: {
        items: { include: { item: { select: { sku: true, description: true } } } },
        party: true,
        supplier: true,
        business: { include: { createdBy: { select: { name: true } } } },
        branch: true,
        createdBy: { select: { id: true, name: true, email: true } },
        referenceInvoice: { select: { id: true, invoiceNumber: true, grandTotal: true, issueDate: true } },
        convertedDocuments: { where: { type: 'DEBIT_NOTE', deletedAt: null, status: { notIn: ['DRAFT','CANCELLED','REJECTED'] } }, select: { grandTotal: true } },
        sourceDocument: { select: { id: true, documentNumber: true, type: true } },
        payments: { where: { voidedAt: null }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] },
        attachments: {
          select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    const convertedDocument = document.status === DocumentStatus.CONVERTED && !document.convertedInvoiceId
      ? await this.prisma.businessDocument.findFirst({ where: { sourceDocumentId: id, businessId, branchId: document.branchId, deletedAt: null, status: { not: DocumentStatus.CANCELLED } }, select: { id: true, type: true, documentNumber: true } })
      : null;
    const conversionTarget = document.convertedInvoiceId ? { id: document.convertedInvoiceId, type: 'INVOICE' as const } : convertedDocument;
    return {
      ...this.withReturnBalance(document), conversionTarget,
      party: document.party
        ? { ...document.party, gstin: document.party.gstin ? decryptField(document.party.gstin) : null }
        : null,
      supplier: document.supplier
        ? { ...document.supplier, gstin: document.supplier.gstin ? decryptField(document.supplier.gstin) : null }
        : null,
      business: { ...document.business, gstin: document.business.gstin ? decryptField(document.business.gstin) : null },
    };
  }

  async addAttachments(
    documentId: string,
    files: UploadedDocumentFile[],
    userId: string,
    businessId: string,
    branchId: string,
  ) {
    if (!files?.length) throw new BadRequestException('Select at least one file to upload');

    const document = await this.prisma.businessDocument.findFirst({
      where: { id: documentId, businessId, branchId, deletedAt: null },
      select: { id: true, type: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    if (document.type !== DocumentType.PURCHASE_INVOICE) {
      throw new BadRequestException('Attachments can only be uploaded to purchase bills');
    }

    const existing = await this.prisma.businessDocumentAttachment.aggregate({
      where: { documentId },
      _count: { id: true },
      _sum: { size: true },
    });
    if (existing._count.id + files.length > MAX_DOCUMENT_ATTACHMENTS) {
      throw new BadRequestException(`A purchase bill can have up to ${MAX_DOCUMENT_ATTACHMENTS} attachments`);
    }

    const totalNewBytes = files.reduce((sum, file) => sum + file.size, 0);
    if ((existing._sum.size ?? 0) + totalNewBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new BadRequestException('Purchase bill attachments cannot exceed 25 MB in total');
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
      uploads.map((upload) => this.prisma.businessDocumentAttachment.create({
        data: { documentId, ...upload },
        select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      })),
    );

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PURCHASE_BILL_ATTACHMENTS_ADDED',
      entityType: 'BusinessDocument',
      entityId: documentId,
      metadata: { files: created.map(({ id, fileName, kind, size }) => ({ id, fileName, kind, size })) },
    });
    return created;
  }

  async listAttachments(documentId: string, businessId: string, branchId?: string) {
    const document = await this.prisma.businessDocument.findFirst({
      where: { id: documentId, businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    return this.prisma.businessDocumentAttachment.findMany({
      where: { documentId },
      select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAttachment(documentId: string, attachmentId: string, businessId: string, branchId?: string) {
    const attachment = await this.prisma.businessDocumentAttachment.findFirst({
      where: {
        id: attachmentId,
        documentId,
        document: { businessId, ...(branchId ? { branchId } : {}), deletedAt: null },
      },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  async updateStatus(id: string, status: DocumentStatus, userId: string, businessId: string, branchId: string) {
    return billingTransaction(this.prisma, async (tx) => {
    await lockBillingRecord(tx, 'document', id);
    const document = await tx.businessDocument.findFirst({ where: { id, businessId, branchId, deletedAt: null }, include: { items: true } });
    if (!document) throw new NotFoundException('Document not found');
    if (document.status === status) return document;
    if (status === DocumentStatus.CONVERTED) throw new BadRequestException('Use the document conversion action');
    if (document.status !== DocumentStatus.DRAFT && status === DocumentStatus.DRAFT) throw new BadRequestException('Issued documents cannot be reset to draft');
    if (document.status === DocumentStatus.CONVERTED || document.status === DocumentStatus.CANCELLED) {
      throw new BadRequestException('This document is already closed');
    }
    if (status === DocumentStatus.CANCELLED && document.type === DocumentType.PURCHASE_INVOICE && Number(document.paidAmount) > 0) {
      throw new BadRequestException('A purchase bill with recorded payments cannot be cancelled');
    }

    if (status === DocumentStatus.REJECTED && document.status !== DocumentStatus.DRAFT && !isOneOf(document.type,[DocumentType.QUOTATION,DocumentType.PROFORMA_INVOICE])) throw new BadRequestException('Cancel an issued financial document to reverse its stock and balances');
    const posting = isOneOf(status, [DocumentStatus.ISSUED, DocumentStatus.ACCEPTED]);
    if (posting) await this.validateReturn(tx, document, Number(document.grandTotal), document.id);
    if (status === DocumentStatus.CANCELLED && document.type === DocumentType.PURCHASE_INVOICE) {
      const linked = await tx.businessDocument.count({ where: { sourceDocumentId: id, type: DocumentType.DEBIT_NOTE, deletedAt: null, status: { notIn: [DocumentStatus.DRAFT,DocumentStatus.CANCELLED,DocumentStatus.REJECTED] } } });
      if (linked) throw new BadRequestException('Cancel linked purchase returns before cancelling the bill');
    }
    const stockDocument = isOneOf(document.type, [DocumentType.PURCHASE_INVOICE,DocumentType.DELIVERY_CHALLAN]) || (document.returnStock && isOneOf(document.type,[DocumentType.CREDIT_NOTE,DocumentType.DEBIT_NOTE]));
    let stockAdjusted = document.stockAdjusted;
    if (stockDocument && posting && !stockAdjusted) { await this.applyDocumentStock(tx,document); stockAdjusted = true; }
    if (stockAdjusted && status === DocumentStatus.CANCELLED) { await this.applyDocumentStock(tx,document,true); stockAdjusted = false; }
    const updated = await tx.businessDocument.update({ where: { id }, data: { status, stockAdjusted } });

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
    });
  }

  async convertToInvoice(id: string, userId: string, businessId: string, branchId: string) {
    const invoice = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      await lockBillingRecord(tx, 'document', id);
      const document = await tx.businessDocument.findFirst({ where: { id, businessId, branchId, deletedAt: null }, include: { items: true } });
      if (!document) throw new NotFoundException('Document not found');
      if (document.convertedInvoiceId) return tx.invoice.findUniqueOrThrow({ where: { id: document.convertedInvoiceId }, include: { items: true, party: true, branch: true } });
      if (!isOneOf(document.type, [DocumentType.QUOTATION, DocumentType.PROFORMA_INVOICE, DocumentType.DELIVERY_CHALLAN, DocumentType.SALES_ORDER])) throw new BadRequestException('This document cannot be converted to a sales invoice');
      if (!document.partyId || isOneOf(document.status, [DocumentStatus.CANCELLED, DocumentStatus.REJECTED, DocumentStatus.CONVERTED])) throw new BadRequestException('This document cannot be converted');
      const created = await this.invoices.create({ warehouseId: document.warehouseId ?? undefined, partyId: document.partyId, issueDate: document.issueDate.toISOString(), dueDate: document.dueDate?.toISOString(), discount: Number(document.discount), deliveryMode: 'MANUAL',
        notes: [document.notes, document.terms, 'Converted from ' + document.documentNumber].filter(Boolean).join('\n'),
        items: document.items.map((item) => ({ ...trackingFields(item), itemId: item.itemId ?? undefined, description: item.description, unit: item.unit, hsnSac: item.hsnSac??undefined, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate), taxInclusive: item.taxInclusive })),
      }, userId, businessId, branchId, tx, document.stockAdjusted);
      await tx.businessDocument.update({ where: { id }, data: { status: DocumentStatus.CONVERTED, convertedInvoiceId: created.id } });
      return created;
    });
    await this.audit.log({ businessId, branchId, userId, action: 'DOCUMENT_CONVERTED_TO_INVOICE', entityType: 'BusinessDocument', entityId: id, metadata: { invoiceId: invoice.id } });
    return invoice;
  }

  async convertToOrderOrChallan(id:string,target:DocumentType,userId:string,businessId:string,branchId:string) {
    const result=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);await lockBillingRecord(tx,'document',id);
      const source=await tx.businessDocument.findFirst({where:{id,businessId,branchId,deletedAt:null},include:{items:true}});
      if(!source)throw new NotFoundException('Document not found');
      const allowed=source.type===DocumentType.QUOTATION && target===DocumentType.SALES_ORDER || source.type===DocumentType.SALES_ORDER && target===DocumentType.DELIVERY_CHALLAN;
      if(!allowed)throw new BadRequestException('This conversion is not supported');
      if(source.status===DocumentStatus.CONVERTED){const existing=await tx.businessDocument.findFirst({where:{sourceDocumentId:id,type:target,deletedAt:null},include:{items:true,party:true,supplier:true,branch:true}});if(existing)return existing;}
      if(isOneOf(source.status,[DocumentStatus.CONVERTED,DocumentStatus.CANCELLED,DocumentStatus.REJECTED]))throw new BadRequestException('This source document is closed');
      const created=await this.create({...transactionDetails(source),type:target,status:DocumentStatus.DRAFT,sourceDocumentId:id,warehouseId:source.warehouseId??undefined,partyId:source.partyId??undefined,issueDate:source.issueDate.toISOString(),dueDate:source.dueDate?.toISOString(),placeOfSupply:source.placeOfSupply??undefined,terms:source.terms??undefined,notes:source.notes??undefined,discount:Number(source.discount),items:source.items.map((line)=>({...trackingFields(line),itemId:line.itemId??undefined,description:line.description,hsnSac:line.hsnSac??undefined,unit:line.unit,quantity:Number(line.quantity),unitPrice:Number(line.unitPrice),taxRate:Number(line.taxRate),taxInclusive:line.taxInclusive}))},userId,businessId,branchId,tx);
      await tx.businessDocument.update({where:{id},data:{status:DocumentStatus.CONVERTED}});return created;
    });
    await this.audit.log({businessId,branchId,userId,action:'DOCUMENT_CONVERTED',entityType:'BusinessDocument',entityId:id,metadata:{target,documentId:result.id}});return result;
  }

  convertToProforma(id: string, userId: string, businessId: string, branchId: string) {
    return this.convertPreSaleDocument(id, DocumentType.PROFORMA_INVOICE, userId, businessId, branchId);
  }

  convertToEstimate(id: string, userId: string, businessId: string, branchId: string) {
    return this.convertPreSaleDocument(id, DocumentType.QUOTATION, userId, businessId, branchId);
  }

  private async convertPreSaleDocument(id: string, target: 'QUOTATION' | 'PROFORMA_INVOICE', userId: string, businessId: string, branchId: string) {
    const result=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId); await lockBillingRecord(tx,'document',id);
      const document=await tx.businessDocument.findFirst({where:{id,businessId,branchId,deletedAt:null},include:{items:true}});
      if(!document) throw new NotFoundException('Document not found');
      if(document.type !== (target === DocumentType.PROFORMA_INVOICE ? DocumentType.QUOTATION : DocumentType.PROFORMA_INVOICE)) throw new BadRequestException('Select an estimate or proforma invoice for this conversion');
      if(document.status===DocumentStatus.CONVERTED){const existing=await tx.businessDocument.findFirst({where:{sourceDocumentId:id,type:target,deletedAt:null,status:{not:DocumentStatus.CANCELLED}},include:{items:true,party:true,supplier:true,branch:true}});if(existing)return existing;}
      if(isOneOf(document.status,[DocumentStatus.CONVERTED,DocumentStatus.CANCELLED,DocumentStatus.REJECTED]))throw new BadRequestException('This quotation cannot be converted');
      const created=await this.create({...transactionDetails(document),warehouseId:document.warehouseId??undefined,type:target,status:DocumentStatus.DRAFT,partyId:document.partyId??undefined,sourceDocumentId:id,issueDate:document.issueDate.toISOString(),validUntil:document.validUntil?.toISOString(),dueDate:document.dueDate?.toISOString(),placeOfSupply:document.placeOfSupply??undefined,terms:document.terms??undefined,notes:document.notes??undefined,discount:Number(document.discount),items:document.items.map((item)=>({...trackingFields(item),itemId:item.itemId??undefined,description:item.description,hsnSac:item.hsnSac??undefined,quantity:Number(item.quantity),unit:item.unit,unitPrice:Number(item.unitPrice),taxRate:Number(item.taxRate),taxInclusive:item.taxInclusive}))},userId,businessId,branchId,tx);
      await tx.businessDocument.update({where:{id},data:{status:DocumentStatus.CONVERTED}});return created;
    });
    await this.audit.log({businessId,branchId,userId,action:target === DocumentType.PROFORMA_INVOICE ? 'DOCUMENT_CONVERTED_TO_PROFORMA' : 'DOCUMENT_CONVERTED_TO_ESTIMATE',entityType:'BusinessDocument',entityId:id,metadata:{documentId:result.id}});
    return result;
  }

  async reverseConversion(id: string, targetId: string, userId: string, businessId: string, branchId: string) {
    const result = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      await lockBillingRecord(tx, 'document', id);
      const source = await tx.businessDocument.findFirst({ where: { id, businessId, branchId, deletedAt: null } });
      if (!source) throw new NotFoundException('Original document not found');
      if (!isOneOf(source.type, [DocumentType.QUOTATION, DocumentType.PROFORMA_INVOICE])) throw new BadRequestException('Only estimate and proforma conversions can be undone here');
      if (source.status !== DocumentStatus.CONVERTED) {
        if (source.status === DocumentStatus.DRAFT && !source.convertedInvoiceId) return { document: source, replayed: true };
        throw new BadRequestException('This document has no conversion to undo');
      }
      if (source.convertedInvoiceId) {
        if (source.convertedInvoiceId !== targetId) throw new BadRequestException('The conversion changed. Refresh the record before undoing it');
        await this.invoices.reverseConvertedInvoice(tx, targetId, businessId, branchId);
      } else {
        await lockBillingRecord(tx, 'document', targetId);
        const target = await tx.businessDocument.findFirst({ where: { id: targetId, sourceDocumentId: id, businessId, branchId, deletedAt: null }, include: { items: true } });
        if (!target) throw new BadRequestException('The conversion changed. Refresh the record before undoing it');
        if (!isOneOf(target.type, [DocumentType.QUOTATION, DocumentType.PROFORMA_INVOICE, DocumentType.SALES_ORDER])) throw new BadRequestException('This conversion cannot be undone here');
        if (Number(target.paidAmount) > 0) throw new BadRequestException('A record with payments cannot be returned to an estimate or proforma');
        const downstream = await tx.businessDocument.count({ where: { sourceDocumentId: target.id, deletedAt: null, status: { not: DocumentStatus.CANCELLED } } });
        if (target.status === DocumentStatus.CONVERTED || target.convertedInvoiceId || downstream) throw new BadRequestException('Undo the later conversion first, then return to the original document');
        if (target.stockAdjusted) throw new BadRequestException('Reverse the stock transaction before undoing this conversion');
        await tx.businessDocument.update({ where: { id: target.id }, data: { status: DocumentStatus.CANCELLED, deletedAt: new Date() } });
      }
      const document = await tx.businessDocument.update({ where: { id }, data: { status: DocumentStatus.DRAFT, convertedInvoiceId: null } });
      return { document, replayed: false };
    });
    if (!result.replayed) await this.audit.log({ businessId, branchId, userId, action: 'DOCUMENT_CONVERSION_REVERSED', entityType: 'BusinessDocument', entityId: id, metadata: { targetId, restoredStatus: DocumentStatus.DRAFT } });
    return result.document;
  }

  /** A payment made while saving a purchase bill becomes a one-bill Payment-Out receipt. */
  recordPurchasePayment(documentId: string, dto: RecordPurchasePaymentDto, userId: string, businessId: string, branchId: string) {
    return this.paymentOut.recordForBill(documentId, dto, userId, businessId, branchId);
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
    if (isOneOf(dto.type, [DocumentType.PURCHASE_INVOICE, DocumentType.DEBIT_NOTE]) && !dto.supplierId) {
      throw new BadRequestException('Purchase invoices and debit notes require a supplier');
    }
    if (PARTY_DOCUMENTS.has(dto.type) && !dto.partyId) {
      throw new BadRequestException('This document requires a party');
    }
  }

  private async applyDocumentStock(tx: Prisma.TransactionClient, document: { id?:string; branchId?:string|null; warehouseId?:string|null; businessId: string; type: DocumentType; items: Array<{itemId?: string | null; quantity: number | Prisma.Decimal}> }, reverse = false) {
    const business = await tx.business.findUnique({ where: { id: document.businessId }, select: { preferences: true } });
    const inward = isOneOf(document.type,[DocumentType.PURCHASE_INVOICE,DocumentType.CREDIT_NOTE]);
    await adjustStock(tx, document.items.map((line)=>({itemId:line.itemId,quantity:Number(line.quantity)})), inward !== reverse ? 'increment' : 'decrement', resolvePreferences(business?.preferences).transaction.negativeStock, {businessId:document.businessId,branchId:document.branchId!,warehouseId:document.warehouseId,sourceId:document.id,kind:reverse?'DOCUMENT_REVERSAL':document.type});
  }

  private async validateReturn(tx: Prisma.TransactionClient, document: { businessId: string; type: DocumentType; referenceInvoiceId?: string | null; sourceDocumentId?: string | null; returnStock?: boolean; items: Array<{ itemId?: string | null; description: string; quantity: number | Prisma.Decimal }> }, total: number, excludingId?: string) {
    if (!isOneOf(document.type,[DocumentType.CREDIT_NOTE,DocumentType.DEBIT_NOTE])) return;
    const sale = document.type === DocumentType.CREDIT_NOTE;
    const sourceId = sale ? document.referenceInvoiceId : document.sourceDocumentId;
    if (!sourceId) throw new BadRequestException('A return must reference its original invoice or bill');
    await lockBillingRecord(tx,sale?'invoice':'document',sourceId);
    const source = sale
      ? await tx.invoice.findFirst({where:{id:sourceId,businessId:document.businessId,deletedAt:null},include:{items:true}})
      : await tx.businessDocument.findFirst({where:{id:sourceId,businessId:document.businessId,deletedAt:null,type:DocumentType.PURCHASE_INVOICE},include:{items:true}});
    if (!source || ['DRAFT','CANCELLED','REJECTED'].includes(source.status)) throw new BadRequestException('Returns require an issued source transaction');
    const previous = await tx.businessDocument.findMany({where:{businessId:document.businessId,type:document.type,...(sale?{referenceInvoiceId:sourceId}:{sourceDocumentId:sourceId}),deletedAt:null,status:{notIn:[DocumentStatus.DRAFT,DocumentStatus.CANCELLED,DocumentStatus.REJECTED]},...(excludingId?{id:{not:excludingId}}:{})},include:{items:true}});
    if (sumMoney([total,...previous.map((record)=>Number(record.grandTotal))]) > Number(source.grandTotal)) throw new BadRequestException('Cumulative returns cannot exceed the original transaction value');
    if (!document.returnStock) return;
    const key = (line:{itemId?:string|null;description:string})=>line.itemId || line.description.trim();
    const available = new Map<string,Prisma.Decimal>();
    for(const line of source.items) available.set(key(line),(available.get(key(line))??new Prisma.Decimal(0)).add(line.quantity));
    for(const line of [...document.items,...previous.filter((record)=>record.returnStock).flatMap((record)=>record.items)]) {
      const remaining=(available.get(key(line))??new Prisma.Decimal(0)).sub(line.quantity);
      if (remaining.isNegative()) throw new BadRequestException('Returned quantities cannot exceed quantities in the original transaction');
      available.set(key(line),remaining);
    }
  }
}
