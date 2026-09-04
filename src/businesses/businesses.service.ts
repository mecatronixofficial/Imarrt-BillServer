import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/utils/audit.service';
import { blindIndexField, decryptField, encryptField } from '../common/utils/encryption.util';
import { CreateBusinessDto } from './dto/create-business.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

type Actor = { id: string; role: Role };

@Injectable()
export class BusinessesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateBusinessDto, actor: Actor) {
    if (dto.gstRegistered && dto.gstin) {
      const gstinHash = blindIndexField('business-gstin', dto.gstin);
      const [indexedBusiness, legacyBusinesses] = await Promise.all([
        this.prisma.business.findUnique({ where: { gstinHash }, select: { id: true } }),
        this.prisma.business.findMany({
        where: { gstRegistered: true, gstinHash: null },
        select: { id: true, gstin: true },
        }),
      ]);
      const duplicate = indexedBusiness || legacyBusinesses.some(
        ({ gstin }) => gstin && decryptField(gstin) === dto.gstin,
      );
      if (duplicate) throw new ConflictException('A business with this GSTIN already exists');
    }

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
          phone: dto.phone?.trim() || undefined,
          email: dto.email?.trim().toLowerCase() || undefined,
          createdById: actor.id,
          branches: {
            create: {
              name: 'Main Branch',
              code: 'MAIN',
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
      include: { _count: { select: { members: true, invoices: true, branches: true } } },
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
      include: { _count: { select: { members: true, invoices: true, branches: true } } },
    });
    if (!business) throw new NotFoundException('Business not found');
    return this.redact(business);
  }

  private redact<T extends { gstin: string | null; gstinHash: string | null }>(business: T) {
    const { gstinHash: _gstinHash, ...publicBusiness } = business;
    return {
      ...publicBusiness,
      gstin: business.gstin ? decryptField(business.gstin) : null,
    };
  }
}
