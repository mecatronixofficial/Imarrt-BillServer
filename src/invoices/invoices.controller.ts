import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Res,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { PdfService } from '../pdf/pdf.service';
import { Role } from '@prisma/client';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { DeliverInvoiceDto } from './dto/deliver-invoice.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('invoices')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
export class InvoicesController {
  constructor(
    private invoicesService: InvoicesService,
    private pdfService: PdfService,
    private deliveryService: InvoiceDeliveryService,
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.invoicesService.create(dto, user.id, businessId, branchId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.invoicesService.findAll(businessId, branchId, query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.invoicesService.findOne(id, businessId, branchId);
  }

  @Get(':id/deliveries')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  deliveries(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.deliveryService.history(id, businessId, branchId);
  }

  @Post(':id/deliver')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  deliver(
    @Param('id') id: string,
    @Body() dto: DeliverInvoiceDto,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
    @CurrentBranch() branchId: string,
  ) {
    return this.deliveryService.deliver(id, businessId, dto.channels, user.id, branchId);
  }

  @Get(':id/pdf')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  async downloadPdf(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string | undefined, @Res() res: Response) {
    const invoice = await this.invoicesService.findOne(id, businessId, branchId);
    const pdfBuffer = await this.pdfService.generateInvoicePdf(invoice);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    });
    res.send(pdfBuffer);
  }

  @Post(':id/payments')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
    @CurrentBranch() branchId: string,
  ) {
    return this.invoicesService.recordPayment(id, dto, user.id, businessId, branchId);
  }

  @Post(':id/cancel')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  cancel(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.invoicesService.cancel(id, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.invoicesService.remove(id, user.id, businessId, branchId);
  }
}
