import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
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
import { PurchaseOrdersService, type UploadedOrderFile } from './purchase-orders.service.js';

@Controller('purchase-orders') @RequireMfa() @BusinessScoped() @BranchScoped() @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}
  @Get() findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) { return this.orders.findAll(businessId, branchId, query); }
  @Post() create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.create(dto, user.id, businessId, branchId); }
  @Get('next-number') nextNumber(@CurrentBranch() branchId: string) { return this.orders.nextNumber(branchId).then((orderNumber) => ({ orderNumber })); }
  @Get(':id') findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) { return this.orders.findOne(id, businessId, branchId); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.update(id, dto, user.id, businessId, branchId); }
  @Delete(':id') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT) remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.remove(id, user.id, businessId, branchId); }
  @Post(':id/convert-to-bill') convert(@Param('id') id:string,@CurrentUser() user:{id:string},@CurrentBusiness() businessId:string,@CurrentBranch() branchId:string){return this.orders.convertToBill(id,user.id,businessId,branchId);}
  @Patch(':id/status') updateStatus(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderStatusDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.updateStatus(id, dto.status, user.id, businessId, branchId); }
  @Post(':id/attachments') @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } }))
  addAttachments(@Param('id') id: string, @UploadedFiles() files: UploadedOrderFile[], @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.addAttachments(id, files, user.id, businessId, branchId); }
  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string | undefined, @Res() res: Response) {
    const attachment = await this.orders.getAttachment(id, attachmentId, businessId, branchId);
    res.set({ 'Content-Type': attachment.mimeType, 'Content-Length': String(attachment.size), 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(attachment.data));
  }
  @Delete(':id/attachments/:attachmentId') removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.orders.removeAttachment(id, attachmentId, user.id, businessId, branchId); }
}
