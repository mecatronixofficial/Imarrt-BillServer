import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { PartiesService } from './parties.service';
import { PartiesController } from './parties.controller';

@Module({
  controllers: [PartiesController],
  providers: [PartiesService, AuditService],
})
export class PartiesModule {}
