import { ItemCategory, PriceMarket, type User } from '@prisma/client';
import request from 'supertest';
import { clearAuditLog } from '../test-utils/clear-audit-log';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';

/**
 * The price endpoint.
 *
 * These do not call cs2.sh: without a key configured the service returns
 * an empty map, which is exactly the shape the screens have to survive
 * anyway. What is pinned here is the contract around the number, not the
 * number — the mapping is covered against a real payload in
 * `cs2sh.provider.spec.ts`.
 */
describe('PricingController', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561198832746940';
  const http = () => request(ctx.server);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await cleanUp(ctx, STEAM_ID);
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Pricer' },
    });
  });

  afterAll(async () => {
    await cleanUp(ctx, STEAM_ID);
    await ctx.close();
  });

  // Each miss costs a call against a quota we pay for.
  it('requires a session', async () => {
    await http()
      .post('/api/prices')
      .send({ items: ['AK-47 | Redline (Field-Tested)'] })
      .expect(401);
  });

  it('answers with a prices object', async () => {
    const r = await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({ items: ['AK-47 | Redline (Field-Tested)'] })
      .expect(201);

    expect(body<{ prices: object }>(r).prices).toBeDefined();
  });

  /**
   * The rule the screens depend on: an unpriced item is missing, never
   * present at zero. A zero would travel to a card and read as a free
   * skin, and further on as an instant-sell offer of nothing.
   */
  it('omits what it cannot price rather than returning zero', async () => {
    const r = await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({ items: ['Definitely | Not A Real Item (Factory New)'] })
      .expect(201);

    const { prices } = body<{ prices: Record<string, unknown> }>(r);

    expect(
      prices['Definitely | Not A Real Item (Factory New)'],
    ).toBeUndefined();
    expect(Object.values(prices)).not.toContain(0);
  });

  it('accepts an empty list without calling anything', async () => {
    const r = await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({ items: [] })
      .expect(201);

    expect(body<{ prices: object }>(r).prices).toEqual({});
  });

  // A Steam inventory is a few hundred items; past that it is not a
  // screen asking a question.
  it('refuses more than 500 names', async () => {
    await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({ items: Array.from({ length: 501 }, (_, i) => `Item ${i}`) })
      .expect(400);
  });

  it('refuses a body without the field', async () => {
    await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({})
      .expect(400);
  });

  // The names carry |, ™ and brackets, which is why this is a body and
  // not a query string.
  it('handles the punctuation real item names contain', async () => {
    await http()
      .post('/api/prices')
      .set(ctx.authFor(user))
      .send({ items: ['StatTrak™ AK-47 | Redline (Field-Tested)'] })
      .expect(201);
  });
});

async function cleanUp(ctx: TestApp, steamId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { steamId } });

  if (user) {
    await clearAuditLog(ctx.prisma);
    await ctx.prisma.user.delete({ where: { id: user.id } });
  }
}

/**
 * The suggested asking price, end to end.
 *
 * The formula itself is pinned in `suggested-price.spec.ts`; what these
 * cover is the wiring — that the stickers come from the inventory and
 * not from the caller, and that the parts reaching the screen add up to
 * the total reaching the screen.
 */
