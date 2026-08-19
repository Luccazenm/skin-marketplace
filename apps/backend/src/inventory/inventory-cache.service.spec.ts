import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { InventoryCacheService } from './inventory-cache.service';

/**
 * Steam limits the inventory endpoint per IP, so the rate limit is per
 * egress route rather than global. This suite is about that: that
 * capacity really does multiply with routes, and — the reason the change
 * was made — that one throttled address no longer stops the site.
 */
describe('InventoryCacheService rate limiting', () => {
  let cache: InventoryCacheService;
  let redis: RedisService;

  const ROUTES = ['test-a', 'test-b', 'test-c'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [InventoryCacheService, RedisService],
    }).compile();

    cache = moduleRef.get(InventoryCacheService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    const keys = await redis.keys('steam:inventory:*test-*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    const keys = await redis.keys('steam:inventory:*test-*');
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('hands out one slot per route before refusing', async () => {
    const taken: (string | null)[] = [];

    for (let i = 0; i < ROUTES.length; i++) {
      taken.push(await cache.tryReserveCall(ROUTES));
    }

    // Three routes, three simultaneous calls — the whole point.
    expect(taken.filter((t) => t !== null).sort()).toEqual([...ROUTES].sort());

    // And the fourth waits, because every route is busy.
    expect(await cache.tryReserveCall(ROUTES)).toBeNull();
  });

  // With one route this is the same single-file queue the site has
  // always had, which is what makes the change safe to ship before any
  // address is bought.
  it('behaves like the old global limit when there is one route', async () => {
    expect(await cache.tryReserveCall(['test-a'])).toBe('test-a');
    expect(await cache.tryReserveCall(['test-a'])).toBeNull();
  });

  // The failure that motivated all of this: a single 429 used to set one
  // global key and stop inventory reads for every user of the site.
  it('a throttled route does not stop the others', async () => {
    await cache.markSteamBlocked('test-a');

    expect(await cache.isBlocked('test-a')).toBe(true);
    expect(await cache.isBlocked('test-b')).toBe(false);

    // Calls keep flowing on the routes that were not refused.
    const first = await cache.tryReserveCall(ROUTES);
    const second = await cache.tryReserveCall(ROUTES);

    expect([first, second].sort()).toEqual(['test-b', 'test-c']);
    expect([first, second]).not.toContain('test-a');
  });

  it('reports all-blocked only when every route is out', async () => {
    expect(await cache.allBlocked(ROUTES)).toBe(false);

    await cache.markSteamBlocked('test-a');
    await cache.markSteamBlocked('test-b');
    expect(await cache.allBlocked(ROUTES)).toBe(false);

    await cache.markSteamBlocked('test-c');
    expect(await cache.allBlocked(ROUTES)).toBe(true);
  });

  // Otherwise the first route absorbs every call while the rest idle,
  // and the extra addresses would be paid for and unused.
  it('spreads calls across routes rather than favouring the first', async () => {
    const used = new Set<string>();

    for (let i = 0; i < ROUTES.length; i++) {
      const id = await cache.tryReserveCall(ROUTES);
      if (id) used.add(id);
    }

    expect(used.size).toBe(ROUTES.length);
  });
});

/**
 * A crowd that arrives together fills every cache at the same instant.
 * Without jitter it empties at the same instant too, and one burst
 * becomes a burst repeating on the hour.
 */
describe('InventoryCacheService freshness jitter', () => {
  let cache: InventoryCacheService;
  let redis: RedisService;

  const STEAM_IDS = Array.from(
    { length: 40 },
    (_, i) => `7656119900000${String(200 + i)}`,
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [InventoryCacheService, RedisService],
    }).compile();

    cache = moduleRef.get(InventoryCacheService);
    redis = moduleRef.get(RedisService);
  });

  afterAll(async () => {
    await redis.del(...STEAM_IDS.map((id) => `inventory:${id}`));
    await redis.quit();
  });

  it('gives entries written together different expiry points', async () => {
    for (const id of STEAM_IDS) {
      await cache.set(id, []);
    }

    const windows = new Set<number>();

    for (const id of STEAM_IDS) {
      const raw = await redis.get(`inventory:${id}`);
      windows.add((JSON.parse(raw!) as { freshFor: number }).freshFor);
    }

    // Forty entries written in the same moment should not share one
    // expiry. A handful of collisions is fine; one value is not.
    expect(windows.size).toBeGreaterThan(10);
  });

  // The window may be shortened to spread load, never lengthened: nobody
  // should be shown older data than the policy promises.
  it('never exceeds the policy window', async () => {
    for (const id of STEAM_IDS.slice(0, 10)) {
      await cache.set(id, []);
      const raw = await redis.get(`inventory:${id}`);
      const { freshFor } = JSON.parse(raw!) as { freshFor: number };

      expect(freshFor).toBeLessThanOrEqual(3600);
      expect(freshFor).toBeGreaterThan(3600 - 600);
    }
  });

  /**
   * An entry has to outlive its freshness, or `serveStale` never has
   * anything to serve and a Steam outage becomes an empty screen — the
   * exact failure the cache exists to prevent. Asserted through Redis's
   * own TTL rather than the constant, so raising one window without the
   * other is caught here instead of during an outage.
   */
  it('keeps entries well past the point they go stale', async () => {
    await cache.set(STEAM_IDS[0], []);

    const ttl = await redis.ttl(`inventory:${STEAM_IDS[0]}`);
    const raw = await redis.get(`inventory:${STEAM_IDS[0]}`);
    const { freshFor } = JSON.parse(raw!) as { freshFor: number };

    expect(ttl).toBeGreaterThan(freshFor * 2);
  });
});
