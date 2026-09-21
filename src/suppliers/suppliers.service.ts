import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { decryptField, encryptField } from '../common/utils/encryption.util.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';

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

  async create(dto: CreateSupplierDto, userId: string, businessId: string, branchId: string) {
    const supplier = await this.prisma.supplier.create({
      data: {
        ...dto,
        businessId,
        branchId,
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

  async findAll(businessId: string, branchId: string, { limit, offset }: PaginationQueryDto) {
    const branchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const suppliers = await this.prisma.supplier.findMany({
      where: { branchId: { in: branchIds }, deletedAt: null },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    });
    return suppliers.map((supplier) => this.present(supplier));
  }

  async findOne(id: string, businessId: string, branchId: string) {
    const branchIds = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, branchId: { in: branchIds }, deletedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.present(supplier);
  }

  async update(id: string, dto: UpdateSupplierDto, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
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

  async remove(id: string, userId: string, businessId: string, branchId: string) {
    await this.findOne(id, businessId, branchId);
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
