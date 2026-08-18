import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Check apps/backend/.env');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * The platform account is required by the model: it owns the items
 * bought through the fast flow and is the counterparty on every ledger
 * line. The steamId is a sentinel — this account does not exist on
 * Steam.
 */
const PLATFORM_STEAM_ID = 'PLATFORM';
const PLATFORM_USERNAME = 'Platform';

async function seedPlatformAccount() {
  const existing = await prisma.user.findFirst({
    where: { isPlatform: true },
  });

  if (!existing) {
    const platform = await prisma.user.create({
      data: {
        isPlatform: true,
        steamId: PLATFORM_STEAM_ID,
        username: PLATFORM_USERNAME,
        displayCurrency: 'USD',
      },
    });

    console.log(`Platform account created (id: ${platform.id})`);
    return platform;
  }

  // Repairs a diverging identity. The balance is NEVER touched here: it
  // is the platform's cash, and zeroing it by mistake would falsify the
  // accounting.
  const needsRepair =
    existing.username !== PLATFORM_USERNAME ||
    existing.avatarUrl !== null ||
    existing.lastLoginAt !== null;

  if (!needsRepair) {
    console.log(`Platform account already exists (id: ${existing.id})`);
    return existing;
  }

  const repaired = await prisma.user.update({
    where: { id: existing.id },
    data: {
      username: PLATFORM_USERNAME,
      avatarUrl: null,
      profileUrl: null,
      lastLoginAt: null,
      steamBanCheckedAt: null,
    },
  });

  console.log(`Platform account repaired (id: ${repaired.id})`);
  return repaired;
}

async function main() {
  await seedPlatformAccount();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
