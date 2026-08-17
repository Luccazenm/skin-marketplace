import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogSyncService } from '../catalog/catalog-sync.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Traz o catálogo de itens do CS2 para o banco.
 *
 *   pnpm build && pnpm catalog:sync
 *
 * Rodar quando sair conteúdo novo (caixa, cápsula, operação). É
 * idempotente: rodar de novo atualiza o que mudou e não duplica.
 *
 * Não mexe em `referencePrice`, `buyoutEligible` nem
 * `buyoutDiscountPct` — são decisões nossas, não do dataset.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const inicio = Date.now();

    console.log('Sincronizando catálogo...\n');

    const total = await app
      .get(CatalogSyncService)
      .sincronizar((arquivo, r) => {
        console.log(
          `  ${arquivo.padEnd(20)} ${String(r.lidos).padStart(6)} lidos  ` +
            `${String(r.criados).padStart(6)} novos  ` +
            `${String(r.atualizados).padStart(6)} atualizados  ` +
            `${String(r.descartados).padStart(5)} fora` +
            (r.falhas > 0 ? `  ${r.falhas} FALHAS` : ''),
        );
      });

    const segundos = Math.round((Date.now() - inicio) / 1000);

    console.log(`\nTotal em ${segundos}s`);
    console.log(`  lidos       ${total.lidos}`);
    console.log(`  criados     ${total.criados}`);
    console.log(`  atualizados ${total.atualizados}`);
    console.log(`  descartados ${total.descartados}`);

    if (total.falhas > 0) {
      // Falha aqui é mapeamento errado, não erro passageiro: alguma
      // categoria está entrando sem os campos que a constraint exige.
      console.log(`  FALHAS      ${total.falhas}  <- investigar`);
      process.exitCode = 1;
    }

    const prisma = app.get(PrismaService);
    const porCategoria = await prisma.skinTemplate.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { _count: { category: 'desc' } },
    });

    console.log('\nCatálogo por categoria:');

    for (const c of porCategoria) {
      console.log(`  ${c.category.padEnd(14)} ${String(c._count).padStart(6)}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
