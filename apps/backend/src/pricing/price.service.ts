import { Injectable, Logger } from '@nestjs/common';
import { PriceMarket } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { Cs2ShProvider } from './cs2sh.provider';
import { PriceHistoryService } from './price-history.service';
import type { RawQuote } from './price-provider';

/** What a screen needs to know about one item's worth. */
export interface ItemPrice {
  marketHashName: string;
  /** Lowest listing on the reference market, in USD. */
  ask: number;
  /** Highest buy order, or null where nobody is bidding. */
  bid: number | null;
  /**
   * `(ask - bid) / bid`, or null without a bid.
   *
   * This is the liquidity signal the instant-sell discount is keyed on.
   * cs2.sh sells a packaged liquidity endpoint on the Scale plan; this
   * is the same information from two numbers the Developer plan already
   * returns.
   */
  spread: number | null;
  /** Items listed on the reference market — depth, not sales. */
  askVolume: number | null;
  /** When the marketplace was measured, not when we read it. */
  quotedAt: Date;
}

/**
 * Prices for the screens.
 *
 * **BUFF governs.** It is the deepest market in the trade and the one
 * every other price is quoted against; the Western markets are worth
 * showing beside it but never averaged into it — an average across
 * markets of different liquidity produces a number that exists nowhere.
 *
 * **Steam is deliberately not a candidate**, even though we collect it.
 * Balance there cannot be withdrawn, so people bid it up: on a reading
 * taken while writing this, Steam asked 41% more than BUFF for the same
 * rifle, with a bid volume of 50,831 against BUFF's 311.
 *
 * Prices are asked for by name and cached in Redis. cs2.sh refreshes
 * every few minutes, so a cache measured in minutes costs nothing in
 * accuracy and saves a round trip on every screen that shows a price.
 */
@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  /**
   * The markets we would price from, best first.
   *
   * Falling through rather than averaging: an item with no BUFF listing
   * still has a real price on Youpin, and quoting that is better than
   * quoting nothing. Which one answered is worth keeping — see
   * `ItemPrice`, where the ask and bid come from a single market so the
   * spread between them means something.
   */
  private static readonly PREFERRED: PriceMarket[] = [
    PriceMarket.BUFF163,
    PriceMarket.YOUPIN,
    PriceMarket.CSFLOAT,
    PriceMarket.C5GAME,
  ];

  /**
   * cs2.sh collects every few minutes, so anything shorter buys nothing
   * and anything much longer starts quoting yesterday on a market that
   * moves.
   */
  private static readonly FRESH_SECONDS = 300;

  constructor(
    private readonly provider: Cs2ShProvider,
    private readonly history: PriceHistoryService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Prices for these items, from cache where possible.
   *
   * Names with no price are **absent from the map**, never present with
   * a zero. A zero would travel to a screen and become a free skin.
   */
  async pricesFor(marketHashNames: string[]): Promise<Map<string, ItemPrice>> {
    const names = [...new Set(marketHashNames)];
    const found = new Map<string, ItemPrice>();

    if (names.length === 0 || !this.provider.configured) return found;

    const missing = await this.readCache(names, found);
    if (missing.length === 0) return found;

    let quotes: RawQuote[];

    try {
      quotes = await this.provider.fetchPrices(missing);
    } catch (error) {
      // A price source being down is not a reason for the storefront to
      // be down. Whatever the cache had still stands, and the screens
      // already draw an item with no price.
      this.logger.error(
        `cs2.sh read failed, serving ${found.size} cached price(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return found;
    }

    for (const [name, price] of pickPrices(quotes, PriceService.PREFERRED)) {
      found.set(name, price);
      await this.writeCache(name, price);
    }

    // The series is what the 30-day chart is built from, and nobody can
    // build it backwards — so every reading that passes through here is
    // kept, whether or not a screen asked for the history.
    void this.history
      .record(this.provider.source, quotes)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not store the price history: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return found;
  }

  /** One item, for the places that only need one. */
  async priceFor(marketHashName: string): Promise<ItemPrice | null> {
    const prices = await this.pricesFor([marketHashName]);
    return prices.get(marketHashName) ?? null;
  }

  /* ─── Cache ──────────────────────────────────────────────────────── */

  private async readCache(
    names: string[],
    into: Map<string, ItemPrice>,
  ): Promise<string[]> {
    const raw = await this.redis.mget(
      ...names.map((name) => PriceService.key(name)),
    );
    const missing: string[] = [];

    names.forEach((name, i) => {
      const hit = raw[i];

      if (!hit) {
        missing.push(name);
        return;
      }

      try {
        const parsed = JSON.parse(hit) as ItemPrice;
        into.set(name, { ...parsed, quotedAt: new Date(parsed.quotedAt) });
      } catch {
        // Old or corrupted shape: treat as a miss rather than serving it.
        missing.push(name);
      }
    });

    return missing;
  }

  private async writeCache(name: string, price: ItemPrice): Promise<void> {
    await this.redis.set(
      PriceService.key(name),
      JSON.stringify(price),
      'EX',
      PriceService.FRESH_SECONDS,
    );
  }

  private static key(marketHashName: string): string {
    return `price:${marketHashName}`;
  }
}

/**
 * Picks one market per item, in order of preference.
 *
 * Ask and bid always come from the **same** market, which is what makes
 * the spread between them mean anything. Taking the best ask from one
 * and the best bid from another would produce a spread no trader could
 * act on, and on a bad day a negative one.
 */
export function pickPrices(
  quotes: RawQuote[],
  preferred: PriceMarket[],
): Map<string, ItemPrice> {
  const byName = new Map<string, RawQuote[]>();

  for (const q of quotes) {
    const list = byName.get(q.marketHashName);
    if (list) list.push(q);
    else byName.set(q.marketHashName, [q]);
  }

  const prices = new Map<string, ItemPrice>();

  for (const [name, list] of byName) {
    // A zero ask is not a price, whichever market said it. The provider
    // already drops them; repeated here because this function is where
    // "there is no price" is decided, and a caller with quotes from
    // anywhere else has to land on the same answer.
    const chosen = preferred
      .map((market) => list.find((q) => q.market === market))
      .find(
        (q): q is RawQuote =>
          q !== undefined && typeof q.ask === 'number' && q.ask > 0,
      );

    if (!chosen || typeof chosen.ask !== 'number') continue;

    const bid = chosen.bid && chosen.bid > 0 ? chosen.bid : null;

    prices.set(name, {
      marketHashName: name,
      ask: chosen.ask,
      bid,
      // Guarded against a zero bid, which would divide by nothing. A bid
      // of zero is not a bid.
      spread: bid && bid > 0 ? (chosen.ask - bid) / bid : null,
      askVolume: chosen.volume24h ?? null,
      quotedAt: chosen.quotedAt,
    });
  }

  return prices;
}
