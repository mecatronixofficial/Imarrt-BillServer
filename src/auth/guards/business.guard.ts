import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BUSINESS_SCOPED_KEY } from '../decorators/business-scoped.decorator';

@Injectable()
export class BusinessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const scoped = this.reflector.getAllAndOverride<boolean>(BUSINESS_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scoped) return true;

    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-business-id'];
    const businessId = Array.isArray(header) ? header[0] : header;
    if (!businessId || typeof businessId !== 'string') {
      throw new BadRequestException('Select a business before continuing');
    }

    const business = await this.prisma.business.findFirst({
      where: {
        id: businessId,
        isActive: true,
        ...(request.user?.role === Role.SUPER_ADMIN
          ? {}
          : { members: { some: { userId: request.user?.id, isActive: true } } }),
      },
      select: { id: true },
    });
    if (!business) throw new ForbiddenException('You do not have access to this business');

    request.businessId = business.id;
    return true;
  }
}
