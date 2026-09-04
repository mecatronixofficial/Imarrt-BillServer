import { Module } from '@nestjs/common';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { AuditService } from '../common/utils/audit.service';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, AuditService],
})
export class ItemsModule {}
