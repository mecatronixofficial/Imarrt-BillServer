import { describe, expect, it, vi } from 'vitest';
import { DocumentStatus, DocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { DocumentsService } from './documents.service.js';
import type { PaymentOutService } from '../payment-out/payment-out.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoiceDeliveryService } from '../invoices/invoice-delivery.service.js';

function fixture(type: DocumentType = DocumentType.QUOTATION) {
  let stock = 8;
  const movements: any[] = [], payments: any[] = [];
  const line = { itemId: 'item', description: 'Product', quantity: new Prisma.Decimal(2), unit: 'pcs', unitPrice: new Prisma.Decimal(50), taxRate: new Prisma.Decimal(0), taxInclusive: false, lotNo: 'LOT-1' };
  const source: any = { id: 'source', businessId: 'business', branchId: 'branch', type, status: DocumentStatus.CONVERTED, documentNumber: 'EST-001', convertedInvoiceId: 'sale', sourceDocumentId: null, deletedAt: null, stockAdjusted: false, paidAmount: 0, items: [line], partyId: 'party', issueDate: new Date('2026-11-01'), discount: 0, grandTotal: 100, terms: 'Terms', notes: 'Original note' };
  const sale: any = { id: 'sale', businessId: 'business', branchId: 'branch', invoiceNumber: 'INV-001', status: InvoiceStatus.UNPAID, amountPaid: 0, deletedAt: null, items: [line], grandTotal: 100 };
  const docs: any[] = [source];
  function matches(record: any, where: any) {
    return Object.entries(where).every(([key, value]: any) => {
      if (value === undefined) return true;
      if (value && typeof value === 'object') {
        if ('not' in value) return record[key] !== value.not;
        if ('notIn' in value) return !value.notIn.includes(record[key]);
        if ('in' in value) return value.in.includes(record[key]);
      }
      return (record[key] ?? null) === value;
    });
  }
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    businessDocument: {
      findFirst: vi.fn(async ({ where }: any) => docs.find((document) => matches(document, where)) ?? null),
      findMany: vi.fn(async ({ where }: any) => docs.filter((document) => matches(document, where))),
      count: vi.fn(async ({ where }: any) => docs.filter((document) => matches(document, where)).length),
      update: vi.fn(async ({ where, data }: any) => Object.assign(docs.find((document) => document.id === where.id), data)),
    },
    invoice: {
      findFirst: vi.fn(async ({ where }: any) => matches(sale, where) ? { ...sale } : null),
      update: vi.fn(async ({ data }: any) => Object.assign(sale, data)),
    },
    paymentRecord: { count: vi.fn(async () => payments.length) },
    stockMovement: { create: vi.fn(async ({ data }: any) => movements.push(data)) },
    item: { updateMany: vi.fn(async ({ data }: any) => { stock += Number(data.stockQty.increment ?? 0) - Number(data.stockQty.decrement ?? 0); return { count: 1 }; }) },
  };
  let queue = Promise.resolve();
  const prisma: any = { ...tx, $transaction: (action: (tx: any) => Promise<any>) => {
    const next = queue.then(async () => {
      const snapshot = { stock, sale: { ...sale }, docs: docs.map((document) => ({ ...document })), movements: [...movements] };
      try { return await action(tx); } catch (error) {
        stock = snapshot.stock; Object.assign(sale, snapshot.sale);
        for (const copy of snapshot.docs) Object.assign(docs.find((document) => document.id === copy.id), copy);
        movements.splice(0, movements.length, ...snapshot.movements);
        throw error;
      }
    });
    queue = next.then(() => undefined, () => undefined);
    return next;
  } };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const invoices = new InvoicesService(prisma as PrismaService, audit as unknown as AuditService, {} as InvoiceDeliveryService);
  const documents = new DocumentsService(prisma as PrismaService, audit as unknown as AuditService, invoices, {} as PaymentOutService);
  const reverse = (targetId = 'sale', businessId = 'business', branchId = 'branch') => documents.reverseConversion('source', targetId, 'user', businessId, branchId);
  const target = (targetType: DocumentType = DocumentType.PROFORMA_INVOICE) => {
    source.convertedInvoiceId = null;
    const child = { ...source, id: 'child', documentNumber: 'PRO-001', type: targetType, sourceDocumentId: source.id, status: DocumentStatus.DRAFT, convertedInvoiceId: null };
    docs.push(child); return child;
  };
  return { source, sale, docs, tx, payments, movements, audit, invoices, documents, reverse, target, stock: () => stock };
}

