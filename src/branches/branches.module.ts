import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service.js';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, AuditService],
  exports: [BranchesService],
})
export class BranchesModule {}
