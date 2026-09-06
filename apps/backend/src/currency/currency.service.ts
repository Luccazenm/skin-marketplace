import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/** Every rate is against USD: `rates.BRL = 5.12` means $1 buys R$5.12. */
export interface RateTable {
  base: 'USD';
  rates: Record<string, number>;
  /** When the provider was read, not when this was served from cache. */
  fetchedAt: string;
}

/**
 * Exchange rates, for showing a price in the reader's own currency.
 *
 * **Display only, and the whole file depends on that.** The ledger is
 * USD, transactions settle in USD or crypto, and nothing here may ever
 * decide what somebody is charged or paid: those numbers come from the
 * payment gateway's own settlement, at the gateway's own rate. A rate
 * from here on an invoice would be a figure nobody can reconcile
 * against what actually moved.
 *
 * That is also why a stale table is fine and an outage is not an error.
 * Being a few hours behind moves a $31.50 rifle by a cent or two in
 * the reader's currency; refusing to render the page over it would be
 * a far worse trade.
 *
 * The provider key lives here rather than in the browser. The frontend
 * asks us, we ask them — a key shipped to the client is a key given
 * away, and this one is rate-limited per account.
 */
@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly apiKey: string | undefined;

  private static readonly URL = 'https://www.steamwebapi.com/currency/api/list';

  private static readonly CACHE_KEY = 'currency:rates';

  /**
   * Six hours. Rates move by fractions of a percent in a day and this
   * is a price label, not a trade — the shorter TTL buys accuracy
   * nobody can see and spends a quota measured in requests per day.
   */
  private static readonly FRESH_SECONDS = 6 * 60 * 60;

  /**
   * Kept far longer than it is considered fresh, so a provider outage
   * serves yesterday's rates instead of nothing. `STALE_SECONDS` is
   * what the cache is set to expire at; `FRESH_SECONDS` is only how
   * long we go before trying to replace it.
   */
  private static readonly STALE_SECONDS = 30 * 24 * 60 * 60;

  private static readonly TIMEOUT_MS = 15_000;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.apiKey = config.get<string>('STEAMWEBAPI_KEY');
  }

  /**
   * The table, from cache when it is fresh and from the provider when
   * it is not.
   *
   * Never throws. Without a key, without a network and without a cache
   * it returns USD alone, which renders every price exactly as it does
   * today — the screen degrades to dollars rather than to an error.
   */
  async rates(): Promise<RateTable> {
    const cached = await this.readCache();

    if (cached && this.isFresh(cached)) return cached;

    const fetched = await this.fetch();

    if (fetched) {
      await this.redis.set(
        CurrencyService.CACHE_KEY,
        JSON.stringify(fetched),
        'EX',
        CurrencyService.STALE_SECONDS,
      );

      return fetched;
    }

    // Stale beats absent: the alternative is showing a Brazilian reader
    // dollars because a third party was down for ten minutes.
    if (cached) {
      this.logger.warn('Serving stale exchange rates: provider unreachable');
      return cached;
    }

    return {
      base: 'USD',
      rates: { USD: 1 },
      fetchedAt: new Date().toISOString(),
    };
  }

  private isFresh(table: RateTable): boolean {
    const age = Date.now() - new Date(table.fetchedAt).getTime();

    return Number.isFinite(age) && age < CurrencyService.FRESH_SECONDS * 1000;
  }

  private async readCache(): Promise<RateTable | null> {
    try {
      const raw = await this.redis.get(CurrencyService.CACHE_KEY);
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);

      // Validated rather than trusted: a table written by an older
      // version of this file, or half-written, would otherwise reach
      // the screen as `undefined` where a price should be.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('rates' in parsed) ||
        typeof (parsed as RateTable).rates !== 'object' ||
        typeof (parsed as RateTable).fetchedAt !== 'string'
      ) {
        return null;
      }

      const table = parsed as RateTable;

      return this.sanitise(table.rates, table.fetchedAt);
    } catch {
      return null;
    }
  }

  private async fetch(): Promise<RateTable | null> {
    if (!this.apiKey) return null;

    const url = `${CurrencyService.URL}?key=${encodeURIComponent(this.apiKey)}`;

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CurrencyService.TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `Exchange rates: provider returned ${response.status}`,
        );
        return null;
      }

      const body = (await response.json()) as {
        rates?: Record<string, unknown>;
      };

      if (!body.rates || typeof body.rates !== 'object') {
        this.logger.warn('Exchange rates: response carried no rate table');
        return null;
      }

      return this.sanitise(body.rates, new Date().toISOString());
    } catch (cause) {
      this.logger.warn(
        `Exchange rates unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return null;
    }
  }

  /**
   * Keeps only rates that can divide a price.
   *
   * A zero, a negative or a string would each reach a component as a
   * number and turn a price into `Infinity`, `-31.50` or `NaN` on
   * screen. USD is forced to 1 regardless of what arrives: it is the
   * base, and a base of anything else silently rescales every price on
   * the site.
   */
  private sanitise(
    rates: Record<string, unknown>,
    fetchedAt: string,
  ): RateTable {
    const clean: Record<string, number> = { USD: 1 };

    for (const [code, value] of Object.entries(rates)) {
      const rate = typeof value === 'number' ? value : Number(value);

      if (code !== 'USD' && Number.isFinite(rate) && rate > 0) {
        clean[code.toUpperCase()] = rate;
      }
    }

    return { base: 'USD', rates: clean, fetchedAt };
  }
}
