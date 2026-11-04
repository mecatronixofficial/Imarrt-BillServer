import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';

/** Lock mutable balances before reading them. All identifiers come from this fixed allow-list. */
export async function lockBillingRecord(tx: Prisma.TransactionClient, kind: 'branch' | 'invoice' | 'document' | 'party' | 'account', id: string) {
  const tables = { branch: 'branches', invoice: 'invoices', document: 'business_documents', party: 'customers', account: 'cash_accounts' };
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${Prisma.raw(tables[kind])} WHERE id = ${id} FOR UPDATE`);
  if (!rows.length) throw new NotFoundException('Record not found');
}
export async function billingTransaction<T>(prisma: PrismaService, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    // Reads after waiting for a row lock must see the transaction that released it.
    try { return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 15_000 }); }
    catch (error) { if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; }
  }
}
export type StockContext = { businessId:string; branchId:string; warehouseId?:string|null; sourceId?:string; kind:string; userId?:string };
export async function adjustStock(tx: Prisma.TransactionClient, lines: Array<{ itemId?: string | null; quantity: number }>, direction: 'increment' | 'decrement', allowNegative = true, context?: StockContext) {
  const quantities = new Map<string, Prisma.Decimal>();
  for (const line of lines) if (line.itemId) quantities.set(line.itemId, (quantities.get(line.itemId) ?? new Prisma.Decimal(0)).add(line.quantity));
  const ids = [...quantities.keys()].sort();
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM items WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  for (const id of ids) {
    const quantity = quantities.get(id)!;
    const signed = direction === 'increment' ? quantity : quantity.negated();
    if(context) {
      if(context.warehouseId) {
        const warehouse = await tx.warehouse.findFirst({where:{id:context.warehouseId,businessId:context.businessId,branchId:context.branchId}});
        if(!warehouse || (!warehouse.isActive && direction==='decrement')) throw new BadRequestException('Select an active godown in this branch');
        const stock=await tx.warehouseStock.findUnique({where:{itemId_warehouseId:{itemId:id,warehouseId:context.warehouseId}}});
        if(direction==='decrement' && !allowNegative && Number(stock?.quantity??0)<Number(quantity)) throw new BadRequestException('Insufficient stock in the selected godown');
        await tx.warehouseStock.upsert({where:{itemId_warehouseId:{itemId:id,warehouseId:context.warehouseId}},create:{itemId:id,warehouseId:context.warehouseId,quantity:signed},update:{quantity:{increment:signed}}});
      } else if(direction==='decrement' && !allowNegative) {
        const [item,allocated]=await Promise.all([tx.item.findUniqueOrThrow({where:{id},select:{stockQty:true}}),tx.warehouseStock.aggregate({where:{itemId:id},_sum:{quantity:true}})]);
        if(item.stockQty.sub(allocated._sum.quantity??0).lessThan(quantity)) throw new BadRequestException('Insufficient unallocated stock. Select the godown holding this item.');
      }
      await tx.stockMovement.create({data:{itemId:id,warehouseId:context.warehouseId,businessId:context.businessId,branchId:context.branchId,quantity:signed,kind:context.kind,sourceId:context.sourceId,createdById:context.userId}});
    }
    const updated = await tx.item.updateMany({ where: { id, ...(direction === 'decrement' && !allowNegative ? { stockQty: { gte: quantity } } : {}) }, data: { stockQty: { [direction]: quantity } } });
    if (updated.count !== 1) throw new BadRequestException('Insufficient stock. Refresh the item quantities and try again.');
  }
}
