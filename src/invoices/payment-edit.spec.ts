import { describe, expect, it, vi } from 'vitest';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoiceDeliveryService } from './invoice-delivery.service.js';

function fixture({ chequeEvents = 0, method = 'cash' } = {}) {
  const invoice: any = { id: 'inv', invoiceNumber: 'INV-1', businessId: 'business', branchId: 'branch', deletedAt: null, status: InvoiceStatus.PARTIALLY_PAID, grandTotal: new Prisma.Decimal(100), amountPaid: new Prisma.Decimal(60) };
  const payments: any[] = [{ id: 'pay', invoiceId: 'inv', amount: new Prisma.Decimal(60), method, accountId: null, reference: null }];
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    paymentRecord: {
      findFirst: vi.fn(async ({ where }: any) => (payments.some(({ id }) => id === where.id) && where.invoice.branchId === invoice.branchId ? { invoiceId: 'inv' } : null)),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ ...payments.find(({ id }) => id === where.id), invoice: { ...invoice } })),
      update: vi.fn(async ({ where, data }: any) => { const payment = payments.find(({ id }) => id === where.id); Object.entries(data).forEach(([key, value]) => { if (value !== undefined) payment[key] = value; }); return { ...payment }; }),
      delete: vi.fn(async ({ where }: any) => payments.splice(payments.findIndex(({ id }) => id === where.id), 1)),
    },
    businessDocument: { aggregate: vi.fn(async () => ({ _sum: { grandTotal: null } })) },
    chequeEvent: { count: vi.fn(async () => chequeEvents) },
    cashAccount: { findFirst: vi.fn(async () => ({ id: 'acct' })) },
    invoice: { update: vi.fn(async ({ data }: any) => Object.assign(invoice, data)) },
  };
  const prisma: any = { ...tx, $transaction: (action: (client: any) => Promise<unknown>) => action(tx) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return { invoice, payments, audit, service: new InvoicesService(prisma as PrismaService, audit as unknown as AuditService, {} as InvoiceDeliveryService) };
}

describe('payment-in corrections', () => {
  it('changes an amount and moves the invoice to paid, refusing more than the invoice total', async () => {
    const f = fixture();
    await f.service.updatePayment('pay', { amount: 100, reference: ' UTR-1 ' }, 'user', 'business', 'branch');
    expect(f.invoice).toMatchObject({ amountPaid: 100, status: InvoiceStatus.PAID });
    expect(f.payments[0].reference).toBe('UTR-1');
    await expect(f.service.updatePayment('pay', { amount: 100.01 }, 'user', 'business', 'branch')).rejects.toThrow('more than the invoice balance');
  });

  it('deletes a payment and reopens the invoice', async () => {
    const f = fixture();
    await f.service.deletePayment('pay', 'user', 'business', 'branch');
    expect(f.payments).toHaveLength(0);
    expect(f.invoice).toMatchObject({ amountPaid: 0, status: InvoiceStatus.UNPAID });
    expect(f.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PAYMENT_DELETED', metadata: expect.objectContaining({ amount: 60, invoiceNumber: 'INV-1' }) }));
  });

  it('protects cheques with deposit history, but still allows fixing the reference', async () => {
    const f = fixture({ chequeEvents: 1, method: 'cheque' });
    await expect(f.service.deletePayment('pay', 'user', 'business', 'branch')).rejects.toThrow('Reverse it in Cheques');
    await expect(f.service.updatePayment('pay', { amount: 50 }, 'user', 'business', 'branch')).rejects.toThrow('Reverse it in Cheques');
    await f.service.updatePayment('pay', { reference: 'CHQ 001234' }, 'user', 'business', 'branch');
    expect(f.payments[0].reference).toBe('CHQ 001234');
  });

  it('does not reach payments in another branch', async () => {
    const f = fixture();
    await expect(f.service.deletePayment('pay', 'user', 'business', 'other')).rejects.toThrow('Payment not found');
  });
});
