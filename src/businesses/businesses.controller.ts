import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BusinessesService } from './businesses.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

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
}
