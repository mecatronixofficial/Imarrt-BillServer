import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { UpdatePurchaseOrderStatusDto } from './dto/update-purchase-order-status.dto.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

@Controller('purchase-orders') @RequireMfa() @BusinessScoped() @BranchScoped() @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}
  @Get() findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) { return this.orders.findAll(businessId, branchId, query); }
  @Post() create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.create(dto, user.id, businessId, branchId); }
  @Patch(':id/status') updateStatus(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderStatusDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.updateStatus(id, dto.status, user.id, businessId, branchId); }
}
