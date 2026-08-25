import { instantSellOffer } from './instant-sell';

/**
 * The buyout offer.
 *
 * This is the platform spending its own money, so every band is pinned
 * and both refusals are pinned. A wrong number here is not a display
 * bug — it is us overpaying for stock we then have to sell.
 */
describe('instantSellOffer', () => {
  const amountOf = (bid: number, spread: number | null) => {
    const offer = instantSellOffer(bid, spread);
    return offer.ok ? offer.amount : offer.reason;
  };

  // ≤ 5% — a Redline, a case, anything that moves every minute.
  it('takes 10% off a liquid item', () => {
    expect(amountOf(27.53, 0.005)).toBe('24.78');
    // The boundary belongs to the band it names.
    expect(amountOf(100, 0.05)).toBe('90.00');
  });

  it('takes 15% off past 5%', () => {
    expect(amountOf(100, 0.0501)).toBe('85.00');
    expect(amountOf(100, 0.12)).toBe('85.00');
  });

  it('takes 25% off past 12%', () => {
    expect(amountOf(100, 0.1201)).toBe('75.00');
    expect(amountOf(100, 0.25)).toBe('75.00');
  });

  /**
   * Past 25% there is no offer. Refusing is a valid answer and the
   * expected one for an illiquid item — the alternative is buying
   * something at a discount that still leaves us holding it for months.
   */
  it('refuses an item nobody is trading', () => {
    expect(amountOf(100, 0.2501)).toBe('illiquid');
    expect(amountOf(100, 3)).toBe('illiquid');
  });

  /**
   * No bid is no offer, not a cheap one. A zero reaching a button would
   * read "sell instantly for $0.00", and somebody would click it.
   */
  it('refuses without a bid', () => {
    expect(amountOf(0, 0.01)).toBe('no_bid');
    expect(instantSellOffer(null, 0.01)).toEqual({
      ok: false,
      reason: 'no_bid',
    });
  });

  /**
   * Observed in the live data: the highest bid can sit above the lowest
   * ask when the two sides are measured moments apart. That is the
   * tightest market there is, not a reason to refuse.
   */
  it('treats a negative spread as the tightest band', () => {
    expect(amountOf(31.25, -0.0144)).toBe('28.13');
  });

  // A bid with no spread beside it means nothing was computed, not that
  // the market is wide. It takes the first band and stays there.
  it('treats a missing spread as tight rather than as illiquid', () => {
    expect(amountOf(100, null)).toBe('90.00');
  });

  /**
   * The cent that cannot be split goes to the seller. It is one cent,
   * and it is the direction that does not need explaining — the same
   * choice the commission makes.
   */
  it('rounds the odd cent towards the seller', () => {
    // 33.33 × 0.9 = 29.997 → 30.00, not 29.99.
    expect(amountOf(33.33, 0.01)).toBe('30.00');
    // 0.15 × 0.9 = 0.135 → 0.14.
    expect(amountOf(0.15, 0.01)).toBe('0.14');
  });

  it('carries the band it used, so a screen can say why', () => {
    expect(instantSellOffer(100, 0.2)).toMatchObject({
      ok: true,
      discount: 0.25,
      spread: 0.2,
    });
  });

  it('reads a five-figure item without losing cents', () => {
    // The Dragon Lore's bid at a 3.6% spread: wide for a Redline, still
    // inside the first band, so 10771.36 × 0.9.
    expect(amountOf(10771.36, 0.036)).toBe('9694.23');
  });
});
