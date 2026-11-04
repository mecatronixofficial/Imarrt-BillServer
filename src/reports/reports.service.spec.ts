import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from './reports.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const owner = { id: 'u1', name: 'Owner' };
function fixture() {
  const list = (rows: unknown[]) => ({ findMany: vi.fn(async () => rows) });
  const prisma = {
    invoice: list([{
      id: 'inv', invoiceNumber: 'INV-1', issueDate: new Date('2026-10-01'), dueDate: new Date('2026-10-05'), status: 'UNPAID', grandTotal: 1000, amountPaid: 300, warehouseId: 'g1',
      party: { id: 'p', name: 'Ze Mayans' }, createdBy: owner, relatedDocuments: [{ grandTotal: 200 }], payments: [{ method: 'upi' }],
    }]),
    paymentRecord: list([{ id: 'pay', amount: 300, method: 'upi', reference: '44', paidAt: new Date('2026-10-02'), invoice: { id: 'inv', invoiceNumber: 'INV-1', warehouseId: 'g1', party: { name: 'Ze Mayans' }, createdBy: owner } }]),
    businessDocument: list([
      { id: 'bill', type: 'PURCHASE_INVOICE', status: 'ISSUED', documentNumber: 'PUR-1', referenceNumber: null, issueDate: new Date('2026-10-03'), dueDate: null, validUntil: null, grandTotal: 500, paidAmount: 100, paymentMethod: 'credit', warehouseId: null, party: null, supplier: { id: 's', name: 'Texas Clothing' }, createdBy: owner, convertedDocuments: [{ grandTotal: 50 }], payments: [] },
      { id: 'est', type: 'QUOTATION', status: 'ISSUED', documentNumber: 'QUO-1', referenceNumber: '2026-27/2', issueDate: new Date('2026-10-06'), dueDate: null, validUntil: new Date('2026-10-20'), grandTotal: 900, paidAmount: 0, paymentMethod: null, warehouseId: null, party: { id: 'p2', name: 'Dr G' }, supplier: null, createdBy: owner, convertedDocuments: [], payments: [] },
    ]),
    paymentOutReceipt: list([]),
    purchaseOrder: list([]),
    expense: list([{ id: 'exp', description: 'Tea', category: 'Office', expenseDate: new Date('2026-10-04'), total: 40, method: 'cash', reference: null, status: 'ISSUED', createdById: 'u1' }]),
    financeEntry: list([{ id: 'emi', kind: 'LOAN_PAYMENT', name: 'Surendar', notes: null, amount: -15000, entryDate: new Date('2026-10-15'), accountId: null, referenceId: 'loan', createdById: 'u1' }]),
    user: list([owner]),
    loanAccount: list([{ id: 'loan', name: 'Surendar' }]),
  };
  return { prisma, service: new ReportsService(prisma as unknown as PrismaService) };
}

describe('all transactions report', () => {
  it('lists every kind of transaction newest first, with balances net of returns', async () => {
    const f = fixture();
    const rows = await f.service.transactions('business', undefined, { from: '2026-10-01', to: '2026-10-31' });
    expect(rows.map((r) => r.type)).toEqual(['EMI Paid', 'Estimate', 'Expense', 'Purchase', 'Payment-In', 'Sale']);
    expect(rows.find((r) => r.kind === 'SALE')).toMatchObject({ number: 'INV-1', total: 1000, paid: 300, balance: 500, paymentType: 'upi', warehouseId: 'g1', createdByName: 'Owner', href: '/invoices/inv' });
    expect(rows.find((r) => r.kind === 'PURCHASE')).toMatchObject({ partyName: 'Texas Clothing', balance: 350, paymentType: 'credit' });
    expect(rows.find((r) => r.kind === 'ESTIMATE')).toMatchObject({ number: '2026-27/2', balance: 0, dueDate: new Date('2026-10-20') });
    expect(rows.find((r) => r.kind === 'EMI')).toMatchObject({ partyName: 'Surendar', category: 'Loan EMI', total: 15000, paymentType: 'cash' });
    expect(rows.find((r) => r.kind === 'EXPENSE')).toMatchObject({ partyName: 'Tea', category: 'Office', createdByName: 'Owner' });
  });

  it('filters by type on the server and checks the period', async () => {
    const f = fixture();
    const rows = await f.service.transactions('business', 'branch', { from: '2026-10-01', to: '2026-10-31', type: 'SALE' });
    expect(rows.map((r) => r.kind)).toEqual(['SALE']);
    expect(f.prisma.businessDocument.findMany).not.toHaveBeenCalled();
    expect(f.prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 'business', branchId: 'branch', issueDate: { gte: new Date('2026-10-01T00:00:00.000Z'), lt: new Date('2026-11-01T00:00:00.000Z') } }) }));
    await expect(f.service.transactions('business', undefined, { from: '2026-11-01', to: '2026-10-01' })).rejects.toThrow('From date');
  });
});
