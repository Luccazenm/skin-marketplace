import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { enrichContext } from '../observability/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService, type VerifiedJwtPayload } from './token.service';

/** Request with the user already resolved by the guard. */
export interface AuthenticatedRequest extends Request {
  user: User;
  /** Kept so logout can revoke the token in use. */
  tokenPayload: VerifiedJwtPayload;
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
      throw new UnauthorizedException('Missing session');
    }

    const payload = this.tokens.verify(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Ended before expiring: logout on this device, or the user asked to
    // log out everywhere.
    if (await this.revocation.isRevoked(payload)) {
      throw new UnauthorizedException('Session ended');
    }

    // We query the database instead of trusting the token alone.
    //
    // A JWT is not revocable: once issued, it is valid until it expires.
    // If someone gets banned, or the account is deleted, the token in
    // their hands would keep working for days. On a site that moves
    // money that is unacceptable, so we trade a little performance for
    // the ability to cut access immediately. The lookup is by primary
    // key — cheap.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.isBanned || user.isPlatform) {
      throw new UnauthorizedException('Invalid session');
    }

    req.user = user;
    req.tokenPayload = payload;

    // From here on the logs for this request carry an owner. The earlier
    // ones do not — which is correct: we did not know who it was yet.
    enrichContext({ userId: user.id });

    return true;
  }

  /**
   * Accepts the httpOnly cookie (normal browser use) or the Authorization
   * header (Swagger, tests, API clients).
   */
  private extractToken(req: Request): string | null {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const fromCookie = cookies?.[TokenService.COOKIE_NAME];

    if (typeof fromCookie === 'string' && fromCookie.length > 0) {
      return fromCookie;
    }

    const header = req.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }
}
