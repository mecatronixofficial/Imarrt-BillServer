import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { BusinessesService } from './businesses.service.js';
import { CreateBusinessDto } from './dto/create-business.dto.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

type CurrentActor = { id: string; role: Role };

@Controller('businesses')
@RequireMfa()
export class BusinessesController {
  constructor(private businessesService: BusinessesService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentUser() user: CurrentActor) {
    return this.businessesService.findAll(user, query);
  }

  @Get(':id/preferences')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  getPreferences(@Param('id') id: string, @CurrentUser() user: CurrentActor) {
    return this.businessesService.getPreferences(id, user);
  }

  @Patch(':id/preferences')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  updatePreferences(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: CurrentActor) {
    return this.businessesService.updatePreferences(id, body, user);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentActor) {
    return this.businessesService.findOne(id, user);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  create(@Body() dto: CreateBusinessDto, @CurrentUser() user: CurrentActor) {
    return this.businessesService.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateBusinessDto, @CurrentUser() user: CurrentActor) {
    return this.businessesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: CurrentActor) {
    return this.businessesService.remove(id, user);
  }
}
