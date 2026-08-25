import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { setupApp } from '../app-setup';
import { PriceSource } from '@prisma/client';
import { AppModule } from '../app.module';
import { Cs2ShProvider } from '../pricing/cs2sh.provider';
import { TokenService } from '../auth/token.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamOpenIdService } from '../auth/steam-openid.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SteamInventoryService } from '../inventory/steam-inventory.service';

/**
 * Boots the whole application for testing, with Steam calls replaced by
 * doubles.
 *
 * It uses setupApp, the same one the bootstrap uses: without it we would
 * be missing the route prefix, body validation and cookie parsing, and
 * the test would be measuring an app that does not exist in production.
 *
 * Only Steam is replaced. Postgres and Redis are real — testing how an
 * exception becomes an HTTP status against a fake database would prove
 * nothing.
 */
export interface TestApp {
  app: INestApplication;
  /** Already typed — getHttpServer() returns any and infects the tests. */
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
  /** Authentication header for a user. */
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

  // The price source is stubbed for the same reason every Steam service
  // is: a suite that reaches the network is slow, flaky, and spends a
  // paid quota on every run. The mapping is covered against a real cs2.sh
  // payload in cs2sh.provider.spec.ts, which needs no network either —
  // it reads a recorded response.
  const prices = {
    source: PriceSource.CS2SH,
    configured: true,
    fetchPrices: jest.fn().mockResolvedValue([]),
    fetchAll: jest
      .fn()
      .mockResolvedValue({ items: {}, collectedAt: new Date() }),
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
    .overrideProvider(Cs2ShProvider)
    .useValue(prices)
    .compile();

  const app = moduleRef.createNestApplication();
  setupApp(app);
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
 * Typed response body. supertest returns `any`, which would spread
 * untyped access across every test and let a field mistake slip through
 * unnoticed.
 */
export function body<T>(response: { body: unknown }): T {
  return response.body as T;
}
