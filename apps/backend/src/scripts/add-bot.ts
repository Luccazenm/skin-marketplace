import { NestFactory } from '@nestjs/core';
import { BotStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
} from '../audit/audit.service';
import { SteamAccountStateService } from '../auth/steam-account-state.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { impedimentosParaOperar, perfilEstaPublico } from './bot-eligibility';

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
    const audit = app.get(AuditService);

    /**
     * Registra a recusa antes de sair.
     *
     * Tentativa recusada é sinal operacional: repetição aqui significa
     * conta comprada, conta reaproveitada de outra finalidade, ou alguém
     * tentando apontar depósito para uma conta que não é nossa. Sem
     * gravar, o padrão só existiria na memória de quem rodou o comando.
     */
    const recusar = async (
      motivo: string,
      mensagem: string,
      extra = {},
    ): Promise<never> => {
      console.error(mensagem);

      await audit.record({
        actorType: AuditActorType.SYSTEM,
        action: AUDIT_ACTIONS.BOT_REGISTRATION_DENIED,
        outcome: AuditOutcome.DENIED,
        targetType: 'Bot',
        metadata: { steamId, credentialRef, motivo, ...extra },
      });

      await app.close();
      process.exit(1);
    };

    const jaExiste = await prisma.bot.findFirst({
      where: { OR: [{ steamId }, { credentialRef }] },
    });

    if (jaExiste) {
      const conflito =
        jaExiste.steamId === steamId
          ? `steamId ${steamId}`
          : `credentialRef ${credentialRef}`;

      await recusar(
        'duplicado',
        `Já existe um Trade Bot com ${conflito} (id ${jaExiste.id})`,
        { conflitoCom: jaExiste.id },
      );
    }

    // A conta existe mesmo? Um dígito trocado no steamId passaria pela
    // validação de formato e só apareceria quando o bot falhasse em operar.
    const perfil = await app.get(SteamProfileService).fetchProfile(steamId);

    if (!perfil) {
      await recusar(
        'perfil_ilegivel',
        'Não foi possível ler o perfil na Steam. Confira o steamID64 e a ' +
          'STEAM_API_KEY antes de cadastrar.',
      );
      // `recusar` encerra o processo; o return é só para o TypeScript
      // enxergar que `perfil` não é null daqui para baixo.
      return;
    }

    const [ban, estado] = await Promise.all([
      app.get(SteamBanService).fetchBanStatus(steamId),
      app.get(SteamAccountStateService).fetchAccountState(steamId),
    ]);

    // Mesma regra que o bot:check usa para informar. Ver bot-eligibility.ts.
    const impedimentos = impedimentosParaOperar(ban, estado);

    if (impedimentos.length > 0) {
      const [primeiro] = impedimentos;

      await recusar(
        primeiro.motivo,
        `Esta conta não pode operar como Trade Bot: ${impedimentos
          .map((i) => i.rotulo)
          .join(', ')}.\n\n${primeiro.comoResolver}\n\n` +
          `Conferir em: https://steamcommunity.com/profiles/${steamId}/?xml=1`,
        { impedimentos: impedimentos.map((i) => i.motivo) },
      );
    }

    // Incerteza não barra o cadastro, mas o operador precisa saber que
    // cadastrou sem confirmação.
    if (!ban) {
      console.warn(
        'Aviso: não foi possível verificar bans (STEAM_API_KEY ausente ou ' +
          'Steam indisponível). Cadastrando mesmo assim.',
      );
    }

    if (!estado) {
      console.warn(
        'Aviso: não foi possível checar se a conta está limitada. ' +
          'Cadastrando mesmo assim — confira antes de pôr em rotação.',
      );
    }

    if (estado && !perfilEstaPublico(estado)) {
      console.warn(
        `Aviso: perfil está "${estado.privacyState ?? 'desconhecido'}". ` +
          'Com o inventário fechado, ninguém consegue conferir o que está ' +
          'em custódia — nem nós, nem o usuário.',
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
