import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { TransactionReportQueryDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

@Controller('reports') @RequireMfa() @BusinessScoped() @BranchScoped()
@Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('transactions') transactions(@Query() query: TransactionReportQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.reports.transactions(businessId, branchId, query);
  }
}
