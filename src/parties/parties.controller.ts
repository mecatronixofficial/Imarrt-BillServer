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
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator';
import { PartiesService } from './parties.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('parties')
@RequireMfa()
@BusinessScoped()
export class PartiesController {
  constructor(private partiesService: PartiesService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreatePartyDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.partiesService.create(dto, user.id, businessId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string) {
    return this.partiesService.findAll(businessId, query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string) {
    return this.partiesService.findOne(id, businessId);
  }

  @Get(':id/ledger')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  ledger(@Param('id') id: string, @CurrentBusiness() businessId: string) {
    return this.partiesService.ledger(id, businessId);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
  ) {
    return this.partiesService.update(id, dto, user.id, businessId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string) {
    return this.partiesService.remove(id, user.id, businessId);
  }
}
