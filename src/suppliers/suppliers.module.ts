import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, AuditService],
})
export class SuppliersModule {}
