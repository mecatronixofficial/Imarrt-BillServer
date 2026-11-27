import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyGroupsService } from './party-groups.service.js';
vi.mock('../common/utils/workspace-scope.util.js', () => ({ getLogicalBranchIds: vi.fn(async () => ['branch-a', 'linked-branch']) }));
let prisma: any;
let groups: PartyGroupsService;
beforeEach(() => {
  prisma = {
    partyGroup: { findUnique: vi.fn(async () => ({ id: 'group', name: 'Wholesale' })), findFirst: vi.fn(async () => ({ id: 'group', name: 'Wholesale' })), update: vi.fn(async ({ data }: any) => ({ id: 'group', ...data })), delete: vi.fn(), create: vi.fn() },
    party: { count: vi.fn(async () => 0), updateMany: vi.fn() }, auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(async () => [{ id: 'group', name: 'Wholesale' }]), $transaction: vi.fn(async (work: any) => work(prisma)),
  };
  groups = new PartyGroupsService(prisma);
});
describe('party group scope and membership', () => {
  it('rejects assignment to a group outside the logical branch', async () => {
    prisma.partyGroup.findFirst.mockResolvedValue(null);
    await expect(groups.assignment(prisma, { groupId: 'foreign' }, 'company', 'branch-a')).rejects.toThrow('Select a party group from this branch');
    expect(prisma.partyGroup.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', branchId: { in: ['branch-a', 'linked-branch'] } } });
  });
  it('preserves an omitted group and explicitly clears a selected no-group value', async () => {
    expect(await groups.assignment(prisma, {}, 'company', 'branch-a')).toEqual({});
    expect(await groups.assignment(prisma, { groupId: null }, 'company', 'branch-a')).toEqual({ groupId: null, group: null });
  });
  it('uses the canonical group name for assigned parties', async () => {
    expect(await groups.assignment(prisma, { groupId: 'group', group: 'spoofed' }, 'company', 'branch-a')).toEqual({ groupId: 'group', group: 'Wholesale' });
  });
  it('uses the current locked name if a group was renamed during assignment', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'group', name: 'Renamed group' }]);
    expect(await groups.assignment(prisma, { groupId: 'group' }, 'company', 'branch-a')).toEqual({ groupId: 'group', group: 'Renamed group' });
  });
  it('rejects duplicate names without creating a record', async () => {
    await expect(groups.create(' Wholesale ', 'company', 'branch-a', 'actor')).rejects.toThrow('already exists');
    expect(prisma.partyGroup.create).not.toHaveBeenCalled();
  });
  it('validates every bulk member before changing any memberships', async () => {
    prisma.party.count.mockResolvedValue(1);
    await expect(groups.updateMembers('group', ['allowed', 'foreign'], 'company', 'branch-a', 'actor')).rejects.toThrow('One or more parties');
    expect(prisma.party.updateMany).not.toHaveBeenCalled();
  });
  it('adds selected parties and clears deselected memberships in one transaction', async () => {
    prisma.party.count.mockResolvedValue(1);
    expect(await groups.updateMembers('group', ['allowed', 'allowed'], 'company', 'branch-a', 'actor')).toEqual({ success: true, partyCount: 1 });
    expect(prisma.party.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.party.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { groupId: 'group', group: 'Wholesale' } }));
  });
  it('refuses to delete a group with active parties', async () => {
    prisma.party.count.mockResolvedValue(1);
    await expect(groups.remove('group', 'company', 'branch-a', 'actor')).rejects.toThrow('This group has parties');
    expect(prisma.partyGroup.delete).not.toHaveBeenCalled();
  });
  it('renames the group and legacy names used in nested transaction responses atomically', async () => {
    prisma.partyGroup.findFirst.mockResolvedValueOnce({ id: 'group' }).mockResolvedValueOnce(null);
    await groups.update('group', 'Retail', 'company', 'branch-a', 'actor');
    expect(prisma.party.updateMany).toHaveBeenCalledWith({ where: { groupId: 'group' }, data: { group: 'Retail' } });
  });
  it('generates the next group code after the highest existing one', async () => {
    prisma.partyGroup.findMany = vi.fn(async () => [{ code: 'G-0002' }, { code: 'G-0009' }, { code: 'custom' }]);
    expect(await groups.nextGroupCode('company')).toEqual({ code: 'G-0010' });
  });
  it('assigns a generated code when a group is created without one', async () => {
    prisma.partyGroup.findFirst.mockResolvedValue(null);
    prisma.partyGroup.findMany = vi.fn(async () => []);
    prisma.partyGroup.create.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data }));
    expect(await groups.create('Retail', 'company', 'branch-a', 'actor')).toMatchObject({ code: 'G-0001', name: 'Retail' });
  });
  it('keeps a code entered by the user', async () => {
    prisma.partyGroup.findFirst.mockResolvedValue(null);
    prisma.partyGroup.create.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data }));
    expect(await groups.create('Retail', 'company', 'branch-a', 'actor', ' RET ')).toMatchObject({ code: 'RET' });
  });
});