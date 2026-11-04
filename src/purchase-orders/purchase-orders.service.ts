import { trackingFields } from '../common/dto/tracking-fields.dto.js';
import { transactionDetails } from '../common/dto/transaction-details.dto.js';
import { DocumentsService } from '../documents/documents.service.js';
import { billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { computeInvoiceTotals, totalsOptionsFor } from '../invoices/invoice-calc.util.js';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceAttachmentKind, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';

const ORDER_INCLUDE = { supplier: true, items: true, branch: true } satisfies Prisma.PurchaseOrderInclude;
const ATTACHMENT_FIELDS = { id: true, kind: true, fileName: true, mimeType: true, size: true, createdAt: true } as const;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain']);

export interface UploadedOrderFile { originalname: string; mimetype: string; size: number; buffer: Buffer }
/** Orders that may still change: not received into a bill, cancelled or closed. */
const OPEN_ORDER: PurchaseOrderStatus[] = [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SENT, PurchaseOrderStatus.CONFIRMED];

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly documents: DocumentsService) {}

  findAll(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    return this.prisma.purchaseOrder.findMany({ where: { businessId, ...(branchId ? { branchId } : {}) }, include: ORDER_INCLUDE, orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }], take: limit, skip: offset });
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, businessId, ...(branchId ? { branchId } : {}) }, include: { ...ORDER_INCLUDE, convertedDocument: { select: { id: true, documentNumber: true, status: true } }, attachments: { select: ATTACHMENT_FIELDS, orderBy: { createdAt: 'asc' } } } });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  /** The number a new order gets when none is typed: PORD-<year>-000001, per branch. */
  async nextNumber(branchId: string, date = new Date(), db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const prefix = `PORD-${date.getFullYear()}-`;
    const last = await db.purchaseOrder.findFirst({ where: { branchId, orderNumber: { startsWith: prefix } }, orderBy: { orderNumber: 'desc' }, select: { orderNumber: true } });
    const sequence = last ? Number.parseInt(last.orderNumber.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(sequence + 1).padStart(6, '0')}`;
  }

  /** Validates the supplier and items, then prices the lines. Shared by create and update. */
  private async price(dto: CreatePurchaseOrderDto, businessId: string, branchId: string) {
    const branches = await getLogicalBranchIds(this.prisma,businessId,branchId);
    if (!await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, branchId: {in: branches}, deletedAt: null } })) throw new NotFoundException('Supplier not found');
    const itemIds=dto.items.flatMap((line)=>line.itemId?[line.itemId]:[]);
    if(itemIds.length && await this.prisma.item.count({where:{id:{in:[...new Set(itemIds)]},branchId:{in:branches},deletedAt:null}})!==new Set(itemIds).size)throw new BadRequestException('Purchase order item is outside this branch');
    if (dto.orderDate && dto.expectedDeliveryDate && dto.expectedDeliveryDate.slice(0, 10) < dto.orderDate.slice(0, 10)) throw new BadRequestException('Expected delivery cannot be before the order date');
    if (dto.warehouseId && !await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, businessId, branchId, isActive: true } })) throw new BadRequestException('Godown not found in this branch');
    if (dto.accountId && !await this.prisma.cashAccount.findFirst({ where: { id: dto.accountId, businessId, branchId, deletedAt: null } })) throw new BadRequestException('Bank account not found in this branch');
    const business=await this.prisma.business.findUnique({where:{id:businessId},select:{preferences:true}});
    const totals=computeInvoiceTotals(dto.items.map((item)=>({quantity:item.quantity,unitPrice:item.unitPrice,taxRate:item.taxRate??0,taxInclusive:item.taxInclusive})),dto.discount??0,{...totalsOptionsFor(resolvePreferences(business?.preferences),false),...(dto.roundOff===undefined?{}:{roundOff:dto.roundOff})});
    if(totals.grandTotal<0)throw new BadRequestException('Discount cannot exceed the order total');
    const lines=totals.lines.map((line,index)=>({...dto.items[index],description:dto.items[index].description.trim(),unit:dto.items[index].unit||'pcs',taxRate:line.taxRate,lineTotal:line.lineTotal}));
    const {subTotal,taxTotal,discount,grandTotal}=totals;
    return { lines, amounts: { subTotal, taxTotal, discount, grandTotal } };
  }

  private fields(dto: CreatePurchaseOrderDto) {
    return {
      supplierId: dto.supplierId,
      orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
      expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
      paymentTerms: dto.paymentTerms?.trim() || null,
      notes: dto.notes?.trim() || null,
      warehouseId: dto.warehouseId ?? null,
      placeOfSupply: dto.placeOfSupply?.trim() || null,
      billingName: dto.billingName?.trim() || null,
      phone: dto.phone?.trim() || null,
      transportName: dto.transportName?.trim() || null,
      deliveryLocation: dto.deliveryLocation?.trim() || null,
      lrNumber: dto.lrNumber?.trim() || null,
      eWayBillNumber: dto.eWayBillNumber?.trim() || null,
      noOfBags: dto.noOfBags ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      accountId: dto.accountId ?? null,
      paymentReference: dto.paymentReference?.trim() || null,
      roundOff: Boolean(dto.roundOff),
    };
  }

  async create(dto: CreatePurchaseOrderDto, userId: string, businessId: string, branchId: string) {
    const { lines, amounts } = await this.price(dto, businessId, branchId);
    const order = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      const orderNumber = dto.orderNumber?.trim() || await this.nextNumber(branchId, dto.orderDate ? new Date(dto.orderDate) : new Date(), tx);
      if (await tx.purchaseOrder.findFirst({ where: { branchId, orderNumber } })) throw new ConflictException('This purchase order number already exists');
      return tx.purchaseOrder.create({ data: { ...this.fields(dto), businessId, branchId, orderNumber, status: dto.status ?? PurchaseOrderStatus.DRAFT, ...amounts, createdById: userId, items: { create: lines } }, include: ORDER_INCLUDE });
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_CREATED', entityType: 'PurchaseOrder', entityId: order.id, metadata: { orderNumber: order.orderNumber, total: order.grandTotal } });
    return order;
  }

  async convertToBill(id:string,userId:string,businessId:string,branchId:string){
    const bill=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      const order=await tx.purchaseOrder.findFirst({where:{id,businessId,branchId},include:{items:true,attachments:true}});
      if(!order)throw new NotFoundException('Purchase order not found');
      if(order.convertedDocumentId)return tx.businessDocument.findUniqueOrThrow({where:{id:order.convertedDocumentId}});
      if([PurchaseOrderStatus.CANCELLED,PurchaseOrderStatus.CLOSED,PurchaseOrderStatus.RECEIVED,PurchaseOrderStatus.PARTIALLY_RECEIVED].includes(order.status as 'CANCELLED'|'CLOSED'|'RECEIVED'|'PARTIALLY_RECEIVED'))throw new BadRequestException('This purchase order is closed');
      const created=await this.documents.create({type:'PURCHASE_INVOICE',status:'ISSUED',supplierId:order.supplierId,referenceNumber:order.orderNumber,...transactionDetails(order),warehouseId:order.warehouseId??undefined,placeOfSupply:order.placeOfSupply??undefined,roundOff:order.roundOff,terms:order.paymentTerms??undefined,notes:[order.notes,'Converted from purchase order '+order.orderNumber].filter(Boolean).join('\n'),discount:Number(order.discount),items:order.items.map((line)=>({...trackingFields(line),itemId:line.itemId??undefined,description:line.description,quantity:Number(line.quantity),unit:line.unit,unitPrice:Number(line.unitPrice),taxRate:Number(line.taxRate),taxInclusive:line.taxInclusive}))},userId,businessId,branchId,tx);
      // The bill keeps the order's photos and documents.
      for(const {kind,fileName,mimeType,size,data} of order.attachments)await tx.businessDocumentAttachment.create({data:{documentId:created.id,kind,fileName,mimeType,size,data}});
      await tx.purchaseOrder.update({where:{id},data:{status:PurchaseOrderStatus.RECEIVED,convertedDocumentId:created.id}});return created;
    });
    await this.audit.log({businessId,branchId,userId,action:'PURCHASE_ORDER_CONVERTED',entityType:'PurchaseOrder',entityId:id,metadata:{documentId:bill.id}});return bill;
  }

  async updateStatus(id: string, status: PurchaseOrderStatus, userId: string, businessId: string, branchId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, businessId, branchId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if(order.convertedDocumentId && status!==PurchaseOrderStatus.RECEIVED)throw new BadRequestException('Converted purchase orders retain their received status');
    if ((order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.CLOSED) && order.status !== status) throw new BadRequestException('Closed purchase orders cannot be reopened');
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data: { status }, include: { supplier: true, items: true, branch: true } });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_STATUS_CHANGED', entityType: 'PurchaseOrder', entityId: id, metadata: { from: order.status, to: status } });
    return updated;
  }

  /** Edits an open order. Orders already turned into a bill, cancelled or closed are fixed. */
  async update(id: string, dto: CreatePurchaseOrderDto, userId: string, businessId: string, branchId: string) {
    const { lines, amounts } = await this.price(dto, businessId, branchId);
    const order = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      const existing = await tx.purchaseOrder.findFirst({ where: { id, businessId, branchId } });
      if (!existing) throw new NotFoundException('Purchase order not found');
      if (existing.convertedDocumentId || !OPEN_ORDER.includes(existing.status)) throw new BadRequestException('Only draft, sent or confirmed orders that are not yet billed can be edited');
      const orderNumber = dto.orderNumber?.trim() || existing.orderNumber;
      if (orderNumber !== existing.orderNumber && await tx.purchaseOrder.findFirst({ where: { branchId, orderNumber, id: { not: id } } })) throw new ConflictException('This purchase order number already exists');
      return tx.purchaseOrder.update({ where: { id }, data: { ...this.fields(dto), orderNumber, status: dto.status ?? existing.status, ...amounts, items: { deleteMany: {}, create: lines } }, include: ORDER_INCLUDE });
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_UPDATED', entityType: 'PurchaseOrder', entityId: id, metadata: { orderNumber: order.orderNumber, total: Number(order.grandTotal) } });
    return order;
  }

  /** Deletes an order that never became a bill. Orders have no stock or money effect, so nothing else changes. */
  async remove(id: string, userId: string, businessId: string, branchId: string) {
    const removed = await billingTransaction(this.prisma, async (tx) => {
      await lockBillingRecord(tx, 'branch', branchId);
      const order = await tx.purchaseOrder.findFirst({ where: { id, businessId, branchId }, include: { items: true } });
      if (!order) throw new NotFoundException('Purchase order not found');
      if (order.convertedDocumentId) throw new BadRequestException('This order was turned into a purchase bill, so it is kept as a record');
      await tx.purchaseOrder.delete({ where: { id } });
      return order;
    });
    await this.audit.log({
      businessId, branchId, userId, action: 'PURCHASE_ORDER_DELETED', entityType: 'PurchaseOrder', entityId: id,
      metadata: { orderNumber: removed.orderNumber, supplierId: removed.supplierId, status: removed.status, total: Number(removed.grandTotal), items: removed.items.map(({ description, quantity, unitPrice }) => ({ description, quantity: Number(quantity), unitPrice: Number(unitPrice) })) },
    });
    return { id, deleted: true };
  }

  /** Photos and documents for an order, such as a supplier quote. They move to the bill on conversion. */
  async addAttachments(id: string, files: UploadedOrderFile[], userId: string, businessId: string, branchId: string) {
    if (!files?.length) throw new BadRequestException('Select at least one file to upload');
    if (!await this.prisma.purchaseOrder.findFirst({ where: { id, businessId, branchId }, select: { id: true } })) throw new NotFoundException('Purchase order not found');
    const existing = await this.prisma.purchaseOrderAttachment.aggregate({ where: { purchaseOrderId: id }, _count: { id: true }, _sum: { size: true } });
    if (existing._count.id + files.length > MAX_ATTACHMENTS) throw new BadRequestException(`A purchase order can have up to ${MAX_ATTACHMENTS} attachments`);
    if ((existing._sum.size ?? 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) throw new BadRequestException('Purchase order attachments cannot exceed 25 MB in total');
    const uploads = files.map((file) => {
      if (!file.buffer || file.size <= 0) throw new BadRequestException('Empty files cannot be uploaded');
      if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`${file.originalname} exceeds the 10 MB file limit`);
      const kind = IMAGE_TYPES.has(file.mimetype) ? InvoiceAttachmentKind.IMAGE : DOCUMENT_TYPES.has(file.mimetype) ? InvoiceAttachmentKind.DOCUMENT : null;
      if (!kind) throw new BadRequestException(`${file.originalname} is not a supported image or document`);
      const fileName = file.originalname.replace(/[\r\n]/g, '').replace(/[^\p{L}\p{N}._() -]/gu, '_').slice(0, 191) || 'attachment';
      return { purchaseOrderId: id, kind, fileName, mimeType: file.mimetype, size: file.size, data: Uint8Array.from(file.buffer) };
    });
    const created = await this.prisma.$transaction(uploads.map((data) => this.prisma.purchaseOrderAttachment.create({ data, select: ATTACHMENT_FIELDS })));
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_ATTACHMENTS_ADDED', entityType: 'PurchaseOrder', entityId: id, metadata: { files: created.map(({ id: fileId, fileName, size }) => ({ id: fileId, fileName, size })) } });
    return created;
  }

  async getAttachment(id: string, attachmentId: string, businessId: string, branchId?: string) {
    const attachment = await this.prisma.purchaseOrderAttachment.findFirst({ where: { id: attachmentId, purchaseOrderId: id, purchaseOrder: { businessId, ...(branchId ? { branchId } : {}) } } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  async removeAttachment(id: string, attachmentId: string, userId: string, businessId: string, branchId: string) {
    const attachment = await this.getAttachment(id, attachmentId, businessId, branchId);
    await this.prisma.purchaseOrderAttachment.delete({ where: { id: attachment.id } });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_ATTACHMENT_REMOVED', entityType: 'PurchaseOrder', entityId: id, metadata: { attachmentId, fileName: attachment.fileName } });
    return { id: attachmentId, deleted: true };
  }
}
