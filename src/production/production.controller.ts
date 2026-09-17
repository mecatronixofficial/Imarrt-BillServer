import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Role, ProductionStageType } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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

  @Get('capabilities')
  capabilities() { return { masterVersion: 2, imageDetails: true }; }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.production.findOne(id, businessId, branchId);
  }

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  addImage(@Param('id') id: string, @UploadedFile() file: { buffer: Buffer; size: number; mimetype: string; originalname: string } | undefined, @Body() body: { stageType?: ProductionStageType; displayName?: string; color?: string; sizeLabel?: string; details?: string }, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    const stageType = body.stageType;
    if (stageType && !Object.values(ProductionStageType).includes(stageType)) throw new BadRequestException('Invalid production stage');
    return this.production.addImage(id, file, stageType, body, user.id, businessId, branchId);
  }

  @Get(':id/images/:imageId')
  async getImage(@Param('id') id: string, @Param('imageId') imageId: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @Res() res: Response) {
    const image = await this.production.getImage(id, imageId, businessId, branchId);
    res.set({ 'Content-Type': image.mimeType, 'Content-Length': String(image.size), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(image.data));
  }

  @Delete(':id/images/:imageId')
  removeImage(@Param('id') id: string, @Param('imageId') imageId: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.removeImage(id, imageId, user.id, businessId, branchId);
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

  @Patch(':id/confirm')
  confirm(@Param('id') id: string, @Body('confirmedAt') confirmedAt: string | undefined, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.confirm(id, confirmedAt, user.id, businessId, branchId);
  }

  @Patch(':id/master')
  updateMaster(@Param('id') id: string, @Body() dto: CreateProductionOrderDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.updateMaster(id, dto, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  removeOrder(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.production.removeOrder(id, user.id, businessId, branchId);
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
