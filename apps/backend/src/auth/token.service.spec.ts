import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwt: JwtService;
  let config: ConfigService;

  const payload = { sub: 'user-123', steamId: '76561198000000001' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => ({
            secret: c.getOrThrow<string>('JWT_SECRET'),
            signOptions: {
              expiresIn: c.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
            },
          }),
        }),
      ],
      providers: [TokenService],
    }).compile();

    service = moduleRef.get(TokenService);
    jwt = moduleRef.get(JwtService);
    config = moduleRef.get(ConfigService);
  });

  describe('sign', () => {
    it('produces a token its own verification accepts', () => {
      const verified = service.verify(service.sign(payload));

      expect(verified?.sub).toBe(payload.sub);
      expect(verified?.steamId).toBe(payload.steamId);
    });

    // Without a unique jti, revoking one logout would drop all of the
    // person's sessions — signing out on the desktop would disconnect
    // the phone.
    it('produces a different jti on every issue', () => {
      const a = service.verify(service.sign(payload))!;
      const b = service.verify(service.sign(payload))!;

      expect(a.jti).toBeDefined();
      expect(a.jti).not.toBe(b.jti);
    });

    it('includes iat and exp', () => {
      const v = service.verify(service.sign(payload))!;
      const ttl = config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

      expect(v.iat).toBeGreaterThan(0);
      expect(v.exp - v.iat).toBe(ttl);
    });

    // The token lives for days and cannot be revised: mutable data
    // embedded in it becomes a stale copy the user carries around.
    it('carries neither balance nor ban state', () => {
      const raw = jwt.decode<Record<string, unknown>>(service.sign(payload));

      expect(Object.keys(raw).sort()).toEqual(
        ['exp', 'iat', 'jti', 'steamId', 'sub'].sort(),
      );
    });
  });

  describe('verify', () => {
    it('refuses text that is not a token', () => {
      expect(service.verify('anything at all')).toBeNull();
    });

    it('refuses a token signed with another key', () => {
      const other = new JwtService({ secret: 'a-different-test-key-123' });
      const forged = other.sign(payload);

      expect(service.verify(forged)).toBeNull();
    });

    it('refuses an expired token', () => {
      const expired = jwt.sign(payload, { expiresIn: '-1s' });

      expect(service.verify(expired)).toBeNull();
    });

    // Editing the payload without re-signing is the simplest attempt at
    // switching identities.
    it('refuses a tampered token', () => {
      const [head, , sig] = service.sign(payload).split('.');
      const otherPayload = Buffer.from(
        JSON.stringify({ ...payload, sub: 'another-user' }),
      ).toString('base64url');

      expect(service.verify(`${head}.${otherPayload}.${sig}`)).toBeNull();
    });
  });

  describe('cookieOptions', () => {
    it('keeps page JavaScript from reading the cookie', () => {
      // Without httpOnly, an XSS would take the session with it.
      expect(service.cookieOptions().httpOnly).toBe(true);
    });

    it('uses sameSite lax against CSRF', () => {
      expect(service.cookieOptions().sameSite).toBe('lax');
    });

    it('expires together with the token', () => {
      const ttl = config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS');

      // The cookie's maxAge is in milliseconds; if they diverge, either
      // the cookie disappears before the token expires or the reverse.
      expect(service.cookieOptions().maxAge).toBe(ttl * 1000);
    });
  });
});
