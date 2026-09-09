import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [InvoicesModule, PdfModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AuditService],
})
export class DocumentsModule {}
