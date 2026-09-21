import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

@Module({
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, AuditService],
})
export class PurchaseOrdersModule {}
