import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { BRANCH_SCOPED_KEY } from '../decorators/branch-scoped.decorator';

@Injectable()
export class BranchGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const scoped = this.reflector.getAllAndOverride<boolean>(BRANCH_SCOPED_KEY, [context.getHandler(), context.getClass()]);
    if (!scoped) return true;

    const request = context.switchToHttp().getRequest();
    const businessId = request.businessId as string | undefined;
    if (!businessId) throw new BadRequestException('Select a company before continuing');

    const header = request.headers['x-branch-id'];
    const requestedBranchId = Array.isArray(header) ? header[0] : header;
    if (requestedBranchId === 'all') {
      if (request.method !== 'GET') throw new BadRequestException('Select a branch before creating or changing records');
      request.branchId = undefined;
      return true;
    }

    const branch = await this.prisma.branch.findFirst({
      where: { businessId, isActive: true, ...(requestedBranchId ? { id: requestedBranchId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) {
      if (requestedBranchId) throw new ForbiddenException('This branch is not available for the selected company');
      throw new BadRequestException('Create a branch before continuing');
    }

    request.branchId = branch.id;
    return true;
  }
}
