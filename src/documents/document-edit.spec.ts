import { describe, expect, it, vi } from 'vitest';
import { DocumentStatus, DocumentType, Prisma } from '@prisma/client';

const adjustStock = vi.hoisted(() => vi.fn());
vi.mock('../common/utils/billing-transaction.util.js', async (original) => ({ ...(await original<object>()), adjustStock }));
vi.mock('../common/utils/workspace-scope.util.js', () => ({ getLogicalBranchIds: async () => ['branch'], getWorkspaceBusinessIds: async () => ['business'] }));

const { DocumentsService } = await import('./documents.service.js');
type Prisma_ = import('../prisma/prisma.service.js').PrismaService;

const SUPPLIER = '00000000-0000-4000-8000-000000000001';
const bill = () => ({
  id: 'bill', businessId: 'business', branchId: 'branch', type: DocumentType.PURCHASE_INVOICE, status: DocumentStatus.ISSUED as DocumentStatus,
  documentNumber: 'PUR-2026-000001', supplierId: SUPPLIER, paidAmount: new Prisma.Decimal(0), stockAdjusted: true, returnStock: false,
  issueDate: new Date('2026-11-01'), warehouseId: null, referenceInvoiceId: null, sourceDocumentId: null, paymentMethod: 'credit', grandTotal: new Prisma.Decimal(100),
  items: [{ itemId: 'item', description: 'Rod', quantity: new Prisma.Decimal(2) }],
});

function fixture(existing = bill(), children = 0) {
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    business: { findUnique: vi.fn(async () => ({ id: 'business', gstRegistered: true, preferences: null })) },
    supplier: { findFirst: vi.fn(async () => ({ id: SUPPLIER })) },
    item: { count: vi.fn(async () => 1) },
    businessDocument: {
      findFirst: vi.fn(async () => existing),
      count: vi.fn(async () => children),
      update: vi.fn(async ({ data }: any) => ({ ...existing, ...data, items: data.items.create })),
    },
  };
  const prisma: any = { ...tx, $transaction: (action: (client: any) => Promise<unknown>) => action(tx) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return { tx, service: new DocumentsService(prisma as Prisma_, audit as any, {} as any, {} as any) };
}

const edit = { type: DocumentType.PURCHASE_INVOICE, supplierId: SUPPLIER, items: [{ itemId: 'item', description: 'Rod', quantity: 5, unitPrice: 20, taxRate: 0 }] };

describe('editing business documents', () => {
  it('reverses the old stock, applies the new quantities and keeps the number and status', async () => {
    adjustStock.mockClear();
    const f = fixture();
    const updated = await f.service.update('bill', edit as any, 'user', 'business', 'branch');
    expect(updated).toMatchObject({ documentNumber: 'PUR-2026-000001', status: DocumentStatus.ISSUED, stockAdjusted: true });
    expect(adjustStock.mock.calls.map(([, lines, direction]) => [direction, lines[0].quantity])).toEqual([['decrement', 2], ['increment', 5]]);
  });

  it('refuses paid bills, documents others were made from, and type changes', async () => {
    await expect(fixture({ ...bill(), paidAmount: new Prisma.Decimal(10) }).service.update('bill', edit as any, 'user', 'business', 'branch')).rejects.toThrow('Void the payments');
    await expect(fixture(bill(), 1).service.update('bill', edit as any, 'user', 'business', 'branch')).rejects.toThrow('Cancel the returns');
    await expect(fixture().service.update('bill', { ...edit, type: DocumentType.DEBIT_NOTE } as any, 'user', 'business', 'branch')).rejects.toThrow('cannot change its type');
    await expect(fixture({ ...bill(), status: DocumentStatus.CANCELLED }).service.update('bill', edit as any, 'user', 'business', 'branch')).rejects.toThrow('cannot be edited');
  });

  it('does not reset an issued document to draft', async () => {
    await expect(fixture().service.update('bill', { ...edit, status: DocumentStatus.DRAFT } as any, 'user', 'business', 'branch')).rejects.toThrow('reset to draft');
  });
});
