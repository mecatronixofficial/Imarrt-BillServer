import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from './finance.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';

type Entry = { id: string; businessId: string; branchId: string; accountId: string | null; kind: string; name: string; amount: number; entryDate: Date; referenceId: string | null; notes: string | null; requestId?: string };

/** Cash in hand = `received` cash sales + every cash-side entry (accountId null). */
function fixture(received = 0) {
  const base = { businessId: 'business', branchId: 'branch', entryDate: new Date('2026-11-01'), notes: null };
  const entries: Entry[] = [
    { ...base, id: 'out', accountId: 'bank', kind: 'TRANSFER_OUT', name: 'Transfer out', amount: -500, referenceId: null },
    { ...base, id: 'in', accountId: null, kind: 'TRANSFER_IN', name: 'Transfer in', amount: 500, referenceId: 'out' },
    { ...base, id: 'income', accountId: 'bank', kind: 'OTHER_INCOME', name: 'Rent', amount: 120, referenceId: 'category' },
    { ...base, id: 'loan', accountId: 'bank', kind: 'LOAN_PAYMENT', name: 'Siva', amount: -50, referenceId: 'loan-account', requestId: 'emi1' },
  ];
  const payments = [{ id: 'p1', loanId: 'loan-account', principal: 50, interest: 0, total: 50, paidAt: new Date('2026-11-01'), requestId: 'emi1' }];
  const loan = { id: 'loan-account', businessId: 'business', branchId: 'branch', name: 'Siva', principal: 5000, openingDate: new Date('2026-01-01') };
  const find = <T extends object>(items: T[], where: Record<string, unknown>) => items.find(item => Object.entries(where).every(([key, value]) => typeof value === 'object' || item[key as keyof T] === value));
  const matches = (entry: Entry, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'in' in value ? (value.in as string[]).includes(entry[key as keyof Entry] as string) : entry[key as keyof Entry] === value);
  const none = { aggregate: vi.fn(async () => ({ _sum: { amount: 0, total: 0 } })) };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'branch' }]),
    paymentRecord: { aggregate: vi.fn(async () => ({ _sum: { amount: received } })) },
    purchasePayment: none,
    expense: none,
    cashAccount: { findFirst: vi.fn(async () => ({ id: 'bank' })) },
    loanAccount: { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find([loan], where) ? { ...loan, payments: payments.filter(p => p.loanId === loan.id) } : null) },
    loanPayment: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(payments, where) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<(typeof payments)[number], 'id'> }) => { const payment = { ...data, id: `p${payments.length + 1}` }; payments.push(payment); return payment; }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => payments.splice(payments.findIndex(p => p.id === where.id), 1)[0]),
    },
    financeEntry: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entries.filter(e => matches(e, where))),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => entries.splice(entries.findIndex(e => e.id === where.id), 1)[0]),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entries.find(e => matches(e, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<Entry, 'id'> }) => { const entry = { ...data, id: `new${entries.length}`, accountId: data.accountId ?? null, referenceId: data.referenceId ?? null, notes: data.notes ?? null }; entries.push(entry); return entry; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Entry> }) => Object.assign(entries.find(e => e.id === where.id)!, data)),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = entries.length;
        for (let i = entries.length - 1; i >= 0; i--) if (matches(entries[i], where)) entries.splice(i, 1);
        return { count: before - entries.length };
      }),
      aggregate: vi.fn(async ({ where }: { where: { accountId: string | null } }) => ({ _sum: { amount: entries.filter(e => e.accountId === where.accountId).reduce((sum, e) => sum + Number(e.amount), 0) } })),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: async (action: (client: unknown) => Promise<unknown>) => {
    const savedEntries = entries.map(entry => ({ ...entry }));
    const savedPayments = payments.map(payment => ({ ...payment }));
    try { return await action(tx); }
    catch (error) { entries.splice(0, entries.length, ...savedEntries); payments.splice(0, payments.length, ...savedPayments); throw error; }
  } };
  return { tx, entries, payments, loan, service: new FinanceService(prisma as unknown as PrismaService, {} as AuditService) };
}
const loanBalance = (f: ReturnType<typeof fixture>) => f.loan.principal - f.payments.reduce((sum, p) => sum + Number(p.principal), 0);
const cash = (f: ReturnType<typeof fixture>, received = 0) => received + f.entries.filter(e => !e.accountId).reduce((sum, e) => sum + Number(e.amount), 0);

