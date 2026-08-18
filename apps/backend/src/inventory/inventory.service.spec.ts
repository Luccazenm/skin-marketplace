import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ItemCategory } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
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
      providers: [InventoryService, InventoryCacheService, RedisService],
    })
      .useMocker((token) =>
        token === SteamInventoryService ? steamMock : undefined,
      )
      .compile();

    service = moduleRef.get(InventoryService);
    redis = moduleRef.get(RedisService);
  });

  beforeEach(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot',
      'steam:inventory:blocked',
    );
    steamMock.fetchInventory.mockReset();
  });

  afterAll(async () => {
    await redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot',
      'steam:inventory:blocked',
    );
    await redis.quit();
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
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
    expect(r.items).toHaveLength(1);

    // And it marked the penalty, so the next callers do not even try
    expect(await redis.exists('steam:inventory:blocked')).toBe(1);
  });

  it('refuses when it hits the limit with nothing cached', async () => {
    steamMock.fetchInventory.mockResolvedValue({ status: 'rate_limited' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('rate_limited');
  });

  it('does not call Steam during the penalty', async () => {
    await redis.set('steam:inventory:blocked', '1', 'EX', 60);

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
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({
      status: 'error',
      message: 'timeout',
    });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.stale).toBe(true);
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
    await redis.del('steam:inventory:slot');

    steamMock.fetchInventory.mockResolvedValue({ status: 'private' });

    const r = await service.getInventory(STEAM_ID);

    expect(r.status).toBe('private');
  });
});

/** Rewrites the cache entry with an old date, so it turns stale. */
async function ageCache(redis: RedisService, steamId: string) {
  const raw = await redis.get(`inventory:${steamId}`);
  const entry = JSON.parse(raw!) as { items: unknown[]; fetchedAt: number };

  entry.fetchedAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago

  await redis.set(`inventory:${steamId}`, JSON.stringify(entry), 'EX', 3600);
}
