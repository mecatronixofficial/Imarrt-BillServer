import { describe, expect, it, vi } from 'vitest';
import { DocumentStatus, Prisma } from '@prisma/client';
import { PaymentOutService, allocateOldestFirst, fundAllocations } from './payment-out.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';

vi.mock('../common/utils/workspace-scope.util.js', () => ({ getLogicalBranchIds: async () => ['branch'] }));

const decimal = (value: number) => new Prisma.Decimal(value);
const SUPPLIER = '00000000-0000-4000-8000-000000000001';

function fixture() {
  const bills: any[] = [
    { id: 'old', documentNumber: 'PUR-1', referenceNumber: 'INV-9', supplierId: SUPPLIER, branchId: 'branch', businessId: 'business', status: DocumentStatus.ISSUED, deletedAt: null, issueDate: new Date('2026-09-01'), dueDate: new Date('2026-09-15'), createdAt: new Date('2026-09-01'), grandTotal: decimal(100), paidAmount: decimal(0), convertedDocuments: [] },
    { id: 'new', documentNumber: 'PUR-2', referenceNumber: null, supplierId: SUPPLIER, branchId: 'branch', businessId: 'business', status: DocumentStatus.ISSUED, deletedAt: null, issueDate: new Date('2026-10-01'), dueDate: null, createdAt: new Date('2026-10-01'), grandTotal: decimal(200), paidAmount: decimal(0), convertedDocuments: [] },
  ];
  const receipts: any[] = [];
  const payments: any[] = [];
  const shape = (receipt: any) => receipt && ({
    ...receipt,
    supplier: { id: 'sup', name: 'Acme', phone: null, email: null },
    payments: payments.filter((payment) => payment.receiptId === receipt.id).map((payment) => ({ ...payment, account: null, document: bills.find(({ id }) => id === payment.documentId) })),
    _count: { attachments: 0 },
  });
  const step = (record: any, key: string, value: any) => {
    if (value && typeof value === 'object' && ('increment' in value || 'decrement' in value)) record[key] = decimal(Number(record[key]) + Number(value.increment ?? 0) - Number(value.decrement ?? 0));
    else if (value !== undefined) record[key] = value;
  };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    supplier: { findFirst: vi.fn(async () => ({ id: 'sup', name: 'Acme' })) },
    cashAccount: { findFirst: vi.fn(async () => ({ id: 'acct' })) },
    businessDocument: {
      findMany: vi.fn(async ({ where }: any) => bills.filter((bill) => bill.supplierId === where.supplierId && where.status.in.includes(bill.status) && !bill.deletedAt)),
      update: vi.fn(async ({ where, data }: any) => { const bill = bills.find(({ id }) => id === where.id); Object.entries(data).forEach(([key, value]) => step(bill, key, value)); return bill; }),
    },
    paymentOutReceipt: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.requestId) return shape(receipts.find((receipt) => receipt.requestId === where.requestId));
        if (where.receiptNumber?.startsWith) return [...receipts].filter((receipt) => receipt.receiptNumber.startsWith(where.receiptNumber.startsWith)).sort((a, b) => b.receiptNumber.localeCompare(a.receiptNumber))[0] ?? null;
        return shape(receipts.find((receipt) => receipt.id === where.id && receipt.branchId === where.branchId));
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => shape(receipts.find(({ id }) => id === where.id))),
      create: vi.fn(async ({ data }: any) => { const receipt = { id: `r${receipts.length + 1}`, voidedAt: null, ...data, paid: decimal(data.paid), discount: decimal(data.discount) }; receipts.push(receipt); return receipt; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(receipts.find(({ id }) => id === where.id), data)),
      delete: vi.fn(async ({ where }: any) => {
        receipts.splice(receipts.findIndex(({ id }) => id === where.id), 1);
        for (let index = payments.length - 1; index >= 0; index--) if (payments[index].receiptId === where.id) payments.splice(index, 1);
      }),
    },
    purchasePayment: {
      create: vi.fn(async ({ data }: any) => { payments.push({ id: `p${payments.length + 1}`, voidedAt: null, ...data, amount: decimal(data.amount) }); }),
      updateMany: vi.fn(async ({ where, data }: any) => payments.filter((payment) => payment.receiptId === where.receiptId && (where.voidedAt === undefined || payment.voidedAt === where.voidedAt)).forEach((payment) => Object.assign(payment, data))),
    },
    paymentOutAttachment: { findMany: vi.fn(async () => []) },
  };
  const prisma: any = { ...tx, $transaction: (action: (client: any) => Promise<unknown>) => action(tx) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new PaymentOutService(prisma as PrismaService, audit as unknown as AuditService);
  const paid = (id: string) => Number(bills.find((bill) => bill.id === id).paidAmount);
  return { service, bills, receipts, payments, audit, paid };
}

const base = { supplierId: SUPPLIER, paidAt: '2026-11-03' };

