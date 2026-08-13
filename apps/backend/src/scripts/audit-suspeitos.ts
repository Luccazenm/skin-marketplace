import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditQueryService } from '../audit/audit-query.service';

/**
 * Quem acumulou recusas no período.
 *
 *   pnpm build && pnpm audit:suspeitos [-- --dias=7 --minimo=3]
 *
 * Uma recusa isolada é engano comum. Repetição é o que indica alguém
 * testando o sistema — e só aparece porque gravamos também as tentativas
 * negadas.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dias = args['dias'] ? Number(args['dias']) : 7;
  const minimo = args['minimo'] ? Number(args['minimo']) : 3;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const suspeitos = await app.get(AuditQueryService).suspiciousActivity({
      desde: new Date(Date.now() - dias * 86_400_000),
      minimoRecusas: minimo,
    });

    console.log('');
    console.log(
      `  Contas com ${minimo}+ recusas nos últimos ${dias} dia(s): ${suspeitos.length}`,
    );
    console.log('  ' + '-'.repeat(70));

    if (suspeitos.length === 0) {
      console.log('  (nada fora do comum)');
      console.log('');
      return;
    }

    for (const s of suspeitos) {
      console.log('');
      console.log(`  ${s.username ?? '(sem usuário identificado)'}`);

      if (s.steamId) {
        console.log(`    steamId  ${s.steamId}`);
      }

      console.log(`    recusas  ${s.recusas}`);
      console.log(
        `    última   ${s.ultima.toISOString().replace('T', ' ').slice(0, 19)}`,
      );

      for (const m of s.motivos) {
        console.log(`      ${m.vezes}x ${m.acao}`);
      }

      // Vários IPs para a mesma conta em pouco tempo é sinal de conta
      // compartilhada ou comprometida.
      if (s.ips.length > 0) {
        console.log(`    ips      ${s.ips.slice(0, 5).join(', ')}`);
      }

      if (s.actorId) {
        console.log(
          `    detalhe  pnpm audit:user -- --id=${s.steamId ?? s.actorId}`,
        );
      }
    }

    console.log('');
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) {
      out[m[1]] = m[2];
    }
  }

  return out;
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
