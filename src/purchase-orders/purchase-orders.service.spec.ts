import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { DocumentsService } from '../documents/documents.service.js';

vi.mock('../common/utils/workspace-scope.util.js', () => ({ getLogicalBranchIds: async () => ['branch'] }));

const SUPPLIER = '00000000-0000-4000-8000-000000000001';
const line = { description: ' Steel rod ', quantity: 2, unitPrice: 100, taxRate: 18 };

function fixture() {
  const orders: any[] = [];
  const matches = (order: any, where: any) => Object.entries(where).every(([key, value]: any) => {
    if (value && typeof value === 'object' && 'startsWith' in value) return String(order[key]).startsWith(value.startsWith);
    if (value && typeof value === 'object' && 'not' in value) return order[key] !== value.not;
    return order[key] === value;
  });
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    supplier: { findFirst: vi.fn(async () => ({ id: SUPPLIER })) },
    item: { count: vi.fn(async () => 0) },
    business: { findUnique: vi.fn(async () => ({ preferences: null })) },
    warehouse: { findFirst: vi.fn(async () => ({ id: 'godown' })) },
    cashAccount: { findFirst: vi.fn(async () => ({ id: 'account' })) },
    businessDocument: { findUniqueOrThrow: vi.fn() },
    businessDocumentAttachment: { create: vi.fn(async ({ data }: any) => data) },
    purchaseOrder: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const found = orders.filter((order) => matches(order, where));
        if (orderBy?.orderNumber === 'desc') found.sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));
        return found[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => { const order = { id: `o${orders.length + 1}`, convertedDocumentId: null, ...data, items: data.items.create }; orders.push(order); return order; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(orders.find(({ id }) => id === where.id), { ...data, items: data.items?.create ?? undefined })),
      delete: vi.fn(async ({ where }: any) => orders.splice(orders.findIndex(({ id }) => id === where.id), 1)),
    },
  };
  const prisma: any = { ...tx, $transaction: (action: (client: any) => Promise<unknown>) => action(tx) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const documents = { create: vi.fn(async () => ({ id: 'bill', documentNumber: 'PUR-2026-000001' })) };
  return { tx, orders, audit, documents, service: new PurchaseOrdersService(prisma as PrismaService, audit as unknown as AuditService, documents as unknown as DocumentsService) };
}

describe('purchase orders', () => {
  it('numbers orders automatically per year when no number is typed, and keeps typed ones unique', async () => {
    const f = fixture();
    const first = await f.service.create({ supplierId: SUPPLIER, orderDate: '2026-11-03', items: [line] }, 'user', 'business', 'branch');
    const second = await f.service.create({ supplierId: SUPPLIER, orderDate: '2026-11-04', status: 'SENT', items: [line] }, 'user', 'business', 'branch');
    expect([first.orderNumber, second.orderNumber]).toEqual(['PORD-2026-000001', 'PORD-2026-000002']);
    expect(first.status).toBe(PurchaseOrderStatus.DRAFT);
    expect(second.status).toBe(PurchaseOrderStatus.SENT);
    await expect(f.service.create({ supplierId: SUPPLIER, orderNumber: 'PORD-2026-000001', items: [line] }, 'user', 'business', 'branch')).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits an open order and re-prices it, but not one already billed or cancelled', async () => {
    const f = fixture();
    const order = await f.service.create({ supplierId: SUPPLIER, items: [line] }, 'user', 'business', 'branch');
    const edited = await f.service.update(order.id, { supplierId: SUPPLIER, items: [{ ...line, quantity: 5 }], notes: '  Rush  ' }, 'user', 'business', 'branch');
    expect(Number(edited.subTotal)).toBe(500);
    expect(edited).toMatchObject({ orderNumber: order.orderNumber, notes: 'Rush' });
    f.orders[0].status = PurchaseOrderStatus.CANCELLED;
    await expect(f.service.update(order.id, { supplierId: SUPPLIER, items: [line] }, 'user', 'business', 'branch')).rejects.toThrow('can be edited');
  });

  it('deletes an order unless it became a purchase bill', async () => {
    const f = fixture();
    const billed = await f.service.create({ supplierId: SUPPLIER, items: [line] }, 'user', 'business', 'branch');
    const spare = await f.service.create({ supplierId: SUPPLIER, items: [line] }, 'user', 'business', 'branch');
    f.orders[0].convertedDocumentId = 'bill';
    await expect(f.service.remove(billed.id, 'user', 'business', 'branch')).rejects.toThrow('kept as a record');
    await f.service.remove(spare.id, 'user', 'business', 'branch');
    expect(f.orders.map(({ id }) => id)).toEqual([billed.id]);
    expect(f.audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'PURCHASE_ORDER_DELETED' }));
  });

  it('keeps the bill-style details and hands them, with attachments, to the purchase bill on conversion', async () => {
    const f = fixture();
    const order = await f.service.create({
      supplierId: SUPPLIER, items: [line], warehouseId: '00000000-0000-4000-8000-0000000000a1', placeOfSupply: 'Tamil Nadu',
      transportName: ' VRL ', noOfBags: 4, lrNumber: 'LR-9', paymentMethod: 'bank_transfer', paymentReference: ' UTR ', roundOff: true,
    }, 'user', 'business', 'branch');
    expect(order).toMatchObject({ placeOfSupply: 'Tamil Nadu', transportName: 'VRL', noOfBags: 4, paymentMethod: 'bank_transfer', paymentReference: 'UTR', roundOff: true });

    f.orders[0].attachments = [{ kind: 'IMAGE', fileName: 'quote.jpg', mimeType: 'image/jpeg', size: 10, data: new Uint8Array(10) }];
    await f.service.convertToBill(order.id, 'user', 'business', 'branch');
    expect(f.documents.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PURCHASE_INVOICE', placeOfSupply: 'Tamil Nadu', transportName: 'VRL', noOfBags: 4, lrNumber: 'LR-9', roundOff: true, warehouseId: '00000000-0000-4000-8000-0000000000a1', referenceNumber: order.orderNumber,
    }), 'user', 'business', 'branch', expect.anything());
    expect(f.tx.businessDocumentAttachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ documentId: 'bill', fileName: 'quote.jpg' }) });
    expect(f.orders[0]).toMatchObject({ status: 'RECEIVED', convertedDocumentId: 'bill' });
  });
});
