import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hash } from 'bcryptjs';
import { ActionSecurityService } from './action-security.service.js';
import { ActionSecurityGuard } from './action-security.guard.js';

const record = { userId: 'actor', enabled: true, passcodeHash: '', failedAttempts: 0, lockedUntil: null as Date | null, updatedAt: new Date() };
let prisma: any;
let service: ActionSecurityService;
beforeEach(async () => {
  record.passcodeHash = await hash('123456', 4); record.failedAttempts = 0; record.lockedUntil = null; record.enabled = true;
  prisma = { actionSecurity: {
    findUnique: vi.fn(async () => ({ ...record })),
    update: vi.fn(async ({ data }: any) => { if (data.failedAttempts?.increment) record.failedAttempts += data.failedAttempts.increment; else Object.assign(record, data); return { ...record }; }),
    updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(),
  }, auditLog: { create: vi.fn() }, $transaction: vi.fn(async (work: any) => work(prisma)) };
  service = new ActionSecurityService(prisma);
});

describe('action passcode enforcement', () => {
  it('returns only the enabled flag to settings', async () => {
    expect(await service.status('actor')).toEqual({ enabled: true });
  });
  it('rejects missing and incorrect passcodes before a mutation', async () => {
    await expect(service.verify('actor')).rejects.toThrow('PASSCODE_REQUIRED');
    await expect(service.verify('actor', '999999')).rejects.toThrow('PASSCODE_INVALID');
    expect(record.failedAttempts).toBe(1);
  });
  it('fails closed if enabled protection has a missing hash', async () => {
    record.passcodeHash = '';
    await expect(service.verify('actor', '123456')).rejects.toThrow('Passcode settings are unavailable');
  });
  it('accepts the hash-verified passcode and clears failed attempts', async () => {
    record.failedAttempts = 3;
    await service.verify('actor', '123456');
    expect(record.failedAttempts).toBe(0);
  });
  it('locks after five failed checks, including across separate service instances', async () => {
    for (let i = 0; i < 4; i++) await expect(service.verify('actor', '999999')).rejects.toThrow('PASSCODE_INVALID');
    await expect(service.verify('actor', '999999')).rejects.toThrow('Too many incorrect');
    await expect(new ActionSecurityService(prisma).verify('actor', '123456')).rejects.toThrow('Too many incorrect');
  });
  it('starts a new attempt window after a lock expires', async () => {
    record.failedAttempts = 5; record.lockedUntil = new Date(Date.now() - 1000);
    prisma.actionSecurity.updateMany.mockImplementation(async ({ data }: any) => { Object.assign(record, data); return { count: 1 }; });
    await expect(service.verify('actor', '999999')).rejects.toThrow('PASSCODE_INVALID');
    expect(record.failedAttempts).toBe(1);
  });
  it('requires the old passcode to disable or replace protection', async () => {
    await expect(service.update('actor', false)).rejects.toThrow('PASSCODE_REQUIRED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await service.update('actor', false, undefined, '123456');
    expect(prisma.actionSecurity.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: false, passcodeHash: null }) }));
  });
  it('does not bypass a passcode changed concurrently with a settings update', async () => {
    prisma.actionSecurity.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('actor', false, undefined, '123456')).rejects.toThrow('Passcode settings changed');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('global action guard', () => {
  const context = (method: string, url: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url, user: { id: 'actor' }, headers: {} }) }) }) as any;
  it.each([['PATCH', '/api/v1/parties/p1'], ['PUT', '/api/v1/settings'], ['DELETE', '/api/v1/items/i1'], ['DELETE', '/api/v1/party-groups/g1'], ['PATCH', '/api/v1/businesses/b1']])('protects edit/delete %s %s throughout the project, including direct API requests', async (method, url) => {
    const verify = vi.fn().mockRejectedValue(new Error('PASSCODE_REQUIRED'));
    const guard = new ActionSecurityGuard({ verify } as any);
    await expect(guard.canActivate(context(method, url))).rejects.toThrow('PASSCODE_REQUIRED');
    expect(verify).toHaveBeenCalledWith('actor', undefined);
  });
  it('does not ask for the passcode when creating records or running other actions', async () => {
    const verify = vi.fn(); const guard = new ActionSecurityGuard({ verify } as any);
    for (const url of ['/api/v1/parties', '/api/v1/items', '/api/v1/party-groups', '/api/v1/invoices', '/api/v1/invoices/i1/cancel']) expect(await guard.canActivate(context('POST', url))).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
  it('keeps reads, sign-in, MFA and recovery available', async () => {
    const verify = vi.fn(); const guard = new ActionSecurityGuard({ verify } as any);
    for (const [method, url] of [['GET', '/api/v1/parties'], ['POST', '/api/v1/auth/login'], ['POST', '/api/v1/auth/mfa/verify'], ['POST', '/api/v1/auth/logout']]) expect(await guard.canActivate(context(method, url))).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});