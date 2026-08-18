import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionRevocationService } from './session-revocation.service';
import { TokenService } from './token.service';

/**
 * The guard protects EVERY authenticated route. An inverted condition
 * here opens up the whole site, and it is the kind of mistake that slips
 * past a quick review.
 */
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let tokens: TokenService;
  let prisma: PrismaService;
  let redis: RedisService;
  let revocation: SessionRevocationService;

  const STEAM_ID_OK = '76561199000000090';
  const STEAM_ID_BANNED = '76561199000000091';
  const ALL = [STEAM_ID_OK, STEAM_ID_BANNED];

  let user: User;
  let banned: User;

  /** Minimal ExecutionContext wrapping the request we want to test. */
  function contextWith(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  const withHeader = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const withCookie = (token: string) => ({
    headers: {},
    cookies: { session: token },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.getOrThrow<string>('JWT_SECRET'),
            signOptions: {
              expiresIn: config.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
            },
          }),
        }),
      ],
      providers: [
        JwtAuthGuard,
        TokenService,
        PrismaService,
        RedisService,
        SessionRevocationService,
      ],
    }).compile();

    guard = moduleRef.get(JwtAuthGuard);
    tokens = moduleRef.get(TokenService);
    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    revocation = moduleRef.get(SessionRevocationService);

    await prisma.user.deleteMany({ where: { steamId: { in: ALL } } });

    user = await prisma.user.create({
      data: { steamId: STEAM_ID_OK, username: 'Authorized' },
    });

    banned = await prisma.user.create({
      data: {
        steamId: STEAM_ID_BANNED,
        username: 'Suspended',
        isBanned: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: ALL } } });
    const keys = await redis.keys('revoked:*');
    if (keys.length > 0) await redis.del(...keys);
    await prisma.$disconnect();
    await redis.quit();
  });

  const tokenFor = (u: User) => tokens.sign({ sub: u.id, steamId: u.steamId });

  describe('accepts', () => {
    it('a valid token in the Authorization header', async () => {
      const req = withHeader(tokenFor(user));

      await expect(guard.canActivate(contextWith(req))).resolves.toBe(true);
    });

    it('a valid token in the cookie', async () => {
      const req = withCookie(tokenFor(user));

      await expect(guard.canActivate(contextWith(req))).resolves.toBe(true);
    });

    // The handler depends on this: without attaching, @CurrentUser comes
    // through undefined.
    it('attaches the user and the payload to the request', async () => {
      const req: Record<string, unknown> = withHeader(tokenFor(user));

      await guard.canActivate(contextWith(req));

      expect((req.user as User).id).toBe(user.id);
      expect((req.tokenPayload as { sub: string }).sub).toBe(user.id);
    });
  });

  describe('refuses', () => {
    it('a request with no token', async () => {
      await expect(
        guard.canActivate(contextWith({ headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a token that is not a JWT', async () => {
      await expect(
        guard.canActivate(contextWith(withHeader('this.is.not-a-token'))),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Signed with another secret: this is the session-forging attempt.
    it('a token signed with another key', async () => {
      const forged =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiJxdWFscXVlciIsInN0ZWFtSWQiOiIxIiwiaWF0IjoxfQ.' +
        'invalid_signature';

      await expect(
        guard.canActivate(contextWith(withHeader(forged))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a header without the Bearer prefix', async () => {
      const req = { headers: { authorization: tokenFor(user) } };

      await expect(guard.canActivate(contextWith(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('a revoked token', async () => {
      const token = tokenFor(user);
      const payload = tokens.verify(token)!;

      await revocation.revokeToken(payload.jti, payload.exp);

      await expect(
        guard.canActivate(contextWith(withHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });

    // A ban takes effect immediately because the guard queries the
    // database. Were it to trust the token alone, a banned user would
    // keep getting in for days.
    it('a valid token from a banned account', async () => {
      await expect(
        guard.canActivate(contextWith(withHeader(tokenFor(banned)))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a token from a user that no longer exists', async () => {
      const ghost = await prisma.user.create({
        data: { steamId: '76561199000000092', username: 'Deleted' },
      });
      const token = tokens.sign({
        sub: ghost.id,
        steamId: ghost.steamId,
      });
      await prisma.user.delete({ where: { id: ghost.id } });

      await expect(
        guard.canActivate(contextWith(withHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('a token from the platform account', async () => {
      const platform = await prisma.user.findFirst({
        where: { isPlatform: true },
      });
      expect(platform).not.toBeNull();

      const token = tokens.sign({
        sub: platform!.id,
        steamId: platform!.steamId,
      });

      await expect(
        guard.canActivate(contextWith(withHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
