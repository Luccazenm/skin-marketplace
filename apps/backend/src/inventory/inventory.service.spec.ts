import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ItemCategory } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogEnrichmentService } from './catalog-enrichment.service';
import { InventoryCacheService } from './inventory-cache.service';
import { InventoryService } from './inventory.service';
import {
  SteamInventoryService,
  type InventoryItem,
} from './steam-inventory.service';

/**
 * Runs against the local Redis (docker compose up -d).
 * Steam is mocked — the point is to test WHEN we decide to call it.
 */
describe('InventoryService', () => {
  let service: InventoryService;
  let redis: RedisService;
  let prisma: PrismaService;

  const STEAM_ID = '76561199000000050';

  const fakeItem: InventoryItem = {
    assetId: '1',
    classId: '2',
    instanceId: '0',
    marketHashName: 'AK-47 | Redline (Field-Tested)',
    iconUrl: null,
    category: ItemCategory.RIFLE,
    tradable: true,
    marketable: true,
    depositable: true,
    blockReason: null,
    hasUniquePattern: true,
    applied: [],
    rarity: 'Classified',
    exterior: 'Field-Tested',
    typeLabel: 'Rifle',
    float: 0.25,
    paintSeed: 661,
    inspectLink: null,
  };

  const steamMock = {
    fetchInventory: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      // PrismaService goes in for real, like AuditService elsewhere: the
      // enrichment reads the catalog, and a mocked one would prove the
      // wiring works against a fiction rather than against the 33,950
      // rows the screen will actually meet.
      providers: [
        InventoryService,
        InventoryCacheService,
        RedisService,
        PrismaService,
        CatalogEnrichmentService,
      ],
    })
      .useMocker((token) =>
        token === SteamInventoryService ? steamMock : undefined,
      )
      .compile();

    service = moduleRef.get(InventoryService);
    redis = moduleRef.get(RedisService);
    prisma = moduleRef.get(PrismaService);

    // The test database has the migrations and the seed, but not the
    // catalog: `catalog:sync` pulls 33,950 rows off the network and takes
    // ~220s, which is not something a test run should do. So the one row
    // this suite needs is created here, matching the real shape — weapon
    // and float range included, because the CHECK constraints require
    // them for a skinned weapon.
    // The same fields on both sides, rather than `update: {}`. A row
    // left over from an earlier run would otherwise keep whatever shape
    // it had then, and a field added to this seed would never reach the
    // database — the suite failing on a value it appears to set right
    // here, which is exactly what happened when `flavorText` arrived.
    const template = {
      rarity: 'Classified',
      category: ItemCategory.RIFLE,
      weapon: 'AK-47',
      skinName: 'Redline',
      collections: ['The Phoenix Collection'],
      description: 'It has been custom painted with a hot rod flame job.',
      flavorText: 'Custom paint, custom problems',
      minFloat: 0.1,
      maxFloat: 0.7,
    };

    await prisma.skinTemplate.upsert({
      where: { marketHashName: fakeItem.marketHashName },
      update: template,
      create: { marketHashName: fakeItem.marketHashName, ...template },
    });
  });

  beforeEach(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot:default',
      'steam:inventory:blocked:default',
    );
    steamMock.fetchInventory.mockReset();
  });

  afterAll(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot:default',
      'steam:inventory:blocked:default',
    );
    await redis.quit();
    await prisma.$disconnect();
  });

  it('queries Steam when there is no cache', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [fakeItem],
    });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.cached).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);
  });

  // The central point of this stage: a user refresh does not become a
  // call to Steam.
  it('does not call Steam again while the cache is fresh', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [fakeItem],
    });

    await service.getInventory(STEAM_ID);
    const second = await service.getInventory(STEAM_ID);

    expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') return;
    expect(second.cached).toBe(true);
    expect(second.stale).toBe(false);
  });

  it('serves stale data when Steam returns a 429', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [fakeItem],
    });
    await service.getInventory(STEAM_ID);

    // Age the cache and free the slot to force another attempt
    await ageCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot:default');

    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
    expect(r.items).toHaveLength(1);

    // And it marked the penalty, so the next callers do not even try
    expect(await redis.exists('steam:inventory:blocked:default')).toBe(1);
  });

  it('refuses when it hits the limit with nothing cached', async () => {
    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('rate_limited');
  });

  it('does not call Steam during the penalty', async () => {
    await redis.set('steam:inventory:blocked:default', '1', 'EX', 60);

    await service.getInventory(STEAM_ID);

    expect(steamMock.fetchInventory).not.toHaveBeenCalled();
  });

  it('serves stale data when Steam fails for another reason', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [fakeItem],
    });
    await service.getInventory(STEAM_ID);

    await ageCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot:default');

    steamMock.fetchInventory.mockResolvedValue({
      status: 'error',
      message: 'timeout',
    });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
  });

  // Steam returns one name; the screen wants the weapon and the skin
  // apart. The catalog already holds them split, so the split happens
  // here and never in the browser — a second splitter written there
  // would be free to drift from catalog-mapping.ts.
  describe('catalog enrichment', () => {
    it('splits the weapon from the skin name using the catalog', async () => {
      steamMock.fetchInventory.mockResolvedValue({
        status: 'ok',
        items: [fakeItem],
      });

      const r = await service.getInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].catalog).toEqual({
        weapon: 'AK-47',
        skinName: 'Redline',
        collections: ['The Phoenix Collection'],
        description: 'It has been custom painted with a hot rod flame job.',
        flavorText: 'Custom paint, custom problems',
      });
    });

    // The catalog mirrors a public dataset, and Valve ships items before
    // it catches up. An unknown item has to survive the read rather than
    // disappear from someone's inventory.
    it('leaves catalog null for an item it does not know', async () => {
      steamMock.fetchInventory.mockResolvedValue({
        status: 'ok',
        items: [
          { ...fakeItem, marketHashName: 'Nonexistent | Item (Factory New)' },
        ],
      });

      const r = await service.getInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].catalog).toBeNull();
    });
  });

  // A ten-minute freshness window is what makes one address serve 150
  // people instead of 30. The cost is that someone who just traded sees
  // stale data, and this is the way out of that.
  describe('manual refresh', () => {
    it('goes to Steam even when the cache is fresh', async () => {
      steamMock.fetchInventory.mockResolvedValue({
        status: 'ok',
        items: [fakeItem],
      });

      await service.getInventory(STEAM_ID);
      expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);

      // Without force this would be served from cache, untouched.
      await redis.del('steam:inventory:slot:default');
      await service.getInventory(STEAM_ID, true);

      expect(steamMock.fetchInventory).toHaveBeenCalledTimes(2);
    });

    // It bypasses the cache, not the limiter. Otherwise holding down the
    // button would spend the whole site's Steam budget.
    it('still waits its turn in the rate limit', async () => {
      steamMock.fetchInventory.mockResolvedValue({
        status: 'ok',
        items: [fakeItem],
      });

      await service.getInventory(STEAM_ID);
      // The slot from that call is still held.
      const forced = await service.getInventory(STEAM_ID, true);

      expect(steamMock.fetchInventory).toHaveBeenCalledTimes(1);
      // Served from cache rather than refused: the data is there, it is
      // just not newer than it was.
      expect(forced.status).toBe('ok');
    });
  });

  // Privacy: if the person closed their profile, we cannot keep showing
  // what they decided to hide.
  it('does NOT serve the cache once the inventory turns private', async () => {
    steamMock.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [fakeItem],
    });
    await service.getInventory(STEAM_ID);

    await ageCache(redis, STEAM_ID);
    await redis.del('steam:inventory:slot:default');

    steamMock.fetchInventory.mockResolvedValue({ status: 'private' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('private');
  });
});

/**
 * Rewrites the cache entry with an old date, so it turns stale.
 *
 * Aged against the entry's own freshness window rather than a fixed
 * number of minutes: the window is jittered per entry and has been
 * lengthened once already, and a hardcoded age silently stops ageing
 * anything the day it is raised again — leaving these tests passing
 * while asserting the opposite of what they read as.
 */
async function ageCache(redis: RedisService, steamId: string) {
  const raw = await redis.get(`inventory:${steamId}`);
  const entry = JSON.parse(raw!) as {
    items: unknown[];
    fetchedAt: number;
    freshFor?: number;
  };

  const windowSeconds = entry.freshFor ?? 60 * 60;
  entry.fetchedAt = Date.now() - (windowSeconds + 60) * 1000;

  await redis.set(`inventory:${steamId}`, JSON.stringify(entry), 'EX', 3600);
}
