import {Prisma} from '@prisma/client';
import {BadRequestException,Injectable,NotFoundException} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service.js';
import {adjustStock,billingTransaction,lockBillingRecord} from '../common/utils/billing-transaction.util.js';
import {getLogicalBranchIds} from '../common/utils/workspace-scope.util.js';
import {resolvePreferences} from '../businesses/business-preferences.js';
import {PaginationQueryDto} from '../common/dto/pagination-query.dto.js';
import {WarehouseDto,StockOperationDto} from './inventory.dto.js';
@Injectable()
export class InventoryService {
 constructor(private readonly prisma:PrismaService){}
 warehouses(businessId:string,branchId:string,page:PaginationQueryDto){return this.prisma.warehouse.findMany({where:{businessId,branchId},orderBy:[{name:'asc'},{id:'asc'}],take:page.limit,skip:page.offset});}
 createWarehouse(dto:WarehouseDto,businessId:string,branchId:string){return this.prisma.warehouse.create({data:{...dto,name:dto.name.trim(),businessId,branchId}});}
 async updateWarehouse(id:string,dto:WarehouseDto,businessId:string,branchId:string){
  const record=await this.prisma.warehouse.findFirst({where:{id,businessId,branchId}});if(!record)throw new NotFoundException('Godown not found');
  return this.prisma.warehouse.update({where:{id},data:{name:dto.name.trim(),address:dto.address}});
 }
 async removeWarehouse(id:string,businessId:string,branchId:string){
  return billingTransaction(this.prisma,async(tx)=>{
   const record=await tx.warehouse.findFirst({where:{id,businessId,branchId},include:{_count:{select:{invoices:true,documents:true,movements:true}},stocks:true}});
   if(!record)throw new NotFoundException('Godown not found');
   if(record.stocks.some((stock)=>!stock.quantity.isZero())||Object.values(record._count).some((count)=>count>0))throw new BadRequestException('Godowns with stock or linked transactions must be retained');
   await tx.warehouseStock.deleteMany({where:{warehouseId:id}});await tx.warehouse.delete({where:{id}});return {success:true};
  });
 }
 async summary(businessId:string,branchId:string,page:PaginationQueryDto){
  const branches=await getLogicalBranchIds(this.prisma,businessId,branchId);
  const items=await this.prisma.item.findMany({where:{branchId:{in:branches},deletedAt:null},include:{warehouseStocks:{include:{warehouse:{select:{businessId:true,name:true}}}}},orderBy:[{name:'asc'},{id:'asc'}],take:page.limit,skip:page.offset});
  return items.map((item)=>({id:item.id,name:item.name,unit:item.unit,quantity:item.stockQty,purchasePrice:item.purchasePrice,unallocated:item.stockQty.sub(item.warehouseStocks.reduce((sum,stock)=>sum.add(stock.quantity),new Prisma.Decimal(0))),stocks:item.warehouseStocks.filter((stock)=>stock.warehouse.businessId===businessId).map((stock)=>({warehouseId:stock.warehouseId,name:stock.warehouse.name,quantity:stock.quantity}))}));
 }
 movements(businessId:string,branchId:string,page:PaginationQueryDto){return this.prisma.stockMovement.findMany({where:{businessId,branchId},include:{item:{select:{name:true,unit:true}},warehouse:{select:{name:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:page.limit,skip:page.offset});}
 async operate(dto:StockOperationDto,userId:string,businessId:string,branchId:string){
  const branches=await getLogicalBranchIds(this.prisma,businessId,branchId);
  return billingTransaction(this.prisma,async(tx)=>{
   await lockBillingRecord(tx,'branch',branchId);
   const existing=await tx.stockOperation.findUnique({where:{branchId_requestId:{branchId,requestId:dto.requestId}}});if(existing)return existing;
   const item=await tx.item.findFirst({where:{id:dto.itemId,branchId:{in:branches},deletedAt:null}});if(!item)throw new NotFoundException('Item not found');
   if(dto.kind==='TRANSFER' && (!dto.warehouseId || dto.warehouseId===dto.fromWarehouseId))throw new BadRequestException('Select a different destination godown');
   const business=await tx.business.findUnique({where:{id:businessId},select:{preferences:true}});
   const allowNegative=resolvePreferences(business?.preferences).transaction.negativeStock;
   const operation=await tx.stockOperation.create({data:{requestId:dto.requestId,businessId,branchId,kind:dto.kind,notes:dto.notes,createdById:userId}});
   const context={businessId,branchId,sourceId:operation.id,kind:dto.kind==='TRANSFER'?'TRANSFER':'ADJUSTMENT',userId};
   const lines=[{itemId:item.id,quantity:dto.quantity}];
   if(dto.kind==='TRANSFER'){
    await adjustStock(tx,lines,'decrement',allowNegative,{...context,warehouseId:dto.fromWarehouseId});
    await adjustStock(tx,lines,'increment',allowNegative,{...context,warehouseId:dto.warehouseId});
   }else await adjustStock(tx,lines,dto.kind==='IN'?'increment':'decrement',allowNegative,{...context,warehouseId:dto.warehouseId});
   return operation;
  });
 }
}
