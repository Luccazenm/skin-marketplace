import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL não definida. Confira apps/backend/.env');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * A conta da plataforma é obrigatória pelo modelo: ela é a dona dos itens
 * comprados no fluxo rápido e a contraparte de toda linha do ledger.
 * O steamId é sentinela — essa conta não existe na Steam.
 */
const PLATFORM_STEAM_ID = 'PLATFORM';
const PLATFORM_USERNAME = 'Plataforma';

async function seedPlatformAccount() {
  const existente = await prisma.user.findFirst({
    where: { isPlatform: true },
  });

  if (!existente) {
    const plataforma = await prisma.user.create({
      data: {
        isPlatform: true,
        steamId: PLATFORM_STEAM_ID,
        username: PLATFORM_USERNAME,
        displayCurrency: 'USD',
      },
    });

    console.log(`Conta da plataforma criada (id: ${plataforma.id})`);
    return plataforma;
  }

  // Repara identidade divergente. O saldo NUNCA é tocado aqui: ele é o
  // caixa da plataforma e zerá-lo por engano falsearia a contabilidade.
  const precisaReparo =
    existente.username !== PLATFORM_USERNAME ||
    existente.avatarUrl !== null ||
    existente.lastLoginAt !== null;

  if (!precisaReparo) {
    console.log(`Conta da plataforma já existe (id: ${existente.id})`);
    return existente;
  }

  const reparada = await prisma.user.update({
    where: { id: existente.id },
    data: {
      username: PLATFORM_USERNAME,
      avatarUrl: null,
      profileUrl: null,
      lastLoginAt: null,
      steamBanCheckedAt: null,
    },
  });

  console.log(`Conta da plataforma reparada (id: ${reparada.id})`);
  return reparada;
}

async function main() {
  await seedPlatformAccount();
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
