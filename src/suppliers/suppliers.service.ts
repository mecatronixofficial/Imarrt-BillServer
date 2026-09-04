import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/utils/audit.service';
import { decryptField, encryptField } from '../common/utils/encryption.util';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private present(supplier: any) {
    return {
      ...supplier,
      gstin: supplier.gstin ? decryptField(supplier.gstin) : null,
    };
  }

  async create(dto: CreateSupplierDto, userId: string, businessId: string) {
    const supplier = await this.prisma.supplier.create({
      data: {
        ...dto,
        businessId,
        gstin: dto.gstin ? encryptField(dto.gstin) : undefined,
      },
    });
    await this.audit.log({
      businessId,
      userId,
      action: 'SUPPLIER_CREATED',
      entityType: 'Supplier',
      entityId: supplier.id,
    });
    return this.present(supplier);
  }

  async findAll(businessId: string, { limit, offset }: PaginationQueryDto) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    });
    return suppliers.map((supplier) => this.present(supplier));
  }

  async findOne(id: string, businessId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.present(supplier);
  }

  async update(id: string, dto: UpdateSupplierDto, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...dto,
        gstin: dto.gstin ? encryptField(dto.gstin) : undefined,
      },
    });
    await this.audit.log({
      businessId,
      userId,
      action: 'SUPPLIER_UPDATED',
      entityType: 'Supplier',
      entityId: id,
    });
    return this.present(supplier);
  }

  async remove(id: string, userId: string, businessId: string) {
    await this.findOne(id, businessId);
    await this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      businessId,
      userId,
      action: 'SUPPLIER_DELETED',
      entityType: 'Supplier',
      entityId: id,
    });
    return { success: true };
  }
}
