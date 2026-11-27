import { describe, expect, it, vi } from 'vitest';
import { DocumentType } from '@prisma/client';
import { DocumentsService } from './documents.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';
import type { InvoicesService } from '../invoices/invoices.service.js';
import type { PaymentOutService } from '../payment-out/payment-out.service.js';

/** A branch with some quotations already saved, and a DocumentsService that saves into it. */
function fixture(saved: Array<{ documentNumber: string; issueDate: string; deletedAt?: Date | null }>) {
  const docs: any[] = saved.map((doc, index) => ({ id: `d${index}`, branchId: 'branch', businessId: 'business', type: DocumentType.QUOTATION, deletedAt: null, ...doc, issueDate: new Date(doc.issueDate) }));
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: 'business', gstRegistered: false, preferences: {} }),
      findFirst: vi.fn().mockResolvedValue({ workspaceBranchId: null }),
    },
    branch: { findMany: vi.fn().mockResolvedValue([{ id: 'branch' }]) },
    party: { findFirst: vi.fn().mockResolvedValue({ id: 'party' }) },
    businessDocument: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(async ({ where }: any) => docs.filter((doc) => doc.branchId === where.branchId && doc.documentNumber.startsWith(where.documentNumber.startsWith))),
      count: vi.fn(async ({ where }: any) => docs.filter((doc) => doc.type === where.type && doc.issueDate >= where.issueDate.gte && doc.issueDate < where.issueDate.lt).length),
      create: vi.fn(async ({ data }: any) => {
        // The database's @@unique([branchId, documentNumber]).
        if (docs.some((doc) => doc.branchId === data.branchId && doc.documentNumber === data.documentNumber)) throw new Error(`Unique constraint failed: ${data.documentNumber}`);
        const created = { id: `d${docs.length}`, ...data };
        docs.push(created);
        return created;
      }),
    },
  };
  db.$transaction = (action: (tx: any) => Promise<unknown>) => action(db);
  const service = new DocumentsService(db as PrismaService, { log: vi.fn() } as unknown as AuditService, {} as InvoicesService, {} as PaymentOutService);
  const create = (issueDate: string) => service.create({ type: DocumentType.QUOTATION, status: 'DRAFT', partyId: 'party', issueDate, items: [{ description: 'Item', quantity: 1, unitPrice: 100, taxRate: 0 }] } as any, 'user', 'business', 'branch');
  return { create, docs };
}

describe('document numbering', () => {
  it('continues after the highest number of the year', async () => {
    const f = fixture([{ documentNumber: 'QUO-2026-000001', issueDate: '2026-02-01' }, { documentNumber: 'QUO-2026-000002', issueDate: '2026-03-01' }]);
    expect((await f.create('2026-04-01')).documentNumber).toBe('QUO-2026-000003');
    expect((await f.create('2027-01-05')).documentNumber).toBe('QUO-2027-000001');
  });

  it('does not reuse a number when a document was moved to another year or deleted', async () => {
    // QUO-2026-000002 had its date edited into 2027, and QUO-2026-000003 was deleted. Counting this
    // year's documents gave 1 → number 000002, which already exists, so every new quotation failed.
    const f = fixture([
      { documentNumber: 'QUO-2026-000001', issueDate: '2026-02-01' },
      { documentNumber: 'QUO-2026-000002', issueDate: '2027-01-10' },
      { documentNumber: 'QUO-2026-000003', issueDate: '2026-03-01', deletedAt: new Date() },
    ]);
    expect((await f.create('2026-05-01')).documentNumber).toBe('QUO-2026-000004');
    expect((await f.create('2026-05-02')).documentNumber).toBe('QUO-2026-000005');
  });
});
