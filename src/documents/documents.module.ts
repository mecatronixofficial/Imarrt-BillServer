import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { PdfModule } from '../pdf/pdf.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [InvoicesModule, PdfModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AuditService],
})
export class DocumentsModule {}
