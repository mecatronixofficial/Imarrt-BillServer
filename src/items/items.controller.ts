import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ItemsService } from './items.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { Role } from '@prisma/client';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { UploadedItemImage } from './items.service.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';

@Controller('items')
@RequireMfa()
@BusinessScoped()
@BranchScoped()
export class ItemsController {
  constructor(private itemsService: ItemsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  create(@Body() dto: CreateItemDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.create(dto, user.id, businessId, branchId);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findAll(@Query() query: PaginationQueryDto, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.findAll(businessId, branchId, query);
  }

  @Post(':id/image')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  setImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedItemImage | undefined,
    @CurrentUser() user: { id: string },
    @CurrentBusiness() businessId: string,
    @CurrentBranch() branchId: string,
  ) {
    return this.itemsService.setImage(id, file, user.id, businessId, branchId);
  }

  @Get(':id/image')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  async getImage(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string, @Res() res: Response) {
    const image = await this.itemsService.getImage(id, businessId, branchId);
    res.set({
      'Content-Type': image.mimeType,
      'Content-Length': String(image.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(Buffer.from(image.data));
  }

  @Delete(':id/image')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  removeImage(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.removeImage(id, user.id, businessId, branchId);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  findOne(@Param('id') id: string, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.findOne(id, businessId, branchId);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
  update(@Param('id') id: string, @Body() dto: UpdateItemDto, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.update(id, dto, user.id, businessId, branchId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.OWNER)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }, @CurrentBusiness() businessId: string, @CurrentBranch() branchId: string) {
    return this.itemsService.remove(id, user.id, businessId, branchId);
  }
}
