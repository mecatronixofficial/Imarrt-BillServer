import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProductionCostDto } from './dto/create-production-cost.dto';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { UpdateProductionStatusDto } from './dto/update-production-status.dto';
import { ProductionService } from './production.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

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

  @Delete(':id/costs/:costId')
  removeCost(@Param('id') id: string, @Param('costId') costId: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.removeCost(id, costId, user.id, businessId, branchId);
  }
}
