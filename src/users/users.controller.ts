import { Body, Controller, Get, Patch, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { Role } from '@prisma/client';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

@Controller('users')
@Roles(Role.SUPER_ADMIN, Role.OWNER)
@RequireMfa()
@BusinessScoped()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentBusiness() businessId: string) {
    return this.usersService.create(dto, businessId);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string) {
    return this.usersService.findAll(businessId, query);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.usersService.deactivate(id, user.id, businessId);
  }
}
