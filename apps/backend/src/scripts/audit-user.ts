import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditQueryService } from '../audit/audit-query.service';

/**
 * Linha do tempo de um usuário.
 *
 *   pnpm build && pnpm audit:user -- --id=76561198832746931 [--dias=30]
 *
 * Feito para ser lido no meio de uma reclamação: quem, quando, de onde, e
 * o que mudou. Aceita steamId (o que o usuário informa) ou o id interno.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identificador = args['id'];

  if (!identificador) {
    console.error(
      'Uso: pnpm audit:user -- --id=<steamID64 ou id interno> [--dias=N] [--limite=N]',
    );
    process.exit(1);
  }

  const dias = args['dias'] ? Number(args['dias']) : undefined;
  const limite = args['limite'] ? Number(args['limite']) : 100;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const resultado = await app
      .get(AuditQueryService)
      .timelineFor(identificador, {
        limite,
        desde: dias ? new Date(Date.now() - dias * 86_400_000) : undefined,
      });

    if (!resultado) {
      console.error(`Nenhum usuário encontrado para "${identificador}"`);
      process.exit(1);
    }

    const { user, eventos, omitidos } = resultado;

    console.log('');
    console.log(`  ${user.username}`);
    console.log(`  steamId   ${user.steamId}`);
    console.log(`  id        ${user.id}`);
    console.log(`  saldo     US$ ${user.balance.toString()}`);
    console.log(`  cadastro  ${formatarData(user.createdAt)}`);
    if (user.isBanned) {
      console.log(`  SUSPENSO`);
    }
    console.log('');
    console.log(
      `  ${eventos.length} evento(s)` +
        (dias ? ` nos últimos ${dias} dias` : '') +
        (omitidos > 0 ? `, ${omitidos} mais antigos omitidos` : ''),
    );
    console.log('  ' + '-'.repeat(70));

    if (eventos.length === 0) {
      console.log('  (nada registrado)');
    }

    for (const e of eventos) {
      const marca =
        e.outcome === 'SUCCESS' ? ' ' : e.outcome === 'DENIED' ? '!' : 'x';

      console.log(
        `  ${marca} ${formatarData(e.createdAt)}  ${e.action.padEnd(26)} ${e.outcome}`,
      );

      if (e.ip) {
        console.log(`      de ${e.ip}`);
      }

      for (const linha of detalhar(e.metadata)) {
        console.log(`      ${linha}`);
      }
    }

    console.log('');
  } finally {
    await app.close();
  }
}

/**
 * Mostra o que interessa do metadata, sem despejar JSON cru.
 * Alteração vira "de X para Y", que é o formato que resolve disputa.
 */
function detalhar(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const dados = metadata as Record<string, unknown>;
  const linhas: string[] = [];

  if ('de' in dados || 'para' in dados) {
    linhas.push(`de:   ${valor(dados.de)}`);
    linhas.push(`para: ${valor(dados.para)}`);
  }

  if (typeof dados.motivo === 'string') {
    linhas.push(`motivo: ${dados.motivo}`);
  }

  if (typeof dados.erro === 'string') {
    linhas.push(`erro: ${dados.erro}`);
  }

  if (Array.isArray(dados.itens)) {
    for (const item of dados.itens as { assetId?: string; nome?: string }[]) {
      linhas.push(`item: ${item.nome ?? '?'} (asset ${item.assetId ?? '?'})`);
    }
  }

  if (typeof dados.botSteamId === 'string') {
    linhas.push(`bot: ${dados.botSteamId}`);
  }

  if (dados.primeiroLogin === true) {
    linhas.push('primeiro acesso');
  }

  return linhas;
}

/** Metadata é JSON livre: um campo pode vir objeto e virar "[object Object]". */
function valor(v: unknown): string {
  if (v === null || v === undefined) return '(vazio)';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function formatarData(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
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
