import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { BranchesService } from './branches.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';

@Controller('branches')
@BusinessScoped()
@RequireMfa()
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string) {
    return this.branches.findAll(businessId, query);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  create(@Body() dto: CreateBranchDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.branches.create(dto, user.id, businessId);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.branches.update(id, dto, user.id, businessId);
  }
}
