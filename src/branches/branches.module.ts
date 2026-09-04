import { Module } from '@nestjs/common';
import { AuditService } from '../common/utils/audit.service';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, AuditService],
  exports: [BranchesService],
})
export class BranchesModule {}
