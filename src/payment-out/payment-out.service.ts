import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType, InvoiceAttachmentKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';
import { CreatePaymentOutDto, UpdatePaymentOutDto, VoidPaymentOutDto } from './payment-out.dto.js';

export interface UploadedReceiptFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const OPEN_BILL = [DocumentStatus.ISSUED, DocumentStatus.ACCEPTED];
const LIVE_DEBIT_NOTE = { type: DocumentType.DEBIT_NOTE, deletedAt: null, status: { notIn: [DocumentStatus.DRAFT, DocumentStatus.CANCELLED, DocumentStatus.REJECTED] } };
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const METHOD_LABELS: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', other: 'Other', discount: 'Discount' };

/** Money is handled in whole paise so splits and allocations add up exactly. */
const toPaise = (value: number | Prisma.Decimal) => Math.round(Number(value) * 100);
const toRupees = (paise: number) => paise / 100;
const rupees = (paise: number) => `₹${toRupees(paise).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type OpenBill = { id: string; documentNumber: string; referenceNumber: string | null; issueDate: Date; dueDate: Date | null; grandTotal: number; outstanding: number };

/** Settles the oldest-due bills first until the amount runs out. Returns null if the bills can't absorb it all. */
export function allocateOldestFirst(bills: Array<{ id: string; outstanding: number }>, amount: number) {
  let remaining = toPaise(amount);
  const allocations: Array<{ documentId: string; amount: number }> = [];
  for (const bill of bills) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, toPaise(bill.outstanding));
    if (take > 0) allocations.push({ documentId: bill.id, amount: toRupees(take) });
    remaining -= take;
  }
  return remaining > 0 ? null : allocations;
}

/**
 * Splits each bill's settlement across the funding sources in order: the money
 * payment types first, then any discount. Returns one row per (bill, source) piece.
 */
export function fundAllocations<S extends { amount: number }>(allocations: Array<{ documentId: string; amount: number }>, sources: S[]) {
  const left = sources.map((source) => toPaise(source.amount));
  const pieces: Array<{ documentId: string; amount: number; source: S }> = [];
  let index = 0;
  for (const allocation of allocations) {
    let need = toPaise(allocation.amount);
    while (need > 0) {
      while (index < sources.length && left[index] <= 0) index++;
      if (index >= sources.length) throw new BadRequestException('Bill settlements add up to more than the payment');
      const take = Math.min(need, left[index]);
      pieces.push({ documentId: allocation.documentId, amount: toRupees(take), source: sources[index] });
      need -= take;
      left[index] -= take;
    }
  }
  return pieces;
}

@Injectable()
export class PaymentOutService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private readonly listInclude = {
    supplier: { select: { id: true, name: true, phone: true, email: true } },
    payments: {
      select: {
        id: true, documentId: true, amount: true, method: true, accountId: true, reference: true, voidedAt: true,
        account: { select: { bankName: true } },
        document: { select: { id: true, documentNumber: true, referenceNumber: true, grandTotal: true, paidAmount: true } },
      },
      orderBy: { createdAt: 'asc' as const },
    },
    _count: { select: { attachments: true } },
  } satisfies Prisma.PaymentOutReceiptInclude;

  private present(receipt: Prisma.PaymentOutReceiptGetPayload<{ include: PaymentOutService['listInclude'] }>) {
    const bills = new Map<string, { id: string; documentNumber: string; referenceNumber: string | null; settled: number }>();
    for (const payment of receipt.payments) {
      const bill = bills.get(payment.documentId) ?? { id: payment.document.id, documentNumber: payment.document.documentNumber, referenceNumber: payment.document.referenceNumber, settled: 0 };
      bill.settled = toRupees(toPaise(bill.settled) + toPaise(payment.amount));
      bills.set(payment.documentId, bill);
    }
    const paymentTypes = [...new Set(receipt.payments.filter(({ method }) => method !== 'discount').map((payment) => payment.account?.bankName ?? METHOD_LABELS[payment.method] ?? payment.method))];
    const { _count, payments, ...rest } = receipt;
    return {
      ...rest,
      paid: Number(receipt.paid),
      discount: Number(receipt.discount),
      total: toRupees(toPaise(receipt.paid) + toPaise(receipt.discount)),
      paymentTypes,
      splits: payments.filter(({ method }) => method !== 'discount').map(({ method, accountId, account, amount, reference }) => ({ method, accountId, bankName: account?.bankName ?? null, amount: Number(amount), reference })),
      bills: [...bills.values()],
      attachmentCount: _count.attachments,
    };
  }

  async list(businessId: string, branchId: string | undefined, limit: number, offset: number) {
    const receipts = await this.prisma.paymentOutReceipt.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
      include: this.listInclude,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
    return receipts.map((receipt) => this.present(receipt));
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const receipt = await this.prisma.paymentOutReceipt.findFirst({ where: { id, businessId, ...(branchId ? { branchId } : {}) }, include: this.listInclude });
    if (!receipt) throw new NotFoundException('Payment not found');
    const attachments = await this.prisma.paymentOutAttachment.findMany({ where: { receiptId: id }, select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    return { ...this.present(receipt), attachments };
  }

  /** Unpaid bills for a supplier, oldest due first, with what is still payable on each. */
  async openBills(supplierId: string, businessId: string, branchId: string, tx?: Prisma.TransactionClient): Promise<OpenBill[]> {
    const bills = await (tx ?? this.prisma).businessDocument.findMany({
      where: { businessId, branchId, supplierId, type: DocumentType.PURCHASE_INVOICE, status: { in: OPEN_BILL }, deletedAt: null },
      select: { id: true, documentNumber: true, referenceNumber: true, issueDate: true, dueDate: true, grandTotal: true, paidAmount: true, createdAt: true, convertedDocuments: { where: LIVE_DEBIT_NOTE, select: { grandTotal: true } } },
    });
    return bills
      .map((bill) => ({
        id: bill.id,
        documentNumber: bill.documentNumber,
        referenceNumber: bill.referenceNumber,
        issueDate: bill.issueDate,
        dueDate: bill.dueDate,
        createdAt: bill.createdAt,
        grandTotal: Number(bill.grandTotal),
        outstanding: toRupees(toPaise(bill.grandTotal) - bill.convertedDocuments.reduce((sum, note) => sum + toPaise(note.grandTotal), 0) - toPaise(bill.paidAmount)),
      }))
      .filter((bill) => bill.outstanding > 0)
      .sort((a, b) => (a.dueDate ?? a.issueDate).getTime() - (b.dueDate ?? b.issueDate).getTime() || a.issueDate.getTime() - b.issueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ createdAt: _createdAt, ...bill }) => bill);
  }

  private async assertAccount(tx: Prisma.TransactionClient, accountId: string, businessId: string, branchId: string) {
    await lockBillingRecord(tx, 'account', accountId);
    if (!await tx.cashAccount.findFirst({ where: { id: accountId, businessId, branchId, deletedAt: null } })) throw new BadRequestException('Bank account not found in this branch');
  }

  /** Receipt numbers run PO-<year>-000001 per branch; callers hold the branch lock. */
  private async nextReceiptNumber(tx: Prisma.TransactionClient, branchId: string, paidAt: Date) {
    const prefix = `PO-${paidAt.getFullYear()}-`;
    const last = await tx.paymentOutReceipt.findFirst({ where: { branchId, receiptNumber: { startsWith: prefix } }, orderBy: { receiptNumber: 'desc' }, select: { receiptNumber: true } });
    const sequence = last ? Number.parseInt(last.receiptNumber.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(sequence + 1).padStart(6, '0')}`;
  }

  async create(dto: CreatePaymentOutDto, userId: string, businessId: string, branchId: string) {
    const paidPaise = dto.splits.reduce((sum, split) => sum + toPaise(split.amount), 0);
    const discountPaise = toPaise(dto.discount ?? 0);
    const totalPaise = paidPaise + discountPaise;
    if (totalPaise <= 0) throw new BadRequestException('Enter the amount paid or a discount');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    const reference = dto.reference?.trim() || null;
    const description = dto.description?.trim() || null;

    const result = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      if (dto.requestId) {
        const previous = await tx.paymentOutReceipt.findFirst({ where: { branchId, requestId: dto.requestId }, include: this.listInclude });
        if (previous) return { receipt: previous, replayed: true };
      }
      const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
      const supplier = await tx.supplier.findFirst({ where: { id: dto.supplierId, branchId: { in: logicalBranchIds }, deletedAt: null }, select: { id: true, name: true } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      for (const accountId of [...new Set(dto.splits.flatMap(({ accountId }) => accountId ? [accountId] : []))].sort()) await this.assertAccount(tx, accountId, businessId, branchId);

      // Lock in a fixed order, then re-read so balances reflect any payment that just committed.
      for (const { id } of [...await this.openBills(dto.supplierId, businessId, branchId, tx)].sort((a, b) => a.id.localeCompare(b.id))) await lockBillingRecord(tx, 'document', id);
      const open = await this.openBills(dto.supplierId, businessId, branchId, tx);
      if (!open.length) throw new BadRequestException(`${supplier.name} has no unpaid purchase bills`);
      const payable = open.reduce((sum, bill) => sum + toPaise(bill.outstanding), 0);

      let allocations: Array<{ documentId: string; amount: number }>;
      if (dto.allocations?.length) {
        const seen = new Set<string>();
        for (const allocation of dto.allocations) {
          const bill = open.find(({ id }) => id === allocation.documentId);
          if (!bill) throw new BadRequestException('One of the selected bills is no longer open for payment');
          if (seen.has(bill.id)) throw new BadRequestException(`Bill ${bill.referenceNumber || bill.documentNumber} is listed twice`);
          seen.add(bill.id);
          if (toPaise(allocation.amount) > toPaise(bill.outstanding)) throw new BadRequestException(`Bill ${bill.referenceNumber || bill.documentNumber} only has ${rupees(toPaise(bill.outstanding))} outstanding`);
        }
        const allocated = dto.allocations.reduce((sum, allocation) => sum + toPaise(allocation.amount), 0);
        if (allocated !== totalPaise) throw new BadRequestException(`Bills settled (${rupees(allocated)}) must equal paid plus discount (${rupees(totalPaise)})`);
        allocations = dto.allocations.map(({ documentId, amount }) => ({ documentId, amount }));
      } else {
        const auto = allocateOldestFirst(open, toRupees(totalPaise));
        if (!auto) throw new BadRequestException(`${rupees(totalPaise)} is more than the ${rupees(payable)} ${supplier.name} is owed on open bills`);
        allocations = auto;
      }

      const receipt = await tx.paymentOutReceipt.create({
        data: { businessId, branchId, supplierId: supplier.id, receiptNumber: await this.nextReceiptNumber(tx, branchId, paidAt), paidAt, reference, description, paid: toRupees(paidPaise), discount: toRupees(discountPaise), requestId: dto.requestId, createdById: userId },
      });
      const sources = [
        ...dto.splits.map((split) => ({ amount: split.amount, method: split.method, accountId: split.accountId ?? null, reference: split.reference?.trim() || reference })),
        ...(discountPaise > 0 ? [{ amount: toRupees(discountPaise), method: 'discount', accountId: null, reference }] : []),
      ];
      for (const piece of fundAllocations(allocations, sources)) {
        await tx.purchasePayment.create({ data: { documentId: piece.documentId, receiptId: receipt.id, amount: piece.amount, method: piece.source.method, accountId: piece.source.accountId, reference: piece.source.reference, notes: description, paidAt, createdById: userId } });
      }
      for (const allocation of allocations) await tx.businessDocument.update({ where: { id: allocation.documentId }, data: { paidAmount: { increment: allocation.amount } } });
      return { receipt: await tx.paymentOutReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: this.listInclude }), replayed: false };
    });
    if (!result.replayed) await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_RECORDED', entityType: 'PaymentOutReceipt', entityId: result.receipt.id, metadata: { receiptNumber: result.receipt.receiptNumber, supplierId: dto.supplierId, paid: toRupees(paidPaise), discount: toRupees(discountPaise) } });
    return this.present(result.receipt);
  }

  /** Records one payment against one bill, as the purchase bill form does when saving. */
  async recordForBill(documentId: string, payment: { amount: number; method: string; accountId?: string; reference?: string; notes?: string; paidAt?: string; requestId?: string }, userId: string, businessId: string, branchId: string) {
    const bill = await this.prisma.businessDocument.findFirst({ where: { id: documentId, businessId, branchId, deletedAt: null }, select: { type: true, status: true, supplierId: true } });
    if (!bill) throw new NotFoundException('Document not found');
    if (bill.type !== DocumentType.PURCHASE_INVOICE || !OPEN_BILL.includes(bill.status as (typeof OPEN_BILL)[number])) throw new BadRequestException('Issue a purchase bill before recording payment');
    if (!bill.supplierId) throw new BadRequestException('Assign a supplier to this bill before recording payment');
    return this.create({
      supplierId: bill.supplierId,
      requestId: payment.requestId,
      paidAt: payment.paidAt,
      reference: payment.reference,
      description: payment.notes,
      splits: [{ method: payment.method, accountId: payment.accountId, amount: payment.amount }],
      allocations: [{ documentId, amount: payment.amount }],
    }, userId, businessId, branchId);
  }

  /** Locks the receipt's bills in a fixed order and returns the receipt with its payments. */
  private async lockReceipt(tx: Prisma.TransactionClient, id: string, businessId: string, branchId: string) {
    const scoped = await tx.paymentOutReceipt.findFirst({ where: { id, businessId, branchId }, select: { payments: { select: { documentId: true } } } });
    if (!scoped) throw new NotFoundException('Payment not found');
    for (const documentId of [...new Set(scoped.payments.map(({ documentId }) => documentId))].sort()) await lockBillingRecord(tx, 'document', documentId);
    return tx.paymentOutReceipt.findUniqueOrThrow({ where: { id }, include: { payments: { include: { document: true } } } });
  }

  private static perBill(payments: Array<{ documentId: string; amount: Prisma.Decimal }>) {
    const totals = new Map<string, number>();
    for (const payment of payments) totals.set(payment.documentId, (totals.get(payment.documentId) ?? 0) + toPaise(payment.amount));
    return totals;
  }

  async update(id: string, dto: UpdatePaymentOutDto, userId: string, businessId: string, branchId: string) {
    const receipt = await this.prisma.paymentOutReceipt.findFirst({ where: { id, businessId, branchId } });
    if (!receipt) throw new NotFoundException('Payment not found');
    if (receipt.voidedAt) throw new BadRequestException('Restore this payment before editing it');
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : undefined;
    const description = dto.description === undefined ? undefined : dto.description.trim() || null;
    await this.prisma.$transaction([
      this.prisma.paymentOutReceipt.update({ where: { id }, data: { paidAt, description, reference: dto.reference === undefined ? undefined : dto.reference.trim() || null } }),
      this.prisma.purchasePayment.updateMany({ where: { receiptId: id }, data: { paidAt, notes: description } }),
    ]);
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_UPDATED', entityType: 'PaymentOutReceipt', entityId: id, metadata: { ...dto } });
    return this.findOne(id, businessId, branchId);
  }

  async void(id: string, dto: VoidPaymentOutDto, userId: string, businessId: string, branchId: string) {
    const replayed = await billingTransaction(this.prisma, async (tx) => {
      const receipt = await this.lockReceipt(tx, id, businessId, branchId);
      if (receipt.voidedAt) return true;
      const live = receipt.payments.filter(({ voidedAt }) => !voidedAt);
      for (const [documentId, paise] of PaymentOutService.perBill(live)) await tx.businessDocument.update({ where: { id: documentId }, data: { paidAmount: { decrement: toRupees(paise) } } });
      const now = new Date();
      await tx.purchasePayment.updateMany({ where: { receiptId: id, voidedAt: null }, data: { voidedAt: now, voidedById: userId, voidReason: dto.reason?.trim() || null } });
      await tx.paymentOutReceipt.update({ where: { id }, data: { voidedAt: now, voidedById: userId, voidReason: dto.reason?.trim() || null } });
      return false;
    });
    if (!replayed) await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_VOIDED', entityType: 'PaymentOutReceipt', entityId: id, metadata: { reason: dto.reason?.trim() || null } });
    return this.findOne(id, businessId, branchId);
  }

  async restore(id: string, userId: string, businessId: string, branchId: string) {
    const replayed = await billingTransaction(this.prisma, async (tx) => {
      const receipt = await this.lockReceipt(tx, id, businessId, branchId);
      if (!receipt.voidedAt) return true;
      for (const accountId of [...new Set(receipt.payments.flatMap(({ accountId }) => accountId ? [accountId] : []))].sort()) await this.assertAccount(tx, accountId, businessId, branchId);
      const amounts = PaymentOutService.perBill(receipt.payments);
      for (const [documentId, paise] of amounts) {
        const bill = receipt.payments.find((payment) => payment.documentId === documentId)!.document;
        const open = bill.supplierId && !bill.deletedAt && OPEN_BILL.includes(bill.status as (typeof OPEN_BILL)[number])
          ? (await this.openBills(bill.supplierId, businessId, branchId, tx)).find(({ id: openId }) => openId === documentId)
          : undefined;
        const outstanding = open?.outstanding ?? 0;
        if (paise > toPaise(outstanding)) throw new BadRequestException(`Bill ${bill.referenceNumber || bill.documentNumber} only has ${rupees(toPaise(outstanding))} outstanding, so this payment can't be restored`);
      }
      for (const [documentId, paise] of amounts) await tx.businessDocument.update({ where: { id: documentId }, data: { paidAmount: { increment: toRupees(paise) } } });
      await tx.purchasePayment.updateMany({ where: { receiptId: id }, data: { voidedAt: null, voidedById: null, voidReason: null } });
      await tx.paymentOutReceipt.update({ where: { id }, data: { voidedAt: null, voidedById: null, voidReason: null } });
      return false;
    });
    if (!replayed) await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_RESTORED', entityType: 'PaymentOutReceipt', entityId: id });
    return this.findOne(id, businessId, branchId);
  }

  /** Permanently removes a receipt; live amounts come off their bills first and the audit log keeps a copy. */
  async remove(id: string, userId: string, businessId: string, branchId: string) {
    const removed = await billingTransaction(this.prisma, async (tx) => {
      const receipt = await this.lockReceipt(tx, id, businessId, branchId);
      for (const [documentId, paise] of PaymentOutService.perBill(receipt.payments.filter(({ voidedAt }) => !voidedAt))) await tx.businessDocument.update({ where: { id: documentId }, data: { paidAmount: { decrement: toRupees(paise) } } });
      await tx.paymentOutReceipt.delete({ where: { id } });
      return receipt;
    });
    await this.audit.log({
      businessId, branchId, userId, action: 'PAYMENT_OUT_DELETED', entityType: 'PaymentOutReceipt', entityId: id,
      metadata: {
        receiptNumber: removed.receiptNumber, supplierId: removed.supplierId, paidAt: removed.paidAt, paid: Number(removed.paid), discount: Number(removed.discount), voided: Boolean(removed.voidedAt),
        payments: removed.payments.map(({ documentId, document, amount, method, accountId, reference }) => ({ documentId, documentNumber: document.documentNumber, amount: Number(amount), method, accountId, reference })),
      },
    });
    return { id, deleted: true };
  }

  async addAttachments(id: string, files: UploadedReceiptFile[], userId: string, businessId: string, branchId: string) {
    if (!files?.length) throw new BadRequestException('Select at least one file to upload');
    if (!await this.prisma.paymentOutReceipt.findFirst({ where: { id, businessId, branchId }, select: { id: true } })) throw new NotFoundException('Payment not found');
    const existing = await this.prisma.paymentOutAttachment.aggregate({ where: { receiptId: id }, _count: { id: true }, _sum: { size: true } });
    if (existing._count.id + files.length > MAX_ATTACHMENTS) throw new BadRequestException(`A payment can have up to ${MAX_ATTACHMENTS} attachments`);
    if ((existing._sum.size ?? 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) throw new BadRequestException('Payment attachments cannot exceed 25 MB in total');
    const uploads = files.map((file) => {
      if (!file.buffer || file.size <= 0) throw new BadRequestException('Empty files cannot be uploaded');
      if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`${file.originalname} exceeds the 10 MB file limit`);
      const kind = IMAGE_TYPES.has(file.mimetype) ? InvoiceAttachmentKind.IMAGE : file.mimetype === 'application/pdf' ? InvoiceAttachmentKind.DOCUMENT : null;
      if (!kind) throw new BadRequestException(`${file.originalname} must be a JPG, PNG, WebP image or a PDF`);
      const fileName = file.originalname.replace(/[\r\n]/g, '').replace(/[^\p{L}\p{N}._() -]/gu, '_').slice(0, 191) || 'attachment';
      return { receiptId: id, kind, fileName, mimeType: file.mimetype, size: file.size, data: Uint8Array.from(file.buffer) };
    });
    const created = await this.prisma.$transaction(uploads.map((data) => this.prisma.paymentOutAttachment.create({ data, select: { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true } })));
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_ATTACHMENTS_ADDED', entityType: 'PaymentOutReceipt', entityId: id, metadata: { files: created.map(({ id: fileId, fileName, size }) => ({ id: fileId, fileName, size })) } });
    return created;
  }

  async getAttachment(id: string, attachmentId: string, businessId: string, branchId?: string) {
    const attachment = await this.prisma.paymentOutAttachment.findFirst({ where: { id: attachmentId, receiptId: id, receipt: { businessId, ...(branchId ? { branchId } : {}) } } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  async removeAttachment(id: string, attachmentId: string, userId: string, businessId: string, branchId: string) {
    const attachment = await this.getAttachment(id, attachmentId, businessId, branchId);
    await this.prisma.paymentOutAttachment.delete({ where: { id: attachment.id } });
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_ATTACHMENT_REMOVED', entityType: 'PaymentOutReceipt', entityId: id, metadata: { attachmentId, fileName: attachment.fileName } });
    return { id: attachmentId, deleted: true };
  }
}
