import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

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
