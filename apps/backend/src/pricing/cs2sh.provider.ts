import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceMarket, PriceSource } from '@prisma/client';
import type { PriceProvider, RawQuote } from './price-provider';

/**
 * cs2.sh, on the Developer plan.
 *
 * Two things about this endpoint shape everything below.
 *
 * **It takes no filter.** `/v1/prices/latest` returns every item there
 * is — about 40,000 of them, 50MB, in roughly eight seconds. So
 * `fetchPrices` does not query per name: it reads the whole thing once
 * and picks out what was asked for. Calling it in a loop would download
 * fifty megabytes per item.
 *
 * **Bid is real here, and it is the point.** BUFF, Youpin, Steam and
 * C5Game carry buy orders; Skinport does not. The instant-sell offer is
 * anchored on the bid, never the ask — an ask is what somebody is
 * asking, a bid is what somebody will actually hand over.
 */
@Injectable()
export class Cs2ShProvider implements PriceProvider {
  readonly source = PriceSource.CS2SH;

  private readonly logger = new Logger(Cs2ShProvider.name);
  private readonly apiKey: string | undefined;

  private static readonly URL = 'https://api.cs2.sh/v1/prices/latest';

  /**
   * Generous because the response is 50MB. The plan allows unlimited
   * requests at 10/s, so the risk here is a slow transfer, not a quota.
   */
  private static readonly TIMEOUT_MS = 120_000;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('CS2SH_API_KEY');
  }

  /** False when no key is configured, so callers can skip rather than fail. */
  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchPrices(marketHashNames: string[]): Promise<RawQuote[]> {
    if (marketHashNames.length === 0) return [];

    const all = await this.fetchAll();
    const wanted = new Set(marketHashNames);
    const quotes: RawQuote[] = [];

    for (const [name, sources] of Object.entries(all.items)) {
      if (!wanted.has(name)) continue;
      quotes.push(...toQuotes(name, sources, all.collectedAt));
    }

    return quotes;
  }

  /**
   * The whole catalogue in one read.
   *
   * Public because syncing wants every item, and going through
   * `fetchPrices` with 40,000 names just to filter back down to 40,000
   * would be silly.
   */
  async fetchAll(): Promise<{
    items: Record<string, MarketSources>;
    collectedAt: Date;
  }> {
    if (!this.apiKey) {
      throw new Error(
        'CS2SH_API_KEY is not set — the price source cannot be read.',
      );
    }

    const started = Date.now();

    const response = await fetch(Cs2ShProvider.URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(Cs2ShProvider.TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries a request_id, which is what their support asks
      // for. Losing it would make a report unanswerable.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `cs2.sh returned ${response.status}: ${detail.slice(0, 300)}`,
      );
    }

    const body = (await response.json()) as Cs2ShResponse;

    if (body.currency !== 'USD') {
      // Everything downstream stores USD. A silent currency change would
      // turn every price into a wrong number rather than an error.
      throw new Error(
        `cs2.sh returned ${body.currency}, and the ledger is USD.`,
      );
    }

    const count = Object.keys(body.items).length;

    this.logger.log(
      `Read ${count} items from cs2.sh in ${Date.now() - started}ms`,
    );

    return { items: body.items, collectedAt: new Date(body.response_time) };
  }
}

/* ─── Mapping ──────────────────────────────────────────────────────── */

/**
 * Which key in the response belongs to which market in our enum.
 *
 * Anything cs2.sh adds later is ignored until it is listed here, which
 * is the safe direction: an unknown market silently becoming a price
 * would be worse than not having it.
 */
const MARKETS: Record<string, PriceMarket> = {
  buff: PriceMarket.BUFF163,
  youpin: PriceMarket.YOUPIN,
  csfloat: PriceMarket.CSFLOAT,
  skinport: PriceMarket.SKINPORT,
  steam: PriceMarket.STEAM,
  c5game: PriceMarket.C5GAME,
};

export function toQuotes(
  marketHashName: string,
  sources: MarketSources,
  fallbackAt: Date,
): RawQuote[] {
  const quotes: RawQuote[] = [];

  for (const [key, market] of Object.entries(MARKETS)) {
    const source = sources[key];
    if (!source) continue;

    // No ask means nothing is listed. There is no price to record, and a
    // bid alone is not one — it is what somebody hopes to pay.
    if (typeof source.ask !== 'number') continue;

    quotes.push({
      marketHashName,
      market,
      price: source.ask,
      // Absent and null both mean the same thing: this market has no buy
      // orders for this item. Kept apart from zero, which would read as
      // "somebody bids nothing".
      bid: source.bid ?? null,
      ask: source.ask,
      volume24h: source.ask_volume ?? null,
      // When the marketplace was measured, not when we received it. A
      // reading collected four minutes ago is not a reading from now,
      // and the difference decides whether a price is worth showing.
      quotedAt: source.updated_at ? new Date(source.updated_at) : fallbackAt,
    });
  }

  return quotes;
}

/* ─── The shape cs2.sh actually returns ────────────────────────────── */

export interface MarketSource {
  updated_at?: string;
  collected_at?: string;
  ask?: number | null;
  ask_volume?: number | null;
  bid?: number | null;
  bid_volume?: number | null;
}

export type MarketSources = Record<string, MarketSource | undefined>;

interface Cs2ShResponse {
  response_time: string;
  currency: string;
  items: Record<string, MarketSources>;
}
