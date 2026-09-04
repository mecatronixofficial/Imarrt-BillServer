import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';

@Module({
  controllers: [BusinessesController],
  providers: [BusinessesService, AuditService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