describe('PricingController — suggest', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561198832746941';
  const http = () => request(ctx.server);

  const BASE = 'AK-47 | Blue Laminate (Factory New)';
  const TITAN = 'Sticker | Titan (Holo) | Katowice 2014';

  const quote = (marketHashName: string, ask: number) => ({
    marketHashName,
    market: PriceMarket.BUFF163,
    price: ask,
    ask,
    bid: ask * 0.98,
    volume24h: 100,
    quotedAt: new Date(),
  });

  /** One AK carrying one very expensive sticker. */
  const stickeredAk = () => ({
    status: 'ok',
    items: [
      {
        assetId: '9001',
        classId: '1',
        instanceId: '0',
        marketHashName: BASE,
        iconUrl: null,
        category: ItemCategory.RIFLE,
        tradable: true,
        marketable: true,
        depositable: true,
        blockReason: null,
        hasUniquePattern: true,
        applied: [
          {
            kind: 'STICKER',
            name: 'Titan (Holo) | Katowice 2014',
            marketHashName: TITAN,
            imageUrl: null,
            position: 0,
            wear: 0,
          },
        ],
        rarity: null,
        exterior: 'Factory New',
        typeLabel: null,
        float: 0.03,
        paintSeed: 586,
        inspectLink: null,
      },
    ],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await cleanUp(ctx, STEAM_ID);
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Suggester' },
    });

    // The inventory cache is deliberately left standing between these:
    // clearing it would force a fresh Steam read per test, and the rate
    // limiter is real in the test app — the second read comes back
    // empty and every assertion below it fails for the wrong reason.

    ctx.steam.inventory.fetchInventory.mockResolvedValue(stickeredAk());
    ctx.prices.fetchPrices.mockResolvedValue([
      quote(BASE, 30.8),
      quote(TITAN, 3422.32),
    ]);
  });

  afterAll(async () => {
    await cleanUp(ctx, STEAM_ID);
    await ctx.close();
  });

  it('requires a session', async () => {
    await http()
      .post('/api/prices/suggest')
      .send({ assetId: '9001' })
      .expect(401);
  });

  /**
   * The item from CLAUDE.md: $3,422 of Katowice on a $30.80 rifle. The
   * cap is what turns it into a number a seller can act on.
   */
  it('caps the stickers at twice the skin', async () => {
    const r = await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({ assetId: '9001' })
      .expect(201);

    expect(body<Suggestion>(r)).toMatchObject({
      base: '30.80',
      stickers: '61.60',
      charms: '0.00',
      stickerCapped: true,
      suggested: '92.40',
    });
  });

  // The screen prints the parts next to the images, above the total.
  it('returns parts that add up to the total', async () => {
    const r = await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({ assetId: '9001' })
      .expect(201);

    const s = body<Suggestion>(r);
    const parts = s.applied.reduce((sum, a) => sum + Number(a.adds), 0);

    expect(parts).toBeCloseTo(Number(s.stickers) + Number(s.charms), 2);
    expect(Number(s.base) + parts).toBeCloseTo(Number(s.suggested), 2);
  });

  // What each piece is worth on its own travels too — it is the number
  // that explains why so little of it transfers.
  it('carries each piece own price beside what it adds', async () => {
    const r = await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({ assetId: '9001' })
      .expect(201);

    expect(body<Suggestion>(r).applied[0]).toMatchObject({
      marketHashName: TITAN,
      kind: 'STICKER',
      own: '3422.32',
    });
  });

  /**
   * The stickers come from the inventory, never from the body. Sending
   * a different asset id is the only thing a caller can change, and an
   * id they do not own is refused.
   */
  it('refuses an item the caller does not own', async () => {
    await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({ assetId: '404' })
      .expect(404);
  });

  it('suggests nothing when the skin itself has no price', async () => {
    // The price cache is per name and lives five minutes, so the reading
    // the tests above stored would answer for the skin here and hide the
    // case entirely.
    await ctx.redis.del(`price:${BASE}`);
    ctx.prices.fetchPrices.mockResolvedValue([quote(TITAN, 3422.32)]);

    const r = await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({ assetId: '9001' })
      .expect(201);

    expect(body<Suggestion>(r)).toMatchObject({
      suggested: null,
      reason: 'no_base_price',
    });
  });

  it('refuses a body without the field', async () => {
    await http()
      .post('/api/prices/suggest')
      .set(ctx.authFor(user))
      .send({})
      .expect(400);
  });
});

interface Suggestion {
  suggested: string | null;
  reason?: string;
  base: string;
  stickers: string;
  charms: string;
  stickerCapped: boolean;
  applied: {
    marketHashName: string;
    kind: string;
    own: string | null;
    adds: string;
  }[];
}
