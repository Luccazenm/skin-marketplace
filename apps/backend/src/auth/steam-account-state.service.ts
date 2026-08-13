import { Injectable, Logger } from '@nestjs/common';

export interface SteamAccountState {
  /**
   * Conta que ainda não gastou US$ 5 na Steam. Não consegue negociar,
   * então não serve como Trade Bot.
   */
  isLimited: boolean;
  /** "public", "friendsonly", "private" — vazio quando a Steam omite. */
  privacyState: string | null;
  /** "None" quando não há restrição de troca. */
  tradeBanState: string | null;
}

/**
 * Lê o estado da conta pelo perfil público da comunidade.
 *
 * Existe separado do SteamBanService porque a informação vem de outro
 * lugar: a Web API (GetPlayerBans) **não reporta conta limitada**, e
 * conta limitada não é ban — é conta que ainda não gastou os US$ 5. Sem
 * esta checagem, cadastrar um Trade Bot recém-criado passaria por todas
 * as barreiras e a descoberta só viria quando ele fosse escolhido para
 * receber um depósito.
 *
 * O endpoint `?xml=1` é o próprio perfil público, sem chave de API.
 */
@Injectable()
export class SteamAccountStateService {
  private readonly logger = new Logger(SteamAccountStateService.name);

  /**
   * Retorna o estado ou null se não foi possível apurar.
   *
   * Como no SteamBanService, null é diferente de "está tudo certo": quem
   * chama decide o que fazer com a incerteza, em vez de receber um
   * palpite disfarçado de resposta.
   */
  async fetchAccountState(steamId: string): Promise<SteamAccountState | null> {
    try {
      const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(
          `Steam respondeu ${req.status} ao ler o perfil ${steamId}`,
        );
        return null;
      }

      const xml = await req.text();

      const limitado = this.extrair(xml, 'isLimitedAccount');

      // Perfil inexistente devolve HTML de erro, e perfil privado pode
      // omitir o campo. Sem ele não há resposta a dar.
      if (limitado === null) {
        this.logger.warn(
          `Perfil ${steamId} não trouxe isLimitedAccount — pode não existir ` +
            `ou estar privado`,
        );
        return null;
      }

      return {
        isLimited: limitado === '1',
        privacyState: this.extrair(xml, 'privacyState'),
        tradeBanState: this.extrair(xml, 'tradeBanState'),
      };
    } catch (erro) {
      this.logger.warn(`Falha ao ler o perfil na Steam: ${String(erro)}`);
      return null;
    }
  }

  /**
   * Lê uma tag simples do XML.
   *
   * Sem biblioteca de XML de propósito: são três campos de formato fixo, e
   * a alternativa seria uma dependência inteira para isso. O conteúdo pode
   * vir embrulhado em CDATA, que a Steam usa em campos de texto livre.
   */
  private extrair(xml: string, tag: string): string | null {
    const m = new RegExp(
      `<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`,
      's',
    ).exec(xml);

    return m ? m[1].trim() : null;
  }
}
