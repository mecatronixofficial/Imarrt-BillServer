import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { BusinessesController } from './businesses.controller.js';
import { BusinessesService } from './businesses.service.js';

@Module({
  controllers: [BusinessesController],
  providers: [BusinessesService, AuditService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
