import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogSyncService } from '../catalog/catalog-sync.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Brings the CS2 item catalog into the database.
 *
 *   pnpm build && pnpm catalog:sync
 *
 * Run it when Valve ships new content (case, capsule, operation). It is
 * idempotent: running again updates what changed and duplicates nothing.
 *
 * It does not touch `referencePrice`, `buyoutEligible` or
 * `buyoutDiscountPct` — those are our decisions, not the dataset's.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const startedAt = Date.now();

    console.log('Syncing catalog...\n');

    const total = await app.get(CatalogSyncService).sync((file, r) => {
      console.log(
        `  ${file.padEnd(20)} ${String(r.read).padStart(6)} read  ` +
          `${String(r.created).padStart(6)} new  ` +
          `${String(r.updated).padStart(6)} updated  ` +
          `${String(r.discarded).padStart(5)} out` +
          (r.failures > 0 ? `  ${r.failures} FAILURES` : ''),
      );
    });

    const seconds = Math.round((Date.now() - startedAt) / 1000);

    console.log(`\nTotal in ${seconds}s`);
    console.log(`  read       ${total.read}`);
    console.log(`  created    ${total.created}`);
    console.log(`  updated    ${total.updated}`);
    console.log(`  discarded  ${total.discarded}`);

    if (total.failures > 0) {
      // A failure here means a wrong mapping, not a transient error: some
      // category is coming in without the fields the constraint demands.
      console.log(`  FAILURES   ${total.failures}  <- investigate`);
      process.exitCode = 1;
    }

    const prisma = app.get(PrismaService);
    const byCategory = await prisma.skinTemplate.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { _count: { category: 'desc' } },
    });

    console.log('\nCatalog by category:');

    for (const c of byCategory) {
      console.log(`  ${c.category.padEnd(14)} ${String(c._count).padStart(6)}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
