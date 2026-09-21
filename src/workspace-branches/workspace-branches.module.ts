import { Module } from '@nestjs/common';
import { WorkspaceBranchesController } from './workspace-branches.controller.js';
import { WorkspaceBranchesService } from './workspace-branches.service.js';

@Module({ controllers: [WorkspaceBranchesController], providers: [WorkspaceBranchesService] })
export class WorkspaceBranchesModule {}
