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
