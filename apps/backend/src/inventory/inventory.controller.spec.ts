import { ItemCategory, type User } from '@prisma/client';
import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import type { InventoryItem } from './steam-inventory.service';

/**
 * Each Steam failure becomes a different status on purpose: the actions
 * the user can take differ. A private inventory they fix themselves; a
 * rate limit means waiting; Steam being down means trying later.
 */
interface Summary {
  count: number;
  total: number;
  blocked: number;
  cached: boolean;
}

describe('InventoryController', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561199000000110';
  const http = () => request(ctx.server);

  const item = (assetId: string, depositable = true): InventoryItem => ({
    assetId,
    classId: '1',
    instanceId: '0',
    marketHashName: depositable ? 'AK-47 | Redline' : 'Service Medal',
    iconUrl: null,
    category: depositable ? ItemCategory.RIFLE : ItemCategory.COLLECTIBLE,
    tradable: depositable,
    marketable: true,
    depositable,
    blockReason: depositable ? null : 'permanent',
    hasUniquePattern: depositable,
    applied: [],
    rarity: null,
    exterior: null,
    typeLabel: null,
    float: depositable ? 0.18 : null,
    paintSeed: depositable ? 42 : null,
    inspectLink: null,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: STEAM_ID } });
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Owner' },
    });

    // Every test starts from a clean cache, otherwise the result depends
    // on the order they run in
    await ctx.redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot:default',
      'steam:inventory:blocked:default',
    );
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: STEAM_ID } });
    await ctx.redis.del(`inventory:${STEAM_ID}`);
    await ctx.close();
  });

  it('requires a session', async () => {
    await http().get('/api/inventory').expect(401);
  });

  it('returns the items along with the summary', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1'), item('2'), item('3', false)],
    });

    const r = await http()
      .get('/api/inventory')
      .set(ctx.authFor(user))
      .expect(200);

    const inv = body<Summary>(r);

    expect(inv.count).toBe(3);
    expect(inv.total).toBe(3);
    expect(inv.blocked).toBe(1);
    expect(inv.cached).toBe(false);
  });

  it('filters by depositable while keeping the total', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1'), item('2'), item('3', false)],
    });

    const r = await http()
      .get('/api/inventory?depositable=true')
      .set(ctx.authFor(user))
      .expect(200);

    const inv = body<Summary>(r);

    expect(inv.count).toBe(2);
    // total and blocked stay complete: that is what lets the screen warn
    // about hidden items, instead of them vanishing unexplained.
    expect(inv.total).toBe(3);
    expect(inv.blocked).toBe(1);
  });

  it('refuses an invalid value in the filter', async () => {
    await http()
      .get('/api/inventory?depositable=maybe')
      .set(ctx.authFor(user))
      .expect(400);
  });

  it('refuses an unknown parameter', async () => {
    await http()
      .get('/api/inventory?xpto=1')
      .set(ctx.authFor(user))
      .expect(400);
  });

  describe('Steam failures', () => {
    it('a private inventory returns 403 with instructions', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'private',
      });

      const r = await http()
        .get('/api/inventory')
        .set(ctx.authFor(user))
        .expect(403);

      // The person can fix this themselves — the message says where.
      expect(body<{ message: string }>(r).message).toContain('Privacy');
    });

    it('a Steam rate limit returns 429', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'rate_limited',
      });

      await http().get('/api/inventory').set(ctx.authFor(user)).expect(429);
    });

    it('Steam being unavailable returns 502', async () => {
      ctx.steam.inventory.fetchInventory.mockResolvedValue({
        status: 'error',
        message: 'timeout',
      });

      await http().get('/api/inventory').set(ctx.authFor(user)).expect(502);
    });
  });

  it('does not query Steam twice in a row', async () => {
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('1')],
    });

    await http().get('/api/inventory').set(ctx.authFor(user)).expect(200);
    const r = await http()
      .get('/api/inventory')
      .set(ctx.authFor(user))
      .expect(200);

    expect(ctx.steam.inventory.fetchInventory).toHaveBeenCalledTimes(1);
    expect(body<Summary>(r).cached).toBe(true);
  });
});
