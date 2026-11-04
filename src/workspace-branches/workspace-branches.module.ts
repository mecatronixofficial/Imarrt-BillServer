import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { WorkspaceBranchesController } from './workspace-branches.controller.js';
import { WorkspaceBranchesService } from './workspace-branches.service.js';
import { GroupSummaryService } from './group-summary.service.js';

@Module({ imports: [AccountingModule], controllers: [WorkspaceBranchesController], providers: [WorkspaceBranchesService, GroupSummaryService] })
export class WorkspaceBranchesModule {}
