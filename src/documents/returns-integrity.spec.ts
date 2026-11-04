import { describe, expect, it, vi } from 'vitest';
import { DocumentStatus, DocumentType, Prisma } from '@prisma/client';
import { DocumentsService } from './documents.service.js';
import type { PaymentOutService } from '../payment-out/payment-out.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoicesService } from '../invoices/invoices.service.js';
function setup(type:DocumentType, returnStock=false) {
 const document={id:'document',businessId:'business',branchId:'branch',type,status:DocumentStatus.DRAFT as DocumentStatus,stockAdjusted:false,returnStock,paidAmount:new Prisma.Decimal(0),grandTotal:new Prisma.Decimal(100),referenceInvoiceId:'invoice',sourceDocumentId:'purchase',partyId:'party',items:[{itemId:'item',description:'Product',quantity:new Prisma.Decimal(2)}]};
 const source={id:'invoice',businessId:'business',status:'UNPAID',grandTotal:new Prisma.Decimal(100),items:[{itemId:'item',description:'Product',quantity:new Prisma.Decimal(2)}]};
 const previous:Array<{grandTotal:Prisma.Decimal;returnStock:boolean;items:typeof document.items}>=[];
 let stock=5;
 const tx={
  stockMovement:{create:vi.fn().mockResolvedValue({})},warehouseStock:{aggregate:vi.fn().mockResolvedValue({_sum:{quantity:0}})},
  $queryRaw:vi.fn().mockResolvedValue([{id:'row'}]),business:{findUnique:vi.fn().mockResolvedValue({preferences:{transaction:{negativeStock:false}}})},
  invoice:{findFirst:vi.fn().mockResolvedValue(source)},
  businessDocument:{findFirst:vi.fn(async()=>({...document})),findMany:vi.fn(async()=>previous),count:vi.fn().mockResolvedValue(0),update:vi.fn(async({data}:{data:Partial<typeof document>})=>Object.assign(document,data))},
  item:{findUniqueOrThrow:vi.fn(async()=>({stockQty:new Prisma.Decimal(stock)})),updateMany:vi.fn(async({where,data}:{where:{stockQty?:{gte:Prisma.Decimal}};data:{stockQty:{increment?:Prisma.Decimal;decrement?:Prisma.Decimal}}})=>{if(where.stockQty && stock<Number(where.stockQty.gte))return {count:0};stock+=Number(data.stockQty.increment??0)-Number(data.stockQty.decrement??0);return {count:1};})},
 };
 const service=new DocumentsService({$transaction:(action:(tx:unknown)=>Promise<unknown>)=>action(tx)} as unknown as PrismaService,{log:vi.fn().mockResolvedValue(undefined)} as unknown as AuditService,{} as InvoicesService,{} as PaymentOutService);
 return {document,source,previous,tx,service,getStock:()=>stock};
}
describe('goods return and purchase reversal workflows',()=>{
 it('issues a physical sales return once and cancels it once',async()=>{
  const f=setup(DocumentType.CREDIT_NOTE,true);
  await f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch');
  await f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch');
  expect(f.getStock()).toBe(7);
  await f.service.updateStatus('document',DocumentStatus.CANCELLED,'user','business','branch');
  await f.service.updateStatus('document',DocumentStatus.CANCELLED,'user','business','branch');
  expect(f.getStock()).toBe(5);expect(f.tx.item.updateMany).toHaveBeenCalledTimes(2);
 });
 it('does not restock financial-only credit notes',async()=>{
  const f=setup(DocumentType.CREDIT_NOTE,false);await f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch');expect(f.getStock()).toBe(5);
 });
 it('rejects cumulative returns above source value before changing stock',async()=>{
  const f=setup(DocumentType.CREDIT_NOTE,true);f.previous.push({grandTotal:new Prisma.Decimal(10),returnStock:false,items:[]});
  await expect(f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch')).rejects.toThrow('Cumulative returns');expect(f.getStock()).toBe(5);
 });
 it('rejects physical return quantities above the original quantity',async()=>{
  const f=setup(DocumentType.CREDIT_NOTE,true);f.document.items[0].quantity=new Prisma.Decimal(3);
  await expect(f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch')).rejects.toThrow('Returned quantities');expect(f.getStock()).toBe(5);
 });
 it('prevents a purchase cancellation from taking stock below zero',async()=>{
  const f=setup(DocumentType.PURCHASE_INVOICE);f.document.status=DocumentStatus.ISSUED;f.document.stockAdjusted=true;f.document.items[0].quantity=new Prisma.Decimal(6);
  await expect(f.service.updateStatus('document',DocumentStatus.CANCELLED,'user','business','branch')).rejects.toThrow(/Insufficient.*stock/);expect(f.getStock()).toBe(5);
 });
 it('posts dispatch stock when a delivery challan is issued',async()=>{
  const f=setup(DocumentType.DELIVERY_CHALLAN);await f.service.updateStatus('document',DocumentStatus.ISSUED,'user','business','branch');expect(f.getStock()).toBe(3);expect(f.document.stockAdjusted).toBe(true);
 });
});
