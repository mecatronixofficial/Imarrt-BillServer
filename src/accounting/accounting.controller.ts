import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessScoped } from '../auth/decorators/business-scoped.decorator.js';
import { BranchScoped } from '../auth/decorators/branch-scoped.decorator.js';
import { CurrentBusiness } from '../auth/decorators/current-business.decorator.js';
import { CurrentBranch } from '../auth/decorators/current-branch.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RequireMfa } from '../auth/decorators/require-mfa.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { AccountingService } from './accounting.service.js';
import { AccountDto, DeleteExpenseCategoryQueryDto, ExpenseCategoryDto, ExpenseDto } from './accounting.dto.js';
@Controller() @RequireMfa() @BusinessScoped() @BranchScoped()
export class AccountingController {
 constructor(private readonly service:AccountingService){}
 @Get('accounts') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 accounts(@CurrentBusiness() business:string,@CurrentBranch() branch:string|undefined,@Query() page:PaginationQueryDto){return this.service.accounts(business,branch,page);}
 @Post('accounts') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 create(@Body() dto:AccountDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.saveAccount(dto,user.id,business,branch);}
 @Patch('accounts/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 update(@Param('id') id:string,@Body() dto:AccountDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.saveAccount(dto,user.id,business,branch,id);}
 @Delete('accounts/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER)
 remove(@Param('id') id:string,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.removeAccount(id,user.id,business,branch);}
 @Get('expenses') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 expenses(@CurrentBusiness() business:string,@CurrentBranch() branch:string|undefined,@Query() page:PaginationQueryDto){return this.service.expenses(business,branch,page);}
 @Post('expenses') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 expense(@Body() dto:ExpenseDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.createExpense(dto,user.id,business,branch);}
 @Get('expenses/categories') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT,Role.STAFF)
 expenseCategories(@CurrentBusiness() business:string,@CurrentBranch() branch:string|undefined,@Query() page:PaginationQueryDto){return this.service.expenseCategories(business,branch,page);}
 @Post('expenses/categories') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 createExpenseCategory(@Body() dto:ExpenseCategoryDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.createExpenseCategory(dto,user.id,business,branch);}
 @Patch('expenses/categories/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 renameExpenseCategory(@Param('id') id:string,@Body() dto:ExpenseCategoryDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.renameExpenseCategory(id,dto,user.id,business,branch);}
 @Delete('expenses/categories/:id') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 deleteExpenseCategory(@Param('id') id:string,@Query() query:DeleteExpenseCategoryQueryDto,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.deleteExpenseCategory(id,query,user.id,business,branch);}
 @Post('expenses/:id/cancel') @Roles(Role.SUPER_ADMIN,Role.OWNER,Role.ACCOUNTANT)
 cancel(@Param('id') id:string,@CurrentUser() user:{id:string},@CurrentBusiness() business:string,@CurrentBranch() branch:string){return this.service.cancelExpense(id,user.id,business,branch);}
}
