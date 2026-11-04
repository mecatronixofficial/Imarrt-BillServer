import { describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Member = { businessId: string; userId: string; isActive: boolean; createdAt: Date; user: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: Date; mfaEnabled: boolean } };

function fixture() {
  const person = (id: string, role: string) => ({ id, name: id, email: `${id}@x.in`, role, isActive: true, createdAt: new Date('2026-01-01'), mfaEnabled: false });
  const members: Member[] = [
    { businessId: 'b1', userId: 'owner', isActive: true, createdAt: new Date('2026-01-01'), user: person('owner', 'OWNER') },
    { businessId: 'b1', userId: 'staff', isActive: true, createdAt: new Date('2026-02-01'), user: person('staff', 'STAFF') },
    { businessId: 'b2', userId: 'acct', isActive: true, createdAt: new Date('2026-02-01'), user: person('acct', 'ACCOUNTANT') },
    { businessId: 'b1', userId: 'acct', isActive: true, createdAt: new Date('2026-03-01'), user: person('acct', 'ACCOUNTANT') },
  ];
  const find = (where: { businessId_userId: { businessId: string; userId: string } }) => members.find((m) => m.businessId === where.businessId_userId.businessId && m.userId === where.businessId_userId.userId);
  const sessions = { updateMany: vi.fn(async () => ({ count: 1 })), groupBy: vi.fn(async () => [{ userId: 'staff', _max: { lastUsedAt: new Date('2026-11-03T10:00:00Z') } }]) };
  const businessMember = {
    findUnique: vi.fn(async ({ where }: { where: Parameters<typeof find>[0] }) => find(where) ?? null),
    update: vi.fn(async ({ where, data }: { where: Parameters<typeof find>[0]; data: { isActive: boolean } }) => Object.assign(find(where)!, data)),
    delete: vi.fn(async ({ where }: { where: Parameters<typeof find>[0] }) => members.splice(members.indexOf(find(where)!), 1)[0]),
    count: vi.fn(async ({ where }: { where: { userId: string; isActive: boolean } }) => members.filter((m) => m.userId === where.userId && m.isActive).length),
  };
  const auditLog = { create: vi.fn(async () => ({})), findMany: vi.fn(async () => [{ id: 'a', action: 'INVOICE_CREATED', entityType: 'Invoice', createdAt: new Date() }]) };
  const prisma = {
    businessMember, authSession: sessions, auditLog,
    invoice: { count: vi.fn(async () => 4) },
    businessDocument: { count: vi.fn(async () => 2) },
    $transaction: (action: (tx: unknown) => Promise<unknown>) => action({ businessMember, authSession: sessions }),
  };
  return { members, prisma, service: new UsersService(prisma as unknown as PrismaService) };
}

describe('team actions', () => {
  it('views a member with their last activity and what they recorded here', async () => {
    const f = fixture();
    await expect(f.service.findOne('staff', 'b1')).resolves.toMatchObject({ id: 'staff', role: 'STAFF', isActive: true, lastActiveAt: new Date('2026-11-03T10:00:00Z'), activity: { invoices: 4, documents: 2 }, recent: [expect.objectContaining({ action: 'INVOICE_CREATED' })] });
    await expect(f.service.findOne('acct', 'b9')).rejects.toThrow('not found');
  });

  it('deactivates and re-activates staff, but never the owner or yourself', async () => {
    const f = fixture();
    await f.service.deactivate('staff', 'owner', 'b1');
    expect(f.members[1].isActive).toBe(false);
    await f.service.activate('staff', 'owner', 'b1');
    expect(f.members[1].isActive).toBe(true);
    await expect(f.service.deactivate('owner', 'someone', 'b1')).rejects.toThrow('Owners');
    await expect(f.service.deactivate('owner', 'owner', 'b1')).rejects.toThrow('your own');
    expect(f.prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'TEAM_MEMBER_ACTIVATED', entityId: 'staff', businessId: 'b1' }) });
  });

  it('removes a member from this company only, signing them out when no company is left', async () => {
    const f = fixture();
    await f.service.remove('acct', 'owner', 'b1');
    expect(f.members.filter((m) => m.userId === 'acct').map((m) => m.businessId)).toEqual(['b2']);
    expect(f.prisma.authSession.updateMany).not.toHaveBeenCalled();
    await f.service.remove('staff', 'owner', 'b1');
    expect(f.prisma.authSession.updateMany).toHaveBeenCalledWith({ where: { userId: 'staff', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    await expect(f.service.remove('owner', 'owner', 'b1')).rejects.toThrow('your own');
  });
});
