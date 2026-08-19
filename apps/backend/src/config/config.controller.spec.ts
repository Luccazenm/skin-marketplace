import request from 'supertest';
import {
  body,
  createTestApp,
  type TestApp,
} from '../test-utils/create-test-app';

/**
 * The commission decides what a seller is paid, so the frontend reads it
 * from here rather than holding its own copy.
 */
describe('ConfigController', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // No session: someone deciding whether to sell here needs to see the
  // commission before signing in.
  it('is public', async () => {
    await request(ctx.server).get('/api/config').expect(200);
  });

  it('reports the fee as a percentage', async () => {
    const r = await request(ctx.server).get('/api/config').expect(200);

    const { platformFeePercent } = body<{ platformFeePercent: number }>(r);

    // A percentage, not a fraction: 5 means 5%. Returning 0.05 here
    // would have every caller guessing which one it is, and guessing
    // wrong by a factor of a hundred on a payout.
    expect(platformFeePercent).toBe(5);
  });
});
