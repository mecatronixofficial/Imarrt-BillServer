import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { getLogicalBranchIds } from '../common/utils/workspace-scope.util.js';

@Injectable()
export class PartyGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockedGroup(tx: Prisma.TransactionClient, id: string) {
    // Serialize assignments with renames/deletions so the display name cannot become stale.
    const [group] = await tx.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM party_groups WHERE id = ${id} FOR UPDATE`;
    if (!group) throw new NotFoundException('Party group not found');
    return group;
  }

  async nextGroupCode(businessId: string) {
    return { code: await this.generateGroupCode(this.prisma, businessId) };
  }

  /** Next free "G-0001" code. Codes are unique per business and groups can be deleted, so use the highest number, not a count. */
  private async generateGroupCode(tx: PrismaService | Prisma.TransactionClient, businessId: string) {
    const groups = await tx.partyGroup.findMany({ where: { businessId, code: { startsWith: 'G-' } }, select: { code: true } });
    const highest = groups.reduce((max, { code }) => {
      const number = Number(/^G-(\d+)$/.exec(code ?? '')?.[1]);
      return Number.isFinite(number) && number > max ? number : max;
    }, 0);
    return `G-${String(highest + 1).padStart(4, '0')}`;
  }

  private codeConflict(error: unknown, requested?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && String(error.meta?.target ?? '').includes('code')) {
      throw new ConflictException(requested ? `Group code ${requested} is already used by another party group. Enter a different code.` : 'Could not assign a group code. Please try again.');
    }
    throw error;
  }

  async list(businessId: string, branchId: string) {
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const groups = await this.prisma.partyGroup.findMany({
      where: { branchId: { in: ids } }, orderBy: { name: 'asc' },
      include: { _count: { select: { parties: { where: { deletedAt: null } } } } },
    });
    return groups.map(({ _count, ...group }) => ({ ...group, partyCount: _count.parties }));
  }

  async create(name: string, businessId: string, branchId: string, userId: string, code?: string) {
    const requestedCode = code?.trim() || undefined;
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new BadRequestException('Group name must contain 1–60 characters');
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    if (await this.prisma.partyGroup.findFirst({ where: { branchId: { in: ids }, normalizedName: clean.toLowerCase() } })) {
      throw new ConflictException('A party group with this name already exists');
    }
    return this.prisma.$transaction(async (tx) => {
      const groupCode = requestedCode ?? await this.generateGroupCode(tx, businessId);
      const group = await tx.partyGroup.create({ data: { name: clean, normalizedName: clean.toLowerCase(), code: groupCode, businessId, branchId } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'PARTY_GROUP_CREATED', entityType: 'PartyGroup', entityId: group.id } });
      return { ...group, partyCount: 0 };
    }).catch((error: unknown) => this.codeConflict(error, requestedCode));
  }

  async update(id: string, name: string, businessId: string, branchId: string, userId: string, code?: string) {
    await this.accessible(id, businessId, branchId);
    // A blank code keeps the existing one; codes are never cleared.
    const requestedCode = code?.trim() || undefined;
    const clean = name.trim();
    if (!clean || clean.length > 60) throw new BadRequestException('Group name must contain 1–60 characters');
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    if (await this.prisma.partyGroup.findFirst({ where: { id: { not: id }, branchId: { in: ids }, normalizedName: clean.toLowerCase() } })) {
      throw new ConflictException('A party group with this name already exists');
    }
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.partyGroup.update({ where: { id }, data: { name: clean, normalizedName: clean.toLowerCase(), ...(requestedCode ? { code: requestedCode } : {}) } });
      // Keep the legacy display field synchronized for every nested invoice/document response.
      await tx.party.updateMany({ where: { groupId: id }, data: { group: clean } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'PARTY_GROUP_UPDATED', entityType: 'PartyGroup', entityId: id } });
      return group;
    }).catch((error: unknown) => this.codeConflict(error, requestedCode));
  }

  async remove(id: string, businessId: string, branchId: string, userId: string) {
    await this.accessible(id, businessId, branchId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockedGroup(tx, id);
      if (await tx.party.count({ where: { groupId: id, deletedAt: null } })) throw new BadRequestException('This group has parties. Reassign or clear their group before deleting it.');
      await tx.party.updateMany({ where: { groupId: id, deletedAt: { not: null } }, data: { groupId: null, group: null } });
      await tx.partyGroup.delete({ where: { id } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'PARTY_GROUP_DELETED', entityType: 'PartyGroup', entityId: id } });
    });
    return { success: true };
  }

  async updateMembers(id: string, partyIds: string[], businessId: string, branchId: string, userId: string) {
    await this.accessible(id, businessId, branchId);
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const unique = [...new Set(partyIds)];
    await this.prisma.$transaction(async (tx) => {
      const group = await this.lockedGroup(tx, id);
      const count = await tx.party.count({ where: { id: { in: unique }, branchId: { in: ids }, deletedAt: null } });
      if (count !== unique.length) throw new BadRequestException('One or more parties are not available in this branch');
      await tx.party.updateMany({ where: { groupId: id, id: { notIn: unique } }, data: { groupId: null, group: null } });
      await tx.party.updateMany({ where: { id: { in: unique }, branchId: { in: ids }, deletedAt: null }, data: { groupId: id, group: group.name } });
      await tx.auditLog.create({ data: { businessId, branchId, userId, action: 'PARTY_GROUP_MEMBERS_UPDATED', entityType: 'PartyGroup', entityId: id } });
    });
    return { success: true, partyCount: unique.length };
  }

  async accessible(id: string, businessId: string, branchId: string) {
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    const group = await this.prisma.partyGroup.findFirst({ where: { id, branchId: { in: ids } } });
    if (!group) throw new NotFoundException('Party group not found in this branch');
    return group;
  }

  async assignment(tx: Prisma.TransactionClient, input: { groupId?: string | null; group?: string | null }, businessId: string, branchId: string) {
    if (input.groupId === undefined && input.group === undefined) return {};
    if (input.groupId === null || input.groupId === '' || input.groupId === undefined && !input.group?.trim()) return { groupId: null, group: null };
    const ids = await getLogicalBranchIds(this.prisma, businessId, branchId);
    if (input.groupId) {
      const group = await tx.partyGroup.findFirst({ where: { id: input.groupId, branchId: { in: ids } } });
      if (!group) throw new BadRequestException('Select a party group from this branch');
      const current = await this.lockedGroup(tx, group.id);
      return { groupId: current.id, group: current.name };
    }
    // Older clients can still send a group name. It becomes a reusable group.
    const name = input.group!.trim();
    const normalizedName = name.toLowerCase();
    const group = await tx.partyGroup.findFirst({ where: { branchId: { in: ids }, normalizedName } })
      ?? await tx.partyGroup.upsert({ where: { branchId_normalizedName: { branchId, normalizedName } }, create: { name, normalizedName, code: await this.generateGroupCode(tx, businessId), businessId, branchId }, update: {} });
    const current = await this.lockedGroup(tx, group.id);
    return { groupId: current.id, group: current.name };
  }
}