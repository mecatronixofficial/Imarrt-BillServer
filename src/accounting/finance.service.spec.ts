import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from './finance.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';

function fixture() {
  const loan = { id: 'loan', businessId: 'business', branchId: 'branch', name: 'Working capital', principal: 100, openingDate: new Date('2026-01-01'), payments: [] as Array<{ id: string; principal: number; interest: number; total: number; requestId: string }> };
  const entries: Array<Record<string, unknown>> = [];
  const cheque = { id: 'cheque', accountId: null as string | null, amount: 25 };
  const events: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'branch' }]),
    cashAccount: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => where.id === 'bank' ? { id: 'bank' } : null) },
    loanAccount: { findFirst: vi.fn().mockResolvedValue(loan) },
    loanPayment: { create: vi.fn(async ({ data }: { data: typeof loan.payments[number] }) => { const payment = { ...data, id: 'payment' }; loan.payments.push(payment); return payment; }) },
    financeEntry: {
      findFirst: vi.fn(async ({ where }: { where: { requestId: string; kind: string } }) => entries.find(e => e.requestId === where.requestId && e.kind === where.kind) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const entry = { ...data, id: String(entries.length + 1) }; entries.push(entry); return entry; }),
      aggregate: vi.fn(async () => ({ _sum: { amount: entries.filter(e => !e.accountId).reduce((sum, e) => sum + Number(e.amount), 0) } })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    // Cash in hand of 1,000 from cash sales, so EMIs paid in cash can go through.
    paymentRecord: { findFirst: vi.fn<(...args: unknown[]) => Promise<typeof cheque | null>>().mockResolvedValue(cheque), update: vi.fn(async ({ data }: { data: { accountId: string | null } }) => Object.assign(cheque, data)), aggregate: vi.fn(async () => ({ _sum: { amount: 1000 } })) },
    purchasePayment: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
    expense: { aggregate: vi.fn(async () => ({ _sum: { total: 0 } })) },
    chequeEvent: {
      findFirst: vi.fn(async ({ where }: { where: { requestId: string } }) => events.find(e => e.requestId === where.requestId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; }),
    },
  };
  let queue = Promise.resolve();
  const prisma = { $transaction: (action: (tx: unknown) => Promise<unknown>) => { const result = queue.then(() => action(tx)); queue = result.then(() => undefined, () => undefined); return result; } };
  const service = new FinanceService(prisma as unknown as PrismaService, {} as AuditService);
  return { service, tx, loan, entries, cheque, events };
}
describe('finance posting contracts', () => {
  it('repays principal separately from interest, debits the account once, and replays safely', async () => {
    const f = fixture(); const dto = { principal: 25.1, interest: 0.2, paidAt: '2026-11-02', accountId: 'bank', requestId: 'payment-request' };
    await f.service.payLoan('loan', dto, 'user', 'business', 'branch');
    await f.service.payLoan('loan', dto, 'user', 'business', 'branch');
    expect(f.loan.payments).toHaveLength(1); expect(f.loan.payments[0].total).toBe(25.3);
    expect(f.entries).toHaveLength(1); expect(f.entries[0]).toMatchObject({ amount: -25.3, accountId: 'bank', businessId: 'business', branchId: 'branch' });
  });
  it('rejects concurrent principal overpayment and leaves the second payment unposted', async () => {
    const f = fixture();
    const result = await Promise.allSettled(['one', 'two'].map(requestId => f.service.payLoan('loan', { principal: 60, interest: 0, paidAt: '2026-11-02', requestId }, 'user', 'business', 'branch')));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(f.entries).toHaveLength(1); expect(f.loan.payments).toHaveLength(1);
  });
  it('rejects an account from another scope before posting money', async () => {
    const f = fixture();
    await expect(f.service.payLoan('loan', { principal: 10, interest: 0, accountId: 'foreign-bank', paidAt: '2026-11-02', requestId: 'one' }, 'user', 'business', 'branch')).rejects.toThrow('company and branch');
    expect(f.loan.payments).toHaveLength(0); expect(f.entries).toHaveLength(0);
    expect(f.tx.cashAccount.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-bank', businessId: 'business', branchId: 'branch', deletedAt: null } });
  });
  it('rejects repayments before opening and zero-value payments', async () => {
    const f = fixture();
    await expect(f.service.payLoan('loan', { principal: 1, interest: 0, paidAt: '2025-01-01', requestId: 'one' }, 'user', 'business', 'branch')).rejects.toThrow('opening loan date');
    await expect(f.service.payLoan('loan', { principal: 0, interest: 0, paidAt: '2026-11-02', requestId: 'two' }, 'user', 'business', 'branch')).rejects.toThrow('principal or interest');
    expect(f.entries).toHaveLength(0);
  });
  it('posts both sides of a transfer on the same transaction and preserves total funds on replay', async () => {
    const f = fixture(); const dto = { fromAccountId: 'bank', amount: 10.25, date: '2026-11-02', requestId: 'transfer' };
    await f.service.transfer(dto, 'user', 'business', 'branch'); await f.service.transfer(dto, 'user', 'business', 'branch');
    expect(f.entries).toHaveLength(2); expect(f.entries.reduce((sum, e) => sum + Number(e.amount), 0)).toBe(0);
    expect(f.entries[0]).toMatchObject({ kind: 'TRANSFER_OUT', accountId: 'bank', amount: -10.25 });
    expect(f.entries[1]).toMatchObject({ kind: 'TRANSFER_IN', amount: 10.25 });
  });
  it('rejects same-account transfers before starting a transaction', async () => {
    const f = fixture();
    await expect(f.service.transfer({ amount: 10, date: '2026-11-02', requestId: 'same' }, 'user', 'business', 'branch')).rejects.toThrow('different');
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('deposits and re-opens a cheque without changing its receipt amount, retaining history', async () => {
    const f = fixture();
    await f.service.cheque('cheque', { action: 'DEPOSIT', accountId: 'bank', requestId: 'deposit' }, 'user', 'business', 'branch');
    await f.service.cheque('cheque', { action: 'DEPOSIT', accountId: 'bank', requestId: 'deposit' }, 'user', 'business', 'branch');
    expect(f.cheque.accountId).toBe('bank'); expect(f.cheque.amount).toBe(25); expect(f.events).toHaveLength(1);
    await f.service.cheque('cheque', { action: 'REOPEN', requestId: 'reopen' }, 'user', 'business', 'branch');
    expect(f.cheque.accountId).toBeNull(); expect(f.cheque.amount).toBe(25); expect(f.events).toHaveLength(2);
  });
  it('cannot mutate a cheque belonging to another company', async () => {
    const f = fixture(); f.tx.paymentRecord.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.cheque('cheque', { action: 'DEPOSIT', accountId: 'bank', requestId: 'foreign' }, 'user', 'other-business', 'branch')).rejects.toThrow('not found');
    expect(f.events).toHaveLength(0); expect(f.tx.paymentRecord.update).not.toHaveBeenCalled();
  });
});
