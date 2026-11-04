import {describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {InvoicesService} from './invoices.service.js';
import type {PrismaService} from '../prisma/prisma.service.js';
import type {AuditService} from '../common/utils/audit.service.js';
import type {InvoiceDeliveryService} from './invoice-delivery.service.js';
function fixture(){
 let stock=10;let records:any[]=[];let movements:any[]=[];
 const party={id:'party',creditLimit:0,openingBalance:0,openingBalanceType:'RECEIVABLE',invoiceDeliveryMode:'MANUAL',invoiceDeliveryChannel:'EMAIL'};
 const business={id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false}}};
 const tx:any={
  $queryRaw:vi.fn().mockResolvedValue([{id:'row'}]),
  business:{findFirst:vi.fn().mockResolvedValue({workspaceBranchId:null}),findUnique:vi.fn().mockResolvedValue(business),findUniqueOrThrow:vi.fn().mockResolvedValue(business)},
  branch:{findMany:vi.fn().mockResolvedValue([{id:'branch'}]),findFirst:vi.fn().mockResolvedValue({id:'branch',code:'MAIN',isActive:true})},
  party:{findFirst:vi.fn().mockResolvedValue(party),findUniqueOrThrow:vi.fn().mockResolvedValue(party)},
  item:{count:vi.fn().mockResolvedValue(1),findUniqueOrThrow:vi.fn(async()=>({stockQty:new Prisma.Decimal(stock)})),updateMany:vi.fn(async({where,data}:any)=>{if(where.stockQty&&stock<Number(where.stockQty.gte))return {count:0};stock+=Number(data.stockQty.increment??0)-Number(data.stockQty.decrement??0);return {count:1};})},
  warehouseStock:{aggregate:vi.fn().mockResolvedValue({_sum:{quantity:0}})},stockMovement:{create:vi.fn(async({data}:any)=>{movements.push(data);return data;})},
  businessDocument:{count:vi.fn().mockResolvedValue(0),aggregate:vi.fn().mockResolvedValue({_sum:{grandTotal:0}})},
  invoice:{
   count:vi.fn(async()=>records.length),
   findFirst:vi.fn(async({where}:any)=>records.find((record)=>(!where.id||record.id===where.id)&&(!where.requestId||record.requestId===where.requestId))??null),
   aggregate:vi.fn(async()=>({_sum:{grandTotal:records.reduce((sum,record)=>sum+record.grandTotal,0),amountPaid:records.reduce((sum,record)=>sum+record.amountPaid,0)}})),
   create:vi.fn(async({data}:any)=>{const record={...data,id:'invoice-'+(records.length+1),items:data.items.create,party};records.push(record);return record;}),
   update:vi.fn(async({where,data}:any)=>{const record=records.find((entry)=>entry.id===where.id);Object.assign(record,{...data,items:data.items?data.items.create:record.items});return record;}),
  },
 };
 tx.$transaction=async(action:(transaction:unknown)=>Promise<unknown>)=>{const snapshot={stock,records:records.map((record)=>({...record,items:[...record.items]})),movements:[...movements]};try{return await action(tx);}catch(error){stock=snapshot.stock;records=snapshot.records;movements=snapshot.movements;throw error;}};
 const audit={log:vi.fn().mockResolvedValue(undefined)};
 const service=new InvoicesService(tx as PrismaService,audit as unknown as AuditService,{deliver:vi.fn()} as unknown as InvoiceDeliveryService);
 const draft=(quantity=1)=>({partyId:'party',issueDate:'2026-10-31',items:[{itemId:'item',description:'Product',quantity,unitPrice:100,taxRate:0}]});
 return {service,draft,party,tx,audit,stock:()=>stock,records:()=>records,movements:()=>movements};
}
describe('invoice save and edit lifecycle',()=>{
 it('retains tracking metadata across save and unpaid edit without affecting money or stock',async()=>{
  const f=fixture();const tracking={brand:'IMC',lotNo:'LOT-7',barcode:'890123',serialNumbers:'SN-1',mrp:199.99,count:2.125,size:'M'};
  const payload={...f.draft(),items:[{...f.draft().items[0],...tracking}]};
  const saved=await f.service.create(payload,'user','business','branch');expect(saved.items[0]).toMatchObject(tracking);expect(Number(saved.grandTotal)).toBe(100);expect(f.stock()).toBe(9);
  await f.service.update(saved.id,{...payload,items:[{...payload.items[0],lotNo:'LOT-8'}]},'user','business','branch');expect(f.records()[0].items[0]).toMatchObject({...tracking,lotNo:'LOT-8'});expect(f.stock()).toBe(9);
 });
 it('replays a timed-out create without a duplicate invoice, stock deduction, or created audit',async()=>{
  const f=fixture();const payload={...f.draft(),requestId:'request'};
  const a=await f.service.create(payload,'user','business','branch');const b=await f.service.create(payload,'user','business','branch');
  expect(a.id).toBe(b.id);expect(f.records()).toHaveLength(1);expect(f.stock()).toBe(9);expect(f.movements()).toHaveLength(1);expect(f.audit.log).toHaveBeenCalledTimes(1);
 });
 it('saves a draft without posting stock and issues it using the same invoice identity',async()=>{
  const f=fixture();const saved=await f.service.create({...f.draft(2),status:'DRAFT'},'user','business','branch');expect(f.stock()).toBe(10);expect(saved.status).toBe('DRAFT');
  const issued=await f.service.update(saved.id,{...f.draft(2),status:'UNPAID',requestId:'issue'},'user','business','branch');expect(issued.id).toBe(saved.id);expect(issued.status).toBe('UNPAID');expect(f.stock()).toBe(8);expect(f.records()).toHaveLength(1);
 });
 it('edits item quantities by reversing and reposting stock and does not repost on request retry',async()=>{
  const f=fixture();const saved=await f.service.create(f.draft(2),'user','business','branch');
  const update={...f.draft(3),requestId:'edit'};await f.service.update(saved.id,update,'user','business','branch');await f.service.update(saved.id,update,'user','business','branch');
  expect(f.stock()).toBe(7);expect(f.records()).toHaveLength(1);expect(f.movements()).toHaveLength(3);
 });
 it('rolls back invoice and stock when an edit requires unavailable inventory',async()=>{
  const f=fixture();const saved=await f.service.create(f.draft(2),'user','business','branch');
  await expect(f.service.update(saved.id,f.draft(20),'user','business','branch')).rejects.toThrow(/Insufficient.*stock/);
  expect(f.stock()).toBe(8);expect(f.records()[0].items[0].quantity).toBe(2);
 });
 it('rejects edits to paid invoices without touching stock',async()=>{
  const f=fixture();const saved=await f.service.create({...f.draft(),initialPayment:{amount:100,method:'cash'}},'user','business','branch');
  await expect(f.service.update(saved.id,f.draft(2),'user','business','branch')).rejects.toThrow('Only unpaid');expect(f.stock()).toBe(9);
 });
 it('enforces configured customer credit limits before posting a sale',async()=>{
  const f=fixture();f.party.creditLimit=50;await expect(f.service.create(f.draft(),'user','business','branch')).rejects.toThrow('credit limit');expect(f.records()).toHaveLength(0);expect(f.stock()).toBe(10);
 });
});

describe('initial receipt timestamps', () => {
 it('preserves an explicit initial payment date and time when creating an invoice', async () => {
  const f = fixture();
  const paidAt = '2026-10-30T13:15:00.000Z';
  await f.service.create({ ...f.draft(), initialPayment: { amount: 40, method: 'cash', paidAt } }, 'user', 'business', 'branch');
  expect(f.tx.invoice.create.mock.calls[0][0].data.payments.create.paidAt.toISOString()).toBe(paidAt);
 });
 it('preserves an explicit receipt date and time when issuing a draft with an initial payment', async () => {
  const f = fixture();
  const draft = await f.service.create({ ...f.draft(), status: 'DRAFT' }, 'user', 'business', 'branch');
  const paidAt = '2026-10-31T09:45:00.000Z';
  await f.service.update(draft.id, { ...f.draft(), initialPayment: { amount: 40, method: 'cash', paidAt } }, 'user', 'business', 'branch');
  expect(f.tx.invoice.update.mock.calls[0][0].data.payments.create.paidAt.toISOString()).toBe(paidAt);
 });
});
