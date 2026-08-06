import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * A Steam autentica por OpenID 2.0 — um protocolo antigo, mas é o único que
 * ela oferece. Não há OAuth para login na Steam.
 *
 * O fluxo tem duas pernas:
 *   1. Mandamos o usuário para a Steam com os parâmetros abaixo (este arquivo)
 *   2. A Steam devolve o usuário para nós com uma assinatura, que PRECISA ser
 *      validada de volta com ela (parte 2)
 *
 * A perna 2 é onde mora a segurança. Confiar nos parâmetros do retorno sem
 * validar permite que qualquer um se passe por qualquer conta — é exatamente
 * essa a falha conhecida de algumas bibliotecas de Steam login.
 */
@Injectable()
export class SteamOpenIdService {
  private static readonly STEAM_OPENID_ENDPOINT =
    'https://steamcommunity.com/openid/login';

  /**
   * O claimed_id devolvido pela Steam sempre tem esta forma:
   *   https://steamcommunity.com/openid/id/76561198000000000
   * Ancorado nas duas pontas de propósito: sem isso, uma URL como
   * "https://sitefalso.com/?x=https://steamcommunity.com/openid/id/123"
   * passaria na checagem.
   */
  private static readonly CLAIMED_ID_PATTERN =
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

  private readonly logger = new Logger(SteamOpenIdService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * URL para onde o usuário deve ser enviado ao clicar em "Entrar com Steam".
   */
  buildLoginUrl(): string {
    const apiUrl = this.config.getOrThrow<string>('API_URL');

    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',

      // Para onde a Steam devolve o usuário depois do login
      'openid.return_to': `${apiUrl}/api/auth/steam/return`,

      // Domínio que a Steam mostra na tela de login ("deseja entrar em X?")
      'openid.realm': apiUrl,

      // "identifier_select" = não sabemos quem é o usuário ainda;
      // a própria Steam decide qual conta está logando.
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });

    return `${SteamOpenIdService.STEAM_OPENID_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Valida o retorno da Steam e devolve o steamId de 64 bits.
   *
   * Esta função é o ponto crítico do login inteiro. Os parâmetros chegam pela
   * query string, ou seja, sob controle de quem faz a requisição — qualquer um
   * pode montar uma URL dizendo ser dono de qualquer conta. A única coisa que
   * separa um login legítimo de uma falsificação é a chamada de volta à Steam
   * feita aqui: devolvemos os parâmetros exatamente como vieram, com o modo
   * trocado para check_authentication, e só aceitamos se ela responder
   * is_valid:true.
   *
   * Retorna null para qualquer coisa que não seja um login válido.
   */
  async verifyReturn(query: Record<string, unknown>): Promise<string | null> {
    // A Steam manda mode=cancel quando o usuário desiste na tela de login
    if (query['openid.mode'] !== 'id_res') {
      return null;
    }

    const claimedId = query['openid.claimed_id'];

    if (typeof claimedId !== 'string') {
      return null;
    }

    // Antes de gastar uma chamada de rede, conferimos o formato. Isso também
    // impede que um claimed_id apontando para outro provedor seja aceito.
    const match = SteamOpenIdService.CLAIMED_ID_PATTERN.exec(claimedId);

    if (!match) {
      return null;
    }

    const steamId = match[1];

    const valido = await this.checkAuthentication(query);

    return valido ? steamId : null;
  }

  /**
   * Devolve os parâmetros para a Steam e pergunta se a assinatura é dela.
   */
  private async checkAuthentication(
    query: Record<string, unknown>,
  ): Promise<boolean> {
    const body = new URLSearchParams();

    // Todos os campos openid.* precisam voltar exatamente como chegaram —
    // eles fazem parte do que foi assinado. Só o mode muda.
    for (const [chave, valor] of Object.entries(query)) {
      if (chave.startsWith('openid.') && typeof valor === 'string') {
        body.set(chave, valor);
      }
    }

    body.set('openid.mode', 'check_authentication');

    let resposta: string;

    try {
      const req = await fetch(SteamOpenIdService.STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!req.ok) {
        this.logger.warn(`Steam respondeu ${req.status} na verificação`);
        return false;
      }

      resposta = await req.text();
    } catch (erro) {
      // Steam fora do ar ou timeout: recusamos o login. Nunca liberar por
      // falha de rede — seria uma porta aberta durante instabilidade.
      this.logger.error(`Falha ao verificar login na Steam: ${String(erro)}`);
      return false;
    }

    // A resposta é texto simples no formato "chave:valor" por linha
    return resposta
      .split('\n')
      .some((linha) => linha.trim() === 'is_valid:true');
  }
}
