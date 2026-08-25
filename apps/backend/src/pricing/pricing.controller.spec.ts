import type { User } from '@prisma/client';
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
