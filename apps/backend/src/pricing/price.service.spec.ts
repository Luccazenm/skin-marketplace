import { PriceMarket } from '@prisma/client';
import fixture from './cs2sh.fixture.json';
import { toQuotes, type MarketSources } from './cs2sh.provider';
import { pickPrices } from './price.service';

/**
 * Choosing which market answers, against the real payload.
 *
 * The rule from STATE.md: BUFF governs, the others stand beside it, and
 * nothing is ever averaged — an average across markets of different
 * liquidity produces a number that exists on none of them.
 */
describe('pickPrices', () => {
  const items = fixture.items as unknown as Record<string, MarketSources>;
  const at = new Date(fixture.response_time);

  const preferred = [
    PriceMarket.BUFF163,
    PriceMarket.YOUPIN,
    PriceMarket.CSFLOAT,
    PriceMarket.C5GAME,
  ];

  const priceOf = (name: string) =>
    pickPrices(toQuotes(name, items[name], at), preferred).get(name);

  it('quotes BUFF when BUFF has the item', () => {
    const price = priceOf('AK-47 | Redline (Field-Tested)');

    expect(price).toMatchObject({ ask: 27.68, bid: 27.53 });
  });

  /**
   * The spread is the liquidity signal the instant-sell discount table
   * is keyed on. cs2.sh sells it packaged on the Scale plan; this is the
   * same number from two the Developer plan already returns.
   */
  it('computes the spread from the bid and ask of one market', () => {
    const price = priceOf('AK-47 | Redline (Field-Tested)')!;

    // (27.68 - 27.53) / 27.53 — a very liquid item, half a percent.
    expect(price.spread).toBeCloseTo(0.00545, 4);
    expect(price.spread!).toBeLessThan(0.05);
  });

  it('leaves the spread null when nobody is bidding', () => {
    const price = priceOf('AK-47 | Jet Set (Factory New)')!;

    expect(price.ask).toBe(1175.49);
    expect(price.bid).toBeNull();
    expect(price.spread).toBeNull();
  });

  /**
   * Steam is collected but must never be the answer. Its balance cannot
   * be withdrawn, so its prices run high — quoting it would mean paying
   * above what we could ever liquidate at.
   */
  it('never quotes Steam, even when Steam is the only market with a bid', () => {
    const quotes = toQuotes(
      'Only | OnSteam',
      {
        steam: { ask: 38.95, bid: 38.5, updated_at: at.toISOString() },
      },
      at,
    );

    expect(pickPrices(quotes, preferred).size).toBe(0);
  });

  it('falls through to the next market when BUFF has nothing', () => {
    const quotes = toQuotes(
      'No | Buff',
      {
        youpin: { ask: 12.5, bid: 11, updated_at: at.toISOString() },
        steam: { ask: 20, bid: 19, updated_at: at.toISOString() },
      },
      at,
    );

    const price = pickPrices(quotes, preferred).get('No | Buff');

    expect(price).toMatchObject({ ask: 12.5, bid: 11 });
  });

  /**
   * Ask and bid have to come from the same market or the spread between
   * them describes no trade anyone could make. Here BUFF asks more than
   * CSFloat bids — mixing them would report a negative spread.
   */
  it('takes ask and bid from one market rather than the best of each', () => {
    const quotes = toQuotes(
      'Mixed | Markets',
      {
        buff: { ask: 100, bid: 90, updated_at: at.toISOString() },
        csfloat: { ask: 80, bid: 105, updated_at: at.toISOString() },
      },
      at,
    );

    const price = pickPrices(quotes, preferred).get('Mixed | Markets')!;

    expect(price).toMatchObject({ ask: 100, bid: 90 });
    expect(price.spread).toBeGreaterThan(0);
  });

  // A zero bid is not a bid, and dividing by it would produce Infinity
  // on its way to a screen.
  it('does not divide by a zero bid', () => {
    const quotes = toQuotes(
      'Zero | Bid',
      { buff: { ask: 10, bid: 0, updated_at: at.toISOString() } },
      at,
    );

    expect(pickPrices(quotes, preferred).get('Zero | Bid')!.spread).toBeNull();
  });

  it('omits an item nothing could price rather than pricing it at zero', () => {
    expect(pickPrices([], preferred).size).toBe(0);
  });

  it('reads a five-figure item without losing cents', () => {
    const price = priceOf('AWP | Dragon Lore (Factory New)')!;

    expect(price.ask).toBe(11159.42);
    expect(price.bid).toBe(10771.36);
    // ~3.6%: wide next to a Redline, which is what an $11,000 item looks
    // like when few people are holding buy orders open.
    expect(price.spread).toBeGreaterThan(0.03);
  });
});