describe('bank transaction actions', () => {
  it('edits a deposit/withdrawal on both accounts and keeps each side in its own direction', async () => {
    const f = fixture();
    await f.service.updateEntry('in', { amount: 750, date: '2026-11-03', notes: ' corrected ' }, 'user', 'business', 'branch');
    expect(f.entries.find(e => e.id === 'out')).toMatchObject({ amount: -750, notes: 'corrected', entryDate: new Date('2026-11-03') });
    expect(f.entries.find(e => e.id === 'in')).toMatchObject({ amount: 750, notes: 'corrected' });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'FINANCE_ENTRY_UPDATED', entityId: 'in' }) });
  });

  it('deletes both sides of a transfer and records what was removed', async () => {
    const f = fixture(500);
    await expect(f.service.removeEntry('out', 'user', 'business', 'branch')).resolves.toEqual({ id: 'out', deleted: 2 });
    expect(f.entries.map(e => e.id)).toEqual(['income', 'loan']);
    const metadata = JSON.parse(f.tx.auditLog.create.mock.calls[0][0].data.metadata);
    expect(metadata.removed.map((e: Entry) => [e.id, e.amount])).toEqual([['out', -500], ['in', 500]]);
  });

  it('edits other income alone, but an EMI can only be edited on its loan account', async () => {
    const f = fixture();
    await f.service.updateEntry('income', { amount: 150, date: '2026-11-02' }, 'user', 'business', 'branch');
    expect(f.entries.find(e => e.id === 'income')).toMatchObject({ amount: 150, notes: null });
    await expect(f.service.updateEntry('loan', { amount: 10, date: '2026-11-02' }, 'user', 'business', 'branch')).rejects.toThrow('Loan Accounts');
    await expect(f.service.removeEntry('missing', 'user', 'business', 'branch')).rejects.toThrow('not found');
    expect(f.entries).toHaveLength(4);
  });
});

