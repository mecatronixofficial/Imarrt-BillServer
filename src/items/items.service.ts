import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AuditService } from '../common/utils/audit.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util';

@Injectable()
export class ItemsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateItemDto, userId: string, businessId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    if (dto.sku) {
      const existing = await this.prisma.item.findFirst({ where: { businessId: { in: workspaceBusinessIds }, sku: dto.sku, deletedAt: null } });
      if (existing) throw new ConflictException('An item with this SKU already exists');
    }
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { gstRegistered: true } });
    const item = await this.prisma.item.create({ data: { ...dto, businessId, taxRate: business?.gstRegistered ? dto.taxRate : 0 } });
    await this.audit.log({ businessId, userId, action: 'ITEM_CREATED', entityType: 'Item', entityId: item.id });
    return item;
  }

  async findAll(businessId: string, { limit, offset }: PaginationQueryDto) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    return this.prisma.item.findMany({
      where: { businessId: { in: workspaceBusinessIds }, deletedAt: null },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    });
  }

  async findOne(id: string, businessId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    const item = await this.prisma.item.findFirst({ where: { id, businessId: { in: workspaceBusinessIds }, deletedAt: null } });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async update(id: string, dto: UpdateItemDto, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { gstRegistered: true } });
    const item = await this.prisma.item.update({ where: { id }, data: { ...dto, taxRate: business?.gstRegistered ? dto.taxRate : 0 } });
    await this.audit.log({ businessId, userId, action: 'ITEM_UPDATED', entityType: 'Item', entityId: id });
    return item;
  }

  async remove(id: string, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    await this.prisma.item.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ businessId, userId, action: 'ITEM_DELETED', entityType: 'Item', entityId: id });
    return { success: true };
  }
}
