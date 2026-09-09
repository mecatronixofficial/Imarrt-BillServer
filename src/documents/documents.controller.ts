import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PdfService } from '../pdf/pdf.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto.js';
import { DocumentsService } from './documents.service.js';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto.js';

@Controller('documents')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly pdf: PdfService,
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.documents.create(dto, user.id, businessId, branchId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(
    @CurrentBusiness() businessId: string,
    @Query() query: ListDocumentsQueryDto,
    @CurrentBranch() branchId?: string,
  ) {
    return this.documents.findAll(businessId, branchId, query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId?: string) {
    return this.documents.findOne(id, businessId, branchId);
  }

  @Get(':id/pdf')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  async downloadPdf(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string | undefined, @Res() res: Response) {
    const document = await this.documents.findOne(id, businessId, branchId);
    const pdf = await this.pdf.generateDocumentPdf(document);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${document.documentNumber}.pdf"`,
    });
    res.send(pdf);
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentStatusDto,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
    @CurrentBranch() branchId: string,
  ) {
    return this.documents.updateStatus(id, dto.status, user.id, businessId, branchId);
  }

  @Post(':id/convert-to-invoice')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  convertToInvoice(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.documents.convertToInvoice(id, user.id, businessId, branchId);
  }

  @Post(':id/convert-to-proforma')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  convertToProforma(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.documents.convertToProforma(id, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.documents.remove(id, user.id, businessId, branchId);
  }
}
