import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriceMarket, PriceSource } from '@prisma/client';
import type { PriceProvider, RawQuote } from './price-provider';

/**
 * cs2.sh, on the Developer plan.
 *
 * The endpoint has two doors, and which one you use matters by three
 * orders of magnitude:
 *
 * - **POST** with up to 100 names returns just those. Two items came
 *   back in 1.5KB.
 * - **GET** with no body returns the entire catalogue — about 40,000
 *   items, 52MB uncompressed.
 *
 * So `fetchPrices` posts in batches of 100 and `fetchAll` is reserved
 * for the sync that genuinely wants everything. Reading the whole
 * catalogue to answer a question about three items is what this class
 * did before the full spec was read.
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

  /** The documented ceiling for one POST. */
  private static readonly BATCH = 100;

  /** Documented as 10 requests per second, per key. */
  private static readonly MIN_INTERVAL_MS = 110;

  /**
   * Generous because the full catalogue is 52MB. The plan allows
   * unlimited requests at 10/s, so the risk here is a slow transfer
   * rather than a quota.
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

    // Duplicates would spend batch slots on the same item.
    const names = [...new Set(marketHashNames)];
    const quotes: RawQuote[] = [];

    for (let i = 0; i < names.length; i += Cs2ShProvider.BATCH) {
      if (i > 0) await sleep(Cs2ShProvider.MIN_INTERVAL_MS);

      const batch = names.slice(i, i + Cs2ShProvider.BATCH);
      const body = await this.post(batch);
      const at = new Date(body.response_time);

      for (const [name, sources] of Object.entries(body.items)) {
        quotes.push(...toQuotes(name, sources, at));
      }

      // An item cs2.sh does not know is not a failure of the request —
      // it comes back beside the ones that worked. Ours can be ahead of
      // their schema after a Valve update, so this is expected traffic
      // and belongs in the log, not in an exception.
      if (body.errors?.length) {
        this.logger.warn(
          `cs2.sh did not recognise ${body.errors.length} item(s): ` +
            body.errors
              .slice(0, 5)
              .map((e) => `${e.item} (${e.code})`)
              .join(', '),
        );
      }
    }

    return quotes;
  }

  private async post(items: string[]): Promise<Cs2ShResponse> {
    const response = await this.request({
      method: 'POST',
      body: JSON.stringify({ items }),
      headers: { 'Content-Type': 'application/json' },
    });

    return assertUsd((await response.json()) as Cs2ShResponse);
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
    const started = Date.now();
    const response = await this.request({ method: 'GET' });
    const body = assertUsd((await response.json()) as Cs2ShResponse);
    const count = Object.keys(body.items).length;

    this.logger.log(
      `Read ${count} items from cs2.sh in ${Date.now() - started}ms`,
    );

    return { items: body.items, collectedAt: new Date(body.response_time) };
  }

  /** The one place the key, the headers and the failure shape live. */
  private async request(init: RequestInit): Promise<Response> {
    if (!this.apiKey) {
      throw new Error(
        'CS2SH_API_KEY is not set — the price source cannot be read.',
      );
    }

    const response = await fetch(Cs2ShProvider.URL, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.apiKey}`,
        // Required by cs2.sh, and it is what turns a 52MB catalogue into
        // something worth transferring.
        'Accept-Encoding': 'gzip',
      },
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

    return response;
  }
}

/**
 * Everything downstream stores USD, so a currency change has to be an
 * error rather than forty thousand wrong numbers.
 *
 * Called on the parsed body, not on a clone of the response: cloning to
 * peek at one field means parsing 52MB twice on the catalogue read.
 */
function assertUsd(body: Cs2ShResponse): Cs2ShResponse {
  if (body.currency !== 'USD') {
    throw new Error(`cs2.sh returned ${body.currency}, and the ledger is USD.`);
  }

  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  /** Partial success: names cs2.sh does not know, beside the ones it does. */
  errors?: { item: string; code: string; message: string }[];
}
