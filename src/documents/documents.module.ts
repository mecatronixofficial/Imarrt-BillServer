import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { PaymentOutModule } from '../payment-out/payment-out.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [InvoicesModule, PdfModule, PaymentOutModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AuditService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
