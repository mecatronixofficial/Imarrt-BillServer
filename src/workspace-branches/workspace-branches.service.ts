import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateWorkspaceBranchDto } from './dto/update-workspace-branch.dto.js';

@Injectable()
export class WorkspaceBranchesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(actor: { id: string; role: Role }) {
    return this.prisma.workspaceBranch.findMany({
      where: actor.role === Role.SUPER_ADMIN ? {} : { OR: [{ createdById: actor.id }, { businesses: { some: { members: { some: { userId: actor.id, isActive: true } } } } }] },
      include: { businesses: { where: { isActive: true }, include: { _count: { select: { invoices: true, members: true } } }, orderBy: { createdAt: 'asc' } }, _count: { select: { businesses: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(body: { name: string; code: string; address?: string }, userId: string) {
    const name = body.name?.trim();
    const code = body.code?.trim().toUpperCase();
    if (!name || !code || !/^[A-Z0-9_-]{2,24}$/.test(code)) throw new BadRequestException('Valid branch name and code are required');
    const duplicate = await this.prisma.workspaceBranch.findUnique({ where: { createdById_code: { createdById: userId, code } } });
    if (duplicate) throw new ConflictException('A branch with this code already exists');
    return this.prisma.workspaceBranch.create({ data: { name, code, address: body.address?.trim() || null, createdById: userId }, include: { businesses: true, _count: { select: { businesses: true } } } });
  }

  async update(id: string, dto: UpdateWorkspaceBranchDto, actor: { id: string; role: Role }) {
    const branch = await this.prisma.workspaceBranch.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { createdById: actor.id }) } });
    if (!branch) throw new NotFoundException('Branch not found');

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Branch name is required');

    const code = dto.code?.trim().toUpperCase();
    if (code && code !== branch.code) {
      const duplicate = await this.prisma.workspaceBranch.findUnique({ where: { createdById_code: { createdById: branch.createdById, code } } });
      if (duplicate) throw new ConflictException('A branch with this code already exists');
    }

    return this.prisma.workspaceBranch.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(code && { code }),
        ...(dto.address !== undefined && { address: dto.address?.trim() || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { businesses: true, _count: { select: { businesses: true } } },
    });
  }

  async remove(id: string, actor: { id: string; role: Role }) {
    const branch = await this.prisma.workspaceBranch.findFirst({ where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { createdById: actor.id }) }, include: { _count: { select: { businesses: true } } } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (branch._count.businesses) throw new ConflictException('Delete or move the companies in this branch first');
    await this.prisma.workspaceBranch.delete({ where: { id } });
    return { success: true };
  }
}
