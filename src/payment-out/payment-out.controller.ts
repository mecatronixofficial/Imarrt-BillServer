import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CreatePaymentOutDto, UpdatePaymentOutDto, VoidPaymentOutDto } from './payment-out.dto.js';
import { PaymentOutService, type UploadedReceiptFile } from './payment-out.service.js';

const ALL_STAFF = [Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF];

@Controller('payment-out')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
export class PaymentOutController {
  constructor(private readonly paymentOut: PaymentOutService) {}

  @Get()
  @Roles(...ALL_STAFF)
  list(@CurrentBusiness() businessId: string, @Query() query: PaginationQueryDto, @CurrentBranch() branchId?: string) {
    return this.paymentOut.list(businessId, branchId, query.limit, query.offset);
  }

  @Get('suppliers/:supplierId/bills')
  @Roles(...ALL_STAFF)
  openBills(@Param('supplierId') supplierId: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.openBills(supplierId, businessId, branchId);
  }

  @Post()
  @Roles(...ALL_STAFF)
  create(@Body() dto: CreatePaymentOutDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.create(dto, user.id, businessId, branchId);
  }

  @Get(':id')
  @Roles(...ALL_STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.paymentOut.findOne(id, businessId, branchId);
  }

  @Patch(':id')
  @Roles(...ALL_STAFF)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentOutDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.update(id, dto, user.id, businessId, branchId);
  }

  @Post(':id/void')
  @Roles(...ALL_STAFF)
  void(@Param('id') id: string, @Body() dto: VoidPaymentOutDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.void(id, dto, user.id, businessId, branchId);
  }

  @Post(':id/restore')
  @Roles(...ALL_STAFF)
  restore(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.restore(id, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.remove(id, user.id, businessId, branchId);
  }

  @Post(':id/attachments')
  @Roles(...ALL_STAFF)
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } }))
  addAttachments(@Param('id') id: string, @UploadedFiles() files: UploadedReceiptFile[], @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.addAttachments(id, files, user.id, businessId, branchId);
  }

  @Get(':id/attachments/:attachmentId')
  @Roles(...ALL_STAFF)
  async downloadAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string | undefined, @Res() res: Response) {
    const attachment = await this.paymentOut.getAttachment(id, attachmentId, businessId, branchId);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(Buffer.from(attachment.data));
  }

  @Delete(':id/attachments/:attachmentId')
  @Roles(...ALL_STAFF)
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.paymentOut.removeAttachment(id, attachmentId, user.id, businessId, branchId);
  }
}
