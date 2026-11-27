import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsArray, IsUUID, ArrayMaxSize, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PartyGroupsService } from './party-groups.service.js';

export class PartyGroupDto {
  @IsString()
  @MaxLength(60)
  @Matches(/\S/, { message: 'Group name is required' })
  name: string;

  /** Optional; a "G-0001" style code is generated when it is left blank. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string;
}

export class GroupMembersDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  partyIds: string[];
}

@Controller('party-groups')
@BusinessScoped()
@BranchScoped()
@RequireMfa()
@Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class PartyGroupsController {
  constructor(private readonly groups: PartyGroupsService) {}
  @Get()
  list(@CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) { return this.groups.list(businessId, branchId); }
  @Get('next-code')
  nextCode(@CurrentBusiness() businessId: string) { return this.groups.nextGroupCode(businessId); }
  @Post()
  create(@Body() dto: PartyGroupDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @CurrentUser() user: { id: string }) { return this.groups.create(dto.name, businessId, branchId, user.id, dto.code); }
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: PartyGroupDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @CurrentUser() user: { id: string }) { return this.groups.update(id, dto.name, businessId, branchId, user.id, dto.code); }
  @Patch(':id/parties')
  updateMembers(@Param('id') id: string, @Body() dto: GroupMembersDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @CurrentUser() user: { id: string }) { return this.groups.updateMembers(id, dto.partyIds, businessId, branchId, user.id); }
  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @CurrentUser() user: { id: string }) { return this.groups.remove(id, businessId, branchId, user.id); }
}