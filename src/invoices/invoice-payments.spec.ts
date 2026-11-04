import { describe, expect, it, vi } from 'vitest';
import { InvoiceStatus } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoiceDeliveryService } from './invoice-delivery.service.js';

function fixture() {
  const payments: Array<Record<string, any>> = [];
  const invoice = {
    id: 'invoice', businessId: 'business', branchId: 'branch', invoiceNumber: 'INV-001',
    grandTotal: 100, amountPaid: 0, status: InvoiceStatus.UNPAID as InvoiceStatus,
    deletedAt: null, items: [], party: { id: 'party', name: 'Customer', gstin: null },
    business: null, relatedDocuments: [] as Array<{ grandTotal: number }>,
  };
  const sortedPayments = () => [...payments].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  const result = () => ({ ...invoice, payments: sortedPayments() });
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: invoice.id }]),
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => where.id === invoice.id && where.businessId === invoice.businessId && (!where.branchId || where.branchId === invoice.branchId) && !invoice.deletedAt ? result() : null),
      findUniqueOrThrow: vi.fn(async () => result()),
      update: vi.fn(async ({ data }: any) => { Object.assign(invoice, data); return result(); }),
    },
    paymentRecord: {
      findFirst: vi.fn(async ({ where }: any) => payments.find((payment) => payment.requestId === where.requestId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const payment = { ...data, id: `payment-${payments.length + 1}`, createdAt: new Date() };
        payments.push(payment);
        return payment;
      }),
      findMany: vi.fn(async () => payments.map((payment) => ({ ...payment, invoice: { ...invoice } }))),
    },
    businessDocument: { findFirst: vi.fn().mockResolvedValue(null), aggregate: vi.fn(async () => ({ _sum: { grandTotal: invoice.relatedDocuments.reduce((sum, note) => sum + note.grandTotal, 0) } })) },
    cashAccount: { findFirst: vi.fn(async ({ where }: any) => where.id === 'account' && where.businessId === 'business' && where.branchId === 'branch' ? { id: 'account' } : null) },
  };
  let queue = Promise.resolve();
  const prisma = {
    ...tx,
    $transaction: (action: (tx: unknown) => Promise<unknown>) => {
      const next = queue.then(() => action(tx));
      queue = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  const service = new InvoicesService(prisma as unknown as PrismaService, audit as unknown as AuditService, {} as InvoiceDeliveryService);
  const pay = (dto: Parameters<InvoicesService['recordPayment']>[1], businessId = 'business', branchId = 'branch') => service.recordPayment('invoice', dto, 'user', businessId, branchId);
  return { service, invoice, payments, audit, tx, pay };
}

describe('invoice balance payments and dated receipt history', () => {
  it('keeps the first partial receipt when the remaining amount is settled on another day', async () => {
    const f = fixture();
    const first = await f.pay({ amount: 30.25, method: 'cash', paidAt: '2026-11-01T04:30:00.000Z', requestId: 'first' });
    expect(first).toMatchObject({ amountPaid: 30.25, balanceDue: 69.75, status: 'PARTIALLY_PAID' });
    const settled = await f.pay({ amount: 69.75, method: 'upi', paidAt: '2026-11-03T09:45:00.000Z', reference: 'UTR-123', accountId: 'account', requestId: 'second' });
    expect(settled).toMatchObject({ amountPaid: 100, balanceDue: 0, status: 'PAID' });
    expect(settled.payments).toHaveLength(2);
    expect(settled.payments[0]).toMatchObject({ amount: 69.75, method: 'upi', reference: 'UTR-123', accountId: 'account' });
    expect(settled.payments.map((payment) => payment.paidAt.toISOString())).toEqual(['2026-11-03T09:45:00.000Z', '2026-11-01T04:30:00.000Z']);
    expect(settled.payments[1].createdAt).toBeInstanceOf(Date);
  });

  it('leaves the correct remaining balance after multiple partial payments', async () => {
    const f = fixture();
    await f.pay({ amount: 20.1, method: 'cash' });
    const result = await f.pay({ amount: 30.2, method: 'bank_transfer' });
    expect(result).toMatchObject({ amountPaid: 50.3, balanceDue: 49.7, status: 'PARTIALLY_PAID' });
    expect(result.payments).toHaveLength(2);
    expect(result.payments[0].paidAt).toBeInstanceOf(Date);
  });

  it('returns the same settled history on retry without another receipt or audit entry', async () => {
    const f = fixture();
    const payment = { amount: 100, method: 'cash', requestId: 'retry', paidAt: '2026-11-03T10:00:00.000Z' };
    await f.pay(payment);
    const retry = await f.pay(payment);
    expect(retry).toMatchObject({ amountPaid: 100, balanceDue: 0, status: 'PAID' });
    expect(retry.payments).toHaveLength(1);
    expect(f.audit.log).toHaveBeenCalledTimes(1);
    expect(f.payments[0].paidAt.toISOString()).toBe(payment.paidAt);
  });

  it('settles the credit-adjusted balance and reports it consistently in the payment register', async () => {
    const f = fixture();
    f.invoice.relatedDocuments.push({ grandTotal: 20 });
    await f.pay({ amount: 30, method: 'cash' });
    const result = await f.pay({ amount: 50, method: 'upi' });
    expect(result).toMatchObject({ creditTotal: 20, balanceDue: 0, amountPaid: 80, status: 'PAID' });
    const register = await f.service.listPayments('business', 'branch', { limit: 50, offset: 0 });
    expect(register[0].invoice).toMatchObject({ creditTotal: 20, balanceDue: 0, status: 'PAID' });
  });

  it('rejects overpayment after an earlier partial payment or full settlement', async () => {
    const f = fixture();
    await f.pay({ amount: 40, method: 'cash' });
    await expect(f.pay({ amount: 60.01, method: 'cash' })).rejects.toThrow('outstanding');
    expect(f.payments).toHaveLength(1);
    await f.pay({ amount: 60, method: 'cash' });
    await expect(f.pay({ amount: 0.01, method: 'cash' })).rejects.toThrow('outstanding');
    expect(f.payments).toHaveLength(2);
  });

  it.each(['DRAFT', 'CANCELLED'] as const)('does not accept money for a %s invoice', async (status) => {
    const f = fixture(); f.invoice.status = status;
    await expect(f.pay({ amount: 20, method: 'cash' })).rejects.toThrow('Issue an invoice');
    expect(f.payments).toHaveLength(0);
  });

  it('rejects cross-company, cross-branch, and invalid-account receipts without posting money', async () => {
    const f = fixture();
    await expect(f.pay({ amount: 20, method: 'cash' }, 'other-business')).rejects.toThrow('not found');
    await expect(f.pay({ amount: 20, method: 'cash' }, 'business', 'other-branch')).rejects.toThrow('not found');
    await expect(f.pay({ amount: 20, method: 'cash', accountId: 'other-account' })).rejects.toThrow('Account not found');
    expect(f.payments).toHaveLength(0);
    expect(f.invoice.amountPaid).toBe(0);
  });

  it('rejects invalid dates and nonpositive amounts before creating a receipt', async () => {
    const f = fixture();
    await expect(f.pay({ amount: 10, method: 'cash', paidAt: 'invalid' })).rejects.toThrow('valid payment date');
    await expect(f.pay({ amount: 0, method: 'cash' })).rejects.toThrow('positive');
    await expect(f.pay({ amount: -1, method: 'cash' })).rejects.toThrow('positive');
    expect(f.payments).toHaveLength(0);
  });

  it('loads dated history for fully paid invoices with deterministic payment ordering', async () => {
    const f = fixture();
    await f.pay({ amount: 100, method: 'cash', paidAt: '2026-11-03T12:00:00.000Z' });
    const invoice = await f.service.findOne('invoice', 'business', 'branch');
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.balanceDue).toBe(0);
    expect(f.tx.invoice.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ include: expect.objectContaining({ payments: { orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }] } }) }));
  });
});
