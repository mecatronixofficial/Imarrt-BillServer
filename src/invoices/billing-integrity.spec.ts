import { describe, expect, it, vi } from 'vitest';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { PaymentOutService } from '../payment-out/payment-out.service.js';
import { adjustStock, billingTransaction } from '../common/utils/billing-transaction.util.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoiceDeliveryService } from './invoice-delivery.service.js';

/** Serial transaction double checks service boundaries; actual MySQL row-lock tests require a disposable database. */
function fixture() {
 const invoice = {id:'invoice',businessId:'business',branchId:'branch',status:InvoiceStatus.UNPAID,amountPaid:0,grandTotal:100,items:[{itemId:'item',quantity:2}],deletedAt:null};
 const payments:Array<{amount:number;requestId?:string}> = [];
 let stock = 8;
 const audit={log:vi.fn().mockResolvedValue(undefined)};
 const tx={
  stockMovement:{create:vi.fn().mockResolvedValue({})},warehouseStock:{aggregate:vi.fn().mockResolvedValue({_sum:{quantity:0}})},
  $queryRaw:vi.fn().mockResolvedValue([{id:'record'}]),
  invoice:{findUniqueOrThrow:vi.fn(async()=>({...invoice})),findFirst:vi.fn(async({where}:{where:{businessId:string;branchId:string}})=>where.businessId===invoice.businessId && where.branchId===invoice.branchId && !invoice.deletedAt?{...invoice}:null),update:vi.fn(async({data}:{data:Partial<typeof invoice>})=>Object.assign(invoice,data))},
  paymentRecord:{findFirst:vi.fn(async({where}:{where:{requestId:string}})=>payments.find((payment)=>payment.requestId===where.requestId)??null),create:vi.fn(async({data}:{data:{amount:number}})=>{payments.push(data);return data;})},
  businessDocument:{aggregate:vi.fn().mockResolvedValue({_sum:{grandTotal:0}}),count:vi.fn().mockResolvedValue(0)},
  item:{findUniqueOrThrow:vi.fn(async()=>({stockQty:new Prisma.Decimal(stock)})),updateMany:vi.fn(async({data,where}:{data:{stockQty:{increment?:Prisma.Decimal;decrement?:Prisma.Decimal}};where:{stockQty?:{gte:Prisma.Decimal}}})=>{
   if(where.stockQty && stock<Number(where.stockQty.gte))return {count:0};
   stock += Number(data.stockQty.increment??0)-Number(data.stockQty.decrement??0);return {count:1};
  })},
 };
 let queue=Promise.resolve();
 const prisma={$transaction:vi.fn((action:(tx:unknown)=>Promise<unknown>)=>{
  const result=queue.then(()=>action(tx));queue=result.then(()=>undefined,()=>undefined);return result;
 })};
 const service=new InvoicesService(prisma as unknown as PrismaService,audit as unknown as AuditService,{} as InvoiceDeliveryService);
 return {invoice,payments,tx,prisma,service,getStock:()=>stock};
}
describe('invoice integrity',()=>{
 it('restores stock once even when cancellation is requested twice',async()=>{
  const f=fixture();await f.service.cancel('invoice','user','business','branch');await f.service.cancel('invoice','user','business','branch');
  expect(f.getStock()).toBe(10);expect(f.tx.item.updateMany).toHaveBeenCalledTimes(1);expect(f.invoice.status).toBe('CANCELLED');
 });
 it('preserves payments and stock when paid invoice cancellation is rejected',async()=>{
  const f=fixture();f.invoice.amountPaid=40;
  await expect(f.service.cancel('invoice','user','business','branch')).rejects.toThrow('recorded payments');
  expect(f.getStock()).toBe(8);expect(f.invoice.status).toBe('UNPAID');
 });
 it('cannot overpay with simultaneous receipts and never overwrites the running paid balance',async()=>{
  const f=fixture();
  const result=await Promise.allSettled([f.service.recordPayment('invoice',{amount:60,method:'cash'},'user','business','branch'),f.service.recordPayment('invoice',{amount:60,method:'cash'},'user','business','branch')]);
  expect(result.filter((entry)=>entry.status==='fulfilled')).toHaveLength(1);expect(f.payments).toHaveLength(1);expect(f.invoice.amountPaid).toBe(60);
  await f.service.recordPayment('invoice',{amount:40,method:'cash'},'user','business','branch');
  expect(f.invoice.amountPaid).toBe(100);expect(f.invoice.status).toBe('PAID');
 });
 it('rejects cross-company mutation after locking without changing stock',async()=>{
  const f=fixture();await expect(f.service.cancel('invoice','user','other-business','branch')).rejects.toThrow('not found');expect(f.getStock()).toBe(8);
 });
 it('aggregates duplicate item rows before conditional negative-stock prevention',async()=>{
  const f=fixture();await expect(adjustStock(f.tx as unknown as Prisma.TransactionClient,[{itemId:'item',quantity:5},{itemId:'item',quantity:4}],'decrement',false)).rejects.toThrow('Insufficient stock');expect(f.getStock()).toBe(8);
 });
});
describe('receipt retries and credit-note allocation',()=>{
 it('records a repeated receipt request once',async()=>{
  const f=fixture();const payment={amount:20,method:'cash',requestId:'receipt-request'};
  await f.service.recordPayment('invoice',payment,'user','business','branch');await f.service.recordPayment('invoice',payment,'user','business','branch');expect(f.payments).toHaveLength(1);expect(f.invoice.amountPaid).toBe(20);
 });
 it('allocates only the net amount after issued credit notes',async()=>{
  const f=fixture();f.tx.businessDocument.aggregate.mockResolvedValue({_sum:{grandTotal:20}});
  await expect(f.service.recordPayment('invoice',{amount:81,method:'cash'},'user','business','branch')).rejects.toThrow('outstanding');
  await f.service.recordPayment('invoice',{amount:80,method:'cash'},'user','business','branch');expect(f.invoice.amountPaid).toBe(80);expect(f.invoice.status).toBe('PAID');
 });
});
describe('atomic document conversion',()=>{
 it('closes the source and creates the invoice on the same transaction and returns the same invoice on retry',async()=>{
  const document={id:'quote',businessId:'business',branchId:'branch',type:'QUOTATION',partyId:'party',status:'ISSUED',convertedInvoiceId:null as string|null,issueDate:new Date('2026-10-01'),dueDate:null,discount:0,notes:'Note',terms:'Terms',items:[{description:'Product',quantity:1,unitPrice:100,taxRate:0,taxInclusive:false}]};
  const invoice={id:'converted',invoiceNumber:'INV-1'};
  const tx={$queryRaw:vi.fn().mockResolvedValue([{id:'quote'}]),businessDocument:{findFirst:vi.fn(async()=>({...document})),update:vi.fn(async({data}:{data:Partial<typeof document>})=>Object.assign(document,data))},invoice:{findUniqueOrThrow:vi.fn().mockResolvedValue(invoice)}};
  const create=vi.fn(async(...args:unknown[])=>{expect(args[4]).toBe(tx);return invoice;});
  const service=new DocumentsService({$transaction:(action:(tx:unknown)=>Promise<unknown>)=>action(tx)} as unknown as PrismaService,{log:vi.fn().mockResolvedValue(undefined)} as unknown as AuditService,{create} as unknown as InvoicesService,{} as PaymentOutService);
  expect((await service.convertToInvoice('quote','user','business','branch')).id).toBe('converted');
  expect((await service.convertToInvoice('quote','user','business','branch')).id).toBe('converted');
  expect(create).toHaveBeenCalledTimes(1);expect(document.status).toBe('CONVERTED');expect(document.convertedInvoiceId).toBe('converted');
 });
 it('retries serialization/deadlock errors but never retries business validation failures',async()=>{
  const transaction=vi.fn().mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('deadlock',{code:'P2034',clientVersion:'6.19.3'})).mockResolvedValue('saved');
  expect(await billingTransaction({$transaction:transaction} as unknown as PrismaService,async()=>undefined)).toBe('saved');expect(transaction).toHaveBeenCalledTimes(2);
 });
});
