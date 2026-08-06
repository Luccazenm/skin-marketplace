import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Conteúdo do token de sessão.
 *
 * Só entra aqui o que é imutável. Saldo, banimento e permissões ficam de
 * fora de propósito: o token vive por dias e não pode ser revogado, então
 * qualquer dado mutável embutido nele vira uma cópia desatualizada que o
 * usuário carrega — e, no caso de saldo, uma que ele poderia explorar.
 */
export interface JwtPayload {
  sub: string; // id do usuário
  steamId: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  sign(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }

  /**
   * Retorna o payload ou null se o token for inválido/expirado.
   */
  verify(token: string): JwtPayload | null {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  /**
   * Opções do cookie de sessão.
   *
   * httpOnly: JavaScript da página não consegue ler o cookie. Se um XSS
   *   entrar no site, o atacante não leva a sessão junto.
   * sameSite lax: o cookie não é enviado em requisições cross-site de
   *   terceiros, o que corta CSRF na maior parte dos casos.
   * secure: só trafega em HTTPS. Falso apenas em dev local.
   */
  cookieOptions() {
    const segundos = this.config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: 'lax' as const,
      // maxAge do cookie é em milissegundos
      maxAge: segundos * 1000,
      path: '/',
    };
  }

  static readonly COOKIE_NAME = 'session';
}
