import { ConfigService } from '@nestjs/config';
import { CurrencyService } from './currency.service';
import type { RedisService } from '../redis/redis.service';

/**
 * Exchange rates for display.
 *
 * The behaviour worth pinning is not the arithmetic — there is none
 * here — but what happens when things go wrong. This table decorates
 * every price on the site, so the one outcome it must never produce is
 * a number: a rate of zero, of NaN, or of a currency the provider
 * quietly renamed would each reach a card as a price.
 *
 * No audit trail on purpose. `AuditLog` records operations on money,
 * items and accounts, including refused ones; this endpoint reads a
 * public rate table, changes nothing, and belongs to nobody.
 */
describe('CurrencyService', () => {
  const KEY = 'test-key';

  function build(options: {
    key?: string;
    cached?: string | null;
    fetch?: typeof globalThis.fetch;
  }) {
    const store = new Map<string, string>();

    const redis = {
      get: jest.fn(() => Promise.resolve(options.cached ?? null)),
      set: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
    } as unknown as RedisService;

    const config = {
      get: () => options.key,
    } as unknown as ConfigService;

    if (options.fetch) globalThis.fetch = options.fetch;

    return { service: new CurrencyService(config, redis), redis, store };
  }

  const ok = (rates: Record<string, unknown>) =>
    jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rates }),
      }),
    ) as unknown as typeof globalThis.fetch;

  const fresh = () => new Date().toISOString();

  it('reads the provider and keys every rate to USD', async () => {
    const { service } = build({
      key: KEY,
      fetch: ok({ BRL: 5.127075, EUR: 0.861049 }),
    });

    const table = await service.rates();

    expect(table.base).toBe('USD');
    expect(table.rates.BRL).toBeCloseTo(5.127075);
    expect(table.rates.USD).toBe(1);
  });

  /**
   * USD is the base. A provider that returned USD as anything else —
   * a rounding artefact, or a table quoted against something other than
   * the dollar — would silently rescale every price on the site.
   */
  it('forces USD to 1 whatever the provider says', async () => {
    const { service } = build({ key: KEY, fetch: ok({ USD: 0.99, BRL: 5 }) });

    expect((await service.rates()).rates.USD).toBe(1);
  });

  /**
   * Each of these reaches a component as a number and turns a $31.50
   * rifle into `R$0`, `-R$31,50` or `R$NaN`. Dropping the currency
   * leaves it absent from the picker's table, where the caller already
   * falls back to the dollar figure.
   */
  it.each([
    ['zero', 0],
    ['negative', -3],
    ['not a number', 'abc'],
    ['null', null],
  ])('drops a rate that is %s', async (_label, value) => {
    const { service } = build({ key: KEY, fetch: ok({ BAD: value, BRL: 5 }) });

    const table = await service.rates();

    expect(table.rates.BAD).toBeUndefined();
    expect(table.rates.BRL).toBe(5);
  });

  it('serves the cache without calling the provider while it is fresh', async () => {
    const fetchSpy = ok({ BRL: 9.99 });

    const { service } = build({
      key: KEY,
      cached: JSON.stringify({
        base: 'USD',
        rates: { USD: 1, BRL: 5.1 },
        fetchedAt: fresh(),
      }),
      fetch: fetchSpy,
    });

    expect((await service.rates()).rates.BRL).toBe(5.1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Stale beats absent. Being six hours behind moves a price by a cent
   * in the reader's currency; falling back to dollars because a third
   * party was down for ten minutes is the visible failure.
   */
  it('serves stale rates when the provider is unreachable', async () => {
    const { service } = build({
      key: KEY,
      cached: JSON.stringify({
        base: 'USD',
        rates: { USD: 1, BRL: 4.2 },
        fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      }),
      fetch: jest.fn(() => Promise.reject(new Error('network down'))),
    });

    expect((await service.rates()).rates.BRL).toBe(4.2);
  });

  it('falls back to dollars alone with no key, no cache and no provider', async () => {
    const { service } = build({
      key: undefined,
      cached: null,
      fetch: jest.fn(() => Promise.reject(new Error('should not be called'))),
    });

    const table = await service.rates();

    expect(table.rates).toEqual({ USD: 1 });
  });

  /**
   * A half-written or older-format cache entry would otherwise reach a
   * component as `undefined` where a price should be.
   */
  it('ignores a cache entry that is not a rate table', async () => {
    const { service } = build({
      key: KEY,
      cached: '{"nonsense":true}',
      fetch: ok({ BRL: 5.5 }),
    });

    expect((await service.rates()).rates.BRL).toBe(5.5);
  });

  it('never throws when the provider answers with an error status', async () => {
    const { service } = build({
      key: KEY,
      cached: null,
      fetch: jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
        }),
      ) as unknown as typeof globalThis.fetch,
    });

    const table = await service.rates();

    expect(table.rates).toEqual({ USD: 1 });
    expect(typeof table.fetchedAt).toBe('string');
  });
});
