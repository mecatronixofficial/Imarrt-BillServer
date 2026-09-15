import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getWorkspaceBusinessIds } from '../common/utils/workspace-scope.util.js';

export type UploadedItemImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const ITEM_IMAGE_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ITEM_INCLUDE = {
  image: { select: ITEM_IMAGE_SELECT },
} as const;

const ALLOWED_ITEM_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

@Injectable()
export class ItemsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateItemDto, userId: string, businessId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    if (dto.saleDiscountType === 'PERCENTAGE' && (dto.saleDiscount ?? 0) > 100) {
      throw new BadRequestException('Sale discount percentage cannot exceed 100%');
    }
    if (dto.sku) {
      const existing = await this.prisma.item.findFirst({ where: { businessId: { in: workspaceBusinessIds }, sku: dto.sku, deletedAt: null } });
      if (existing) throw new ConflictException('An item with this SKU already exists');
    }
    const item = await this.prisma.item.create({ data: { ...dto, businessId }, include: ITEM_INCLUDE });
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
      include: ITEM_INCLUDE,
    });
  }

  async findOne(id: string, businessId: string) {
    const workspaceBusinessIds = await getWorkspaceBusinessIds(this.prisma, businessId);
    const item = await this.prisma.item.findFirst({
      where: { id, businessId: { in: workspaceBusinessIds }, deletedAt: null },
      include: ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async update(id: string, dto: UpdateItemDto, userId: string, businessId: string) {
    const current = await this.findOne(id, businessId);
    const discountType = dto.saleDiscountType ?? current.saleDiscountType;
    const discount = dto.saleDiscount ?? Number(current.saleDiscount);
    if (discountType === 'PERCENTAGE' && discount > 100) {
      throw new BadRequestException('Sale discount percentage cannot exceed 100%');
    }
    const item = await this.prisma.item.update({ where: { id }, data: dto, include: ITEM_INCLUDE });
    await this.audit.log({ businessId, userId, action: 'ITEM_UPDATED', entityType: 'Item', entityId: id });
    return item;
  }

  async setImage(id: string, file: UploadedItemImage | undefined, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    if (!file) throw new BadRequestException('Select an item image');
    if (!file.buffer || file.size <= 0) throw new BadRequestException('Empty images cannot be uploaded');
    if (!ALLOWED_ITEM_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Item image must be a JPG, PNG, WEBP, or GIF file');
    }
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Item image cannot exceed 5 MB');

    const image = await this.prisma.itemImage.upsert({
      where: { itemId: id },
      create: {
        itemId: id,
        fileName: file.originalname.slice(0, 191) || 'item-image',
        mimeType: file.mimetype,
        size: file.size,
        data: Uint8Array.from(file.buffer),
      },
      update: {
        fileName: file.originalname.slice(0, 191) || 'item-image',
        mimeType: file.mimetype,
        size: file.size,
        data: Uint8Array.from(file.buffer),
      },
      select: ITEM_IMAGE_SELECT,
    });
    await this.audit.log({ businessId, userId, action: 'ITEM_IMAGE_UPDATED', entityType: 'Item', entityId: id });
    return image;
  }

  async getImage(id: string, businessId: string) {
    await this.findOne(id, businessId);
    const image = await this.prisma.itemImage.findUnique({ where: { itemId: id } });
    if (!image) throw new NotFoundException('Item image not found');
    return image;
  }

  async removeImage(id: string, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    const image = await this.prisma.itemImage.findUnique({ where: { itemId: id }, select: { id: true } });
    if (!image) throw new NotFoundException('Item image not found');
    await this.prisma.itemImage.delete({ where: { itemId: id } });
    await this.audit.log({ businessId, userId, action: 'ITEM_IMAGE_REMOVED', entityType: 'Item', entityId: id });
    return { success: true };
  }

  async remove(id: string, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    await this.prisma.item.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ businessId, userId, action: 'ITEM_DELETED', entityType: 'Item', entityId: id });
    return { success: true };
  }
}
