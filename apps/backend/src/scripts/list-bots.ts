import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/** Situação da frota:  pnpm build && pnpm bot:list */
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
        'Nenhum bot cadastrado. Use: pnpm bot:add -- --steam-id=... --ref=...',
      );
      return;
    }

    const agora = Date.now();

    for (const bot of bots) {
      const travado =
        bot.tradeHoldUntil && bot.tradeHoldUntil.getTime() > agora;

      const dias = travado
        ? Math.ceil((bot.tradeHoldUntil!.getTime() - agora) / 86_400_000)
        : 0;

      // itemCount é denormalizado e pode divergir; mostramos os dois para
      // a diferença ficar visível em vez de silenciosa.
      const ocupacao = Math.round((bot._count.items / bot.maxItems) * 100);

      console.log(`${bot.displayName ?? bot.username}`);
      console.log(`  steamId    ${bot.steamId}`);
      console.log(
        `  status     ${bot.status}${travado ? ` (libera em ${dias} dia(s))` : ''}`,
      );
      console.log(
        `  ocupação   ${bot._count.items}/${bot.maxItems} (${ocupacao}%)` +
          (bot.itemCount !== bot._count.items
            ? `  — contador diz ${bot.itemCount}, precisa reconciliar`
            : ''),
      );

      if (bot.lastError) {
        console.log(`  último erro ${bot.lastError}`);
      }

      console.log('');
    }
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
