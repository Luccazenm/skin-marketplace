import { PriceMarket } from '@prisma/client';
import fixture from './cs2sh.fixture.json';
import { toQuotes, type MarketSources } from './cs2sh.provider';

/**
 * The mapping, against a real payload.
 *
 * `cs2.sh.fixture.json` is three items cut out of an actual response on
 * 2026-08-25, not something written by hand: a liquid rifle, an
 * eleven-thousand-dollar Dragon Lore, and one with no buy orders at all.
 * Invented fixtures agree with whatever the code does, which is the one
 * thing a fixture must not do.
 */
describe('cs2.sh mapping', () => {
  const items = fixture.items as unknown as Record<string, MarketSources>;
  const collectedAt = new Date(fixture.response_time);

  const quotesFor = (name: string) => toQuotes(name, items[name], collectedAt);

  const from = (name: string, market: PriceMarket) =>
    quotesFor(name).find((q) => q.market === market);

  it('carries the BUFF bid through, which is what the offer is anchored on', () => {
    const buff = from('AK-47 | Redline (Field-Tested)', PriceMarket.BUFF163);

    expect(buff).toMatchObject({ ask: 27.68, bid: 27.53, price: 27.68 });
  });

  it('maps every market the response carries', () => {
    const markets = quotesFor('AK-47 | Redline (Field-Tested)').map(
      (q) => q.market,
    );

    expect(markets.sort()).toEqual(
      [
        PriceMarket.BUFF163,
        PriceMarket.YOUPIN,
        PriceMarket.CSFLOAT,
        PriceMarket.SKINPORT,
        PriceMarket.STEAM,
        PriceMarket.C5GAME,
      ].sort(),
    );
  });

  /**
   * No buy orders is a fact about the item, and the difference between
   * "nobody bids" and "somebody bids nothing" is the whole instant-sell
   * decision. Null has to survive; zero would become an offer of $0.
   */
  it('keeps a missing bid as null rather than zero', () => {
    const buff = from('AK-47 | Jet Set (Factory New)', PriceMarket.BUFF163);

    expect(buff?.ask).toBe(1175.49);
    expect(buff?.bid).toBeNull();
    expect(buff?.bid).not.toBe(0);
  });

  // Skinport publishes listings and history but no buy orders.
  it('handles a market that has no bid field at all', () => {
    const skinport = from(
      'AK-47 | Redline (Field-Tested)',
      PriceMarket.SKINPORT,
    );

    expect(skinport?.ask).toBeGreaterThan(0);
    expect(skinport?.bid).toBeNull();
  });

  /**
   * The reading is timestamped when the marketplace was measured, not
   * when we received it. Four minutes of drift decides whether a price
   * is worth putting on screen.
   */
  it('timestamps from the marketplace, not from our request', () => {
    const buff = from('AK-47 | Redline (Field-Tested)', PriceMarket.BUFF163);

    expect(buff?.quotedAt.toISOString()).toBe('2026-08-25T14:44:16.000Z');
    expect(buff?.quotedAt.getTime()).toBeLessThan(collectedAt.getTime());
  });

  it('reads a five-figure item without losing precision', () => {
    const buff = from('AWP | Dragon Lore (Factory New)', PriceMarket.BUFF163);

    expect(buff).toMatchObject({ ask: 11159.42, bid: 10771.36 });
  });

  it('omits an item with no listing rather than pricing it at zero', () => {
    const quotes = toQuotes(
      'Nothing | Listed',
      { buff: { bid: 5, updated_at: '2026-08-25T14:44:16Z' } },
      collectedAt,
    );

    expect(quotes).toHaveLength(0);
  });

  // An unknown key today is a market cs2.sh added; treating it as a
  // price would be inventing one.
  it('ignores a market it does not know', () => {
    const quotes = toQuotes(
      'Some | Item',
      { brandnewmarket: { ask: 10, updated_at: '2026-08-25T14:44:16Z' } },
      collectedAt,
    );

    expect(quotes).toHaveLength(0);
  });

  /**
   * Not a mapping rule — a check on reality, and the reason CLAUDE.md
   * forbids Steam as a reference. Steam balance cannot be withdrawn, so
   * people bid it up; on this reading Steam asks 41% more than BUFF for
   * the same rifle. If this ever stops being true it is worth knowing.
   */
  it('shows Steam well above BUFF, which is why it is not the reference', () => {
    const name = 'AK-47 | Redline (Field-Tested)';
    const buff = from(name, PriceMarket.BUFF163)!;
    const steam = from(name, PriceMarket.STEAM)!;

    expect(steam.ask! / buff.ask!).toBeGreaterThan(1.2);
  });
});
