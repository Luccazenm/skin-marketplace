import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { SessionRevocationService } from './session-revocation.service';

describe('SessionRevocationService', () => {
  let service: SessionRevocationService;
  let redis: RedisService;

  const USER = 'user-revocation-test';
  const now = () => Math.floor(Date.now() / 1000);

  const payload = (jti: string, iat = now()) => ({ jti, sub: USER, iat });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [SessionRevocationService, RedisService],
    }).compile();

    service = moduleRef.get(SessionRevocationService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    const keys = await redis.keys('revoked:*test*');
    if (keys.length > 0) await redis.del(...keys);
    await redis.del(`revoked:user:${USER}`);
  });

  afterAll(async () => {
    const keys = await redis.keys('revoked:*test*');
    if (keys.length > 0) await redis.del(...keys);
    await redis.del(`revoked:user:${USER}`);
    await redis.quit();
  });

  it('accepts a token that was never revoked', async () => {
    expect(await service.isRevoked(payload('jti-test-1'))).toBe(false);
  });

  it('refuses a revoked token', async () => {
    await service.revokeToken('jti-test-1', now() + 3600);

    expect(await service.isRevoked(payload('jti-test-1'))).toBe(true);
  });

  // Signing out on the desktop must not disconnect the person's phone.
  it('revoking one token does not affect the others', async () => {
    await service.revokeToken('jti-test-1', now() + 3600);

    expect(await service.isRevoked(payload('jti-test-2'))).toBe(false);
  });

  it('writes nothing for a token that already expired', async () => {
    await service.revokeToken('jti-test-old', now() - 60);

    expect(await redis.exists('revoked:jti:jti-test-old')).toBe(0);
  });

  describe('log out of every device', () => {
    it('drops tokens issued before the cutoff', async () => {
      const old = payload('jti-test-older', now() - 300);

      await service.revokeAllForUser(USER);

      expect(await service.isRevoked(old)).toBe(true);
    });

    // The token behind the next sign-in has to work, otherwise the user
    // can never log in again after "log out everywhere".
    it('does not drop a token issued after the cutoff', async () => {
      await service.revokeAllForUser(USER);

      // +2s to land clearly past the cutoff, rounding included
      const fresh = payload('jti-test-new', now() + 2);

      expect(await service.isRevoked(fresh)).toBe(false);
    });

    // Regression: a JWT records iat in seconds, so a token issued in the
    // same second as the cutoff had an equal iat and escaped a "less
    // than" comparison. That was a one-second window in which "log out
    // everywhere" failed to drop the session in use.
    it('drops a token issued in the same second as the cutoff', async () => {
      const sameSecond = payload('jti-test-boundary', now());

      await service.revokeAllForUser(USER);

      expect(await service.isRevoked(sameSecond)).toBe(true);
    });

    it('does not affect another user', async () => {
      await service.revokeAllForUser(USER);

      const someoneElse = {
        jti: 'jti-test-3',
        sub: 'another-test-user',
        iat: now() - 300,
      };

      expect(await service.isRevoked(someoneElse)).toBe(false);
    });
  });

  it('the entry expires together with the token', async () => {
    await service.revokeToken('jti-test-ttl', now() + 120);

    const ttl = await redis.ttl('revoked:jti:jti-test-ttl');

    // Keeping it longer than the token's lifetime would only take up
    // memory: once expired, the token is worthless on its own.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(121);
  });
});
