import { Body, Controller, Get, Patch, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { Role } from '@prisma/client';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

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
