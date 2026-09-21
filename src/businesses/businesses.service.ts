import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { blindIndexField, decryptField, encryptField } from '../common/utils/encryption.util.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { PREFERENCE_SECTIONS, resolvePreferences, validatePreferencePatch } from './business-preferences.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

type Actor = { id: string; role: Role };

@Injectable()
export class BusinessesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateBusinessDto, actor: Actor) {
    const workspaceBranch = await this.prisma.workspaceBranch.findFirst({
      where: {
        id: dto.workspaceBranchId,
        isActive: true,
        ...(actor.role === Role.SUPER_ADMIN ? {} : { createdById: actor.id }),
      },
    });
    if (!workspaceBranch) throw new BadRequestException('Workspace branch not found');
    if (dto.gstRegistered && dto.gstin) await this.assertGstinAvailable(dto.gstin);

    const business = await this.prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: {
          name: dto.name.trim(),
          legalName: dto.legalName?.trim() || undefined,
          gstRegistered: dto.gstRegistered,
          gstin: dto.gstRegistered && dto.gstin ? encryptField(dto.gstin) : null,
          gstinHash:
            dto.gstRegistered && dto.gstin
              ? blindIndexField('business-gstin', dto.gstin)
              : null,
          address: dto.address?.trim() || undefined,
          stateCode: dto.stateCode?.trim() || undefined,
          tin: dto.tin?.trim() || undefined,
          phone: dto.phone?.trim() || undefined,
          email: dto.email?.trim().toLowerCase() || undefined,
          createdById: actor.id,
          workspaceBranchId: workspaceBranch.id,
          branches: {
            create: {
              name: dto.branchName?.trim() || 'Main Branch',
              code: dto.branchCode?.trim().toUpperCase() || 'MAIN',
              address: dto.address?.trim() || undefined,
              stateCode: dto.stateCode?.trim() || undefined,
              phone: dto.phone?.trim() || undefined,
              email: dto.email?.trim().toLowerCase() || undefined,
            },
          },
        },
      });
      await tx.businessMember.create({ data: { businessId: created.id, userId: actor.id } });
      return created;
    });

    await this.audit.log({
      businessId: business.id,
      userId: actor.id,
      action: 'BUSINESS_CREATED',
      entityType: 'Business',
      entityId: business.id,
      metadata: { gstRegistered: business.gstRegistered },
    });
    return this.redact(business);
  }

  async findAll(actor: Actor, { limit, offset }: PaginationQueryDto) {
    const businesses = await this.prisma.business.findMany({
      where: {
        isActive: true,
        ...(actor.role === Role.SUPER_ADMIN ? {} : { members: { some: { userId: actor.id, isActive: true } } }),
      },
      include: { workspaceBranch: true, _count: { select: { members: true, invoices: true, branches: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      skip: offset,
    });
    return businesses.map((business) => this.redact(business));
  }

  async findOne(id: string, actor: Actor) {
    const business = await this.prisma.business.findFirst({
      where: {
        id,
        isActive: true,
        ...(actor.role === Role.SUPER_ADMIN ? {} : { members: { some: { userId: actor.id, isActive: true } } }),
      },
      include: { workspaceBranch: true, _count: { select: { members: true, invoices: true, branches: true } } },
    });
    if (!business) throw new NotFoundException('Business not found');
    return this.redact(business);
  }

  async update(id: string, dto: UpdateBusinessDto, actor: Actor) {
    const current = await this.findAccessible(id, actor);

    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('Business name is required');

    const gstRegistered = dto.gstRegistered ?? current.gstRegistered;
    const currentGstin = current.gstin ? decryptField(current.gstin) : null;
    const gstin = gstRegistered ? (dto.gstin ?? currentGstin) : null;
    if (gstRegistered && !gstin) throw new BadRequestException('GSTIN is required for a GST registered business');
    if (gstin && gstin !== currentGstin) await this.assertGstinAvailable(gstin, id);

    // `undefined` leaves a field untouched; `null` or a blank string clears it.
    const text = (value: string | null | undefined) => value?.trim() || null;

    const business = await this.prisma.business.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.legalName !== undefined ? { legalName: text(dto.legalName) } : {}),
        ...(dto.address !== undefined ? { address: text(dto.address) } : {}),
        ...(dto.stateCode !== undefined ? { stateCode: text(dto.stateCode) } : {}),
        ...(dto.tin !== undefined ? { tin: text(dto.tin)?.toUpperCase() ?? null } : {}),
        ...(dto.phone !== undefined ? { phone: text(dto.phone) } : {}),
        ...(dto.email !== undefined ? { email: text(dto.email)?.toLowerCase() ?? null } : {}),
        gstRegistered,
        gstin: gstin ? encryptField(gstin) : null,
        gstinHash: gstin ? blindIndexField('business-gstin', gstin) : null,
      },
      include: { workspaceBranch: true, _count: { select: { members: true, invoices: true, branches: true } } },
    });

    await this.audit.log({
      businessId: id,
      userId: actor.id,
      action: 'BUSINESS_UPDATED',
      entityType: 'Business',
      entityId: id,
      metadata: { gstRegistered: business.gstRegistered },
    });
    return this.redact(business);
  }

  async getPreferences(id: string, actor: Actor) {
    const business = await this.findAccessible(id, actor);
    return resolvePreferences(business.preferences);
  }

  async updatePreferences(id: string, body: unknown, actor: Actor) {
    const patch = validatePreferencePatch(body);
    const business = await this.findAccessible(id, actor);
    const current = resolvePreferences(business.preferences);
    const next = Object.fromEntries(
      PREFERENCE_SECTIONS.map((section) => [section, { ...current[section], ...patch[section] }]),
    ) as typeof current;
    await this.prisma.business.update({ where: { id }, data: { preferences: next } });
    await this.audit.log({
      businessId: id,
      userId: actor.id,
      action: 'BUSINESS_PREFERENCES_UPDATED',
      entityType: 'Business',
      entityId: id,
      metadata: { sections: Object.keys(patch) },
    });
    return next;
  }

  // Soft delete only - invoices, documents and ledgers belong to the business and
  // are never hard-deleted. An archived business disappears from every listing
  // and is rejected by the business guard.
  async remove(id: string, actor: Actor) {
    await this.findAccessible(id, actor);
    await this.prisma.business.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({
      businessId: id,
      userId: actor.id,
      action: 'BUSINESS_ARCHIVED',
      entityType: 'Business',
      entityId: id,
    });
    return { success: true };
  }

  private async findAccessible(id: string, actor: Actor) {
    const business = await this.prisma.business.findFirst({
      where: {
        id,
        isActive: true,
        ...(actor.role === Role.SUPER_ADMIN ? {} : { members: { some: { userId: actor.id, isActive: true } } }),
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  private async assertGstinAvailable(gstin: string, excludeId?: string) {
    const gstinHash = blindIndexField('business-gstin', gstin);
    const [indexedBusiness, legacyBusinesses] = await Promise.all([
      this.prisma.business.findUnique({ where: { gstinHash }, select: { id: true } }),
      this.prisma.business.findMany({
        where: { gstRegistered: true, gstinHash: null },
        select: { id: true, gstin: true },
      }),
    ]);
    const duplicate =
      (indexedBusiness !== null && indexedBusiness.id !== excludeId) ||
      legacyBusinesses.some((business) => business.id !== excludeId && business.gstin && decryptField(business.gstin) === gstin);
    if (duplicate) throw new ConflictException('A business with this GSTIN already exists');
  }

  private redact<T extends { gstin: string | null; gstinHash: string | null }>(business: T) {
    const { gstinHash: _gstinHash, ...publicBusiness } = business;
    return {
      ...publicBusiness,
      gstin: business.gstin ? decryptField(business.gstin) : null,
    };
  }
}
