import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

// Sign-in details for the seeded business owner account - override via env
// so real credentials never need to be hardcoded here.
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'Business Owner';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@example.com';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? 'Platform Administrator';
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

async function main() {
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, SALT_ROUNDS);

  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      passwordHash,
      role: Role.OWNER,
      isActive: true,
    },
  });

  console.log(`Seeded owner: ${owner.email} / role=${owner.role}`);

  if (SUPER_ADMIN_EMAIL && SUPER_ADMIN_PASSWORD) {
    const superAdminPasswordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, SALT_ROUNDS);
    const superAdmin = await prisma.user.upsert({
      where: { email: SUPER_ADMIN_EMAIL.trim().toLowerCase() },
      update: { role: Role.SUPER_ADMIN, isActive: true },
      create: {
        name: SUPER_ADMIN_NAME,
        email: SUPER_ADMIN_EMAIL.trim().toLowerCase(),
        passwordHash: superAdminPasswordHash,
        role: Role.SUPER_ADMIN,
        isActive: true,
      },
    });
    console.log(`Seeded super admin: ${superAdmin.email} / role=${superAdmin.role}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
