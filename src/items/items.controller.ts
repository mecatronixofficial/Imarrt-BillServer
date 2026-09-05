import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { Role } from '@prisma/client';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('items')
@RequireMfa()
@BusinessScoped()
export class ItemsController {
  constructor(private itemsService: ItemsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreateItemDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.itemsService.create(dto, user.id, businessId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string) {
    return this.itemsService.findAll(businessId, query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string) {
    return this.itemsService.findOne(id, businessId);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateItemDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.itemsService.update(id, dto, user.id, businessId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.itemsService.remove(id, user.id, businessId);
  }
}
