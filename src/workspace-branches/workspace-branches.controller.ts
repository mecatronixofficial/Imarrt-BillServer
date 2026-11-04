import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Matches } from 'class-validator';
import { GroupSummaryService } from './group-summary.service.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
class GroupSummaryQueryDto {
  @Matches(DAY, { message: 'from must be a date in YYYY-MM-DD format' }) from: string;
  @Matches(DAY, { message: 'to must be a date in YYYY-MM-DD format' }) to: string;
}
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UpdateWorkspaceBranchDto } from './dto/update-workspace-branch.dto.js';
import { WorkspaceBranchesService } from './workspace-branches.service.js';

@Controller('workspace-branches')
@RequireMfa()
export class WorkspaceBranchesController {
  constructor(private readonly service: WorkspaceBranchesService, private readonly summaries: GroupSummaryService) {}

  /** The main company's combined figures across its sub companies. */
  @Get(':id/summary')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  summary(@Param('id') id: string, @Query() query: GroupSummaryQueryDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.summaries.summary(id, query.from, query.to, user);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@CurrentUser() user: { id: string; role: Role }) { return this.service.findAll(user); }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  create(@Body() body: { name: string; code: string; address?: string }, @CurrentUser() user: { id: string }) {
    return this.service.create(body, user.id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateWorkspaceBranchDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) { return this.service.remove(id, user); }
}