describe('loan EMIs and cash in hand', () => {
  it('deleting an EMI from cash or a bank also deletes the loan payment, so the loan balance goes back up', async () => {
    const f = fixture();
    expect(loanBalance(f)).toBe(4950);
    await f.service.removeEntry('loan', 'user', 'business', 'branch');
    expect(f.entries.map(e => e.id)).toEqual(['out', 'in', 'income']);
    expect(f.payments).toHaveLength(0);
    expect(loanBalance(f)).toBe(5000);
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'LOAN_PAYMENT_DELETED', entityId: 'p1' }) });
  });

  it('turns a typed-in "Reduce Cash" into an EMI on the loan: cash stays the same, the loan balance drops', async () => {
    const f = fixture(); // 500 cash in hand
    const adjustment = await f.service.adjustCash({ direction: 'OUT', amount: 1000, date: '2026-11-03', type: 'Siva', requestId: 'typed' }, 'user', 'business', 'branch').catch(() => null);
    expect(adjustment).toBeNull(); // more than the cash in hand
    const typed = await f.service.adjustCash({ direction: 'OUT', amount: 400, date: '2026-11-03', type: 'Siva', reason: 'November EMI', requestId: 'typed' }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(100);

    await f.service.convertToLoanPayment(typed.id, { loanId: 'loan-account', interest: 100 }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(100);
    expect(f.entries.find(e => e.id === typed.id)).toBeUndefined();
    expect(f.entries.at(-1)).toMatchObject({ kind: 'LOAN_PAYMENT', accountId: null, name: 'Siva', amount: -400, notes: 'November EMI', referenceId: 'loan-account' });
    expect(f.payments.at(-1)).toMatchObject({ principal: 300, interest: 100, total: 400, paidAt: new Date('2026-11-03') });
    expect(loanBalance(f)).toBe(4650);
  });

  it('only converts a cash reduction, and never beyond the loan balance', async () => {
    const f = fixture(2000);
    const added = await f.service.adjustCash({ direction: 'IN', amount: 10, date: '2026-11-03', requestId: 'add' }, 'user', 'business', 'branch');
    await expect(f.service.convertToLoanPayment(added.id, { loanId: 'loan-account' }, 'user', 'business', 'branch')).rejects.toThrow('Reduce Cash');
    f.loan.principal = 100; // 50 left to repay
    const spent = await f.service.adjustCash({ direction: 'OUT', amount: 60, date: '2026-11-03', requestId: 'spend' }, 'user', 'business', 'branch');
    await expect(f.service.convertToLoanPayment(spent.id, { loanId: 'loan-account' }, 'user', 'business', 'branch')).rejects.toThrow('loan balance');
    await expect(f.service.convertToLoanPayment(spent.id, { loanId: 'loan-account', interest: 61 }, 'user', 'business', 'branch')).rejects.toThrow('Interest cannot be more');
    await f.service.convertToLoanPayment(spent.id, { loanId: 'loan-account', interest: 10 }, 'user', 'business', 'branch');
    expect(loanBalance(f)).toBe(0);
  });

  it('pays an EMI from cash only when the cash is in hand', async () => {
    const f = fixture(); // 500 cash in hand
    await expect(f.service.payLoan('loan-account', { principal: 500, interest: 1, paidAt: '2026-11-03', requestId: 'emi2' }, 'user', 'business', 'branch')).rejects.toThrow('Cash in hand is');
    await f.service.payLoan('loan-account', { principal: 450, interest: 50, paidAt: '2026-11-03', requestId: 'emi2' }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(0);
    expect(loanBalance(f)).toBe(4500);
  });
});

describe('adjust cash', () => {
  it('adds cash in and takes cash out, but never more than is in hand', async () => {
    const f = fixture(); // 500 in hand, from the withdrawal
    await f.service.adjustCash({ direction: 'IN', amount: 200, date: '2026-11-03', requestId: 'add' }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(700);
    expect(f.entries.at(-1)).toMatchObject({ kind: 'CASH_ADJUSTMENT', amount: 200, name: 'Cash adjustment', accountId: null });
    await expect(f.service.adjustCash({ direction: 'OUT', amount: 700.01, date: '2026-11-03', requestId: 'too-much' }, 'user', 'business', 'branch')).rejects.toThrow('Cash in hand is');
    await f.service.adjustCash({ direction: 'OUT', amount: 700, date: '2026-11-03', type: ' Petty Cash ', reason: ' Tea and courier ', requestId: 'all' }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(0);
    expect(f.entries.at(-1)).toMatchObject({ amount: -700, name: 'Petty Cash', notes: 'Tea and courier' });
  });

  it('keeps the typed-in type on edit, and a blank type goes back to Add/Reduce Cash', async () => {
    const f = fixture();
    const entry = await f.service.adjustCash({ direction: 'IN', amount: 10, date: '2026-11-03', type: 'Opening Cash', requestId: 'typed' }, 'user', 'business', 'branch');
    await f.service.updateEntry(entry.id, { amount: 20, date: '2026-11-03', name: ' Owner Capital ', notes: 'From home' }, 'user', 'business', 'branch');
    expect(f.entries.at(-1)).toMatchObject({ name: 'Owner Capital', notes: 'From home', amount: 20 });
    await f.service.updateEntry(entry.id, { amount: 20, date: '2026-11-03', name: '  ' }, 'user', 'business', 'branch');
    expect(f.entries.at(-1)).toMatchObject({ name: 'Cash adjustment', notes: null });
  });

  it('switches an adjustment between adding and reducing, still guarding cash in hand', async () => {
    const f = fixture(100); // 600 in hand
    const added = await f.service.adjustCash({ direction: 'IN', amount: 50, date: '2026-11-03', requestId: 'add' }, 'user', 'business', 'branch');
    await f.service.updateEntry(added.id, { amount: 80, date: '2026-11-03', direction: 'OUT' }, 'user', 'business', 'branch');
    expect(cash(f, 100)).toBe(520);
    await expect(f.service.updateEntry(added.id, { amount: 900, date: '2026-11-03', direction: 'OUT' }, 'user', 'business', 'branch')).rejects.toThrow('cannot be taken out');
    expect(cash(f, 100)).toBe(520);
  });

  it('will not deposit more cash in the bank than is in hand, nor delete cash already spent', async () => {
    const f = fixture(); // 500 in hand
    await expect(f.service.transfer({ toAccountId: 'bank', amount: 600, date: '2026-11-03', requestId: 'deposit' }, 'user', 'business', 'branch')).rejects.toThrow('Cash in hand is');
    await f.service.adjustCash({ direction: 'OUT', amount: 450, date: '2026-11-03', requestId: 'spend' }, 'user', 'business', 'branch');
    await expect(f.service.removeEntry('in', 'user', 'business', 'branch')).rejects.toThrow('cannot be taken out');
    expect(cash(f)).toBe(50);
  });
});

describe('loan repayments recorded directly in Adjust Cash', () => {
  it('reduces cash once and principal once, retaining the paid date and description in both ledgers', async () => {
    const f = fixture();
    const payload = { direction: 'OUT' as const, amount: 400, loanId: 'loan-account', interest: 100, date: '2026-11-03', reason: ' November EMI ', requestId: 'linked-cash' };
    await f.service.adjustCash(payload, 'user', 'business', 'branch');
    expect(cash(f)).toBe(100); expect(loanBalance(f)).toBe(4650);
    expect(f.payments.at(-1)).toMatchObject({ principal: 300, interest: 100, total: 400, paidAt: new Date('2026-11-03') });
    expect(f.entries.at(-1)).toMatchObject({ kind: 'LOAN_PAYMENT', referenceId: 'loan-account', name: 'Siva', amount: -400, notes: 'November EMI', requestId: 'linked-cash' });
    expect(f.entries.filter(e => e.requestId === 'linked-cash')).toHaveLength(1);
    await f.service.adjustCash(payload, 'user', 'business', 'branch');
    expect(cash(f)).toBe(100); expect(loanBalance(f)).toBe(4650); expect(f.payments).toHaveLength(2);
  });
  it('allows an interest-only payment without reducing the principal balance', async () => {
    const f = fixture(); const before = loanBalance(f);
    await f.service.adjustCash({ direction: 'OUT', amount: 100, interest: 100, loanId: 'loan-account', date: '2026-11-03', requestId: 'interest-only' }, 'user', 'business', 'branch');
    expect(cash(f)).toBe(400); expect(loanBalance(f)).toBe(before);
  });
  it('rejects cash shortages and loan overpayment before writing either side', async () => {
    const f = fixture();
    await expect(f.service.adjustCash({ direction: 'OUT', amount: 501, loanId: 'loan-account', date: '2026-11-03', requestId: 'too-much-cash' }, 'user', 'business', 'branch')).rejects.toThrow('Cash in hand is');
    f.loan.principal = 100;
    await expect(f.service.adjustCash({ direction: 'OUT', amount: 51, loanId: 'loan-account', date: '2026-11-03', requestId: 'too-much-principal' }, 'user', 'business', 'branch')).rejects.toThrow('loan balance');
    expect(f.payments).toHaveLength(1); expect(cash(f)).toBe(500);
  });
  it('rejects adding cash as a repayment, invalid interest, and dates before the loan opened', async () => {
    const f = fixture();
    const payment = { direction: 'OUT' as const, amount: 100, loanId: 'loan-account', date: '2026-11-03', requestId: 'invalid' };
    await expect(f.service.adjustCash({ ...payment, direction: 'IN' }, 'user', 'business', 'branch')).rejects.toThrow('Reduce Cash');
    await expect(f.service.adjustCash({ ...payment, interest: 101 }, 'user', 'business', 'branch')).rejects.toThrow('Interest');
    await expect(f.service.adjustCash({ ...payment, date: '2025-01-01' }, 'user', 'business', 'branch')).rejects.toThrow('opening loan date');
    await expect(f.service.adjustCash({ ...payment, loanId: undefined, interest: 10 }, 'user', 'business', 'branch')).rejects.toThrow('Select a loan');
    expect(cash(f)).toBe(500); expect(f.payments).toHaveLength(1);
  });
  it('does not post a loan payment outside the current company or branch', async () => {
    const f = fixture(); const dto = { direction: 'OUT' as const, amount: 100, loanId: 'loan-account', date: '2026-11-03', requestId: 'scope' };
    await expect(f.service.adjustCash(dto, 'user', 'other-company', 'branch')).rejects.toThrow('not found');
    await expect(f.service.adjustCash(dto, 'user', 'business', 'other-branch')).rejects.toThrow('not found');
    expect(f.payments).toHaveLength(1); expect(cash(f)).toBe(500);
  });
  it('prevents the same saved cash request from being posted again as an EMI', async () => {
    const f = fixture(); const dto = { direction: 'OUT' as const, amount: 100, date: '2026-11-03', requestId: 'retry' };
    await f.service.adjustCash(dto, 'user', 'business', 'branch');
    await expect(f.service.adjustCash({ ...dto, loanId: 'loan-account' }, 'user', 'business', 'branch')).rejects.toThrow('already saved');
    await expect(f.service.payLoan('loan-account', { principal: 100, interest: 0, paidAt: dto.date, requestId: dto.requestId }, 'user', 'business', 'branch')).rejects.toThrow('already recorded');
    expect(cash(f)).toBe(400); expect(f.payments).toHaveLength(1);
  });
  it('removing a linked repayment restores both cash and the principal balance', async () => {
    const f = fixture(); const before = loanBalance(f);
    await f.service.adjustCash({ direction: 'OUT', amount: 100, loanId: 'loan-account', date: '2026-11-03', requestId: 'remove-linked' }, 'user', 'business', 'branch');
    await f.service.removeEntry(f.entries.at(-1)!.id, 'user', 'business', 'branch');
    expect(cash(f)).toBe(500); expect(loanBalance(f)).toBe(before);
  });
});

describe('atomic linked cash and loan posting', () => {
  it('rolls back the loan receipt when the cash ledger write fails and safely allows a retry', async () => {
    const f = fixture(); const before = loanBalance(f);
    const payment = { direction: 'OUT' as const, loanId: 'loan-account', amount: 200, interest: 20, date: '2026-11-03', requestId: 'atomic-linked' };
    f.tx.financeEntry.create.mockRejectedValueOnce(new Error('Cash ledger write failed'));
    await expect(f.service.adjustCash(payment, 'user', 'business', 'branch')).rejects.toThrow('Cash ledger write failed');
    expect(cash(f)).toBe(500); expect(loanBalance(f)).toBe(before); expect(f.payments).toHaveLength(1);
    await f.service.adjustCash(payment, 'user', 'business', 'branch');
    expect(cash(f)).toBe(300); expect(loanBalance(f)).toBe(before - 180); expect(f.payments).toHaveLength(2);
    expect(f.entries.filter(entry => entry.requestId === payment.requestId)).toHaveLength(1);
  });
});
