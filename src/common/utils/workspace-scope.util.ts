import { PrismaService } from '../../prisma/prisma.service.js';

/** Legacy owner-wide scope; branch-scoped masters should use a branch-aware resolver. */
export async function getWorkspaceBusinessIds(prisma: PrismaService, businessId: string) {
  const activeBusiness = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdById: true },
  });
  if (!activeBusiness) return [businessId];

  const businesses = await prisma.business.findMany({
    where: { createdById: activeBusiness.createdById, isActive: true },
    select: { id: true },
  });
  return businesses.map(({ id }) => id);
}

/**
 * Treats branches with the same code in an owner's companies as one logical
 * branch. This lets a branch expose several companies while keeping its master
 * data isolated from other logical branches.
 */
export async function getBranchBusinessIds(prisma: PrismaService, businessId: string, branchId: string) {
  const business = await prisma.business.findFirst({
    where: { id: businessId, branches: { some: { id: branchId, isActive: true } } },
    select: { workspaceBranchId: true },
  });
  if (!business?.workspaceBranchId) return business ? [businessId] : [];
  const matches = await prisma.business.findMany({
    where: { workspaceBranchId: business.workspaceBranchId, isActive: true },
    select: { id: true },
  });
  return matches.map(({ id }) => id);
}

export async function getLogicalBranchIds(prisma: PrismaService, businessId: string, branchId: string) {
  const businessIds = await getBranchBusinessIds(prisma, businessId, branchId);
  if (!businessIds.length) return [];
  const matches = await prisma.branch.findMany({
    where: { businessId: { in: businessIds }, isActive: true },
    select: { id: true },
  });
  return matches.map(({ id }) => id);
}
