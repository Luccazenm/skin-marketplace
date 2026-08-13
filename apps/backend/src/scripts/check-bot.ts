import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SteamAccountStateService } from '../auth/steam-account-state.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { impedimentosParaOperar, perfilEstaPublico } from './bot-eligibility';

/**
 * Confere uma conta da Steam antes de cadastrá-la como Trade Bot.
 *
 *   pnpm build && pnpm bot:check -- --steam-id=765...
 *
 * Só leitura: não grava no banco e não registra auditoria. Existe para
 * responder "posso cadastrar esta conta?" sem efeito colateral — em
 * particular, para conferir o steamID64 antes de gravá-lo. Um dígito
 * trocado passa pela validação de formato e só apareceria dias depois,
 * quando o Trade Bot falhasse em operar.
 *
 * As mesmas checagens rodam dentro do bot:add. Aqui elas informam; lá
 * elas barram.
 */
async function main() {
  const steamId = /^--steam-id=(.*)$/.exec(
    process.argv.slice(2).join(' '),
  )?.[1];

  if (!steamId) {
    console.error('Uso: pnpm bot:check -- --steam-id=<steamID64>');
    process.exit(1);
  }

  if (!/^\d{17}$/.test(steamId)) {
    console.error(`steamID64 inválido: ${steamId} (esperado 17 dígitos)`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const [perfil, ban, estado, jaCadastrado] = await Promise.all([
      app.get(SteamProfileService).fetchProfile(steamId),
      app.get(SteamBanService).fetchBanStatus(steamId),
      app.get(SteamAccountStateService).fetchAccountState(steamId),
      app.get(PrismaService).bot.findUnique({ where: { steamId } }),
    ]);

    if (!perfil) {
      console.log('✗ Perfil não encontrado na Steam');
      console.log('  Confira o steamID64 e a STEAM_API_KEY.');
      process.exit(1);
    }

    console.log(`Perfil    ${perfil.username}`);
    console.log(`steamId   ${steamId}`);
    console.log(
      `Criado    ${perfil.steamCreatedAt?.toISOString().slice(0, 10) ?? '(oculto)'}`,
    );
    console.log('');

    // Mesma regra que o bot:add usa para barrar. Ver bot-eligibility.ts.
    const impedimentos = impedimentosParaOperar(ban, estado);
    const bloqueado = (motivo: string) =>
      impedimentos.some((i) => i.motivo === motivo);

    // O operador precisa ver todas as pendências de uma vez, não só a
    // primeira — senão corrige uma, roda de novo, e descobre a seguinte.
    linha('Não limitada', estado ? !bloqueado('conta_limitada') : null);
    linha(
      'Sem restrição de economia',
      ban ? !bloqueado('restricao_de_economia') : null,
      ban && bloqueado('restricao_de_economia') ? ban.economyBan : undefined,
    );
    linha('Sem VAC ban', ban ? !bloqueado('vac_ban') : null);

    // Não bloqueia cadastro, mas cega a conferência depois.
    linha(
      'Perfil público',
      estado ? perfilEstaPublico(estado) : null,
      estado && !perfilEstaPublico(estado)
        ? (estado.privacyState ?? 'desconhecido')
        : undefined,
    );

    console.log('');

    if (jaCadastrado) {
      console.log(`Já cadastrado como Trade Bot (id ${jaCadastrado.id})`);
      console.log(`  status ${jaCadastrado.status}`);
      console.log(`  ref    ${jaCadastrado.credentialRef}`);
    } else if (impedimentos.length > 0) {
      console.log(
        `NÃO pode ser cadastrada: ${impedimentos.map((i) => i.rotulo).join(', ')}`,
      );

      for (const i of impedimentos) {
        console.log(`  ${i.comoResolver}`);
      }

      process.exitCode = 1;
    } else {
      console.log('Pode ser cadastrada.');
      console.log(
        `  pnpm bot:add -- --steam-id=${steamId} --ref=<chave no cofre> ` +
          `--ready=AAAA-MM-DD`,
      );
    }
  } finally {
    await app.close();
  }
}

/** null = não foi possível apurar, que é diferente de reprovado. */
function linha(rotulo: string, ok: boolean | null, detalhe?: string) {
  const marca = ok === null ? '?' : ok ? '✓' : '✗';
  console.log(`${marca} ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
