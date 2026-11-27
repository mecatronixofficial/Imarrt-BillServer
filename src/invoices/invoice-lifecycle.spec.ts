import {describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {InvoicesService} from './invoices.service.js';
import type {PrismaService} from '../prisma/prisma.service.js';
import type {AuditService} from '../common/utils/audit.service.js';
import type {InvoiceDeliveryService} from './invoice-delivery.service.js';
function fixture(){
 let stock=10;let records:any[]=[];let movements:any[]=[];let sequences=new Map<string,number>();
 const party={id:'party',creditLimit:0,openingBalance:0,openingBalanceType:'RECEIVABLE',invoiceDeliveryMode:'MANUAL',invoiceDeliveryChannel:'EMAIL'};
 const business={id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false}}};
 const tx:any={
  $queryRaw:vi.fn().mockResolvedValue([{id:'row'}]),
  business:{findFirst:vi.fn().mockResolvedValue({workspaceBranchId:null}),findUnique:vi.fn().mockResolvedValue(business),findUniqueOrThrow:vi.fn().mockResolvedValue(business)},
  branch:{findMany:vi.fn().mockResolvedValue([{id:'branch',code:'MAIN'}]),findFirst:vi.fn().mockResolvedValue({id:'branch',code:'MAIN',isActive:true})},
  party:{findFirst:vi.fn().mockResolvedValue(party),findUniqueOrThrow:vi.fn().mockResolvedValue(party)},
  item:{count:vi.fn().mockResolvedValue(1),findUniqueOrThrow:vi.fn(async()=>({stockQty:new Prisma.Decimal(stock)})),updateMany:vi.fn(async({where,data}:any)=>{if(where.stockQty&&stock<Number(where.stockQty.gte))return {count:0};stock+=Number(data.stockQty.increment??0)-Number(data.stockQty.decrement??0);return {count:1};})},
  warehouseStock:{aggregate:vi.fn().mockResolvedValue({_sum:{quantity:0}})},stockMovement:{create:vi.fn(async({data}:any)=>{movements.push(data);return data;})},
  businessDocument:{count:vi.fn().mockResolvedValue(0),aggregate:vi.fn().mockResolvedValue({_sum:{grandTotal:0}})},
  invoiceNumberSequence:{findUnique:vi.fn(async({where}:any)=>{const key=where.businessId_prefix.businessId+"|"+where.businessId_prefix.prefix;return sequences.has(key)?{lastNumber:sequences.get(key)}:null;}),create:vi.fn(async({data}:any)=>{sequences.set(data.businessId+"|"+data.prefix,data.lastNumber);return data;}),update:vi.fn(async({where,data}:any)=>{sequences.set(where.businessId_prefix.businessId+"|"+where.businessId_prefix.prefix,data.lastNumber);return data;})},
  invoice:{
   count:vi.fn(async({where}:any={})=>records.filter((record)=>(!where?.invoiceNumber||record.invoiceNumber===where.invoiceNumber)&&(!where?.id?.not||record.id!==where.id.not)).length),
   findMany:vi.fn(async()=>records.map(({invoiceNumber})=>({invoiceNumber}))),
   findFirst:vi.fn(async({where}:any)=>records.find((record)=>(!where.id||record.id===where.id)&&(!where.requestId||record.requestId===where.requestId))??null),
   aggregate:vi.fn(async()=>({_sum:{grandTotal:records.reduce((sum,record)=>sum+record.grandTotal,0),amountPaid:records.reduce((sum,record)=>sum+record.amountPaid,0)}})),
   create:vi.fn(async({data}:any)=>{const record={...data,id:'invoice-'+(records.length+1),items:data.items.create,party};records.push(record);return record;}),
   update:vi.fn(async({where,data}:any)=>{const record=records.find((entry)=>entry.id===where.id);Object.assign(record,{...data,items:data.items?data.items.create:record.items});return record;}),
  },
 };
 tx.$transaction=async(action:(transaction:unknown)=>Promise<unknown>)=>{const snapshot={stock,records:records.map((record)=>({...record,items:[...record.items]})),movements:[...movements],sequences:new Map(sequences)};try{return await action(tx);}catch(error){stock=snapshot.stock;records=snapshot.records;movements=snapshot.movements;sequences=snapshot.sequences;throw error;}};
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
describe('company-wise invoice numbering',()=>{
 it('gives each saved invoice the next number of the company sequence and finalizes it on save',async()=>{
  const f=fixture();
  const preview=await f.service.nextInvoiceNumber('business','2026-10-31');expect(preview).toMatchObject({invoiceNumber:'INV-01',manual:false});
  const a=await f.service.create(f.draft(),'user','business','branch');const b=await f.service.create(f.draft(),'user','business','branch');
  expect([a.invoiceNumber,b.invoiceNumber]).toEqual(['INV-01','INV-02']);
  expect((await f.service.nextInvoiceNumber('business','2026-10-31')).invoiceNumber).toBe('INV-03');
 });
 it('uses the company prefix template with the invoice date and keeps saved numbers on edit',async()=>{
  const f=fixture();f.tx.business.findUnique.mockResolvedValue({id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false,invoicePrefix:'SV/{FY}/'}}});
  const saved=await f.service.create({...f.draft(),issueDate:'2027-02-10'},'user','business','branch');expect(saved.invoiceNumber).toBe('SV/26-27/01');
  await f.service.update(saved.id,{...f.draft(),invoiceNumber:'OTHER-1'},'user','business','branch');expect(f.records()[0].invoiceNumber).toBe('SV/26-27/01');
 });
 it('continues after legacy branch-prefixed numbers and skips numbers already used in the company',async()=>{
  const f=fixture();f.records().push({id:'old',invoiceNumber:'MAIN-INV-07',items:[],grandTotal:0,amountPaid:0},{id:'manual',invoiceNumber:'INV-08',items:[],grandTotal:0,amountPaid:0});
  f.tx.branch.findMany.mockResolvedValue([{id:'branch',code:'MAIN'}]);
  const saved=await f.service.create(f.draft(),'user','business','branch');expect(saved.invoiceNumber).toBe('INV-09');
 });
 it('rejects a manual number already used in the same company',async()=>{
  const f=fixture();const manual={id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false,autoNumbering:false}}};f.tx.business.findUnique.mockResolvedValue(manual);
  await f.service.create({...f.draft(),invoiceNumber:'A-1'},'user','business','branch');
  await expect(f.service.create({...f.draft(),invoiceNumber:'A-1'},'user','business','branch')).rejects.toThrow(/already used in this company/);
  expect(f.records()).toHaveLength(1);
 });
});
describe('invoice number digits',()=>{
 it('pads to the company digit setting and keeps counting past it',async()=>{
  const f=fixture();f.tx.business.findUnique.mockResolvedValue({id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false,invoicePrefix:'INV-',invoiceNumberDigits:3}}});
  f.records().push({id:'old',invoiceNumber:'INV-999',items:[],grandTotal:0,amountPaid:0});
  expect((await f.service.nextInvoiceNumber('business','2026-10-31')).invoiceNumber).toBe('INV-1000');
 });
});
describe('tax for every company',()=>{
 it('charges the typed tax rate even when the company is not GST-registered',async()=>{
  const f=fixture();
  const saved=await f.service.create({...f.draft(),roundOff:false,items:[{...f.draft().items[0],taxRate:12.5}]},'user','business','branch');
  expect(Number(saved.taxTotal)).toBe(12.5);expect(Number(saved.grandTotal)).toBe(112.5);
 });
});
describe('round off',()=>{
 const taxed=(f:ReturnType<typeof fixture>)=>({...f.draft(),items:[{...f.draft().items[0],taxRate:12.5}]});
 it('is on by default, rounds the grand total once and stores the choice',async()=>{
  const f=fixture();const saved=await f.service.create(taxed(f),'user','business','branch');
  expect(Number(saved.grandTotal)).toBe(113);expect(f.records()[0].roundOff).toBe(true);
  expect(Number(saved.subTotal)+Number(saved.taxTotal)).toBe(112.5);
 });
 it('keeps the exact decimal total when turned off',async()=>{
  const f=fixture();const saved=await f.service.create({...taxed(f),roundOff:false},'user','business','branch');
  expect(Number(saved.grandTotal)).toBe(112.5);expect(f.records()[0].roundOff).toBe(false);
 });
 it('keeps the saved choice when an edit does not send one',async()=>{
  const f=fixture();const saved=await f.service.create({...taxed(f),roundOff:false},'user','business','branch');
  await f.service.update(saved.id,taxed(f),'user','business','branch');
  expect(Number(f.records()[0].grandTotal)).toBe(112.5);expect(f.records()[0].roundOff).toBe(false);
  await f.service.update(saved.id,{...taxed(f),roundOff:true},'user','business','branch');
  expect(Number(f.records()[0].grandTotal)).toBe(113);expect(f.records()[0].roundOff).toBe(true);
 });
 it('follows a company that turned round off off by default',async()=>{
  const f=fixture();f.tx.business.findUnique.mockResolvedValue({id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false,autoRoundOff:false}}});
  f.tx.business.findUniqueOrThrow.mockResolvedValue({id:'business',gstRegistered:false,preferences:{transaction:{negativeStock:false,autoRoundOff:false}}});
  const saved=await f.service.create(taxed(f),'user','business','branch');expect(Number(saved.grandTotal)).toBe(112.5);
 });
});
