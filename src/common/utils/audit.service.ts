import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    businessId?: string;
    branchId?: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    await this.prisma.auditLog.create({
      data: {
        businessId: params.businessId,
        branchId: params.branchId,
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
        ipAddress: params.ipAddress,
      },
    });
  }
}
