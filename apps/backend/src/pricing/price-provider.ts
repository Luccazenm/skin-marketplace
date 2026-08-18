import type { PriceMarket, PriceSource } from '@prisma/client';

/** One price reading, already normalized. */
export interface RawQuote {
  marketHashName: string;
  market: PriceMarket;
  /** USD. Conversion is the adapter's responsibility. */
  price: number;
  bid?: number | null;
  ask?: number | null;
  volume24h?: number | null;
  /** When the SOURCE measured it, not when we received it. */
  quotedAt: Date;
}

/**
 * What a price provider needs to know how to do.
 *
 * It exists so the choice of provider does not leak into the rest of the
 * system. No screen, no job and no business rule knows about cs2.sh or
 * SteamWebAPI: they know `RawQuote`. Switching providers, or using two at
 * once, means adding a file.
 *
 * This is not abstraction for its own sake — it is what allows:
 * - combining sources, which requires a common shape to compare in;
 * - dropping whoever raised prices without rewriting the storefront;
 * - testing everything price-dependent without a network.
 */
export interface PriceProvider {
  readonly source: PriceSource;

  /**
   * Prices for the requested items.
   *
   * Takes a batch because every provider charges and limits per request:
   * asking one by one blows the quota and is orders of magnitude slower.
   *
   * An item without a quote is **omitted**, not returned with a price of
   * zero — zero would travel through the system and become "free skin" on
   * some screen.
   */
  fetchPrices(marketHashNames: string[]): Promise<RawQuote[]>;
}

/** Injection token. Several providers can be registered. */
export const PRICE_PROVIDERS = Symbol('PRICE_PROVIDERS');
