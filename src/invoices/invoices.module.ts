import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { AuditService } from '../common/utils/audit.service';
import { PdfModule } from '../pdf/pdf.module';
import { InvoiceDeliveryService } from './invoice-delivery.service';

@Module({
  imports: [PdfModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceDeliveryService, AuditService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
