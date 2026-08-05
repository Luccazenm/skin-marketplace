import { Injectable } from '@nestjs/common';
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
      'openid.claimed_id':
        'http://specs.openid.net/auth/2.0/identifier_select',
    });

    return `${SteamOpenIdService.STEAM_OPENID_ENDPOINT}?${params.toString()}`;
  }
}
