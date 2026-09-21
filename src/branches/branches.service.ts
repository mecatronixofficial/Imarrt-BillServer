import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';

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
    if (dto.parentId) await this.assertValidParent(dto.parentId, businessId);

    const branch = await this.prisma.branch.create({
      data: {
        businessId,
        parentId: dto.parentId || undefined,
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

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Branch name is required');
    if (dto.isActive === false && current.isActive) await this.assertNotLastActive(id, businessId, 'deactivate');
    if (dto.parentId) await this.assertValidParent(dto.parentId, businessId, id);

    // `undefined` leaves a field untouched; `null` or a blank string clears it.
    const text = (value: string | null | undefined) => value?.trim() || null;

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId || null } : {}),
        ...(dto.address !== undefined ? { address: text(dto.address) } : {}),
        ...(dto.stateCode !== undefined ? { stateCode: text(dto.stateCode) } : {}),
        ...(dto.phone !== undefined ? { phone: text(dto.phone) } : {}),
        ...(dto.email !== undefined ? { email: text(dto.email)?.toLowerCase() ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { _count: { select: { invoices: true, productionOrders: true, documents: true } } },
    });
    await this.audit.log({ businessId, branchId: branch.id, userId, action: 'BRANCH_UPDATED', entityType: 'Branch', entityId: branch.id });
    return branch;
  }

  // A branch that has ever held transactions is kept for the audit trail and can
  // only be deactivated. Empty branches are removed outright.
  async remove(id: string, userId: string, businessId: string) {
    const current = await this.prisma.branch.findFirst({
      where: { id, businessId },
      include: { _count: { select: { invoices: true, productionOrders: true, documents: true } } },
    });
    if (!current) throw new NotFoundException('Branch not found');

    const subBranches = await this.prisma.branch.count({ where: { parentId: id } });
    if (subBranches > 0) {
      throw new ConflictException('This branch has sub-branches. Move or delete them first.');
    }

    const { invoices, productionOrders, documents } = current._count;
    if (invoices + productionOrders + documents > 0) {
      throw new ConflictException('This branch has transactions and cannot be deleted. Deactivate it instead.');
    }
    if (current.isActive) await this.assertNotLastActive(id, businessId, 'delete');

    await this.audit.log({ businessId, branchId: id, userId, action: 'BRANCH_DELETED', entityType: 'Branch', entityId: id, metadata: { code: current.code } });
    await this.prisma.branch.delete({ where: { id } });
    return { success: true };
  }

  /** The parent must be in the same company and must not be the branch itself or one of its descendants. */
  private async assertValidParent(parentId: string, businessId: string, selfId?: string) {
    if (parentId === selfId) throw new BadRequestException('A branch cannot be its own parent');

    const branches = await this.prisma.branch.findMany({ where: { businessId }, select: { id: true, parentId: true } });
    const byId = new Map(branches.map((branch) => [branch.id, branch.parentId]));
    if (!byId.has(parentId)) throw new BadRequestException('Parent branch not found in this company');

    // Walking up from the chosen parent must never reach the branch being edited.
    const seen = new Set<string>();
    for (let cursor: string | null | undefined = parentId; cursor && !seen.has(cursor); cursor = byId.get(cursor)) {
      if (cursor === selfId) throw new BadRequestException('A branch cannot be moved beneath its own sub-branch');
      seen.add(cursor);
    }
  }

  private async assertNotLastActive(id: string, businessId: string, verb: 'delete' | 'deactivate') {
    const otherActive = await this.prisma.branch.count({ where: { businessId, isActive: true, id: { not: id } } });
    if (otherActive === 0) throw new BadRequestException(`You cannot ${verb} the only active branch of a company`);
  }
}
