import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { DocumentsService, purchasePaymentType } from './documents.service.js';
import type { PaymentOutService } from '../payment-out/payment-out.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoicesService } from '../invoices/invoices.service.js';

describe('purchase bill payment type', () => {
  it('prefers the latest payment account, then its method, then the bill method', () => {
    expect(purchasePaymentType({ paymentMethod: 'cash', payments: [{ method: 'bank_transfer', account: { bankName: 'Kotak Mahindra Bank' } }] })).toBe('Kotak Mahindra Bank');
    expect(purchasePaymentType({ paymentMethod: 'cash', payments: [{ method: 'upi', account: null }] })).toBe('UPI');
    expect(purchasePaymentType({ paymentMethod: 'credit', payments: [] })).toBe('Credit');
    expect(purchasePaymentType({ paymentMethod: null })).toBeNull();
  });
});

describe('purchase bill register listing', () => {
  function service() {
    const findMany = vi.fn(async () => [{
      id: 'bill', type: DocumentType.PURCHASE_INVOICE, paymentMethod: 'credit',
      grandTotal: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(40),
      convertedDocuments: [{ grandTotal: new Prisma.Decimal(10) }],
      payments: [{ method: 'cash', account: { bankName: 'HDFC Bank' } }],
    }]);
    const documents = new DocumentsService({ businessDocument: { findMany } } as unknown as PrismaService, {} as AuditService, {} as InvoicesService, {} as PaymentOutService);
    return { documents, findMany };
  }

  it('filters by an inclusive issue-date range and godown, and labels the payment type', async () => {
    const { documents, findMany } = service();
    const [bill] = await documents.findAll('business', 'branch', { type: DocumentType.PURCHASE_INVOICE, from: '2026-10-01', to: '2026-10-31', warehouseId: 'godown', limit: 50, offset: 0 });
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where.issueDate).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z'), lt: new Date('2026-11-01T00:00:00.000Z') });
    expect(where.warehouseId).toBe('godown');
    expect(bill).toMatchObject({ paymentType: 'HDFC Bank', debitTotal: 10, balanceDue: 50 });
    expect(bill).not.toHaveProperty('payments');
  });

  it('rejects a reversed date range', async () => {
    const { documents } = service();
    await expect(documents.findAll('business', 'branch', { from: '2026-11-02', to: '2026-11-01', limit: 50, offset: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
