import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { InvoicesController } from './invoices.controller.js';
import { AuditService } from '../common/utils/audit.service.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { InvoiceDeliveryService } from './invoice-delivery.service.js';

@Module({
  imports: [PdfModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceDeliveryService, AuditService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
