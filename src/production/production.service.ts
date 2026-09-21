import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductionOrderStatus, ProductionStageStatus, ProductionStageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util.js';
import { RecordProductionPaymentDto } from './dto/record-production-payment.dto.js';
import { AuditService } from '../common/utils/audit.service.js';
import { CreateProductionCostDto } from './dto/create-production-cost.dto.js';
import { UpdateProductionCostDto } from './dto/update-production-cost.dto.js';
import { CreateProductionOrderDto } from './dto/create-production-order.dto.js';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto.js';
import { calculateProductionSummary } from './production-summary.util.js';
import {
  buildInitialProductionStages,
  getNextStageTransfer,
} from './production-pipeline.util.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

const orderView = {
  branch: { select: { id: true, name: true, code: true } },
  party: { select: { id: true, name: true, phone: true } },
  supplier: { select: { id: true, name: true, phone: true } },
  stages: { orderBy: { sequence: 'asc' as const } },
  costs: {
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  images: { select: { id: true, stageType: true, displayName: true, color: true, sizeLabel: true, details: true, fileName: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: 'desc' as const } },
};

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private present(order: any) {
    return {
      ...order,
      summary: calculateProductionSummary(order),
    };
  }

  async create(dto: CreateProductionOrderDto, userId: string, businessId: string, branchId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    const [party, supplier, existing, branch] = await Promise.all([
      this.prisma.party.findFirst({ where: { id: dto.partyId, businessId: { in: workspaceBusinessIds }, deletedAt: null } }),
      dto.supplierId
        ? this.prisma.supplier.findFirst({ where: { id: dto.supplierId, businessId, deletedAt: null } })
        : Promise.resolve(null),
      this.prisma.productionOrder.findFirst({ where: { branchId, orderNumber: dto.orderNumber.trim() } }),
      this.prisma.branch.findFirst({ where: { id: branchId, businessId, isActive: true } }),
    ]);
    if (!party) throw new NotFoundException('Party not found');
    if (dto.supplierId && !supplier) throw new NotFoundException('Supplier not found');
    if (existing) throw new ConflictException('This production order number already exists');
    if (!branch) throw new NotFoundException('Branch not found');

    const sizeEntries = Object.entries(dto.sizeBreakdown ?? {});
    if (
      sizeEntries.length > 100 ||
      sizeEntries.some(
        ([size, quantity]) =>
          size.length > 30 || !Number.isInteger(quantity) || quantity < 0,
      )
    ) {
      throw new BadRequestException(
        'Size breakdown must contain at most 100 sizes with non-negative integer quantities',
      );
    }

    const sizeTotal = dto.sizeBreakdown
      ? Object.values(dto.sizeBreakdown).reduce((total, quantity) => total + Number(quantity || 0), 0)
      : 0;
    if (sizeTotal > 0 && sizeTotal !== dto.orderedQty) {
      throw new BadRequestException('Size quantities must equal the ordered quantity');
    }
    const colorRows = Object.entries(dto.sizeColorBreakdown ?? {});
    if (colorRows.length > 40 || colorRows.some(([color, sizes]) => color.length > 80 || !sizes || typeof sizes !== 'object' || Array.isArray(sizes))) {
      throw new BadRequestException('Enter up to 40 valid color rows');
    }
    const colorSizeTotals: Record<string, number> = {};
    for (const [, sizes] of colorRows) {
      for (const [size, quantity] of Object.entries(sizes)) {
        if (size.length > 30 || !Number.isInteger(quantity) || quantity < 0) throw new BadRequestException('Color and size quantities must be non-negative whole numbers');
        colorSizeTotals[size] = (colorSizeTotals[size] ?? 0) + quantity;
      }
    }
    if (colorRows.length && (Object.values(colorSizeTotals).reduce((sum, value) => sum + value, 0) !== dto.orderedQty || Object.entries(colorSizeTotals).some(([size, value]) => value !== dto.sizeBreakdown?.[size]))) {
      throw new BadRequestException('Color and size totals must match the order quantity');
    }

    const order = await this.prisma.productionOrder.create({
      data: {
        businessId,
        branchId,
        orderNumber: dto.orderNumber.trim(),
        partyId: dto.partyId,
        supplierId: dto.supplierId,
        createdById: userId,
        styleName: dto.styleName,
        fabricName: dto.fabricName,
        fabricGsm: dto.fabricGsm,
        color: dto.color,
        sizeBreakdown: dto.sizeBreakdown,
        orderedQty: dto.orderedQty,
        saleRate: dto.saleRate,
        supplierRate: dto.supplierRate ?? 0,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        invoiceDetails: dto.invoiceDetails,
        transport: dto.transport,
        destination: dto.destination,
        sizeColorBreakdown: dto.sizeColorBreakdown,
        instructions: dto.instructions as any,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: ProductionOrderStatus.DRAFT,
        notes: dto.notes,
        stages: {
          create: buildInitialProductionStages(dto.orderedQty).map((stage) => ({ ...stage, issuedQty: 0, status: ProductionStageStatus.PENDING })),
        },
      },
      include: orderView,
    });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_ORDER_CREATED',
      entityType: 'ProductionOrder',
      entityId: order.id,
      metadata: { orderNumber: order.orderNumber, orderedQty: order.orderedQty },
    });
    return this.present(order);
  }

  async findAll(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    const orders = await this.prisma.productionOrder.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
      include: orderView,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return orders.map((order) => this.present(order));
  }

  listPayments(businessId: string, branchId: string | undefined, { limit, offset }: PaginationQueryDto) {
    return this.prisma.productionPayment.findMany({
      where: { cost: { order: { businessId, ...(branchId ? { branchId } : {}) } } },
      include: { cost: { include: { supplier: true, order: { select: { id: true, orderNumber: true } } } } },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });
  }

  async findOne(id: string, businessId: string, branchId?: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id, businessId, ...(branchId ? { branchId } : {}) },
      include: orderView,
    });
    if (!order) throw new NotFoundException('Production order not found');
    return this.present(order);
  }

  async updateStage(id: string, stageId: string, dto: UpdateProductionStageDto, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    const stage = order.stages.find((entry: any) => entry.id === stageId);
    if (!stage) throw new NotFoundException('Production stage not found');
    if (order.status === ProductionOrderStatus.DRAFT) throw new BadRequestException('Confirm the order before starting production');
    if ([ProductionOrderStatus.COMPLETED, ProductionOrderStatus.CANCELLED].includes(order.status)) {
      throw new BadRequestException('Completed or cancelled orders cannot be changed');
    }

    const completedQty = dto.completedQty ?? stage.completedQty;
    const rejectedQty = dto.rejectedQty ?? stage.rejectedQty;
    const issuedQty = dto.issuedQty ?? stage.issuedQty;
    const plannedQty = dto.plannedQty ?? stage.plannedQty;
    const nextStatus = dto.status ?? stage.status;
    if (issuedQty > plannedQty) {
      throw new BadRequestException('Issued quantity cannot exceed the planned quantity');
    }
    if (completedQty + rejectedQty > issuedQty) {
      throw new BadRequestException('Completed and rejected quantities cannot exceed the issued quantity');
    }
    if ((dto.rateUnit ?? stage.rateUnit) === 'KG' && (nextStatus === ProductionStageStatus.COMPLETED || Number(dto.rate ?? stage.rate) > 0) && !Number(dto.outputWeightKg ?? stage.outputWeightKg)) {
      throw new BadRequestException('Enter output weight when charging this process per kilogram');
    }
    if (stage.type === ProductionStageType.FABRIC_PURCHASE && Number(dto.rate ?? stage.rate) > 0 && order.costs.some((cost: any) => cost.category === 'FABRIC')) {
      throw new BadRequestException('Fabric has already been entered as a material cost. Record its price in one place only');
    }
    if (
      nextStatus === ProductionStageStatus.COMPLETED &&
      completedQty + rejectedQty !== issuedQty
    ) {
      throw new BadRequestException('Completed and rejected quantities must equal the issued quantity before completing a stage');
    }

    const previousStage = order.stages.filter((entry: any) => entry.sequence < stage.sequence).sort((a: any, b: any) => b.sequence - a.sequence)[0] ?? null;
    const isStartingWork =
      nextStatus !== ProductionStageStatus.PENDING ||
      issuedQty > 0 ||
      completedQty + rejectedQty > 0;
    if (previousStage && previousStage.status !== ProductionStageStatus.COMPLETED && isStartingWork) {
      throw new BadRequestException('Complete the previous production stage before starting this stage');
    }

    const transfer = nextStatus === ProductionStageStatus.COMPLETED
      ? getNextStageTransfer(order.stages, stage.type, completedQty)
      : null;
    if (transfer && transfer.processedQty > completedQty) {
      throw new BadRequestException(
        'The next stage already contains more processed pieces. Reduce its completed or rejected quantity first.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productionStage.update({
        where: { id: stageId },
        data: {
          status: dto.status,
          partnerName: dto.partnerName,
          dcNumber: dto.dcNumber,
          plannedQty: dto.plannedQty,
          issuedQty: dto.issuedQty,
          completedQty: dto.completedQty,
          rejectedQty: dto.rejectedQty,
          rate: dto.rate,
          otherCost: dto.otherCost,
          inputWeightKg: dto.inputWeightKg,
          outputWeightKg: dto.outputWeightKg,
          rateUnit: dto.rateUnit,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          completedAt:
            nextStatus === ProductionStageStatus.COMPLETED
              ? stage.completedAt ?? new Date()
              : null,
          notes: dto.notes,
        },
      });

      if (transfer) {
        await tx.productionStage.update({
          where: { id: transfer.stage.id },
          data: transfer.data,
        });
      }

      const stages = await tx.productionStage.findMany({ where: { orderId: id } });
      const allComplete = stages.every((entry) => entry.status === ProductionStageStatus.COMPLETED);
      const anyStarted = stages.some((entry) => entry.status !== ProductionStageStatus.PENDING);
      await tx.productionOrder.update({
        where: { id },
        data: { status: allComplete ? ProductionOrderStatus.READY : anyStarted ? ProductionOrderStatus.IN_PRODUCTION : ProductionOrderStatus.CONFIRMED },
      });
    }, { maxWait: 10_000, timeout: 30_000 });

    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_STAGE_UPDATED',
      entityType: 'ProductionStage',
      entityId: stageId,
      metadata: { orderId: id, stage: stage.type, status: dto.status },
    });
    return this.findOne(id, businessId, branchId);
  }

  async addCost(id: string, dto: CreateProductionCostDto, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    const purchase = order.stages.find((stage: any) => stage.type === ProductionStageType.FABRIC_PURCHASE);
    if (dto.category === 'FABRIC' && purchase && Number(purchase.rate) > 0) {
      throw new BadRequestException('Fabric purchase price is already recorded in the process stage');
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, businessId, deletedAt: null },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
    }
    const amount = dto.amount ?? Number((dto.quantity * dto.rate).toFixed(2));
    const cost = await this.prisma.productionCost.create({
      data: { ...dto, orderId: id, amount },
    });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_COST_ADDED',
      entityType: 'ProductionCost',
      entityId: cost.id,
      metadata: { orderId: id, category: cost.category, amount },
    });
    return this.findOne(id, businessId, branchId);
  }

  async updateCost(id: string, costId: string, dto: UpdateProductionCostDto, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    const cost = await this.prisma.productionCost.findFirst({ where: { id: costId, orderId: id } });
    if (!cost) throw new NotFoundException('Production cost not found');
    const purchase = order.stages.find((stage: any) => stage.type === ProductionStageType.FABRIC_PURCHASE);
    if (dto.category === 'FABRIC' && cost.category !== 'FABRIC' && purchase && Number(purchase.rate) > 0) {
      throw new BadRequestException('Fabric purchase price is already recorded in the process stage');
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, businessId, deletedAt: null } });
      if (!supplier) throw new NotFoundException('Supplier not found');
    }
    const quantity = dto.quantity ?? Number(cost.quantity);
    const rate = dto.rate ?? Number(cost.rate);
    const amount = dto.amount ?? Number((quantity * rate).toFixed(2));
    if (amount + 0.01 < Number(cost.paidAmount)) {
      throw new BadRequestException('Expense amount cannot be lower than the amount already paid');
    }
    await this.prisma.productionCost.update({ where: { id: costId }, data: { ...dto, quantity, rate, amount } });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_COST_UPDATED',
      entityType: 'ProductionCost',
      entityId: costId,
      metadata: { orderId: id, previousAmount: cost.amount.toString(), amount },
    });
    return this.findOne(id, businessId, branchId);
  }

  async recordPayment(id: string, costId: string, dto: RecordProductionPaymentDto, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const cost = await this.prisma.productionCost.findFirst({ where: { id: costId, orderId: id } });
    if (!cost) throw new NotFoundException('Production cost not found');
    const remaining = Number(cost.amount) - Number(cost.paidAmount);
    if (dto.amount > remaining + 0.01) throw new BadRequestException('Payment amount exceeds the outstanding cost');

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productionPayment.create({
        data: { costId, amount: dto.amount, method: dto.method, reference: dto.reference, paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined, createdById: userId },
        include: { cost: { include: { supplier: true, order: { select: { id: true, orderNumber: true } } } } },
      });
      await tx.productionCost.update({ where: { id: costId }, data: { paidAmount: { increment: dto.amount } } });
      return created;
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PAYMENT_OUT_RECORDED', entityType: 'ProductionPayment', entityId: payment.id, metadata: { orderId: id, costId, amount: dto.amount, method: dto.method } });
    return payment;
  }

  async removeCost(id: string, costId: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const cost = await this.prisma.productionCost.findFirst({ where: { id: costId, orderId: id } });
    if (!cost) throw new NotFoundException('Production cost not found');
    await this.prisma.productionCost.delete({ where: { id: costId } });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_COST_REMOVED',
      entityType: 'ProductionCost',
      entityId: costId,
      metadata: { orderId: id, amount: cost.amount.toString() },
    });
    return this.findOne(id, businessId, branchId);
  }

  async updateStatus(id: string, status: ProductionOrderStatus, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    if (order.status === ProductionOrderStatus.DRAFT) throw new BadRequestException('Confirm the draft order first');
    if (
      status === ProductionOrderStatus.READY ||
      status === ProductionOrderStatus.DISPATCHED ||
      status === ProductionOrderStatus.COMPLETED
    ) {
      const final = order.stages.find((stage: any) => stage.type === ProductionStageType.FINAL);
      if (!final || final.status !== ProductionStageStatus.COMPLETED) {
        throw new BadRequestException('Complete final inspection before marking this order ready or complete');
      }
    }
    const updated = await this.prisma.productionOrder.update({ where: { id }, data: { status }, include: orderView });
    await this.audit.log({
      businessId,
      branchId,
      userId,
      action: 'PRODUCTION_STATUS_UPDATED',
      entityType: 'ProductionOrder',
      entityId: id,
      metadata: { from: order.status, to: status },
    });
    return this.present(updated);
  }

  async confirm(id: string, confirmedAt: string | undefined, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    if (order.status !== ProductionOrderStatus.DRAFT) throw new BadRequestException('Only draft orders can be confirmed');
    const master = order.stages.find((stage: any) => stage.type === ProductionStageType.MASTER);
    if (!master) throw new BadRequestException('Master stage is missing');
    const fabricPurchase = order.stages.find((stage: any) => stage.type === ProductionStageType.FABRIC_PURCHASE);
    if (!fabricPurchase) throw new BadRequestException('Fabric purchase stage is missing');
    const confirmedDate = confirmedAt ? new Date(confirmedAt) : new Date();
    if (Number.isNaN(confirmedDate.getTime())) throw new BadRequestException('Invalid confirmation date');
    await this.prisma.$transaction(async (tx) => {
      await tx.productionStage.update({ where: { id: master.id }, data: { issuedQty: order.orderedQty, completedQty: order.orderedQty, status: ProductionStageStatus.COMPLETED, completedAt: confirmedDate } });
      await tx.productionStage.update({ where: { id: fabricPurchase.id }, data: { plannedQty: order.orderedQty, issuedQty: order.orderedQty, status: ProductionStageStatus.IN_PROGRESS } });
      await tx.productionOrder.update({ where: { id }, data: { status: ProductionOrderStatus.IN_PRODUCTION, confirmedAt: confirmedDate } });
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PRODUCTION_ORDER_CONFIRMED', entityType: 'ProductionOrder', entityId: id });
    return this.findOne(id, businessId, branchId);
  }

  async updateMaster(id: string, dto: CreateProductionOrderDto, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    if (order.status !== ProductionOrderStatus.DRAFT && dto.orderedQty !== order.orderedQty) {
      throw new BadRequestException('Order quantity cannot change after confirmation');
    }
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    const [party, supplier, duplicate] = await Promise.all([
      this.prisma.party.findFirst({ where: { id: dto.partyId, businessId: { in: workspaceBusinessIds }, deletedAt: null } }),
      dto.supplierId ? this.prisma.supplier.findFirst({ where: { id: dto.supplierId, businessId, deletedAt: null } }) : Promise.resolve(null),
      this.prisma.productionOrder.findFirst({ where: { branchId, orderNumber: dto.orderNumber.trim(), id: { not: id } } }),
    ]);
    if (!party || (dto.supplierId && !supplier)) throw new NotFoundException('Customer or supplier not found');
    if (duplicate) throw new ConflictException('This production order number already exists');
    const sizes = Object.entries(dto.sizeColorBreakdown ?? {});
    const quantities: Record<string, number> = {};
    if (sizes.length > 40) throw new BadRequestException('Enter up to 40 colors');
    for (const [color, entries] of sizes) {
      if (color.length > 80 || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new BadRequestException('Invalid color row');
      for (const [size, quantity] of Object.entries(entries)) {
        if (size.length > 30 || !Number.isInteger(quantity) || quantity < 0) throw new BadRequestException('Invalid size quantity');
        quantities[size] = (quantities[size] ?? 0) + quantity;
      }
    }
    if (!sizes.length || Object.values(quantities).reduce((sum, value) => sum + value, 0) !== dto.orderedQty || Object.entries(quantities).some(([size, value]) => value !== dto.sizeBreakdown?.[size])) throw new BadRequestException('Color and size totals must match the order quantity');
    const master = order.stages.find((stage: any) => stage.type === ProductionStageType.MASTER);
    await this.prisma.$transaction(async (tx) => {
      await tx.productionOrder.update({ where: { id }, data: {
        orderNumber: dto.orderNumber.trim(), partyId: dto.partyId, supplierId: dto.supplierId || null,
        styleName: dto.styleName, fabricName: dto.fabricName, fabricGsm: dto.fabricGsm, color: dto.color,
        sizeBreakdown: dto.sizeBreakdown, sizeColorBreakdown: dto.sizeColorBreakdown, instructions: dto.instructions as any,
        orderedQty: dto.orderedQty, saleRate: dto.saleRate, supplierRate: dto.supplierRate ?? 0,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        invoiceDetails: dto.invoiceDetails, transport: dto.transport, destination: dto.destination, notes: dto.notes,
      } });
      if (master && order.status === ProductionOrderStatus.DRAFT) await tx.productionStage.update({ where: { id: master.id }, data: { plannedQty: dto.orderedQty } });
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PRODUCTION_MASTER_UPDATED', entityType: 'ProductionOrder', entityId: id });
    return this.findOne(id, businessId, branchId);
  }

  async removeOrder(id: string, userId: string, businessId: string, branchId: string) {
    const order = await this.findOne(id, businessId, branchId);
    await this.prisma.productionOrder.delete({ where: { id } });
    await this.audit.log({
      businessId, branchId, userId, action: 'PRODUCTION_ORDER_REMOVED',
      entityType: 'ProductionOrder', entityId: id,
      metadata: { orderNumber: order.orderNumber, status: order.status },
    });
    return { success: true };
  }

  async addImage(id: string, file: { buffer: Buffer; size: number; mimetype: string; originalname: string } | undefined, stageType: ProductionStageType | undefined, details: { displayName?: string; color?: string; sizeLabel?: string; details?: string }, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    if (!file?.buffer?.length) throw new BadRequestException('Select an image');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Use a JPG, PNG, or WEBP image under 5 MB');
    }
    const image = await this.prisma.productionImage.create({
      data: { orderId: id, stageType, displayName: details.displayName?.slice(0, 191), color: details.color?.slice(0, 191), sizeLabel: details.sizeLabel?.slice(0, 191), details: details.details?.slice(0, 2000), fileName: file.originalname.slice(0, 191), mimeType: file.mimetype, size: file.size, data: Uint8Array.from(file.buffer) },
      select: { id: true, stageType: true, displayName: true, color: true, sizeLabel: true, details: true, fileName: true, mimeType: true, size: true, createdAt: true },
    });
    await this.audit.log({ businessId, branchId, userId, action: 'PRODUCTION_IMAGE_ADDED', entityType: 'ProductionImage', entityId: image.id, metadata: { orderId: id, stageType } });
    return image;
  }

  async getImage(id: string, imageId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const image = await this.prisma.productionImage.findFirst({ where: { id: imageId, orderId: id } });
    if (!image) throw new NotFoundException('Production image not found');
    return image;
  }

  async removeImage(id: string, imageId: string, userId: string, businessId: string, branchId: string) {
    await this.getImage(id, imageId, businessId, branchId);
    await this.prisma.productionImage.delete({ where: { id: imageId } });
    await this.audit.log({ businessId, branchId, userId, action: 'PRODUCTION_IMAGE_REMOVED', entityType: 'ProductionImage', entityId: imageId, metadata: { orderId: id } });
    return { success: true };
  }
}
