import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductionOrderStatus, ProductionStageStatus, ProductionStageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/utils/audit.service';
import { CreateProductionCostDto } from './dto/create-production-cost.dto';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { calculateProductionSummary } from './production-summary.util';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const orderView = {
  branch: { select: { id: true, name: true, code: true } },
  party: { select: { id: true, name: true, phone: true } },
  supplier: { select: { id: true, name: true, phone: true } },
  stages: { orderBy: { sequence: 'asc' as const } },
  costs: {
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
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
    const [party, supplier, existing, branch] = await Promise.all([
      this.prisma.party.findFirst({ where: { id: dto.partyId, businessId, deletedAt: null } }),
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

    const stageTypes: Array<{ type: ProductionStageType; sequence: number }> = [
      { type: ProductionStageType.CUTTING, sequence: 1 },
      { type: ProductionStageType.PRINT_EMBROIDERY, sequence: 2 },
      { type: ProductionStageType.STITCHING, sequence: 3 },
      { type: ProductionStageType.PACKING, sequence: 4 },
    ];

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
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        notes: dto.notes,
        stages: {
          create: stageTypes.map((stage) => ({ ...stage, plannedQty: dto.orderedQty })),
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
    if ([ProductionOrderStatus.COMPLETED, ProductionOrderStatus.CANCELLED].includes(order.status)) {
      throw new BadRequestException('Completed or cancelled orders cannot be changed');
    }

    const completedQty = dto.completedQty ?? stage.completedQty;
    const rejectedQty = dto.rejectedQty ?? stage.rejectedQty;
    const issuedQty = dto.issuedQty ?? stage.issuedQty;
    if (completedQty + rejectedQty > Math.max(dto.plannedQty ?? stage.plannedQty, issuedQty)) {
      throw new BadRequestException('Completed and rejected quantities cannot exceed the available quantity');
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
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          completedAt: dto.status === ProductionStageStatus.COMPLETED ? new Date() : undefined,
          notes: dto.notes,
        },
      });

      const stages = await tx.productionStage.findMany({ where: { orderId: id } });
      const allComplete = stages.every((entry) => entry.status === ProductionStageStatus.COMPLETED);
      const anyStarted = stages.some((entry) => entry.status !== ProductionStageStatus.PENDING);
      await tx.productionOrder.update({
        where: { id },
        data: { status: allComplete ? ProductionOrderStatus.READY : anyStarted ? ProductionOrderStatus.IN_PRODUCTION : ProductionOrderStatus.CONFIRMED },
      });
    });

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
    await this.findOne(id, businessId, branchId);
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
    if (
      status === ProductionOrderStatus.READY ||
      status === ProductionOrderStatus.DISPATCHED ||
      status === ProductionOrderStatus.COMPLETED
    ) {
      const packing = order.stages.find((stage: any) => stage.type === ProductionStageType.PACKING);
      if (!packing || packing.status !== ProductionStageStatus.COMPLETED) {
        throw new BadRequestException('Complete packing before marking this order ready or complete');
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
}
