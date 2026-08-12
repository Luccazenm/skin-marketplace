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
 * O guard protege TODAS as rotas autenticadas. Uma condição invertida aqui
 * abre o site inteiro, e é o tipo de erro que passa numa revisão rápida.
 */
describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let tokens: TokenService;
  let prisma: PrismaService;
  let redis: RedisService;
  let revocation: SessionRevocationService;

  const STEAM_ID_OK = '76561199000000090';
  const STEAM_ID_BANIDO = '76561199000000091';
  const TODOS = [STEAM_ID_OK, STEAM_ID_BANIDO];

  let user: User;
  let banido: User;

  /** ExecutionContext mínimo com o request que queremos testar. */
  function contextoCom(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  const comHeader = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const comCookie = (token: string) => ({
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

    await prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });

    user = await prisma.user.create({
      data: { steamId: STEAM_ID_OK, username: 'Autorizado' },
    });

    banido = await prisma.user.create({
      data: {
        steamId: STEAM_ID_BANIDO,
        username: 'Suspenso',
        isBanned: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { steamId: { in: TODOS } } });
    const chaves = await redis.keys('revoked:*');
    if (chaves.length > 0) await redis.del(...chaves);
    await prisma.$disconnect();
    await redis.quit();
  });

  const tokenDe = (u: User) => tokens.sign({ sub: u.id, steamId: u.steamId });

  describe('aceita', () => {
    it('token válido pelo header Authorization', async () => {
      const req = comHeader(tokenDe(user));

      await expect(guard.canActivate(contextoCom(req))).resolves.toBe(true);
    });

    it('token válido pelo cookie', async () => {
      const req = comCookie(tokenDe(user));

      await expect(guard.canActivate(contextoCom(req))).resolves.toBe(true);
    });

    // O handler depende disso: sem anexar, @CurrentUser vem undefined.
    it('anexa usuário e payload ao request', async () => {
      const req: Record<string, unknown> = comHeader(tokenDe(user));

      await guard.canActivate(contextoCom(req));

      expect((req.user as User).id).toBe(user.id);
      expect((req.tokenPayload as { sub: string }).sub).toBe(user.id);
    });
  });

  describe('recusa', () => {
    it('requisição sem token', async () => {
      await expect(
        guard.canActivate(contextoCom({ headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('token que não é um JWT', async () => {
      await expect(
        guard.canActivate(contextoCom(comHeader('isso.nao.e-token'))),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Assinado com outro segredo: é a tentativa de forjar sessão.
    it('token assinado por outra chave', async () => {
      const forjado =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiJxdWFscXVlciIsInN0ZWFtSWQiOiIxIiwiaWF0IjoxfQ.' +
        'assinatura_invalida';

      await expect(
        guard.canActivate(contextoCom(comHeader(forjado))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('header sem o prefixo Bearer', async () => {
      const req = { headers: { authorization: tokenDe(user) } };

      await expect(guard.canActivate(contextoCom(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('token revogado', async () => {
      const token = tokenDe(user);
      const payload = tokens.verify(token)!;

      await revocation.revokeToken(payload.jti, payload.exp);

      await expect(
        guard.canActivate(contextoCom(comHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Banimento tem efeito imediato porque o guard consulta o banco. Se
    // passasse a confiar só no token, o banido entraria por dias.
    it('token válido de conta banida', async () => {
      await expect(
        guard.canActivate(contextoCom(comHeader(tokenDe(banido)))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('token de usuário que não existe mais', async () => {
      const fantasma = await prisma.user.create({
        data: { steamId: '76561199000000092', username: 'Apagado' },
      });
      const token = tokens.sign({
        sub: fantasma.id,
        steamId: fantasma.steamId,
      });
      await prisma.user.delete({ where: { id: fantasma.id } });

      await expect(
        guard.canActivate(contextoCom(comHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('token da conta da plataforma', async () => {
      const plataforma = await prisma.user.findFirst({
        where: { isPlatform: true },
      });
      expect(plataforma).not.toBeNull();

      const token = tokens.sign({
        sub: plataforma!.id,
        steamId: plataforma!.steamId,
      });

      await expect(
        guard.canActivate(contextoCom(comHeader(token))),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
