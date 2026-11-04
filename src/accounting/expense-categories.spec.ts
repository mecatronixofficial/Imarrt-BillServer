import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../common/utils/audit.service.js';

const page = { limit: 50, offset: 0 };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function fixture() {
  const categories: any[] = [{ id: 'rent', businessId: 'business', branchId: 'branch', name: 'Rent' }, { id: 'travel', businessId: 'business', branchId: 'branch', name: 'Travel' }];
  const expenses: any[] = [
    { id: 'e1', businessId: 'business', branchId: 'branch', category: 'Rent', status: 'ISSUED', total: 1000 },
    { id: 'e2', businessId: 'business', branchId: 'branch', category: 'Rent', status: 'CANCELLED', total: 50 },
  ];
  // The fake matches names case-insensitively, like the database collation.
  const findCategory = ({ where }: any) => categories.find((c) => (!where.id || (typeof where.id === 'string' ? c.id === where.id : c.id !== where.id.not)) && (!where.name || same(c.name, where.name)) && c.branchId === where.branchId) ?? null;
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    expenseCategory: {
      findMany: vi.fn(async () => [...categories].sort((a, b) => a.name.localeCompare(b.name))),
      findFirst: vi.fn(async (args: any) => findCategory(args)),
      create: vi.fn(async ({ data }: any) => { const row = { id: `c${categories.length + 1}`, ...data }; categories.push(row); return row; }),
      upsert: vi.fn(async ({ where, create }: any) => findCategory({ where: where.branchId_name }) ?? tx.expenseCategory.create({ data: create })),
      update: vi.fn(async ({ where, data }: any) => Object.assign(categories.find((c) => c.id === where.id), data)),
      delete: vi.fn(async ({ where }: any) => categories.splice(categories.findIndex((c) => c.id === where.id), 1)),
    },
    expense: {
      groupBy: vi.fn(async () => {
        const rows = new Map<string, any>();
        for (const e of expenses.filter((row) => row.status === 'ISSUED')) {
          const row = rows.get(e.category) ?? { branchId: e.branchId, category: e.category, _sum: { total: 0 }, _count: { _all: 0 } };
          row._sum.total += e.total; row._count._all += 1; rows.set(e.category, row);
        }
        return [...rows.values()];
      }),
      count: vi.fn(async ({ where }: any) => expenses.filter((e) => same(e.category, where.category)).length),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = expenses.filter((e) => same(e.category, where.category)); hit.forEach((e) => Object.assign(e, data)); return { count: hit.length }; }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => { const row = { id: `e${expenses.length + 1}`, status: 'ISSUED', ...data }; expenses.push(row); return row; }),
    },
    cashAccount: { findFirst: vi.fn(async () => ({ id: 'acct' })) },
  };
  const prisma: any = { ...tx, $transaction: (action: (client: any) => Promise<unknown>) => action(tx) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return { service: new AccountingService(prisma as PrismaService, audit as unknown as AuditService), categories, expenses };
}

describe('expense categories', () => {
  it('lists categories with totals of active expenses only, including empty ones', async () => {
    const f = fixture();
    expect(await f.service.expenseCategories('business', 'branch', page)).toEqual([
      expect.objectContaining({ name: 'Rent', total: 1000, count: 1 }),
      expect.objectContaining({ name: 'Travel', total: 0, count: 0 }),
    ]);
  });

  it('adds a category and refuses a duplicate name in any letter case', async () => {
    const f = fixture();
    await expect(f.service.createExpenseCategory({ name: '  Electricity ' }, 'user', 'business', 'branch')).resolves.toMatchObject({ name: 'Electricity', total: 0 });
    await expect(f.service.createExpenseCategory({ name: 'rent' }, 'user', 'business', 'branch')).rejects.toBeInstanceOf(ConflictException);
  });

  it('renames a category together with its expenses', async () => {
    const f = fixture();
    await f.service.renameExpenseCategory('rent', { name: 'Office Rent' }, 'user', 'business', 'branch');
    expect(f.expenses.map((e) => e.category)).toEqual(['Office Rent', 'Office Rent']);
    await expect(f.service.renameExpenseCategory('rent', { name: 'travel' }, 'user', 'business', 'branch')).rejects.toBeInstanceOf(ConflictException);
  });

  it('only deletes a used category when its expenses move to another one', async () => {
    const f = fixture();
    await expect(f.service.deleteExpenseCategory('rent', {}, 'user', 'business', 'branch')).rejects.toThrow('2 expenses use this category');
    await expect(f.service.deleteExpenseCategory('rent', { moveTo: 'rent' }, 'user', 'business', 'branch')).rejects.toThrow('different category');
    await expect(f.service.deleteExpenseCategory('rent', { moveTo: 'travel' }, 'user', 'business', 'branch')).resolves.toMatchObject({ moved: 2, movedTo: 'Travel' });
    expect(f.categories.map((c) => c.name)).toEqual(['Travel']);
    expect(f.expenses.every((e) => e.category === 'Travel')).toBe(true);
    await expect(f.service.deleteExpenseCategory('travel', { moveTo: undefined }, 'user', 'business', 'branch')).rejects.toThrow('Choose a category');
  });

  it('files a new expense under an existing category spelling, or adds a new category', async () => {
    const f = fixture();
    const base = { description: ' Office rent ', expenseDate: '2026-11-03', amount: 500, method: 'cash' };
    expect(await f.service.createExpense({ ...base, category: 'RENT' }, 'user', 'business', 'branch')).toMatchObject({ category: 'Rent', description: 'Office rent' });
    expect(await f.service.createExpense({ ...base, category: 'Snacks' }, 'user', 'business', 'branch')).toMatchObject({ category: 'Snacks' });
    expect(f.categories.map((c) => c.name)).toContain('Snacks');
  });
});
