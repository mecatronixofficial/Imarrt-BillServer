import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { hashPassword } from '../auth/password.util.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

/** Only staff and accountants are managed from Team; owners manage themselves. */
const TEAM_ROLES: Role[] = [Role.STAFF, Role.ACCOUNTANT];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, businessId: string) {
    if (dto.role !== Role.STAFF && dto.role !== Role.ACCOUNTANT) {
      throw new BadRequestException('Team members must be staff or accountants');
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role !== dto.role) {
        throw new ConflictException('This email already belongs to a user with a different role');
      }
      await this.prisma.businessMember.upsert({
        where: { businessId_userId: { businessId, userId: existing.id } },
        update: { isActive: true },
        create: { businessId, userId: existing.id },
      });
      return this.toPublicUser(existing, existing.isActive);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash,
        role: dto.role,
        businessMemberships: { create: { businessId } },
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
    return user;
  }

  async findAll(businessId: string, { limit, offset }: PaginationQueryDto) {
    const members = await this.prisma.businessMember.findMany({
      where: { businessId },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    const lastSeen = await this.lastSeen(members.map(({ userId }) => userId));
    return members.map((member) => ({
      ...this.toPublicUser(member.user, member.isActive && member.user.isActive),
      joinedAt: member.createdAt,
      lastActiveAt: lastSeen.get(member.userId) ?? null,
    }));
  }

  /** One member: who they are, when they joined and were last active, and what they did in this company. */
  async findOne(id: string, businessId: string) {
    const member = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: id } },
      include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, mfaEnabled: true } } },
    });
    if (!member) throw new NotFoundException('Team member not found');
    const [lastSeen, invoices, documents, recent] = await Promise.all([
      this.lastSeen([id]),
      this.prisma.invoice.count({ where: { businessId, createdById: id, deletedAt: null } }),
      this.prisma.businessDocument.count({ where: { businessId, createdById: id, deletedAt: null } }),
      this.prisma.auditLog.findMany({ where: { businessId, userId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, action: true, entityType: true, createdAt: true } }),
    ]);
    return {
      ...this.toPublicUser(member.user, member.isActive && member.user.isActive),
      mfaEnabled: member.user.mfaEnabled,
      joinedAt: member.createdAt,
      lastActiveAt: lastSeen.get(id) ?? null,
      activity: { invoices, documents },
      recent,
    };
  }

  async deactivate(id: string, actorUserId: string, businessId: string) {
    if (id === actorUserId) throw new BadRequestException('You cannot deactivate your own account');
    await this.teamMember(id, businessId);
    const member = await this.prisma.businessMember.update({
      where: { businessId_userId: { businessId, userId: id } },
      data: { isActive: false },
    });
    await this.audit(businessId, actorUserId, 'TEAM_MEMBER_DEACTIVATED', id);
    return { id, isActive: member.isActive };
  }

  /** Gives a deactivated member access to this company again. */
  async activate(id: string, actorUserId: string, businessId: string) {
    const { user } = await this.teamMember(id, businessId);
    if (!user.isActive) throw new BadRequestException('This login is disabled for every company. Ask support to re-enable it');
    const member = await this.prisma.businessMember.update({
      where: { businessId_userId: { businessId, userId: id } },
      data: { isActive: true },
    });
    await this.audit(businessId, actorUserId, 'TEAM_MEMBER_ACTIVATED', id);
    return { id, isActive: member.isActive };
  }

  /**
   * Removes a member from this company. Their login and everything they recorded are kept;
   * if they are in no other company, their open sessions are signed out.
   */
  async remove(id: string, actorUserId: string, businessId: string) {
    if (id === actorUserId) throw new BadRequestException('You cannot remove your own account');
    const { user } = await this.teamMember(id, businessId);
    await this.prisma.$transaction(async (tx) => {
      await tx.businessMember.delete({ where: { businessId_userId: { businessId, userId: id } } });
      const elsewhere = await tx.businessMember.count({ where: { userId: id, isActive: true } });
      if (!elsewhere) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.audit(businessId, actorUserId, 'TEAM_MEMBER_REMOVED', id, { name: user.name, email: user.email, role: user.role });
    return { id, deleted: true };
  }

  /** The membership of a staff member or accountant, or 404 / 400 if it can't be managed here. */
  private async teamMember(id: string, businessId: string) {
    const member = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: id } },
      include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
    });
    if (!member) throw new NotFoundException('Team member not found');
    if (!TEAM_ROLES.includes(member.user.role)) throw new BadRequestException('Owners cannot be changed from Team');
    return member;
  }

  private async lastSeen(userIds: string[]) {
    if (!userIds.length) return new Map<string, Date>();
    const sessions = await this.prisma.authSession.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { lastUsedAt: true } });
    return new Map(sessions.flatMap(({ userId, _max }) => (_max.lastUsedAt ? [[userId, _max.lastUsedAt] as const] : [])));
  }

  private audit(businessId: string, userId: string, action: string, entityId: string, metadata?: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { businessId, userId, action, entityType: 'User', entityId, ...(metadata ? { metadata: JSON.stringify(metadata) } : {}) } });
  }

  private toPublicUser<
    T extends { id: string; name: string; email: string; role: unknown; createdAt: Date },
  >(user: T, isActive: boolean) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive,
      createdAt: user.createdAt,
    };
  }
}
