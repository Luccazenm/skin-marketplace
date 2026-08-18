import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Contents of the session token.
 *
 * Only immutable data goes in here. Balance, ban status and permissions
 * are deliberately left out: the token lives for days and cannot be
 * revoked, so any mutable value embedded in it becomes a stale copy the
 * user carries around — and, in the case of balance, one they could
 * exploit.
 */
export interface JwtPayload {
  sub: string; // user id
  steamId: string;
  /**
   * Unique identifier for this token. It is what allows dropping ONE
   * session without touching the others — without it, logging out on one
   * device would have to disconnect the person everywhere.
   */
  jti: string;
}

/** Payload as it comes out of verify, with the fields the JWT adds. */
export interface VerifiedJwtPayload extends JwtPayload {
  /** Issued at (seconds). Compared against the "log out everywhere" cutoff. */
  iat: number;
  /** Expires at (seconds). Defines the TTL of the revocation entry. */
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
   * Returns the payload, or null if the token is invalid or expired.
   */
  verify(token: string): VerifiedJwtPayload | null {
    try {
      return this.jwt.verify<VerifiedJwtPayload>(token);
    } catch {
      return null;
    }
  }

  /**
   * Session cookie options.
   *
   * httpOnly: page JavaScript cannot read the cookie. If an XSS lands on
   *   the site, the attacker does not take the session with it.
   * sameSite lax: the cookie is not sent on third-party cross-site
   *   requests, which cuts off CSRF in most cases.
   * secure: HTTPS only. False in local development alone.
   */
  cookieOptions() {
    const seconds = this.config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: 'lax' as const,
      // The cookie's maxAge is in milliseconds
      maxAge: seconds * 1000,
      path: '/',
    };
  }

  static readonly COOKIE_NAME = 'session';
}