describe('reversible estimate and proforma conversions', () => {
  it.each([DocumentType.QUOTATION, DocumentType.PROFORMA_INVOICE])('restores the original %s and reverses an unpaid sale exactly once', async (type) => {
    const f = fixture(type);
    const result = await f.reverse();
    expect(result).toMatchObject({ id: 'source', documentNumber: 'EST-001', type, status: 'DRAFT', convertedInvoiceId: null, deletedAt: null, notes: 'Original note' });
    expect(f.source.items[0]).toMatchObject({ lotNo: 'LOT-1' });
    expect(f.sale).toMatchObject({ status: 'CANCELLED', deletedAt: expect.any(Date) });
    expect(f.stock()).toBe(10);
    await f.reverse();
    expect(f.stock()).toBe(10); expect(f.movements).toHaveLength(1); expect(f.audit.log).toHaveBeenCalledTimes(1);
  });

  it('does not change a paid sale or its original source', async () => {
    const f = fixture(); f.sale.amountPaid = 20;
    await expect(f.reverse()).rejects.toThrow('recorded payments');
    expect(f.source.status).toBe('CONVERTED'); expect(f.sale.deletedAt).toBeNull(); expect(f.stock()).toBe(8);
  });

  it('protects stored receipts even if the cached paid total is inconsistent', async () => {
    const f = fixture(); f.payments.push({ amount: 20 });
    await expect(f.reverse()).rejects.toThrow('recorded payments'); expect(f.stock()).toBe(8);
  });

  it('requires linked credit notes to be reversed first', async () => {
    const f = fixture(); f.docs.push({ id: 'credit', referenceInvoiceId: 'sale', type: 'CREDIT_NOTE', status: 'ISSUED', deletedAt: null });
    await expect(f.reverse()).rejects.toThrow('linked credit notes'); expect(f.source.status).toBe('CONVERTED'); expect(f.stock()).toBe(8);
  });

  it('enforces source and sale company/branch boundaries', async () => {
    const f = fixture();
    await expect(f.reverse('sale', 'other-business')).rejects.toThrow('not found');
    await expect(f.reverse('sale', 'business', 'other-branch')).rejects.toThrow('not found');
    f.sale.branchId = 'other-branch';
    await expect(f.reverse()).rejects.toThrow('not found'); expect(f.stock()).toBe(8);
  });

  it('cannot reverse a newer conversion using a stale target identifier', async () => {
    const f = fixture(); f.source.convertedInvoiceId = 'new-sale';
    await expect(f.reverse('sale')).rejects.toThrow('conversion changed'); expect(f.source.status).toBe('CONVERTED'); expect(f.stock()).toBe(8);
  });

  it('rolls back the stock and sale reversal if reopening the source fails', async () => {
    const f = fixture(); f.tx.businessDocument.update.mockRejectedValueOnce(new Error('Source update failed'));
    await expect(f.reverse()).rejects.toThrow('Source update failed');
    expect(f.stock()).toBe(8); expect(f.sale.status).toBe('UNPAID'); expect(f.sale.deletedAt).toBeNull(); expect(f.movements).toHaveLength(0);
  });

  it('archives the generated proforma and keeps the original estimate number and details', async () => {
    const f = fixture(); const child = f.target();
    await f.reverse(child.id);
    expect(f.source).toMatchObject({ id: 'source', status: 'DRAFT', documentNumber: 'EST-001' });
    expect(child).toMatchObject({ status: 'CANCELLED', deletedAt: expect.any(Date), sourceDocumentId: 'source' });
    expect(f.stock()).toBe(8);
  });

  it('returns a generated estimate to its standalone proforma source', async () => {
    const f = fixture(DocumentType.PROFORMA_INVOICE); const child = f.target(DocumentType.QUOTATION);
    await f.reverse(child.id); expect(f.source.status).toBe('DRAFT'); expect(child.deletedAt).toBeInstanceOf(Date);
  });

  it('requires the latest conversion in a chain to be undone first', async () => {
    const f = fixture(); const child = f.target(); child.status = DocumentStatus.CONVERTED; child.convertedInvoiceId = 'sale';
    await expect(f.reverse(child.id)).rejects.toThrow('later conversion');
    await f.documents.reverseConversion(child.id, 'sale', 'user', 'business', 'branch');
    await f.reverse(child.id);
    expect(f.source.status).toBe('DRAFT'); expect(child.deletedAt).toBeInstanceOf(Date); expect(f.stock()).toBe(10);
  });

  it('rejects a different generated document and posted child stock', async () => {
    const f = fixture(); const child = f.target();
    await expect(f.reverse('wrong-child')).rejects.toThrow('conversion changed');
    child.stockAdjusted = true;
    await expect(f.reverse(child.id)).rejects.toThrow('stock transaction'); expect(f.source.status).toBe('CONVERTED');
  });

  it('creates an estimate from a proforma with the same line metadata and links it to its source', async () => {
    const f = fixture(DocumentType.PROFORMA_INVOICE); f.source.status = DocumentStatus.ISSUED; f.source.convertedInvoiceId = null;
    const create = vi.spyOn(f.documents, 'create').mockImplementation(async (dto: any) => {
      const created = { ...f.source, ...dto, id: 'created-estimate', documentNumber: 'EST-002' };
      f.docs.push(created); return created;
    });
    const result = await f.documents.convertToEstimate('source', 'user', 'business', 'branch');
    expect(result).toMatchObject({ type: 'QUOTATION', sourceDocumentId: 'source', status: 'DRAFT' });
    expect(create.mock.calls[0][0].items[0]).toMatchObject({ quantity: 2, unitPrice: 50, lotNo: 'LOT-1', taxInclusive: false });
    const retry = await f.documents.convertToEstimate('source', 'user', 'business', 'branch');
    expect(retry.id).toBe(result.id); expect(create).toHaveBeenCalledTimes(1);
  });

  it('can reconvert a restored estimate to proforma without reusing its archived target', async () => {
    const f = fixture(); const child = f.target(); await f.reverse(child.id);
    vi.spyOn(f.documents, 'create').mockImplementation(async (dto: any) => ({ ...f.source, ...dto, id: 'new-proforma' }));
    const result = await f.documents.convertToProforma('source', 'user', 'business', 'branch');
    expect(result.id).toBe('new-proforma'); expect(f.source.status).toBe('CONVERTED'); expect(child.deletedAt).toBeInstanceOf(Date);
  });
});
