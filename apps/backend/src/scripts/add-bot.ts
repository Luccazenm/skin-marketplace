import { NestFactory } from '@nestjs/core';
import { BotStatus, SteamEconomyBan } from '@prisma/client';
import { AppModule } from '../app.module';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
} from '../audit/audit.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cadastra um bot no sistema.
 *
 *   pnpm build && pnpm bot:add -- --steam-id=765... --ref=bot/01 [--ready=2026-08-13]
 *
 * Não é rota HTTP de propósito: é operação de operador, feita poucas vezes,
 * e um endpoint administrativo seria superfície exposta sem necessidade.
 *
 * Antes de gravar, confere com a Steam que a conta existe e que não tem
 * restrição de negociação. Cadastrar um bot já impedido de trocar só
 * adiaria a descoberta para o momento em que ele fosse escolhido para
 * receber um depósito.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const steamId = args['steam-id'];
  const credentialRef = args['ref'];
  const readyAt = args['ready'];
  const maxItems = args['max-items'];

  if (!steamId || !credentialRef) {
    console.error(
      'Uso: pnpm bot:add -- --steam-id=<steamID64> --ref=<chave no cofre> ' +
        '[--ready=AAAA-MM-DD] [--max-items=900]\n\n' +
        '  --ready  data em que o autenticador completa 7 dias. Até lá as\n' +
        '           trocas saem com hold e o bot não deve entrar em rotação.',
    );
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
    const prisma = app.get(PrismaService);

    const jaExiste = await prisma.bot.findFirst({
      where: { OR: [{ steamId }, { credentialRef }] },
    });

    if (jaExiste) {
      const motivo =
        jaExiste.steamId === steamId
          ? `steamId ${steamId}`
          : `credentialRef ${credentialRef}`;
      console.error(`Já existe um bot com ${motivo} (id ${jaExiste.id})`);
      process.exit(1);
    }

    // A conta existe mesmo? Um dígito trocado no steamId passaria pela
    // validação de formato e só apareceria quando o bot falhasse em operar.
    const perfil = await app.get(SteamProfileService).fetchProfile(steamId);

    if (!perfil) {
      console.error(
        'Não foi possível ler o perfil na Steam. Confira o steamID64 e a ' +
          'STEAM_API_KEY antes de cadastrar.',
      );
      process.exit(1);
    }

    const ban = await app.get(SteamBanService).fetchBanStatus(steamId);

    if (ban && ban.economyBan !== SteamEconomyBan.NONE) {
      console.error(
        `Esta conta está com restrição de negociação na Steam ` +
          `(${ban.economyBan}) e não pode operar como bot.`,
      );
      process.exit(1);
    }

    if (ban?.vacBanned) {
      console.error(
        'Esta conta tem VAC ban registrado. Se for de CS2, o inventário ' +
          'está travado permanentemente e o bot nunca conseguirá enviar ' +
          'itens. Cadastro cancelado.',
      );
      process.exit(1);
    }

    if (!ban) {
      console.warn(
        'Aviso: não foi possível verificar bans (STEAM_API_KEY ausente ou ' +
          'Steam indisponível). Cadastrando mesmo assim.',
      );
    }

    const tradeHoldUntil = readyAt ? new Date(`${readyAt}T00:00:00Z`) : null;

    if (readyAt && Number.isNaN(tradeHoldUntil!.getTime())) {
      console.error(`Data inválida em --ready: ${readyAt}`);
      process.exit(1);
    }

    const bot = await prisma.bot.create({
      data: {
        steamId,
        username: perfil.username,
        displayName: perfil.username,
        credentialRef,
        // Nasce fora de rotação: só entra depois que o serviço de bots
        // conseguir autenticar com as credenciais do cofre.
        status: BotStatus.OFFLINE,
        tradeHoldUntil,
        ...(maxItems ? { maxItems: Number(maxItems) } : {}),
      },
    });

    // Cadastro de bot define para onde vão as skins dos usuários. Fica
    // registrado como SYSTEM: foi um operador com acesso ao servidor, não
    // alguém autenticado pelo site.
    await app.get(AuditService).record({
      actorType: AuditActorType.SYSTEM,
      action: AUDIT_ACTIONS.BOT_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'Bot',
      targetId: bot.id,
      metadata: {
        steamId: bot.steamId,
        credentialRef: bot.credentialRef,
        perfil: perfil.username,
        maxItems: bot.maxItems,
        tradeHoldUntil: readyAt ?? null,
      },
    });

    console.log(`Bot cadastrado`);
    console.log(`  id            ${bot.id}`);
    console.log(`  steamId       ${bot.steamId}`);
    console.log(`  perfil        ${perfil.username}`);
    console.log(`  credentialRef ${bot.credentialRef}`);
    console.log(`  capacidade    ${bot.maxItems} itens`);
    console.log(`  status        ${bot.status}`);

    if (tradeHoldUntil) {
      const dias = Math.ceil(
        (tradeHoldUntil.getTime() - Date.now()) / 86_400_000,
      );
      console.log(
        `  liberado em   ${readyAt}` +
          (dias > 0 ? ` (faltam ${dias} dia(s))` : ' (já liberado)'),
      );
    } else {
      console.log(
        `  liberado em   não informado — passe --ready se o autenticador ` +
          `ainda não completou 7 dias`,
      );
    }
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
