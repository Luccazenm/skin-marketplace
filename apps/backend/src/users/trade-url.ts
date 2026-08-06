/**
 * A trade URL tem esta forma:
 *   https://steamcommunity.com/tradeoffer/new/?partner=872481203&token=Ab3xY9zQ
 *
 * `partner` é o accountId (steamID3) do dono. `token` é o que autoriza
 * alguém de fora a enviar uma oferta de troca.
 */

/** Constante da Valve que separa steamID64 de accountId. */
const BASE_STEAM_ID64 = 76561197960265728n;

export type TradeUrlErro =
  | 'formato_invalido'
  | 'dominio_invalido'
  | 'sem_partner'
  | 'sem_token'
  | 'partner_de_outra_conta';

export type TradeUrlResultado =
  | { ok: true; url: string; partner: string; token: string }
  | { ok: false; erro: TradeUrlErro };

/**
 * Converte steamID64 em accountId — o número que aparece como `partner`.
 *
 * Usa BigInt porque steamID64 tem 17 dígitos e passa de Number.MAX_SAFE_INTEGER;
 * a conta feita com número comum perderia precisão nos dígitos finais, que
 * são justamente os que distinguem uma conta de outra.
 */
export function accountIdDe(steamId64: string): string | null {
  if (!/^\d{17}$/.test(steamId64)) {
    return null;
  }

  return (BigInt(steamId64) - BASE_STEAM_ID64).toString();
}

/**
 * Valida a trade URL e confirma que ela pertence a quem está enviando.
 *
 * A conferência do `partner` é o ponto crítico: sem ela, alguém que cole a
 * URL de outra pessoa — por engano ou de propósito — faria o bot entregar
 * as skins na conta errada. Entrega de item é irreversível.
 */
export function validarTradeUrl(
  entrada: string,
  steamIdDoDono: string,
): TradeUrlResultado {
  const texto = entrada.trim();

  let url: URL;

  try {
    url = new URL(texto);
  } catch {
    return { ok: false, erro: 'formato_invalido' };
  }

  // Só o domínio oficial. Um link parecido apontando para outro host
  // levaria o usuário a entregar o token dele em outro lugar.
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'steamcommunity.com'
  ) {
    return { ok: false, erro: 'dominio_invalido' };
  }

  if (!url.pathname.startsWith('/tradeoffer/new')) {
    return { ok: false, erro: 'formato_invalido' };
  }

  const partner = url.searchParams.get('partner');
  const token = url.searchParams.get('token');

  if (!partner || !/^\d+$/.test(partner)) {
    return { ok: false, erro: 'sem_partner' };
  }

  if (!token || !/^[A-Za-z0-9_-]{7,12}$/.test(token)) {
    return { ok: false, erro: 'sem_token' };
  }

  if (partner !== accountIdDe(steamIdDoDono)) {
    return { ok: false, erro: 'partner_de_outra_conta' };
  }

  // Guardamos uma URL normalizada, montada por nós: descarta parâmetros
  // extras e qualquer coisa colada junto ao copiar.
  return {
    ok: true,
    url: `https://steamcommunity.com/tradeoffer/new/?partner=${partner}&token=${token}`,
    partner,
    token,
  };
}

export const MENSAGEM_ERRO: Record<TradeUrlErro, string> = {
  formato_invalido:
    'Este link não parece ser uma trade URL da Steam. Ele deve começar ' +
    'com https://steamcommunity.com/tradeoffer/new/',
  dominio_invalido:
    'Este link não é do steamcommunity.com. Copie a trade URL direto das ' +
    'configurações de privacidade da sua conta Steam.',
  sem_partner: 'O link está incompleto: falta a parte "partner".',
  sem_token:
    'O link está incompleto ou o token expirou. Gere um novo em ' +
    'Inventário > Ofertas de troca > Quem pode me enviar ofertas.',
  partner_de_outra_conta:
    'Esta trade URL pertence a outra conta Steam. Use a URL da mesma ' +
    'conta com que você entrou aqui.',
};
