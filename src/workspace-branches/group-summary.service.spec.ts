import { describe, expect, it, vi } from 'vitest';
import { GroupSummaryService } from './group-summary.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FinanceService } from '../accounting/finance.service.js';

/** Two sub companies with fixed figures, so the totals are easy to check. */
function fixture() {
  const by = (values: Record<string, number>) => vi.fn(async ({ where }: { where: { businessId?: string; invoice?: { businessId: string }; document?: { businessId: string } } }) => values[where.businessId ?? where.invoice?.businessId ?? where.document?.businessId ?? ''] ?? 0);
  const salesBy = by({ meca: 1000, imarrt: 3000 });
  const prisma = {
    workspaceBranch: { findFirst: vi.fn(async ({ where }: { where: { createdById?: string } }) => (where.createdById && where.createdById !== 'owner' ? null : { id: 'main', name: 'Mecatronix Group', code: 'MAIN', businesses: [{ id: 'meca', name: 'meca', gstin: null, gstRegistered: false }, { id: 'imarrt', name: 'imarrt', gstin: '33X', gstRegistered: true }] })) },
    invoice: {
      aggregate: vi.fn(async (args: Parameters<typeof salesBy>[0]) => ({ _sum: { grandTotal: await salesBy(args) }, _count: 2 })),
      findMany: vi.fn(async ({ where }: { where: { businessId: string } }) => (where.businessId === 'meca' ? [{ grandTotal: 1000, amountPaid: 400, relatedDocuments: [{ grandTotal: 100 }] }] : [])),
    },
    businessDocument: {
      aggregate: vi.fn(async ({ where }: { where: { type: string; businessId: string } }) => ({ _sum: { grandTotal: where.type === 'PURCHASE_INVOICE' ? 500 : 0 }, _count: 1 })),
      findMany: vi.fn(async () => [{ grandTotal: 500, paidAmount: 200, convertedDocuments: [] }]),
    },
    paymentRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: 400 } })) },
    purchasePayment: { aggregate: vi.fn(async () => ({ _sum: { amount: 200 } })) },
    expense: { aggregate: vi.fn(async () => ({ _sum: { total: 50 } })) },
    financeEntry: { aggregate: vi.fn(async () => ({ _sum: { amount: 10 } })) },
  };
  const finance = { cashAndBank: vi.fn(async (id: string) => (id === 'meca' ? { cash: 100, bank: 0 } : { cash: 20, bank: 900 })) };
  return { prisma, service: new GroupSummaryService(prisma as unknown as PrismaService, finance as unknown as FinanceService) };
}

describe('main company summary', () => {
  it('shows each sub company and adds them up', async () => {
    const f = fixture();
    const summary = await f.service.summary('main', '2026-04-01', '2027-03-31', { id: 'owner', role: 'OWNER' as never });
    expect(summary.companies.map((c) => [c.name, c.sales, c.receivable, c.payable, c.cash, c.bank, c.profit])).toEqual([
      ['meca', 1000, 500, 300, 100, 0, 460],
      ['imarrt', 3000, 0, 300, 20, 900, 2460],
    ]);
    expect(summary.totals).toMatchObject({ sales: 4000, salesCount: 4, received: 800, receivable: 500, purchases: 1000, payable: 600, expenses: 100, otherIncome: 20, cash: 120, bank: 900, profit: 2920 });
  });

  it("only lets the owner see their main company, and checks the period", async () => {
    const f = fixture();
    await expect(f.service.summary('main', '2026-04-01', '2027-03-31', { id: 'someone-else', role: 'OWNER' as never })).rejects.toThrow('not found');
    await expect(f.service.summary('main', '2027-04-01', '2026-03-31', { id: 'owner', role: 'OWNER' as never })).rejects.toThrow('From date');
  });
});
