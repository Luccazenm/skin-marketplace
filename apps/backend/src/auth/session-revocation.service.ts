import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/**
 * Invalidates sessions before the token expires.
 *
 * A JWT is self-contained: once signed, it is valid until its expiry
 * date and the server has no way to "unsign" it. Clearing the cookie on
 * logout is enough for someone using the browser normally, but anyone
 * who copied the token keeps getting in for the remaining days. In a
 * system holding balances, that will not do.
 *
 * There are two revocations, for two different problems:
 *
 *   jti          -> drops ONE token. This is the ordinary logout: signing
 *                   out here must not disconnect the person's phone.
 *   revokedAt    -> drops ALL of the user's tokens issued before now.
 *                   This is the compromised-account case, where we do not
 *                   know how many sessions exist or where.
 *
 * Everything carries a TTL equal to the token's remaining lifetime: past
 * its natural expiry the entry protects nothing and would only take up
 * memory.
 */
@Injectable()
export class SessionRevocationService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Drops one specific token. */
  async revokeToken(jti: string, expiresAt: number): Promise<void> {
    const seconds = this.secondsRemaining(expiresAt);

    if (seconds <= 0) {
      return; // it already expired on its own
    }

    await this.redis.set(`revoked:jti:${jti}`, '1', 'EX', seconds);
  }

  /** Drops every token issued to this user up to now. */
  async revokeAllForUser(userId: string): Promise<void> {
    const ttl = this.config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

    // The cutoff is the end of the current second, not the exact instant.
    //
    // A JWT records iat with second precision: a token issued in the same
    // second as the cutoff would have an equal iat and would escape a
    // "less than" comparison. That would be a one-second window in which
    // "log out everywhere" fails to drop the session that was just used —
    // exactly the compromised-account case, where the attacker is active
    // right now.
    //
    // Rounding up fixes it, at the cost of also invalidating a login made
    // in that same second. In practice that does not happen: signing in
    // again goes through the Steam redirect, which takes far longer.
    const cutoff = Math.floor(Date.now() / 1000) + 1;

    // We store the cutoff instant, not a list of tokens: we have no way
    // to enumerate what was issued, and we do not need one.
    await this.redis.set(
      `revoked:user:${userId}`,
      cutoff.toString(),
      'EX',
      ttl,
    );
  }

  /**
   * Is this token still valid?
   *
   * Both lookups go in a single pipeline so an authenticated request does
   * not cost two round trips to Redis.
   */
  async isRevoked(payload: {
    jti?: string;
    sub: string;
    iat?: number;
  }): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    pipeline.exists(`revoked:jti:${payload.jti ?? ''}`);
    pipeline.get(`revoked:user:${payload.sub}`);

    const results = await pipeline.exec();

    if (!results) {
      // Redis is down. We let the request through: the guard still queries
      // the database and blocks banned accounts, which is the serious
      // case. Refusing every session because the cache is unavailable
      // would take the whole site down.
      return false;
    }

    const [[, tokenRevoked], [, cutoff]] = results as [
      [Error | null, number],
      [Error | null, string | null],
    ];

    if (tokenRevoked === 1) {
      return true;
    }

    if (cutoff && payload.iat !== undefined) {
      // Issued before the cutoff: it came from a session the user asked
      // to end.
      return payload.iat < Number(cutoff);
    }

    return false;
  }

  private secondsRemaining(expiresAt: number): number {
    return Math.ceil(expiresAt - Date.now() / 1000);
  }
}
