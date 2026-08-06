import { SteamEconomyBan } from '@prisma/client';

/** O que a conta consegue fazer, dado o estado dela na Steam. */
export interface UserCapabilities {
  /** Entregar skins para o nosso bot. Exige ENVIAR. */
  canDeposit: boolean;
  /** Receber skins do nosso bot (entrega de compra ou devolução). Exige RECEBER. */
  canWithdraw: boolean;
  /** Vender pelo site o que já está em custódia. Não envolve a Steam. */
  canSell: boolean;
  /** Explicação para mostrar ao usuário quando algo está bloqueado. */
  blockedReason: string | null;
  /** Alertas que não bloqueiam, mas o usuário precisa saber. */
  warnings: string[];
}

type BanState = Pick<
  { steamEconomyBan: SteamEconomyBan; steamVacBanned: boolean },
  'steamEconomyBan' | 'steamVacBanned'
>;

/**
 * Regras de restrição da Steam.
 *
 * O ponto que não é óbvio: vender pelo site NUNCA é bloqueado por ban da
 * Steam. O item já está no nosso bot, e a venda é troca de dono no nosso
 * banco — a Steam não participa. Para quem foi banido, isso é a única
 * liquidez que sobrou, e tirá-la seria transformar o ban da Valve num
 * confisco nosso.
 */
export function capabilitiesFor(user: BanState): UserCapabilities {
  const warnings: string[] = [];

  // Economy ban corta a conta da economia da Steam nas duas direções.
  if (user.steamEconomyBan === SteamEconomyBan.BANNED) {
    return {
      canDeposit: false,
      canWithdraw: false,
      canSell: true,
      blockedReason:
        'Sua conta Steam está impedida de negociar itens, então não é ' +
        'possível depositar nem receber skins. As skins que já estão em ' +
        'custódia podem ser vendidas normalmente aqui.',
      warnings,
    };
  }

  if (user.steamEconomyBan === SteamEconomyBan.PROBATION) {
    return {
      canDeposit: false,
      canWithdraw: false,
      canSell: true,
      blockedReason:
        'Sua conta Steam está em período de restrição de trocas. Depósitos ' +
        'e saques ficam indisponíveis até a Steam liberar. A venda das ' +
        'skins em custódia continua funcionando.',
      warnings,
    };
  }

  // VAC não bloqueia por conta própria: a API da Steam não informa de qual
  // jogo é o ban, e um VAC em outro jogo não afeta os itens de CS2.
  // Bloquear aqui puniria usuário legítimo por um dado impreciso — então
  // avisamos e deixamos a tentativa de troca dar o veredito real.
  if (user.steamVacBanned) {
    warnings.push(
      'Sua conta Steam tem um VAC ban registrado. Se ele for de CS2, o ' +
        'depósito de skins não vai funcionar — o recebimento continua normal.',
    );
  }

  return {
    canDeposit: true,
    canWithdraw: true,
    canSell: true,
    blockedReason: null,
    warnings,
  };
}
