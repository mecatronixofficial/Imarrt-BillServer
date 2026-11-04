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
import { FinanceService } from './finance.service.js';
import { CashAdjustmentDto, ChequeActionDto, ConvertToLoanPaymentDto, IncomeCategoryDto, IncomeDto, LoanDto, LoanPaymentDto, TransferDto, UpdateFinanceEntryDto } from './finance.dto.js';

@Controller() @RequireMfa() @BusinessScoped() @BranchScoped()
@Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT, Role.STAFF)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get('loans') loans(@CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.loans(b, c, p); }
  @Post('loans') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  createLoan(@Body() dto: LoanDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.createLoan(dto, u.id, b, c); }
  @Post('loans/:id/payments') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  payLoan(@Param('id') id: string, @Body() dto: LoanPaymentDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.payLoan(id, dto, u.id, b, c); }
  @Delete('loans/:id/payments/:paymentId') @Roles(Role.SUPER_ADMIN, Role.OWNER)
  removeLoanPayment(@Param('id') id: string, @Param('paymentId') paymentId: string, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.removeLoanPayment(id, paymentId, u.id, b, c); }
  @Post('finance-entries/:id/loan-payment') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  toLoanPayment(@Param('id') id: string, @Body() dto: ConvertToLoanPaymentDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.convertToLoanPayment(id, dto, u.id, b, c); }
  @Get('incomes/categories') categories(@CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.categories(b, c, p); }
  @Post('incomes/categories') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  category(@Body() dto: IncomeCategoryDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.createCategory(dto, u.id, b, c); }
  @Get('incomes') incomes(@CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.incomes(b, c, p); }
  @Post('incomes') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  income(@Body() dto: IncomeDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.income(dto, u.id, b, c); }
  @Get('cash/transactions') cash(@CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.transactions(null, b, c, p); }
  @Get('accounts/:id/transactions') transactions(@Param('id') id: string, @CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.transactions(id, b, c, p); }
  @Post('cash/adjustments') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  adjust(@Body() dto: CashAdjustmentDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.adjustCash(dto, u.id, b, c); }
  @Post('accounts/transfers') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  transfer(@Body() dto: TransferDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.transfer(dto, u.id, b, c); }
  @Patch('finance-entries/:id') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  updateEntry(@Param('id') id: string, @Body() dto: UpdateFinanceEntryDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.updateEntry(id, dto, u.id, b, c); }
  @Delete('finance-entries/:id') @Roles(Role.SUPER_ADMIN, Role.OWNER)
  removeEntry(@Param('id') id: string, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.removeEntry(id, u.id, b, c); }
  @Get('cheques') cheques(@CurrentBusiness() b: string, @CurrentBranch() c: string | undefined, @Query() p: PaginationQueryDto) { return this.service.cheques(b, c, p); }
  @Post('cheques/:id/actions') @Roles(Role.SUPER_ADMIN, Role.OWNER, Role.ACCOUNTANT)
  cheque(@Param('id') id: string, @Body() dto: ChequeActionDto, @CurrentUser() u: { id: string }, @CurrentBusiness() b: string, @CurrentBranch() c: string) { return this.service.cheque(id, dto, u.id, b, c); }
}
