import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { ProductionController } from './production.controller.js';
import { ProductionService } from './production.service.js';

@Module({
  controllers: [ProductionController],
  providers: [ProductionService, AuditService],
})
export class ProductionModule {}
