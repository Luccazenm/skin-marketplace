import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { configurarApp } from '../app-setup';
import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamOpenIdService } from '../auth/steam-openid.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SteamInventoryService } from '../inventory/steam-inventory.service';

/**
 * Sobe a aplicação inteira para teste, com as chamadas à Steam trocadas
 * por dublês.
 *
 * Usa configurarApp, o mesmo do bootstrap: sem isso faltariam prefixo de
 * rota, validação de corpo e leitura de cookie, e o teste passaria a
 * medir um app que não existe em produção.
 *
 * Só a Steam é substituída. Postgres e Redis são reais — testar a
 * tradução de exceção em status HTTP com banco falso não provaria nada.
 */
export interface TestApp {
  app: INestApplication;
  /** Já tipado — getHttpServer() devolve any e contamina os testes. */
  server: Server;
  prisma: PrismaService;
  redis: RedisService;
  tokens: TokenService;
  steam: {
    openId: { buildLoginUrl: jest.Mock; verifyReturn: jest.Mock };
    profile: { fetchProfile: jest.Mock };
    ban: { fetchBanStatus: jest.Mock };
    inventory: { fetchInventory: jest.Mock };
  };
  /** Header de autenticação para um usuário. */
  authFor: (user: User) => Record<string, string>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const steam = {
    openId: {
      buildLoginUrl: jest.fn(
        () => 'https://steamcommunity.com/openid/login?x=1',
      ),
      verifyReturn: jest.fn(),
    },
    profile: { fetchProfile: jest.fn().mockResolvedValue(null) },
    ban: { fetchBanStatus: jest.fn().mockResolvedValue(null) },
    inventory: { fetchInventory: jest.fn() },
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SteamOpenIdService)
    .useValue(steam.openId)
    .overrideProvider(SteamProfileService)
    .useValue(steam.profile)
    .overrideProvider(SteamBanService)
    .useValue(steam.ban)
    .overrideProvider(SteamInventoryService)
    .useValue(steam.inventory)
    .compile();

  const app = moduleRef.createNestApplication();
  configurarApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const tokens = app.get(TokenService);

  return {
    app,
    server: app.getHttpServer() as Server,
    prisma,
    redis,
    tokens,
    steam,
    authFor: (user) => ({
      Authorization: `Bearer ${tokens.sign({ sub: user.id, steamId: user.steamId })}`,
    }),
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Corpo da resposta com tipo. O supertest devolve `any`, o que espalharia
 * acesso não tipado por todos os testes e deixaria erro de campo passar
 * despercebido.
 */
export function corpo<T>(resposta: { body: unknown }): T {
  return resposta.body as T;
}
