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

  describe('PUT /api/users/me/email', () => {
    it('requires a session', async () => {
      await http()
        .put('/api/users/me/email')
        .send({ email: 'someone@example.com' })
        .expect(401);
    });

    it('saves the address, lowercased, and leaves it unverified', async () => {
      const r = await http()
        .put('/api/users/me/email')
        .set(ctx.authFor(user))
        .send({ email: '  Lucca@Example.COM ' })
        .expect(200);

      expect(body<{ email: string; emailVerified: boolean }>(r)).toEqual({
        email: 'lucca@example.com',
        emailVerified: false,
      });
    });

    // Verification is a claim about one address at one moment. Re-saving
    // has to drop it even when the address did not change, or a verified
    // flag could outlive the check that produced it.
    it('resets verification when the address is saved again', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { email: 'old@example.com', emailVerified: true },
      });

      await http()
        .put('/api/users/me/email')
        .set(ctx.authFor(user))
        .send({ email: 'old@example.com' })
        .expect(200);

      const after = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(after.emailVerified).toBe(false);
    });

    // The only way to withdraw an address already given.
    it('removes the address when sent an empty string', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { email: 'bye@example.com' },
      });

      const r = await http()
        .put('/api/users/me/email')
        .set(ctx.authFor(user))
        .send({ email: '' })
        .expect(200);

      expect(body<{ email: string | null }>(r).email).toBeNull();
    });

    it('refuses something that is not an address, saying what to fix', async () => {
      const r = await http()
        .put('/api/users/me/email')
        .set(ctx.authFor(user))
        .send({ email: 'no-at-sign.example' })
        .expect(400);

      expect(body<{ message: string }>(r).message).toContain('@');
    });

    /**
     * The address column is unique, so a second account claiming one
     * already taken is refused — but the message must not reveal that it
     * belongs to somebody here. Otherwise this field becomes a way to
     * check whether a given person has an account.
     */
    it('refuses an address already in use without confirming it exists', async () => {
      const other = await ctx.prisma.user.create({
        data: {
          steamId: '76561198000000001',
          username: 'Other',
          email: 'taken@example.com',
        },
      });

      try {
        const r = await http()
          .put('/api/users/me/email')
          .set(ctx.authFor(user))
          .send({ email: 'taken@example.com' })
          .expect(409);

        const { message } = body<{ message: string }>(r);

        expect(message).not.toContain('taken@example.com');
        expect(message).not.toMatch(/registered|account|exists|in use by/i);
      } finally {
        await ctx.prisma.user.delete({ where: { id: other.id } });
      }
    });

    it('records the change with the address before and after', async () => {
      await http()
        .put('/api/users/me/email')
        .set(ctx.authFor(user))
        .send({ email: 'first@example.com' })
        .expect(200);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'user.email.updated' },
      });

      expect(log.metadata).toMatchObject({
        from: null,
        to: 'first@example.com',
      });
    });
  });

  describe('PUT /api/users/me/consent', () => {
    it('requires a session', async () => {
      await http()
        .put('/api/users/me/consent')
        .send({ marketingEmail: true })
        .expect(401);
    });

    it('records what was agreed to, with the moment it was', async () => {
      const before = new Date();

      const r = await http()
        .put('/api/users/me/consent')
        .set(ctx.authFor(user))
        .send({ marketingEmail: true })
        .expect(200);

      expect(body<{ marketingEmail: boolean }>(r).marketingEmail).toBe(true);

      const after = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(after.consentMarketingEmail).toBe(true);
      expect(after.consentMarketingEmailAt?.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });

    // A screen showing one switch must not reset the other. Sending the
    // whole object every time would let a stale page undo a choice made
    // somewhere else.
    it('leaves untouched whatever the request did not mention', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { consentAnalytics: true, consentAnalyticsAt: new Date() },
      });

      await http()
        .put('/api/users/me/consent')
        .set(ctx.authFor(user))
        .send({ marketingEmail: true })
        .expect(200);

      const after = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });

      expect(after.consentAnalytics).toBe(true);
      expect(after.consentMarketingEmail).toBe(true);
    });

    it('refuses a request that sets nothing', async () => {
      await http()
        .put('/api/users/me/consent')
        .set(ctx.authFor(user))
        .send({})
        .expect(400);
    });

    // Withdrawal has to be as provable as agreement.
    it('records a withdrawal with the before and the after', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: {
          consentMarketingEmail: true,
          consentMarketingEmailAt: new Date(),
        },
      });

      await http()
        .put('/api/users/me/consent')
        .set(ctx.authFor(user))
        .send({ marketingEmail: false })
        .expect(200);

      const [log] = await ctx.prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'user.consent.updated' },
      });

      expect(log.metadata).toMatchObject({
        from: { marketingEmail: true },
        to: { marketingEmail: false },
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
