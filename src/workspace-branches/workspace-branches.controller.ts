import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UpdateWorkspaceBranchDto } from './dto/update-workspace-branch.dto.js';
import { WorkspaceBranchesService } from './workspace-branches.service.js';

@Controller('workspace-branches')
@RequireMfa()
export class WorkspaceBranchesController {
  constructor(private readonly service: WorkspaceBranchesService) {}

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
