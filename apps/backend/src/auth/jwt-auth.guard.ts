import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService, type JwtPayloadVerificado } from './token.service';

/** Request com o usuário já resolvido pelo guard. */
export interface AuthenticatedRequest extends Request {
  user: User;
  /** Guardado para o logout conseguir revogar o token em uso. */
  tokenPayload: JwtPayloadVerificado;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly revocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException('Sessão ausente');
    }

    const payload = this.tokens.verify(token);

    if (!payload) {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    // Encerrada antes de expirar: logout neste dispositivo, ou o usuário
    // mandou sair de todos.
    if (await this.revocation.isRevoked(payload)) {
      throw new UnauthorizedException('Sessão encerrada');
    }

    // Consultamos o banco em vez de confiar só no token.
    //
    // JWT não é revogável: uma vez emitido, vale até expirar. Se alguém for
    // banido, ou a conta for apagada, o token na mão da pessoa continuaria
    // funcionando por dias. Num site que movimenta dinheiro isso é
    // inaceitável, então trocamos um pouco de desempenho por poder cortar
    // acesso na hora. A consulta é por chave primária — barata.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.isBanned || user.isPlatform) {
      throw new UnauthorizedException('Sessão inválida');
    }

    req.user = user;
    req.tokenPayload = payload;

    return true;
  }

  /**
   * Aceita o cookie httpOnly (uso normal, pelo navegador) ou o header
   * Authorization (Swagger, testes, clientes de API).
   */
  private extractToken(req: Request): string | null {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const doCookie = cookies?.[TokenService.COOKIE_NAME];

    if (typeof doCookie === 'string' && doCookie.length > 0) {
      return doCookie;
    }

    const header = req.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }
}
