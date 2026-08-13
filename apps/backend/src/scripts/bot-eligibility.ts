import { SteamEconomyBan } from '@prisma/client';
import type { SteamAccountState } from '../auth/steam-account-state.service';
import type { SteamBanStatus } from '../auth/steam-ban.service';

export interface ImpedimentoBot {
  /** Vai para a auditoria — texto estável, não muda com a mensagem. */
  motivo: string;
  /** Resumo curto, para listar. */
  rotulo: string;
  /** O que o operador tem que fazer. */
  comoResolver: string;
}

/**
 * Por que uma conta da Steam não pode operar como Trade Bot.
 *
 * Regra pura, sem framework e sem rede, porque é ela que decide para onde
 * as skins dos usuários vão. Os dois comandos consomem esta lista: o
 * `bot:check` mostra todas as pendências de uma vez, o `bot:add` barra na
 * primeira. Se cada um tivesse seu próprio critério, os dois discordariam
 * — e a discordância só apareceria com um item já em custódia.
 *
 * `null` em qualquer entrada significa "não foi possível apurar", que não
 * é impedimento: quem chama decide o que fazer com a incerteza. Tratar
 * indisponibilidade da Steam como reprovação impediria cadastrar em dia de
 * instabilidade; tratar como aprovação seria pior.
 */
export function impedimentosParaOperar(
  ban: SteamBanStatus | null,
  estado: SteamAccountState | null,
): ImpedimentoBot[] {
  const impedimentos: ImpedimentoBot[] = [];

  // Conta limitada não é ban, e a Web API não reporta este estado. Conta
  // recém-criada passa por todas as outras barreiras e mesmo assim não
  // consegue negociar.
  if (estado?.isLimited) {
    impedimentos.push({
      motivo: 'conta_limitada',
      rotulo: 'conta limitada',
      comoResolver:
        'Adicione fundos à carteira com um meio de pagamento real ' +
        '(equivalente a US$ 5). Gastar saldo que já estava lá não conta.',
    });
  }

  if (ban && ban.economyBan !== SteamEconomyBan.NONE) {
    impedimentos.push({
      motivo: 'restricao_de_economia',
      rotulo: `restrição de economia (${ban.economyBan})`,
      comoResolver:
        'A Steam bloqueou as trocas desta conta. Não há o que fazer do ' +
        'nosso lado — use outra conta.',
    });
  }

  if (ban?.vacBanned) {
    impedimentos.push({
      motivo: 'vac_ban',
      rotulo: 'VAC ban',
      comoResolver:
        'Se o VAC for de CS2, o inventário está travado permanentemente e ' +
        'a conta nunca conseguirá enviar itens. Use outra conta.',
    });
  }

  return impedimentos;
}

/**
 * Perfil privado não impede cadastrar, mas cega a conferência depois:
 * ninguém — nem nós, nem o usuário — consegue ver o que está em custódia.
 */
export function perfilEstaPublico(estado: SteamAccountState | null): boolean {
  return estado?.privacyState === 'public';
}
