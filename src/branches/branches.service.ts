import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/utils/audit.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(businessId: string, { limit, offset }: PaginationQueryDto) {
    return this.prisma.branch.findMany({
      where: { businessId },
      include: { _count: { select: { invoices: true, productionOrders: true, documents: true } } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      skip: offset,
    });
  }

  async create(dto: CreateBranchDto, userId: string, businessId: string) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.branch.findUnique({ where: { businessId_code: { businessId, code } } });
    if (existing) throw new ConflictException('A branch with this code already exists');

    const branch = await this.prisma.branch.create({
      data: {
        businessId,
        name: dto.name.trim(),
        code,
        address: dto.address?.trim() || undefined,
        stateCode: dto.stateCode?.trim() || undefined,
        phone: dto.phone?.trim() || undefined,
        email: dto.email?.trim().toLowerCase() || undefined,
      },
    });
    await this.audit.log({ businessId, branchId: branch.id, userId, action: 'BRANCH_CREATED', entityType: 'Branch', entityId: branch.id });
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto, userId: string, businessId: string) {
    const current = await this.prisma.branch.findFirst({ where: { id, businessId } });
    if (!current) throw new NotFoundException('Branch not found');
    const code = dto.code?.trim().toUpperCase();
    if (code && code !== current.code) {
      const duplicate = await this.prisma.branch.findUnique({ where: { businessId_code: { businessId, code } } });
      if (duplicate) throw new ConflictException('A branch with this code already exists');
    }

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(dto.address !== undefined ? { address: dto.address.trim() || null } : {}),
        ...(dto.stateCode !== undefined ? { stateCode: dto.stateCode.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({ businessId, branchId: branch.id, userId, action: 'BRANCH_UPDATED', entityType: 'Branch', entityId: branch.id });
    return branch;
  }
}