describe('payment-out allocation helpers', () => {
  it('settles the oldest bills first and refuses amounts the bills cannot absorb', () => {
    const bills = [{ id: 'a', outstanding: 100 }, { id: 'b', outstanding: 50.5 }];
    expect(allocateOldestFirst(bills, 120.25)).toEqual([{ documentId: 'a', amount: 100 }, { documentId: 'b', amount: 20.25 }]);
    expect(allocateOldestFirst(bills, 150.51)).toBeNull();
  });

  it('funds each bill from the payment types in order, then the discount', () => {
    const pieces = fundAllocations([{ documentId: 'a', amount: 100 }, { documentId: 'b', amount: 70 }], [{ amount: 120, name: 'bank' }, { amount: 30, name: 'cash' }, { amount: 20, name: 'discount' }]);
    expect(pieces.map(({ documentId, amount, source }) => [documentId, amount, source.name])).toEqual([
      ['a', 100, 'bank'], ['b', 20, 'bank'], ['b', 30, 'cash'], ['b', 20, 'discount'],
    ]);
  });
});

describe('payment-out receipts', () => {
  it('pays a supplier across bills oldest-due first, with discount, and numbers receipts per year', async () => {
    const f = fixture();
    const receipt = await f.service.create({ ...base, discount: 20, splits: [{ method: 'cash', amount: 150 }] }, 'user', 'business', 'branch');
    expect(receipt).toMatchObject({ receiptNumber: 'PO-2026-000001', paid: 150, discount: 20, total: 170, paymentTypes: ['Cash'] });
    expect(f.paid('old')).toBe(100);
    expect(f.paid('new')).toBe(70);
    expect(f.payments.map(({ documentId, method, amount }) => [documentId, method, Number(amount)])).toEqual([['old', 'cash', 100], ['new', 'cash', 50], ['new', 'discount', 20]]);
    const second = await f.service.create({ ...base, splits: [{ method: 'upi', amount: 10 }] }, 'user', 'business', 'branch');
    expect(second.receiptNumber).toBe('PO-2026-000002');
  });

  it('rejects more than the supplier owes and allocations that do not add up', async () => {
    const f = fixture();
    await expect(f.service.create({ ...base, splits: [{ method: 'cash', amount: 300.01 }] }, 'user', 'business', 'branch')).rejects.toThrow('is owed on open bills');
    await expect(f.service.create({ ...base, splits: [{ method: 'cash', amount: 50 }], allocations: [{ documentId: 'new', amount: 40 }] }, 'user', 'business', 'branch')).rejects.toThrow('must equal paid plus discount');
    await expect(f.service.create({ ...base, splits: [{ method: 'cash', amount: 150 }], allocations: [{ documentId: 'old', amount: 150 }] }, 'user', 'business', 'branch')).rejects.toThrow('only has');
    expect(f.receipts).toHaveLength(0);
  });

  it('settles only the chosen bill when allocations are given', async () => {
    const f = fixture();
    await f.service.create({ ...base, splits: [{ method: 'cash', amount: 50 }], allocations: [{ documentId: 'new', amount: 50 }] }, 'user', 'business', 'branch');
    expect(f.paid('old')).toBe(0);
    expect(f.paid('new')).toBe(50);
  });

  it('replays a repeated request without paying twice', async () => {
    const f = fixture();
    const request = { ...base, requestId: '00000000-0000-4000-8000-0000000000aa', splits: [{ method: 'cash', amount: 40 }] };
    const first = await f.service.create(request, 'user', 'business', 'branch');
    const again = await f.service.create(request, 'user', 'business', 'branch');
    expect(again.id).toBe(first.id);
    expect(f.paid('old')).toBe(40);
    expect(f.audit.log).toHaveBeenCalledTimes(1);
  });

  it('voids and restores a whole receipt, and blocks a restore the bills can no longer take', async () => {
    const f = fixture();
    const receipt = await f.service.create({ ...base, splits: [{ method: 'cash', amount: 150 }] }, 'user', 'business', 'branch');
    await f.service.void(receipt.id, { reason: 'Wrong party' }, 'user', 'business', 'branch');
    await f.service.void(receipt.id, {}, 'user', 'business', 'branch');
    expect([f.paid('old'), f.paid('new')]).toEqual([0, 0]);
    expect(f.receipts[0]).toMatchObject({ voidReason: 'Wrong party' });

    await f.service.restore(receipt.id, 'user', 'business', 'branch');
    expect([f.paid('old'), f.paid('new')]).toEqual([100, 50]);

    await f.service.void(receipt.id, {}, 'user', 'business', 'branch');
    f.bills[0].paidAmount = decimal(90);
    await expect(f.service.restore(receipt.id, 'user', 'business', 'branch')).rejects.toThrow("can't be restored");
  });

  it('deletes a receipt, taking live amounts off bills exactly once', async () => {
    const f = fixture();
    const live = await f.service.create({ ...base, splits: [{ method: 'cash', amount: 120 }] }, 'user', 'business', 'branch');
    await f.service.remove(live.id, 'user', 'business', 'branch');
    expect([f.paid('old'), f.paid('new')]).toEqual([0, 0]);
    expect(f.payments).toHaveLength(0);

    const voided = await f.service.create({ ...base, splits: [{ method: 'cash', amount: 30 }] }, 'user', 'business', 'branch');
    await f.service.void(voided.id, {}, 'user', 'business', 'branch');
    await f.service.remove(voided.id, 'user', 'business', 'branch');
    expect(f.paid('old')).toBe(0);
    expect(f.audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'PAYMENT_OUT_DELETED', metadata: expect.objectContaining({ voided: true, paid: 30 }) }));
  });
});
