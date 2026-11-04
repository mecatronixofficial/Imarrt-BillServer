import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/utils/audit.service.js';
import { billingTransaction, lockBillingRecord } from '../common/utils/billing-transaction.util.js';
import { blindIndexField, decryptField, encryptField } from '../common/utils/encryption.util.js';
import { computeBilling, sumMoney, subtractMoney } from '../common/utils/billing.util.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { AccountDto, DeleteExpenseCategoryQueryDto, ExpenseCategoryDto, ExpenseDto } from './accounting.dto.js';
@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  async accounts(businessId: string, branchId: string | undefined, page: PaginationQueryDto) {
    const records = await this.prisma.cashAccount.findMany({where:{businessId,...(branchId?{branchId}:{}),deletedAt:null},orderBy:[{primary:'desc'},{bankName:'asc'},{id:'asc'}],take:page.limit,skip:page.offset});
    return Promise.all(records.map(async(account)=>{
      const [received,paid,expenses,entries] = await Promise.all([
        this.prisma.paymentRecord.aggregate({where:{accountId:account.id,invoice:{deletedAt:null,status:{notIn:['DRAFT','CANCELLED']}}},_sum:{amount:true}}),
        this.prisma.purchasePayment.aggregate({where:{accountId:account.id,voidedAt:null,document:{deletedAt:null,status:{in:['ISSUED','ACCEPTED','CONVERTED']}}},_sum:{amount:true}}),
        this.prisma.expense.aggregate({where:{accountId:account.id,status:'ISSUED'},_sum:{total:true}}),
        this.prisma.financeEntry.aggregate({where:{businessId,branchId:account.branchId,accountId:account.id},_sum:{amount:true}}),
      ]);
      const {accountNumberHash,...safe}=account;
      return {...safe,accountNumber:decryptField(account.accountNumber),openingBalance:Number(account.openingBalance),balance:subtractMoney(sumMoney([Number(account.openingBalance),Number(received._sum.amount??0),Number(entries._sum.amount??0)]),sumMoney([Number(paid._sum.amount??0),Number(expenses._sum.total??0)]))};
    }));
  }
  async saveAccount(dto:AccountDto,userId:string,businessId:string,branchId:string,id?:string) {
    const result = await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      if(id && !await tx.cashAccount.findFirst({where:{id,businessId,branchId,deletedAt:null}})) throw new NotFoundException('Account not found');
      const hash=blindIndexField('cash-account',dto.accountNumber);
      const duplicate=await tx.cashAccount.findFirst({where:{branchId,accountNumberHash:hash,...(id?{id:{not:id}}:{})}});
      if(duplicate) throw new ConflictException('This bank account is already registered in this branch');
      const primary=dto.primary || !await tx.cashAccount.count({where:{businessId,branchId,deletedAt:null}});
      if(primary) await tx.cashAccount.updateMany({where:{businessId,branchId,deletedAt:null},data:{primary:false}});
      const data={...dto,primary,accountNumber:encryptField(dto.accountNumber),accountNumberHash:hash};
      return id ? tx.cashAccount.update({where:{id},data}) : tx.cashAccount.create({data:{...data,businessId,branchId}});
    });
    await this.audit.log({businessId,branchId,userId,action:id?'ACCOUNT_UPDATED':'ACCOUNT_CREATED',entityType:'CashAccount',entityId:result.id});
    return {id:result.id};
  }
  async removeAccount(id:string,userId:string,businessId:string,branchId:string) {
    await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      await lockBillingRecord(tx,'account',id);
      const record=await tx.cashAccount.findFirst({where:{id,businessId,branchId,deletedAt:null},include:{_count:{select:{paymentsIn:true,paymentsOut:true,expenses:true}}}});
      if(!record) throw new NotFoundException('Account not found');
      if(Object.values(record._count).some((count)=>count>0)) throw new BadRequestException('Accounts with linked transactions must be retained');
      if (await tx.financeEntry.count({where:{accountId:id}}) || await tx.chequeEvent.count({where:{accountId:id}})) throw new BadRequestException('Accounts with finance or cheque history must be retained');
      await tx.cashAccount.update({where:{id},data:{deletedAt:new Date(),primary:false}});
      if(record.primary) { const next=await tx.cashAccount.findFirst({where:{businessId,branchId,deletedAt:null},orderBy:{createdAt:'asc'}}); if(next) await tx.cashAccount.update({where:{id:next.id},data:{primary:true}}); }
    });
    await this.audit.log({businessId,branchId,userId,action:'ACCOUNT_DELETED',entityType:'CashAccount',entityId:id});
    return {success:true};
  }
  expenses(businessId:string,branchId:string|undefined,page:PaginationQueryDto) {
    return this.prisma.expense.findMany({where:{businessId,...(branchId?{branchId}:{})},include:{account:{select:{id:true,bankName:true}}},orderBy:[{expenseDate:'desc'},{id:'desc'}],take:page.limit,skip:page.offset});
  }
  async createExpense(dto:ExpenseDto,userId:string,businessId:string,branchId:string) {
    const totals=computeBilling([{quantity:1,unitPrice:dto.amount,taxRate:dto.taxRate??0}]);
    const record=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      if(dto.requestId){const previous=await tx.expense.findFirst({where:{businessId,branchId,requestId:dto.requestId}});if(previous)return previous;}
      if(dto.accountId && !await tx.cashAccount.findFirst({where:{id:dto.accountId,businessId,branchId,deletedAt:null}})) throw new BadRequestException('Select an account in this branch');
      const {taxRate,...fields}=dto;
      // A new category name is added to the list; an existing one keeps its original spelling.
      const name=dto.category.trim();
      const category=await tx.expenseCategory.upsert({where:{branchId_name:{branchId,name}},create:{businessId,branchId,name},update:{}});
      return tx.expense.create({data:{...fields,description:dto.description.trim(),category:category.name,expenseDate:new Date(dto.expenseDate),businessId,branchId,createdById:userId,taxAmount:totals.taxTotal,total:totals.grandTotal}});
    });
    await this.audit.log({businessId,branchId,userId,action:'EXPENSE_CREATED',entityType:'Expense',entityId:record.id});
    return record;
  }
  async cancelExpense(id:string,userId:string,businessId:string,branchId:string) {
    const result=await this.prisma.expense.updateMany({where:{id,businessId,branchId},data:{status:'CANCELLED'}});
    if(!result.count) throw new NotFoundException('Expense not found');
    await this.audit.log({businessId,branchId,userId,action:'EXPENSE_CANCELLED',entityType:'Expense',entityId:id});
    return {success:true};
  }
  /** Categories with the total and count of their active (not cancelled) expenses. */
  async expenseCategories(businessId:string,branchId:string|undefined,page:PaginationQueryDto) {
    const scope={businessId,...(branchId?{branchId}:{})};
    const [categories,totals]=await Promise.all([
      this.prisma.expenseCategory.findMany({where:scope,orderBy:[{name:'asc'},{id:'asc'}],take:page.limit,skip:page.offset}),
      this.prisma.expense.groupBy({by:['branchId','category'],where:{...scope,status:'ISSUED'},_sum:{total:true},_count:{_all:true}}),
    ]);
    // Category names match case-insensitively, as the database collation does.
    return categories.map((category)=>{
      const match=totals.find((row)=>row.branchId===category.branchId&&row.category.toLowerCase()===category.name.toLowerCase());
      return {...category,total:Number(match?._sum.total??0),count:match?._count._all??0};
    });
  }
  async createExpenseCategory(dto:ExpenseCategoryDto,userId:string,businessId:string,branchId:string) {
    const name=dto.name.trim();
    if(await this.prisma.expenseCategory.findFirst({where:{branchId,name}})) throw new ConflictException(`"${name}" already exists`);
    const category=await this.prisma.expenseCategory.create({data:{businessId,branchId,name}});
    await this.audit.log({businessId,branchId,userId,action:'EXPENSE_CATEGORY_CREATED',entityType:'ExpenseCategory',entityId:category.id,metadata:{name}});
    return {...category,total:0,count:0};
  }
  /** Renames a category and every expense filed under it. */
  async renameExpenseCategory(id:string,dto:ExpenseCategoryDto,userId:string,businessId:string,branchId:string) {
    const name=dto.name.trim();
    const result=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      const category=await tx.expenseCategory.findFirst({where:{id,businessId,branchId}});
      if(!category) throw new NotFoundException('Category not found');
      if(await tx.expenseCategory.findFirst({where:{branchId,name,id:{not:id}}})) throw new ConflictException(`"${name}" already exists`);
      const moved=await tx.expense.updateMany({where:{businessId,branchId,category:category.name},data:{category:name}});
      return {category:await tx.expenseCategory.update({where:{id},data:{name}}),previous:category.name,moved:moved.count};
    });
    await this.audit.log({businessId,branchId,userId,action:'EXPENSE_CATEGORY_RENAMED',entityType:'ExpenseCategory',entityId:id,metadata:{from:result.previous,to:name,expenses:result.moved}});
    return result.category;
  }
  /** Deletes a category; its expenses must be moved to another category first, or in the same call with `moveTo`. */
  async deleteExpenseCategory(id:string,query:DeleteExpenseCategoryQueryDto,userId:string,businessId:string,branchId:string) {
    const result=await billingTransaction(this.prisma,async(tx)=>{
      await lockBillingRecord(tx,'branch',branchId);
      const category=await tx.expenseCategory.findFirst({where:{id,businessId,branchId}});
      if(!category) throw new NotFoundException('Category not found');
      const target=query.moveTo?await tx.expenseCategory.findFirst({where:{id:query.moveTo,businessId,branchId}}):null;
      if(query.moveTo&&(!target||target.id===id)) throw new BadRequestException('Choose a different category to move the expenses to');
      const used=await tx.expense.count({where:{businessId,branchId,category:category.name}});
      if(used&&!target) throw new BadRequestException(`${used} ${used===1?'expense uses':'expenses use'} this category. Choose a category to move ${used===1?'it':'them'} to.`);
      if(target) await tx.expense.updateMany({where:{businessId,branchId,category:category.name},data:{category:target.name}});
      await tx.expenseCategory.delete({where:{id}});
      return {name:category.name,movedTo:target?.name??null,moved:used};
    });
    await this.audit.log({businessId,branchId,userId,action:'EXPENSE_CATEGORY_DELETED',entityType:'ExpenseCategory',entityId:id,metadata:result});
    return {success:true,...result};
  }
}
