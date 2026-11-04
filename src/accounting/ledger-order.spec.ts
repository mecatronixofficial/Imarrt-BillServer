import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from './finance.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';

function fixture() {
  const date = new Date('2026-11-03T00:00:00.000Z');
  const created = (hour: number) => new Date(`2026-11-03T${String(hour).padStart(2, '0')}:00:00.000Z`);
  const receipts = [{ id: 'receipt', paidAt: date, createdAt: created(11), amount: 100, invoiceId: 'invoice', method: 'cash', invoice: { invoiceNumber: 'INV-001', party: { name: 'Customer' } } }];
  const payments = [{ id: 'payment', paidAt: date, createdAt: created(9), amount: 20, documentId: 'bill', method: 'cash', document: { documentNumber: 'PUR-001', supplier: { name: 'Supplier' } } }];
  const expenses = [{ id: 'expense', expenseDate: date, createdAt: created(8), total: 10, description: 'Courier', method: 'cash' }];
  const entries = [
    { id: 'z-old', kind: 'CASH_ADJUSTMENT', name: 'Add Cash', notes: 'Older entry', entryDate: date, createdAt: created(7), amount: 30 },
    { id: 'a-new', kind: 'CASH_ADJUSTMENT', name: 'Add Cash', notes: 'Newest entry', entryDate: date, createdAt: created(12), amount: 40 },
  ];
  const repository = (records: Array<Record<string, any>>) => ({
    findMany: vi.fn(async ({ orderBy, take }: any) => [...records].sort((a, b) => {
      for (const order of orderBy) {
        const [key, direction] = Object.entries(order)[0];
        const difference = a[key] instanceof Date ? a[key].getTime() - b[key].getTime() : String(a[key]).localeCompare(String(b[key]));
        if (difference) return difference * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    }).slice(0, take)),
    aggregate: vi.fn(async () => ({ _sum: { amount: records.reduce((sum, record) => sum + (record.amount ?? 0), 0), total: records.reduce((sum, record) => sum + (record.total ?? 0), 0) } })),
  });
  const prisma = { paymentRecord: repository(receipts), purchasePayment: repository(payments), expense: repository(expenses), financeEntry: repository(entries) };
  return { prisma, entries, service: new FinanceService(prisma as unknown as PrismaService, {} as AuditService) };
}

describe('cash and bank transaction ordering', () => {
  it('merges same-day entries by creation time across all sources, without changing the balance', async () => {
    const f = fixture();
    const result = await f.service.transactions(null, 'business', 'branch', { limit: 100, offset: 0 });
    expect(result.rows.map(row => row.id)).toEqual(['a-new', 'receipt', 'payment', 'expense', 'z-old']);
    expect(result.balance).toBe(140);
    expect(result.rows.map(row => row.amount)).toEqual([40, 100, -20, -10, 30]);
    expect(result.rows[0].createdAt.toISOString()).toBe('2026-11-03T12:00:00.000Z');
  });

  it('uses the same date, creation-time, and ID order before slicing each source for pagination', async () => {
    const f = fixture();
    const first = await f.service.transactions(null, 'business', 'branch', { limit: 1, offset: 0 });
    const second = await f.service.transactions(null, 'business', 'branch', { limit: 1, offset: 1 });
    expect(first.rows.map(row => row.id)).toEqual(['a-new']);
    expect(second.rows.map(row => row.id)).toEqual(['receipt']);
    expect(f.prisma.financeEntry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] }));
    expect(f.prisma.paymentRecord.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] }));
    expect(first.balance).toBe(second.balance);
  });

  it('keeps a backdated entry below later transaction dates', async () => {
    const f = fixture();
    f.entries.push({ ...f.entries[1], id: 'backdated', entryDate: new Date('2026-11-02T00:00:00.000Z'), createdAt: new Date('2026-11-03T23:00:00.000Z') });
    const result = await f.service.transactions(null, 'business', 'branch', { limit: 100, offset: 0 });
    expect(result.rows.at(-1)?.id).toBe('backdated');
  });

  it('retains company, branch, and cash-only filters when reading the ordered ledger', async () => {
    const f = fixture();
    await f.service.transactions(null, 'business', 'branch', { limit: 100, offset: 0 });
    expect(f.prisma.financeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: 'business', branchId: 'branch', accountId: null } }));
    expect(f.prisma.paymentRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: null, method: 'cash', invoice: expect.objectContaining({ businessId: 'business', branchId: 'branch', deletedAt: null }) }) }));
  });
});
