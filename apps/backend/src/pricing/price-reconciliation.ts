import { PriceMarket } from '@prisma/client';

/** One price reading, already normalized by the source adapter. */
export interface Quote {
  market: PriceMarket;
  /** USD. */
  price: number;
  /** When the source measured it — not when we stored it. */
  quotedAt: Date;
  volume24h?: number | null;
}

export type NoPriceReason = 'no_quote' | 'all_stale' | 'sources_disagree';

export type RecommendedPrice =
  | {
      ok: true;
      /** USD. */
      price: number;
      /** Where the displayed number came from. */
      market: PriceMarket;
      quotedAt: Date;
      /** The others, to show alongside — never folded into an average. */
      references: Quote[];
    }
  | { ok: false; reason: NoPriceReason; references: Quote[] };

/**
 * Preference order for the reference price.
 *
 * BUFF163 first because it is the most liquid CS2 market and the one the
 * rest of the market anchors to. Steam last: its price is inflated,
 * because the balance there cannot be withdrawn — it serves as a last
 * resort, not as a reference.
 */
const PREFERENCE: PriceMarket[] = [
  PriceMarket.BUFF163,
  PriceMarket.YOUPIN,
  PriceMarket.C5GAME,
  PriceMarket.CSFLOAT,
  PriceMarket.SKINPORT,
  PriceMarket.DMARKET,
  PriceMarket.WAXPEER,
  PriceMarket.BITSKINS,
  PriceMarket.STEAM,
];

export interface ReconciliationOptions {
  /** A quote older than this is not displayed. */
  maxAgeMs?: number;
  /** Disagreement above this (0.4 = 40%) refuses the price. */
  maxDisagreement?: number;
  now?: Date;
}

/**
 * Picks the price to display from several sources.
 *
 * Three decisions, all with the same bias: **not showing a price beats
 * showing a wrong one.** Someone who sees "US$ 340" closes a deal on it;
 * someone who sees "price unavailable" asks.
 *
 * 1. **No averaging.** Markets have very different liquidity, and the
 *    average between them produces a number that exists nowhere. Pick one
 *    market and show the others beside it.
 * 2. **Discard stale quotes.** Yesterday's price on a selling screen is a
 *    complaint waiting to happen.
 * 3. **Refuse when sources disagree too much.** A large gap means bad
 *    data, an illiquid item, or a provider error — never an opportunity.
 */
export function recommendedPrice(
  quotes: Quote[],
  options: ReconciliationOptions = {},
): RecommendedPrice {
  const {
    maxAgeMs = 60 * 60 * 1000,
    maxDisagreement = 0.4,
    now = new Date(),
  } = options;

  if (quotes.length === 0) {
    return { ok: false, reason: 'no_quote', references: [] };
  }

  const fresh = quotes.filter(
    (q) => q.price > 0 && now.getTime() - q.quotedAt.getTime() <= maxAgeMs,
  );

  if (fresh.length === 0) {
    return { ok: false, reason: 'all_stale', references: quotes };
  }

  // A single source: nothing to compare against. Worth displaying — the
  // alternative would be never showing a price for an item that exists on
  // only one market.
  if (fresh.length > 1 && disagree(fresh, maxDisagreement)) {
    return { ok: false, reason: 'sources_disagree', references: fresh };
  }

  const chosen = mostPreferred(fresh);

  return {
    ok: true,
    price: chosen.price,
    market: chosen.market,
    quotedAt: chosen.quotedAt,
    references: fresh.filter((q) => q.market !== chosen.market),
  };
}

/**
 * Compares the lowest against the highest, not against the average: two
 * coherent sources and one absurd one is still reason not to display, and
 * an average would accommodate it.
 */
function disagree(quotes: Quote[], limit: number): boolean {
  const prices = quotes.map((q) => q.price);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);

  return (highest - lowest) / lowest > limit;
}

function mostPreferred(quotes: Quote[]): Quote {
  for (const market of PREFERENCE) {
    const found = quotes.find((q) => q.market === market);

    if (found) {
      return found;
    }
  }

  // A market not yet in the preference list. Better to display using the
  // most recent one than to withhold a price because of a new enum value.
  return [...quotes].sort(
    (a, b) => b.quotedAt.getTime() - a.quotedAt.getTime(),
  )[0];
}
