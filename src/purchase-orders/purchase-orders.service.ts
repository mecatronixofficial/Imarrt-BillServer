import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  findAll(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    return this.prisma.purchaseOrder.findMany({ where: { businessId, ...(branchId ? { branchId } : {}) }, include: { supplier: true, items: true, branch: true }, orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }], take: limit, skip: offset });
  }

  async create(dto: CreatePurchaseOrderDto, userId: string, businessId: string, branchId: string) {
    const [supplier, duplicate] = await Promise.all([
      this.prisma.supplier.findFirst({ where: { id: dto.supplierId, businessId, deletedAt: null } }),
      this.prisma.purchaseOrder.findFirst({ where: { branchId, orderNumber: dto.orderNumber.trim() } }),
    ]);
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (duplicate) throw new ConflictException('This purchase order number already exists');
    const lines = dto.items.map((item) => { const base = item.quantity * item.unitPrice; const lineTotal = base + base * (item.taxRate ?? 0) / 100; return { ...item, description: item.description.trim(), unit: item.unit || 'pcs', taxRate: item.taxRate ?? 0, lineTotal: Number(lineTotal.toFixed(2)) }; });
    const subTotal = lines.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxTotal = lines.reduce((sum, item) => sum + item.quantity * item.unitPrice * item.taxRate / 100, 0);
    const discount = dto.discount ?? 0;
    if (discount > subTotal + taxTotal) throw new BadRequestException('Discount cannot exceed the order total');
    const order = await this.prisma.purchaseOrder.create({ data: { businessId, branchId, supplierId: dto.supplierId, orderNumber: dto.orderNumber.trim(), orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined, expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : undefined, deliveryLocation: dto.deliveryLocation, paymentTerms: dto.paymentTerms, notes: dto.notes, discount, subTotal, taxTotal, grandTotal: subTotal + taxTotal - discount, createdById: userId, items: { create: lines } }, include: { supplier: true, items: true, branch: true } });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_CREATED', entityType: 'PurchaseOrder', entityId: order.id, metadata: { orderNumber: order.orderNumber, total: order.grandTotal } });
    return order;
  }

  async updateStatus(id: string, status: PurchaseOrderStatus, userId: string, businessId: string, branchId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id, businessId, branchId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if ((order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.CLOSED) && order.status !== status) throw new BadRequestException('Closed purchase orders cannot be reopened');
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data: { status }, include: { supplier: true, items: true, branch: true } });
    await this.audit.log({ businessId, branchId, userId, action: 'PURCHASE_ORDER_STATUS_CHANGED', entityType: 'PurchaseOrder', entityId: id, metadata: { from: order.status, to: status } });
    return updated;
  }
}
