import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, AuditService],
})
export class SuppliersModule {}
