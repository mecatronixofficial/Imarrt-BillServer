import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { PartiesService } from './parties.service.js';
import { CreatePartyDto } from './dto/create-party.dto.js';
import { UpdatePartyDto } from './dto/update-party.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';

@Controller('parties')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
export class PartiesController {
  constructor(private partiesService: PartiesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreatePartyDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.create(dto, user.id, businessId, branchId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.findAll(businessId, branchId, query);
  }

  @Get('next-code')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  nextCode(@CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.nextPartyCode(businessId, branchId);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.findOne(id, businessId, branchId);
  }

  @Get(':id/ledger')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  ledger(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.ledger(id, businessId, branchId);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
    @CurrentBranch() branchId: string,
  ) {
    return this.partiesService.update(id, dto, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.partiesService.remove(id, user.id, businessId, branchId);
  }
}
