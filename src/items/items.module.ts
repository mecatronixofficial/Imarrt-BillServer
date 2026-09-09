import { Module } from '@nestjs/common';
import { ItemsService } from './items.service.js';
import { ItemsController } from './items.controller.js';
import { AuditService } from '../common/utils/audit.service.js';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, AuditService],
})
export class ItemsModule {}
