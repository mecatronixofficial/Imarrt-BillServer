import { adjustStock, billingTransaction } from '../common/utils/billing-transaction.util.js';
import { Prisma } from '@prisma/client';
import { resolvePreferences } from '../businesses/business-preferences.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';

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

  async create(dto: CreateItemDto, userId: string, businessId: string, branchId: string) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    if ((dto.saleDiscountType ?? 'PERCENTAGE') === 'PERCENTAGE' && (dto.saleDiscount ?? 0) > 100) {
      throw new BadRequestException('Sale discount percentage cannot exceed 100%');
    }
    if (dto.sku) {
      const existing = await this.prisma.item.findFirst({ where: { branchId: { in: logicalBranchIds }, sku: dto.sku, deletedAt: null } });
      if (existing) throw new ConflictException('An item with this SKU already exists');
    }
    const item = await billingTransaction(this.prisma,async(tx)=>{
      const created=await tx.item.create({data:{...dto,stockQty:0,businessId,branchId}});
      if(dto.stockQty)await adjustStock(tx,[{itemId:created.id,quantity:dto.stockQty}],'increment',true,{businessId,branchId,kind:'OPENING',sourceId:created.id,userId});
      return tx.item.findUniqueOrThrow({where:{id:created.id},include:ITEM_INCLUDE});
    });
    await this.audit.log({ businessId, userId, action: 'ITEM_CREATED', entityType: 'Item', entityId: item.id });
    return item;
  }

  async findAll(businessId: string, branchId: string, { limit, offset }: PaginationQueryDto) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    return this.prisma.item.findMany({
      where: { branchId: { in: logicalBranchIds }, deletedAt: null },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
      include: ITEM_INCLUDE,
    });
  }

  async findOne(id: string, businessId: string, branchId: string) {
    const logicalBranchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const item = await this.prisma.item.findFirst({
      where: { id, branchId: { in: logicalBranchIds }, deletedAt: null },
      include: ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async transactions(id: string, businessId: string, branchId: string, page: PaginationQueryDto) {
    await this.findOne(id, businessId, branchId);
    const take = (page.offset ?? 0) + (page.limit ?? 100);
    const [sales, purchases] = await Promise.all([
      this.prisma.invoiceItem.findMany({ where: { itemId: id, invoice: { businessId, deletedAt: null } }, include: { invoice: { select: { id: true, invoiceNumber: true, status: true, issueDate: true } } }, orderBy: [{ invoice: { issueDate: 'desc' } }, { id: 'desc' }], take }),
      this.prisma.businessDocumentItem.findMany({ where: { itemId: id, document: { businessId, deletedAt: null, type: 'PURCHASE_INVOICE' } }, include: { document: { select: { id: true, documentNumber: true, status: true, issueDate: true } } }, orderBy: [{ document: { issueDate: 'desc' } }, { id: 'desc' }], take }),
    ]);
    return [
      ...sales.map((line) => ({ id: 'sale-' + line.id, type: 'SALE', number: line.invoice.invoiceNumber, date: line.invoice.issueDate, quantity: -Number(line.quantity), rate: Number(line.unitPrice), total: Number(line.lineTotal), status: line.invoice.status, href: '/invoices/' + line.invoice.id })),
      ...purchases.map((line) => ({ id: 'purchase-' + line.id, type: 'PURCHASE', number: line.document.documentNumber, date: line.document.issueDate, quantity: Number(line.quantity), rate: Number(line.unitPrice), total: Number(line.lineTotal), status: line.document.status, href: '/documents/' + line.document.id })),
    ].sort((a,b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id)).slice(page.offset ?? 0, take);
  }

  async update(id: string, dto: UpdateItemDto, userId: string, businessId: string, branchId: string) {
    const current = await this.findOne(id, businessId, branchId);
    const discountType = dto.saleDiscountType ?? current.saleDiscountType;
    const discount = dto.saleDiscount ?? Number(current.saleDiscount);
    if (discountType === 'PERCENTAGE' && discount > 100) {
      throw new BadRequestException('Sale discount percentage cannot exceed 100%');
    }
    if(dto.sku&&dto.sku!==current.sku){const branches=await getLogicalBranchIds(this.prisma,businessId,branchId);if(await this.prisma.item.count({where:{id:{not:id},branchId:{in:branches},sku:dto.sku,deletedAt:null}}))throw new ConflictException('An item with this SKU already exists');}
    const item = await billingTransaction(this.prisma,async(tx)=>{
      await tx.$queryRaw(Prisma.sql`SELECT id FROM items WHERE id=${id} FOR UPDATE`);
      const actual=await tx.item.findUniqueOrThrow({where:{id}});
      const {stockQty,...fields}=dto;
      await tx.item.update({where:{id},data:fields});
      if(stockQty!==undefined){const delta=new Prisma.Decimal(stockQty).sub(actual.stockQty);if(!delta.isZero()){
        const business=await tx.business.findUnique({where:{id:businessId},select:{preferences:true}});
        await adjustStock(tx,[{itemId:id,quantity:Number(delta.abs())}],delta.isPositive()?'increment':'decrement',resolvePreferences(business?.preferences).transaction.negativeStock,{businessId,branchId,kind:'ADJUSTMENT',sourceId:id,userId});
      }}
      return tx.item.findUniqueOrThrow({where:{id},include:ITEM_INCLUDE});
    });
    await this.audit.log({ businessId, userId, action: 'ITEM_UPDATED', entityType: 'Item', entityId: id });
    return item;
  }

  async setImage(id: string, file: UploadedItemImage | undefined, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
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

  async getImage(id: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const image = await this.prisma.itemImage.findUnique({ where: { itemId: id } });
    if (!image) throw new NotFoundException('Item image not found');
    return image;
  }

  async removeImage(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const image = await this.prisma.itemImage.findUnique({ where: { itemId: id }, select: { id: true } });
    if (!image) throw new NotFoundException('Item image not found');
    await this.prisma.itemImage.delete({ where: { itemId: id } });
    await this.audit.log({ businessId, userId, action: 'ITEM_IMAGE_REMOVED', entityType: 'Item', entityId: id });
    return { success: true };
  }

  async remove(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
    const linked = await this.prisma.item.findUnique({ where: { id }, select: { _count: { select: { invoiceItems: true, documentItems: true } } } });
    if (linked && Object.values(linked._count).some((count) => count > 0)) throw new BadRequestException('This record has linked transactions and must be retained');
    await this.prisma.item.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ businessId, userId, action: 'ITEM_DELETED', entityType: 'Item', entityId: id });
    return { success: true };
  }
}
