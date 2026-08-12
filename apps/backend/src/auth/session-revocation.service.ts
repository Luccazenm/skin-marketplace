import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/**
 * Invalida sessões antes de o token expirar.
 *
 * JWT é autocontido: uma vez assinado, vale até a data de expiração e o
 * servidor não tem como "desassinar". Apagar o cookie no logout resolve
 * para quem usa o navegador normalmente, mas quem tiver copiado o token
 * continua entrando pelos dias restantes. Num sistema com saldo, isso não
 * serve.
 *
 * São duas revogações, para dois problemas diferentes:
 *
 *   jti          -> derruba UM token. É o logout comum: sair aqui não pode
 *                   desconectar a pessoa do celular.
 *   revokedAt    -> derruba TODOS os tokens do usuário emitidos antes de
 *                   agora. É o caso de conta comprometida, em que não se
 *                   sabe quantas sessões existem nem onde.
 *
 * Tudo com TTL igual ao que resta de vida do token: passada a expiração
 * natural, a entrada não protege mais nada e só ocuparia memória.
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Derruba um token específico. */
  async revokeToken(jti: string, expiraEm: number): Promise<void> {
    const segundos = this.segundosRestantes(expiraEm);

    if (segundos <= 0) {
      return; // já expirou sozinho
    }

    await this.redis.set(`revoked:jti:${jti}`, '1', 'EX', segundos);
  }

  /** Derruba todos os tokens do usuário emitidos até agora. */
  async revokeAllForUser(userId: string): Promise<void> {
    const ttl = this.config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

    // O corte é o fim do segundo atual, não o instante exato.
    //
    // O JWT grava iat com precisão de segundos: um token emitido no mesmo
    // segundo do corte teria iat igual a ele e escaparia de uma comparação
    // por "menor que". Seria uma janela de um segundo em que "sair de
    // todos" não derruba a sessão que acabou de ser usada — justamente o
    // caso de conta comprometida, em que o atacante está ativo agora.
    //
    // Arredondar para cima resolve, ao custo de invalidar também um login
    // feito no mesmo segundo. Na prática isso não acontece: entrar de novo
    // passa pelo redirecionamento da Steam, que leva bem mais que isso.
    const corte = Math.floor(Date.now() / 1000) + 1;

    // Guardamos o instante do corte, não uma lista de tokens: não temos
    // como enumerar o que foi emitido, e não precisamos.
    await this.redis.set(
      `revoked:user:${userId}`,
      corte.toString(),
      'EX',
      ttl,
    );
  }

  /**
   * Este token ainda vale?
   *
   * As duas consultas vão numa pipeline só para não custar duas idas ao
   * Redis em cada requisição autenticada.
   */
  async isRevoked(payload: {
    jti?: string;
    sub: string;
    iat?: number;
  }): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    pipeline.exists(`revoked:jti:${payload.jti ?? ''}`);
    pipeline.get(`revoked:user:${payload.sub}`);

    const resultados = await pipeline.exec();

    if (!resultados) {
      // Redis fora do ar. Deixamos passar: o guard ainda consulta o banco
      // e bloqueia conta banida, que é o caso grave. Recusar toda sessão
      // por indisponibilidade do cache derrubaria o site inteiro.
      return false;
    }

    const [[, tokenRevogado], [, corte]] = resultados as [
      [Error | null, number],
      [Error | null, string | null],
    ];

    if (tokenRevogado === 1) {
      return true;
    }

    if (corte && payload.iat !== undefined) {
      // Emitido antes do corte: veio de uma sessão que o usuário mandou
      // encerrar.
      return payload.iat < Number(corte);
    }

    return false;
  }

  private segundosRestantes(expiraEm: number): number {
    return Math.ceil(expiraEm - Date.now() / 1000);
  }
}
