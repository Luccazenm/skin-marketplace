import { BotStatus, ItemCategory, type User } from '@prisma/client';
import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import { clearAuditLog } from '../test-utils/clear-audit-log';
import type { InventoryItem } from '../inventory/steam-inventory.service';

describe('DepositsController', () => {
  let ctx: TestApp;
  let user: User;
  let botId: string;

  // A steamId exclusive to this suite: reusing another spec's makes one
  // delete the other's user when they run together.
  const STEAM_ID = '76561199000000130';
  const BOT_STEAM_ID = '76561199000000131';
  // partner = steamId - 76561197960265728
  const TRADE_URL =
    'https://steamcommunity.com/tradeoffer/new/?partner=1039734402&token=Ab3xY9zQ';

  const http = () => request(ctx.server);

  const item = (assetId: string, depositable = true): InventoryItem => ({
    assetId,
    classId: '1',
    instanceId: '0',
    marketHashName: `AK-47 | Test ${assetId}`,
    iconUrl: null,
    category: ItemCategory.RIFLE,
    tradable: depositable,
    marketable: true,
    depositable,
    blockReason: depositable ? null : 'permanent',
    hasUniquePattern: true,
    applied: [],
    rarity: null,
    exterior: null,
    typeLabel: null,
    float: 0.44,
    paintSeed: 123,
    inspectLink: null,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await cleanUp(ctx, STEAM_ID, BOT_STEAM_ID);

    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Depositor', tradeUrl: TRADE_URL },
    });

    const bot = await ctx.prisma.bot.create({
      data: {
        steamId: BOT_STEAM_ID,
        username: 'http-test-bot',
        credentialRef: 'vault/http-test-bot',
        status: BotStatus.ONLINE,
      },
    });
    botId = bot.id;

    await ctx.redis.del(
      `inventory:${STEAM_ID}`,
      'steam:inventory:slot:default',
    );

    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('111'), item('222'), item('333', false)],
    });
    jest.clearAllMocks();
    ctx.steam.inventory.fetchInventory.mockResolvedValue({
      status: 'ok',
      items: [item('111'), item('222'), item('333', false)],
    });
  });

  afterAll(async () => {
    await cleanUp(ctx, STEAM_ID, BOT_STEAM_ID);
    await ctx.redis.del(`inventory:${STEAM_ID}`);
    await ctx.close();
  });

  it('requires a session', async () => {
    await http()
      .post('/api/deposits')
      .send({ items: [{ assetId: '111', price: '10.00' }] })
      .expect(401);
  });

  it('queues the deposit', async () => {
    const r = await http()
      .post('/api/deposits')
      .set(ctx.authFor(user))
      .send({
        items: [
          { assetId: '111', price: '10.00' },
          { assetId: '222', price: '10.00' },
        ],
      })
      .expect(201);

    const created = body<{ id: string; status: string; itemCount: number }>(r);

    expect(created.status).toBe('CREATED');
    expect(created.itemCount).toBe(2);

    const offer = await ctx.prisma.tradeOffer.findUnique({
      where: { id: created.id },
    });
    expect(offer!.botId).toBe(botId);
  });

  describe('input validation', () => {
    it('refuses an empty list', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [] })
        .expect(400);
    });

    it('refuses an assetId that is not a number', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '../../etc/passwd', price: '10.00' }] })
        .expect(400);
    });

    // Valid items plus one extra field, so the refusal can only be about
    // the extra field — an outdated client, or an attempt to pick the bot.
    it('refuses an unknown field', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({
          items: [{ assetId: '111', price: '10.00' }],
          botId: 'chosen-by-me',
        })
        .expect(400);
    });

    // Money arrives as a string so it never passes through a float. The
    // shapes below all mean something the seller did not intend.
    it.each([
      ['a number rather than a string', 42.5],
      ['more than two decimals', '10.005'],
      ['exponent notation', '1e3'],
      ['a negative', '-5.00'],
      ['zero', '0.00'],
      ['empty', ''],
    ])('refuses a price given as %s', async (_label, price) => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price }] })
        .expect(400);
    });

    /**
     * A cent listing pays out nothing: the minimum commission takes the
     * whole of it. The floor is derived from the fee and comes back on
     * GET /api/config, so the screen and the server refuse the same
     * prices.
     */
    it('refuses a price below the minimum listing price', async () => {
      const r = await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '0.01' }] })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain('$0.02');
    });

    // The boundary belongs to the side that is allowed. A rule that
    // refuses the number it names is the kind nobody can act on.
    it('accepts the minimum itself', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '0.02' }] })
        .expect(201);
    });

    // One bad price refuses the whole selection: the seller picked the
    // items together and gets them back together to fix.
    it('refuses the request when only one item is under the minimum', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({
          items: [
            { assetId: '111', price: '40.00' },
            { assetId: '222', price: '0.01' },
          ],
        })
        .expect(400);
    });

    it('refuses an item with no price at all', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111' }] })
        .expect(400);
    });

    // A ceiling so we never build an offer Steam would refuse for size.
    it('refuses a selection above the limit', async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => ({
        assetId: String(i),
        price: '10.00',
      }));

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: tooMany })
        .expect(400);
    });
  });

  describe('business rules turn into the right status', () => {
    it('no trade URL returns 400', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { tradeUrl: null },
      });

      const r = await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '10.00' }] })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain('trade URL');
    });

    it('a blocked item returns 400 naming the item', async () => {
      const r = await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '333', price: '10.00' }] })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain(
        'AK-47 | Test 333',
      );
    });

    // 409 and not 400: the request is correct, it is the state that gets
    // in the way.
    it('an item already in another trade returns 409', async () => {
      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '10.00' }] })
        .expect(201);

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '10.00' }] })
        .expect(409);
    });

    // 503 and not 500: this is not an error, it is temporary
    // unavailability — and the difference tells the client whether to
    // try again.
    it('no bot in rotation returns 503', async () => {
      await ctx.prisma.bot.update({
        where: { id: botId },
        data: { status: BotStatus.OFFLINE },
      });

      await http()
        .post('/api/deposits')
        .set(ctx.authFor(user))
        .send({ items: [{ assetId: '111', price: '10.00' }] })
        .expect(503);
    });
  });

  it('records the deposit in the audit log with the item names', async () => {
    await http()
      .post('/api/deposits')
      .set(ctx.authFor(user))
      .send({ items: [{ assetId: '111', price: '10.00' }] })
      .expect(201);

    const [log] = await ctx.prisma.auditLog.findMany({
      where: { actorId: user.id, action: 'deposit.requested' },
    });

    expect(log.outcome).toBe('SUCCESS');
    expect(log.metadata).toMatchObject({
      botSteamId: BOT_STEAM_ID,
      items: [{ assetId: '111', name: 'AK-47 | Test 111' }],
    });
  });
});

async function cleanUp(ctx: TestApp, steamId: string, botSteamId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { steamId } });

  if (user) {
    await ctx.prisma.tradeOffer.deleteMany({ where: { userId: user.id } });
    await clearAuditLog(ctx.prisma);
    await ctx.prisma.user.delete({ where: { id: user.id } });
  }

  await ctx.prisma.bot.deleteMany({ where: { steamId: botSteamId } });
}
