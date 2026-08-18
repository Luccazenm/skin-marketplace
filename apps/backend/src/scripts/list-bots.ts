import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/** Fleet status:  pnpm build && pnpm bot:list */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const bots = await app.get(PrismaService).bot.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { items: true } } },
    });

    if (bots.length === 0) {
      console.log(
        'No Trade Bot registered. Use: pnpm bot:add -- --steam-id=... --ref=...',
      );
      return;
    }

    const now = Date.now();

    for (const bot of bots) {
      const onHold = bot.tradeHoldUntil && bot.tradeHoldUntil.getTime() > now;

      const days = onHold
        ? Math.ceil((bot.tradeHoldUntil!.getTime() - now) / 86_400_000)
        : 0;

      // itemCount is denormalized and can drift; we show both so the
      // difference is visible rather than silent.
      const usage = Math.round((bot._count.items / bot.maxItems) * 100);

      console.log(`${bot.displayName ?? bot.username}`);
      console.log(`  steamId    ${bot.steamId}`);
      console.log(
        `  status     ${bot.status}${onHold ? ` (releases in ${days} day(s))` : ''}`,
      );
      console.log(
        `  usage      ${bot._count.items}/${bot.maxItems} (${usage}%)` +
          (bot.itemCount !== bot._count.items
            ? `  — counter says ${bot.itemCount}, needs reconciling`
            : ''),
      );

      if (bot.lastError) {
        console.log(`  last error ${bot.lastError}`);
      }

      console.log('');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
