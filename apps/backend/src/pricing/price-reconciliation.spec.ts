import { PriceMarket } from '@prisma/client';
import { recommendedPrice, type Quote } from './price-reconciliation';

/**
 * This function decides the number a user sees before selling a skin.
 * Getting it wrong does not break the system — it makes someone accept
 * less than the item is worth, which is worse, because nobody notices.
 */
describe('recommendedPrice', () => {
  const NOW = new Date('2026-08-17T12:00:00Z');

  const quote = (
    market: PriceMarket,
    price: number,
    minutesAgo = 0,
  ): Quote => ({
    market,
    price,
    quotedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  });

  const resolve = (quotes: Quote[]) => recommendedPrice(quotes, { now: NOW });

  describe('market choice', () => {
    // BUFF is the most liquid market and the anchor the rest uses.
    it('prefers BUFF163 when available', () => {
      const r = resolve([
        quote(PriceMarket.SKINPORT, 120),
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.CSFLOAT, 110),
      ]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.market).toBe(PriceMarket.BUFF163);
      expect(r.price).toBe(100);
    });

    // Steam is inflated because its balance cannot be withdrawn — it is a
    // last resort, never a reference.
    it('only uses Steam when there is nothing else', () => {
      const r = resolve([
        quote(PriceMarket.STEAM, 150),
        quote(PriceMarket.SKINPORT, 120),
      ]);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    it('accepts Steam alone rather than showing nothing', () => {
      const r = resolve([quote(PriceMarket.STEAM, 150)]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.STEAM);
    });

    // An average across markets of different liquidity produces a number
    // that exists nowhere.
    it('does not average: it returns a real market price', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.SKINPORT, 130),
      ]);

      if (!r.ok) return;
      expect(r.price).toBe(100);
      expect(r.price).not.toBe(115);
    });

    it('returns the others as references, unmixed', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.SKINPORT, 130),
        quote(PriceMarket.CSFLOAT, 125),
      ]);

      if (!r.ok) return;
      expect(r.references.map((q) => q.market).sort()).toEqual(
        [PriceMarket.CSFLOAT, PriceMarket.SKINPORT].sort(),
      );
    });
  });

  describe('stale quote', () => {
    it('discards the one past the maximum age', () => {
      const r = recommendedPrice(
        [
          quote(PriceMarket.BUFF163, 100, 180),
          quote(PriceMarket.SKINPORT, 130, 5),
        ],
        { now: NOW, maxAgeMs: 60 * 60 * 1000 },
      );

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    // Yesterday's price on a selling screen is a complaint with a point.
    it('refuses when every quote is stale', () => {
      const r = recommendedPrice(
        [
          quote(PriceMarket.BUFF163, 100, 300),
          quote(PriceMarket.SKINPORT, 130, 400),
        ],
        { now: NOW, maxAgeMs: 60 * 60 * 1000 },
      );

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('all_stale');
      // The stale ones come back as references: useful when investigating
      // later.
      expect(r.references).toHaveLength(2);
    });
  });

  describe('disagreement between sources', () => {
    // A large gap means bad data, an illiquid item, or a provider error —
    // never an opportunity.
    it('refuses when the sources disagree too much', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.SKINPORT, 300),
      ]);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('sources_disagree');
    });

    it('accepts a difference within the limit', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.SKINPORT, 130),
      ]);

      expect(r.ok).toBe(true);
    });

    // Compares extremes, not the average: two coherent sources and one
    // absurd one is still reason not to display, and the average would
    // accommodate it.
    it('catches the absurd source even between two coherent ones', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.CSFLOAT, 105),
        quote(PriceMarket.SKINPORT, 900),
      ]);

      expect(r.ok).toBe(false);
    });

    it('does not refuse an item that exists on a single market', () => {
      const r = resolve([quote(PriceMarket.BUFF163, 100)]);

      expect(r.ok).toBe(true);
    });

    it('respects the configured limit', () => {
      const quotes = [
        quote(PriceMarket.BUFF163, 100),
        quote(PriceMarket.SKINPORT, 150),
      ];

      expect(
        recommendedPrice(quotes, { now: NOW, maxDisagreement: 0.6 }).ok,
      ).toBe(true);
      expect(
        recommendedPrice(quotes, { now: NOW, maxDisagreement: 0.1 }).ok,
      ).toBe(false);
    });
  });

  describe('degenerate input', () => {
    it('refuses with no quotes at all', () => {
      const r = resolve([]);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no_quote');
    });

    // A zero or negative price is a provider error, not a free item.
    it.each([0, -5])('ignores a price of %p', (price) => {
      const r = resolve([quote(PriceMarket.BUFF163, price)]);

      expect(r.ok).toBe(false);
    });

    it('uses the good quote when the other came in at zero', () => {
      const r = resolve([
        quote(PriceMarket.BUFF163, 0),
        quote(PriceMarket.SKINPORT, 130),
      ]);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    it('does not blow up on a market outside the preference list', () => {
      const r = resolve([quote(PriceMarket.NEXTSKINS, 100)]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.NEXTSKINS);
    });
  });
});
