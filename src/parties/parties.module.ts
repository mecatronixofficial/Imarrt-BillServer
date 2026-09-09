import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { PartiesService } from './parties.service.js';
import { PartiesController } from './parties.controller.js';

@Module({
  controllers: [PartiesController],
  providers: [PartiesService, AuditService],
})
export class PartiesModule {}
