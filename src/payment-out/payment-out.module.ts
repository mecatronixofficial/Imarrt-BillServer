import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { PaymentOutController } from './payment-out.controller.js';
import { PaymentOutService } from './payment-out.service.js';

@Module({
  controllers: [PaymentOutController],
  providers: [PaymentOutService, AuditService],
  exports: [PaymentOutService],
})
export class PaymentOutModule {}
