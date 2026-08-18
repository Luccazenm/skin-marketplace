import type { User } from '@prisma/client';
import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';
import { clearAuditLog } from '../test-utils/clear-audit-log';

/**
 * The HTTP layer: this is where an exception becomes a status. A 403 that
 * escapes as a 500 changes what the user sees and hides the cause from
 * support.
 */
describe('AuthController', () => {
  let ctx: TestApp;
  let user: User;

  const STEAM_ID = '76561199000000100';
  const STEAM_ID_BANNED = '76561199000000101';
  const ALL = [STEAM_ID, STEAM_ID_BANNED];

  const http = () => request(ctx.server);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: { in: ALL } } });
    user = await ctx.prisma.user.create({
      data: { steamId: STEAM_ID, username: 'Authenticated' },
    });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await ctx.prisma.user.deleteMany({ where: { steamId: { in: ALL } } });
    await clearAuditLog(ctx.prisma);
    await ctx.close();
  });

  describe('GET /api/auth/steam', () => {
    it('redirects to Steam', async () => {
      const r = await http().get('/api/auth/steam').expect(302);

      expect(r.headers.location).toContain('steamcommunity.com/openid/login');
    });
  });

  describe('GET /api/auth/steam/return', () => {
    it('creates the session in a cookie and sends the user to the frontend', async () => {
      ctx.steam.openId.verifyReturn.mockResolvedValue(STEAM_ID);

      const r = await http()
        .get('/api/auth/steam/return?openid.mode=id_res')
        .expect(302);

      expect(r.headers.location).toBe('http://localhost:5173');

      // httpOnly: page JavaScript cannot read the session.
      const cookie = String(r.headers['set-cookie']);
      expect(cookie).toContain('session=');
      expect(cookie).toContain('HttpOnly');
    });

    it('refuses a return Steam does not validate', async () => {
      ctx.steam.openId.verifyReturn.mockResolvedValue(null);

      await http().get('/api/auth/steam/return?openid.mode=id_res').expect(401);
    });

    it('refuses a suspended account with 403, not 401', async () => {
      await ctx.prisma.user.create({
        data: {
          steamId: STEAM_ID_BANNED,
          username: 'Suspended',
          isBanned: true,
        },
      });
      ctx.steam.openId.verifyReturn.mockResolvedValue(STEAM_ID_BANNED);

      // 403 and not 401: the difference between "I do not know who you
      // are" and "I do, and you may not come in" changes the message the
      // screen shows.
      await http().get('/api/auth/steam/return?openid.mode=id_res').expect(403);
    });
  });

  describe('GET /api/auth/me', () => {
    it('requires a session', async () => {
      await http().get('/api/auth/me').expect(401);
    });

    it('returns the profile and what the account can do', async () => {
      const r = await http()
        .get('/api/auth/me')
        .set(ctx.authFor(user))
        .expect(200);

      const me = body<{
        steamId: string;
        capabilities: { canSell: boolean };
        hasTradeUrl: boolean;
      }>(r);

      expect(me.steamId).toBe(STEAM_ID);
      expect(me.capabilities.canSell).toBe(true);
      expect(me.hasTradeUrl).toBe(false);
    });

    // Balance as text: a Decimal turns into a number in JSON and 0.1+0.2
    // stops being 0.3. With money that is not acceptable.
    it('serialises the balance as a string', async () => {
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { balance: '1234.56' },
      });

      const r = await http()
        .get('/api/auth/me')
        .set(ctx.authFor(user))
        .expect(200);

      expect(body<{ balance: string }>(r).balance).toBe('1234.56');
    });

    it('accepts a session from the cookie', async () => {
      const token = ctx.tokens.sign({ sub: user.id, steamId: user.steamId });

      await http()
        .get('/api/auth/me')
        .set('Cookie', [`session=${token}`])
        .expect(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('requires a session', async () => {
      await http().post('/api/auth/logout').expect(401);
    });

    it('clears the cookie and invalidates the token', async () => {
      const auth = ctx.authFor(user);

      const r = await http().post('/api/auth/logout').set(auth).expect(201);

      expect(String(r.headers['set-cookie'])).toContain('session=;');

      // The same token no longer works — clearing the cookie alone would
      // not be enough for anyone who had already copied the value.
      await http().get('/api/auth/me').set(auth).expect(401);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('drops the other sessions', async () => {
      const sessionA = ctx.authFor(user);
      const sessionB = ctx.authFor(user);

      await http().post('/api/auth/logout-all').set(sessionA).expect(201);

      await http().get('/api/auth/me').set(sessionB).expect(401);
    });
  });
});
