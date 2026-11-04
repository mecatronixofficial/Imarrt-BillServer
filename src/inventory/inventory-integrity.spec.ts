import {describe,expect,it,vi} from 'vitest';
import {Prisma} from '@prisma/client';
import {InventoryService} from './inventory.service.js';
import type {PrismaService} from '../prisma/prisma.service.js';
function fixture(){
 let total=10;let locations=new Map([['source',5],['destination',0]]);let operations=new Map<string,{id:string}>();let movements:Array<{quantity:Prisma.Decimal}>=[];
 const tx={
  $queryRaw:vi.fn().mockResolvedValue([{id:'record'}]),
  business:{findUnique:vi.fn().mockResolvedValue({preferences:{transaction:{negativeStock:false}}})},
  item:{findFirst:vi.fn().mockResolvedValue({id:'item'}),findUniqueOrThrow:vi.fn(async()=>({stockQty:new Prisma.Decimal(total)})),updateMany:vi.fn(async({data}:{data:{stockQty:{increment?:Prisma.Decimal;decrement?:Prisma.Decimal}}})=>{total+=Number(data.stockQty.increment??0)-Number(data.stockQty.decrement??0);return {count:1};})},
  warehouse:{findFirst:vi.fn(async({where}:{where:{id:string}})=>locations.has(where.id)?{id:where.id,isActive:true}:null)},
  warehouseStock:{findUnique:vi.fn(async({where}:{where:{itemId_warehouseId:{warehouseId:string}}})=>({quantity:new Prisma.Decimal(locations.get(where.itemId_warehouseId.warehouseId)??0)})),aggregate:vi.fn(async()=>({_sum:{quantity:[...locations.values()].reduce((a,b)=>a+b,0)}})),upsert:vi.fn(async({where,update}:{where:{itemId_warehouseId:{warehouseId:string}};update:{quantity:{increment:Prisma.Decimal}}})=>{const id=where.itemId_warehouseId.warehouseId;locations.set(id,(locations.get(id)??0)+Number(update.quantity.increment));})},
  stockMovement:{create:vi.fn(async({data}:{data:{quantity:Prisma.Decimal}})=>{movements.push(data);return data;})},
  stockOperation:{findUnique:vi.fn(async({where}:{where:{branchId_requestId:{requestId:string}}})=>operations.get(where.branchId_requestId.requestId)??null),create:vi.fn(async({data}:{data:{requestId:string}})=>{const record={id:'operation'};operations.set(data.requestId,record);return record;})},
 };
 const prisma={business:{findFirst:vi.fn().mockResolvedValue({workspaceBranchId:null})},branch:{findMany:vi.fn().mockResolvedValue([{id:'branch'}])},$transaction:async(action:(tx:unknown)=>Promise<unknown>)=>{
  const snapshot={total,locations:new Map(locations),operations:new Map(operations),movements:[...movements]};
  try{return await action(tx);}catch(error){total=snapshot.total;locations=snapshot.locations;operations=snapshot.operations;movements=snapshot.movements;throw error;}
 }};
 return {service:new InventoryService(prisma as unknown as PrismaService),total:()=>total,location:(id:string)=>locations.get(id),movements:()=>movements};
}
describe('warehouse stock transfer workflow',()=>{
 it('moves quantities between godowns without changing total item stock and returns the same result on retry',async()=>{
  const f=fixture();const dto={requestId:'request',itemId:'item',kind:'TRANSFER',quantity:3,fromWarehouseId:'source',warehouseId:'destination'};
  await f.service.operate(dto,'user','business','branch');await f.service.operate(dto,'user','business','branch');
  expect(f.total()).toBe(10);expect(f.location('source')).toBe(2);expect(f.location('destination')).toBe(3);expect(f.movements()).toHaveLength(2);
 });
 it('rolls back the entire transfer when the destination is outside the selected branch',async()=>{
  const f=fixture();await expect(f.service.operate({requestId:'request',itemId:'item',kind:'TRANSFER',quantity:2,fromWarehouseId:'source',warehouseId:'foreign'},'user','business','branch')).rejects.toThrow(/godown/i);
  expect(f.total()).toBe(10);expect(f.location('source')).toBe(5);expect(f.movements()).toHaveLength(0);
 });
 it('cannot withdraw stock that exists only in a different godown',async()=>{
  const f=fixture();await expect(f.service.operate({requestId:'request',itemId:'item',kind:'OUT',quantity:6,warehouseId:'source'},'user','business','branch')).rejects.toThrow('Insufficient stock');expect(f.total()).toBe(10);
 });
 it('cannot consume allocated stock by leaving the godown blank',async()=>{
  const f=fixture();await expect(f.service.operate({requestId:'request',itemId:'item',kind:'OUT',quantity:6},'user','business','branch')).rejects.toThrow('Insufficient unallocated stock');expect(f.total()).toBe(10);
 });
});
