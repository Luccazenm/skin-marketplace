import type { User } from '@prisma/client';
import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import { clearAuditLog } from '../test-utils/clear-audit-log';

describe('UsersController', () => {
  let ctx: TestApp;
  let user: User;

  // A real test steamId and its matching partner
  const STEAM_ID = '76561198832746931';
  const PARTNER = '872481203';
  const TRADE_URL = `https://steamcommunity.com/tradeoffer/new/?partner=${PARTNER}&token=Ab3xY9zQ`;

  const http = () => request(ctx.server);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await cleanUp(ctx, STEAM_ID);
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Seller' },
    });
  });

  afterAll(async () => {
    await cleanUp(ctx, STEAM_ID);
    await ctx.close();
  });

  describe('PUT /api/users/me/trade-url', () => {
    it('requires a session', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .send({ tradeUrl: TRADE_URL })
        .expect(401);
    });

    it("saves the owner's own trade URL", async () => {
      const r = await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL })
        .expect(200);

      expect(body<{ tradeUrl: string }>(r).tradeUrl).toBe(TRADE_URL);
    });

    // The refusal that keeps the bot from delivering to the wrong
    // account.
    it('refuses a trade URL from another account, explaining why', async () => {
      const someoneElses =
        'https://steamcommunity.com/tradeoffer/new/?partner=99999999&token=Ab3xY9zQ';

      const r = await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: someoneElses })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain(
        'different Steam account',
      );
    });

    it('refuses a link from a lookalike domain', async () => {
      const fake = TRADE_URL.replace('steamcommunity', 'steamcommunlty');

      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: fake })
        .expect(400);
    });

    it('normalises the stored URL', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: `  ${TRADE_URL}&utm_source=whatsapp  ` })
        .expect(200);

      const stored = await ctx.prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(stored!.tradeUrl).toBe(TRADE_URL);
    });

    it('refuses a body without the field', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({})
        .expect(400);
    });

    // forbidNonWhitelisted: an extra field means an outdated client, or
    // an attempt to touch something that is not theirs.
    it('refuses an unknown field in the body', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL, isBanned: false })
        .expect(400);
    });

    it('leaves a before-and-after trail in the audit log', async () => {
      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: TRADE_URL })
        .expect(200);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'user.trade_url.updated' },
      });

      expect(log.metadata).toMatchObject({ from: null, to: TRADE_URL });
      expect(log.outcome).toBe('SUCCESS');
    });

    it('records the refused attempt as well', async () => {
      const someoneElses =
        'https://steamcommunity.com/tradeoffer/new/?partner=99999999&token=Ab3xY9zQ';

      await http()
        .put('/api/users/me/trade-url')
        .set(ctx.authFor(user))
        .send({ tradeUrl: someoneElses })
        .expect(400);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, outcome: 'DENIED' },
      });

      expect(log.metadata).toMatchObject({
        error: 'partner_from_another_account',
      });
    });
  });
});

async function cleanUp(ctx: TestApp, steamId: string) {
  const user = await ctx.prisma.user.findUnique({ where: { steamId } });

  if (user) {
    await clearAuditLog(ctx.prisma);
    await ctx.prisma.user.delete({ where: { id: user.id } });
  }
}
