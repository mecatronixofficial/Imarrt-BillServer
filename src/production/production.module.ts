import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  controllers: [ProductionController],
  providers: [ProductionService, AuditService],
})
export class ProductionModule {}
