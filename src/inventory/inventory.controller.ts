import {Body,Controller,Delete,Get,Param,Patch,Post,Query} from '@nestjs/common';
import {Role} from '@prisma/client';
import {BusinessScoped} from '../auth/decorators/business-scoped.decorator.js';
import {BranchScoped} from '../auth/decorators/branch-scoped.decorator.js';
import {CurrentBusiness} from '../auth/decorators/current-business.decorator.js';
import {CurrentBranch} from '../auth/decorators/current-branch.decorator.js';
import {CurrentUser} from '../auth/decorators/current-user.decorator.js';
import {Roles} from '../auth/decorators/roles.decorator.js';
import {RequireMfa} from '../auth/decorators/require-mfa.decorator.js';
import {PaginationQueryDto} from '../common/dto/pagination-query.dto.js';
import {InventoryService} from './inventory.service.js';
import {WarehouseDto,StockOperationDto} from './inventory.dto.js';
@Controller('inventory') @BusinessScoped() @BranchScoped() @RequireMfa()
export class InventoryController {
 constructor(private readonly service:InventoryService){}
 @Get('godowns') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 warehouses(@CurrentBusiness() business:string,@CurrentBranch() branch:string,@Query() page:PaginationQueryDto){return this.service.warehouses(business,branch,page);}
 @Post('godowns') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 create(@Body() dto:WarehouseDto,@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.createWarehouse(dto,business,branch);}
 @Patch('godowns/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 update(@Param('id') id:string,@Body() dto:WarehouseDto,@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.updateWarehouse(id,dto,business,branch);}
 @Delete('godowns/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER)
 remove(@Param('id') id:string,@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.removeWarehouse(id,business,branch);}
 @Get('summary') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 summary(@CurrentBusiness() business:string,@CurrentBranch() branch:string,@Query() page:PaginationQueryDto){return this.service.summary(business,branch,page);}
 @Get('movements') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 movements(@CurrentBusiness() business:string,@CurrentBranch() branch:string,@Query() page:PaginationQueryDto){return this.service.movements(business,branch,page);}
 @Post('adjustments') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 operate(@Body() dto:StockOperationDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.operate(dto,user.id,business,branch);}
}
