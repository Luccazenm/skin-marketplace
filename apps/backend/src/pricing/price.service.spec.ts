import { PriceMarket } from '@prisma/client';
import fixture from './cs2sh.fixture.json';
import { toQuotes, type MarketSources } from './cs2sh.provider';
import { parseCached, pickPrices } from './price.service';

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

    const price = pickPrices(quotes, preferred).get('Zero | Bid')!;

    expect(price.spread).toBeNull();
    // And the zero does not survive as the bid either: the instant-sell
    // offer is anchored on this number, and zero would become an offer
    // of nothing rather than a refusal to make one.
    expect(price.bid).toBeNull();
  });

  it('omits an item nothing could price rather than pricing it at zero', () => {
    expect(pickPrices([], preferred).size).toBe(0);
  });

  /**
   * Observed live on 2026-08-25: PP-Bizon | Thermal Currents came back
   * from BUFF at ask 0 with an ask_volume of 950. Passed through, it
   * reached a card as "~$0.00" — which reads as a free skin, not as an
   * item nobody has listed.
   */
  it('drops a market quoting zero rather than showing a free skin', () => {
    const quotes = toQuotes(
      'Zero | Ask',
      {
        buff: { ask: 0, bid: 0, ask_volume: 950, updated_at: at.toISOString() },
      },
      at,
    );

    expect(pickPrices(quotes, preferred).has('Zero | Ask')).toBe(false);
  });

  // Only that market is discarded, not the item: the next one in the
  // order still knows what it is worth.
  it('falls through to the next market when the first quotes zero', () => {
    const quotes = toQuotes(
      'Zero | Then Real',
      {
        buff: { ask: 0, bid: 0, updated_at: at.toISOString() },
        youpin: { ask: 12.5, bid: 12, updated_at: at.toISOString() },
      },
      at,
    );

    expect(pickPrices(quotes, preferred).get('Zero | Then Real')).toMatchObject(
      {
        ask: 12.5,
        bid: 12,
      },
    );
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

/**
 * Reading a cached price back.
 *
 * The cache outlives a deploy: whatever the previous version wrote is
 * still in Redis when the new one starts reading. Everything here is
 * about that seam.
 */
describe('parseCached', () => {
  const complete = JSON.stringify({
    marketHashName: 'AK-47 | Redline (Field-Tested)',
    market: 'BUFF163',
    ask: 27.68,
    bid: 27.53,
    spread: 0.00545,
    askVolume: 1204,
    quotedAt: '2026-08-25T17:26:14.000Z',
  });

  it('reads back what was written, with the date as a date', () => {
    const price = parseCached(complete)!;

    expect(price).toMatchObject({ market: 'BUFF163', ask: 27.68, bid: 27.53 });
    expect(price.quotedAt).toBeInstanceOf(Date);
    expect(price.quotedAt.toISOString()).toBe('2026-08-25T17:26:14.000Z');
  });

  /**
   * The one that got through on 2026-08-25: an entry written before
   * `market` existed was read back as an ItemPrice with the field
   * undefined, and the modal printed "Lowest listing on ,". A miss costs
   * one call; this cost a wrong sentence on a price.
   */
  it('refuses an entry from before a field existed', () => {
    const old = JSON.stringify({
      marketHashName: 'AK-47 | Redline (Field-Tested)',
      ask: 27.68,
      bid: 27.53,
      spread: 0.00545,
      askVolume: 1204,
      quotedAt: '2026-08-25T17:26:14.000Z',
    });

    expect(parseCached(old)).toBeNull();
  });

  it('refuses anything that is not a price', () => {
    expect(parseCached('not json')).toBeNull();
    expect(parseCached('null')).toBeNull();
    expect(parseCached('"a string"')).toBeNull();
    expect(parseCached('[]')).toBeNull();
  });

  // A bid is genuinely optional — plenty of items have none — so a
  // missing one is null rather than a reason to refuse the whole entry.
  it('keeps an entry whose bid is absent', () => {
    const noBid = JSON.stringify({
      marketHashName: 'AK-47 | Jet Set (Factory New)',
      market: 'BUFF163',
      ask: 1175.49,
      quotedAt: '2026-08-25T17:26:14.000Z',
    });

    expect(parseCached(noBid)).toMatchObject({
      ask: 1175.49,
      bid: null,
      spread: null,
      askVolume: null,
    });
  });
});
