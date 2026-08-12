import { randomUUID } from 'node:crypto';
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
  /**
   * Identificador único deste token. É o que permite derrubar UMA sessão
   * sem afetar as outras — sem ele, o logout num dispositivo teria que
   * desconectar a pessoa de todos.
   */
  jti: string;
}

/** Payload como sai do verify, com os campos que o JWT acrescenta. */
export interface JwtPayloadVerificado extends JwtPayload {
  /** Emitido em (segundos). Comparado com o corte de "sair de todos". */
  iat: number;
  /** Expira em (segundos). Define o TTL da entrada de revogação. */
  exp: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  sign(payload: Omit<JwtPayload, 'jti'>): string {
    return this.jwt.sign({ ...payload, jti: randomUUID() });
  }

  /**
   * Retorna o payload ou null se o token for inválido/expirado.
   */
  verify(token: string): JwtPayloadVerificado | null {
    try {
      return this.jwt.verify<JwtPayloadVerificado>(token);
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
