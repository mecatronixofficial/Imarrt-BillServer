import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateProductionCostDto } from './dto/create-production-cost.dto.js';
import { CreateProductionOrderDto } from './dto/create-production-order.dto.js';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto.js';
import { UpdateProductionStatusDto } from './dto/update-production-status.dto.js';
import { ProductionService } from './production.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { RecordProductionPaymentDto } from './dto/record-production-payment.dto.js';

@Controller('production-orders')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
@Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.production.findAll(businessId, branchId, query);
  }

  @Get('payments/register')
  listPayments(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.production.listPayments(businessId, branchId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.production.findOne(id, businessId, branchId);
  }

  @Post()
  create(@Body() dto: CreateProductionOrderDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.create(dto, user.id, businessId, branchId);
  }

  @Patch(':id/stages/:stageId')
  updateStage(@Param('id') id: string, @Param('stageId') stageId: string, @Body() dto: UpdateProductionStageDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.updateStage(id, stageId, dto, user.id, businessId, branchId);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProductionStatusDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.updateStatus(id, dto.status, user.id, businessId, branchId);
  }

  @Post(':id/costs')
  addCost(@Param('id') id: string, @Body() dto: CreateProductionCostDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.addCost(id, dto, user.id, businessId, branchId);
  }

  @Post(':id/costs/:costId/payments')
  recordPayment(@Param('id') id: string, @Param('costId') costId: string, @Body() dto: RecordProductionPaymentDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.recordPayment(id, costId, dto, user.id, businessId, branchId);
  }

  @Delete(':id/costs/:costId')
  removeCost(@Param('id') id: string, @Param('costId') costId: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.removeCost(id, costId, user.id, businessId, branchId);
  }
}
