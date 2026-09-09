import { PrismaService } from '../../prisma/prisma.service.js';

/** Returns every company created in the same owner workspace as the active company. */
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
