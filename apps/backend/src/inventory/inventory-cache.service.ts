import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { InventoryItem } from './steam-inventory.service';

interface CacheEntry {
  items: InventoryItem[];
  /** The moment it came from Steam. */
  fetchedAt: number;
  /**
   * How long this particular entry stays fresh, in seconds.
   *
   * Stored per entry rather than read from the constant, so the jitter
   * picked when it was written is the one honoured when it is read —
   * otherwise every entry would expire on the same boundary again and
   * the jitter would do nothing.
   */
  freshFor?: number;
}

export interface CacheHit {
  items: InventoryItem[];
  fetchedAt: Date;
  /** true = past its freshness window, served for lack of an option. */
  stale: boolean;
}

/**
 * The inventory cache, with two ages.
 *
 * It exists because Steam's inventory endpoint is rate-limited per IP —
 * ours. Without a cache, every refresh from every user becomes a call,
 * and a handful of those is enough for Steam to block everyone for
 * hours.
 *
 * We keep a single entry, with a long TTL, and decide by its age:
 *
 *   age < FRESH   -> serve it directly, never touch Steam
 *   age > FRESH   -> try to revalidate; if we cannot, serve it stale
 *   no entry      -> we have to call Steam or fail
 *
 * Serving stale data beats refusing: an inventory nobody has traded from
 * is identical however old the copy is, and the alternative is an empty
 * screen with an error message.
 */
@Injectable()
export class InventoryCacheService {
  /**
   * Below this, the data counts as current and Steam is not touched.
   *
   * An hour, and the length is a consequence of the refresh button
   * existing rather than an independent guess. A Steam inventory changes
   * when its owner trades — a few times a week for an active trader,
   * never for most people — so a window measured in minutes spends the
   * one genuinely scarce resource here, calls per IP per hour, re-reading
   * data that did not change. One address served about 30 people at two
   * minutes, 150 at ten, and roughly 900 at an hour.
   *
   * The cost of a long window is the person who just received a skin and
   * does not see it. Before the button that was a dead end and the window
   * had to stay short; now it is one click, so the window is set for the
   * common case and the button covers the exception.
   *
   * This governs display only. Anything that acts on the inventory —
   * a deposit, above all — passes force and reads Steam directly, because
   * validating against an hour-old list is not the same as showing one.
   */
  private static readonly FRESH_SECONDS = 60 * 60;

  /**
   * How much of the freshness window is randomised, per entry.
   *
   * Without this, a crowd that arrives together — a stream, a promotion
   * — fills every cache at the same instant and empties it at the same
   * instant, turning one burst into a burst repeating on the hour.
   * Spreading the expiry over ten minutes desynchronises them for free.
   *
   * The jitter only ever shortens the window, never extends it: nobody
   * should be shown older data than the policy promises.
   */
  private static readonly FRESH_JITTER_SECONDS = 600;

  /**
   * How long the data stays around to serve as a fallback.
   *
   * Comfortably longer than the freshness window, and that gap is the
   * point: the stretch between going stale and being evicted is the only
   * time `serveStale` has anything to serve. Were the two equal, an entry
   * would vanish at the exact moment it became stale and a Steam outage
   * would show an empty screen — the failure the cache exists to prevent.
   */
  private static readonly RETENTION_SECONDS = 6 * 60 * 60;

  /**
   * Minimum interval between two calls to the inventory endpoint, for the
   * whole server. The community settled on 4s as the safe limit; below
   * that the per-IP block arrives quickly.
   */
  private static readonly MINIMUM_INTERVAL_MS = 4000;

  private readonly logger = new Logger(InventoryCacheService.name);

  /** Rotates the starting point so one route does not take every call. */
  private nextRoute = 0;

  constructor(private readonly redis: RedisService) {}

  async get(steamId: string): Promise<CacheHit | null> {
    const raw = await this.redis.get(this.key(steamId));

    if (!raw) {
      return null;
    }

    let entry: CacheEntry;

    try {
      entry = JSON.parse(raw) as CacheEntry;
    } catch {
      // Old or corrupted format: treat it as a cache miss.
      return null;
    }

    const ageSeconds = (Date.now() - entry.fetchedAt) / 1000;

    return {
      items: entry.items,
      fetchedAt: new Date(entry.fetchedAt),
      // An entry written before freshFor existed has none. Falling back
      // to the policy value keeps it ageing normally; without this,
      // `age > undefined` is false and the entry would read as fresh
      // until its retention ran out.
      stale:
        ageSeconds > (entry.freshFor ?? InventoryCacheService.FRESH_SECONDS),
    };
  }

  async set(steamId: string, items: InventoryItem[]): Promise<void> {
    const entry: CacheEntry = {
      items,
      fetchedAt: Date.now(),
      freshFor: InventoryCacheService.jitteredFreshness(),
    };

    await this.redis.set(
      this.key(steamId),
      JSON.stringify(entry),
      'EX',
      InventoryCacheService.RETENTION_SECONDS,
    );
  }

  /**
   * Tries to reserve the right to call Steam right now, on any route
   * that is free.
   *
   * The limit is **per route**, because Steam's is per IP. One slot per
   * route, each holding for the minimum interval: with one route this
   * is the same single-file queue as before, and with ten it is ten
   * queues running side by side.
   *
   * Routes are tried in a rotating order rather than always from the
   * first, so traffic spreads instead of hammering one address while
   * the rest idle.
   *
   * Implemented with SET NX: the key is created only if absent and
   * expires on its own. It holds across API instances, since the state
   * is in Redis and not in process memory.
   */
  async tryReserveCall(routeIds: string[]): Promise<string | null> {
    const start = this.nextRoute++ % routeIds.length;

    for (let i = 0; i < routeIds.length; i++) {
      const id = routeIds[(start + i) % routeIds.length];

      if (await this.isBlocked(id)) {
        continue;
      }

      const taken = await this.redis.set(
        InventoryCacheService.slotKey(id),
        Date.now().toString(),
        'PX',
        InventoryCacheService.MINIMUM_INTERVAL_MS,
        'NX',
      );

      if (taken === 'OK') {
        return id;
      }
    }

    return null;
  }

  /**
   * After a 429, stop using THAT route for a few minutes.
   *
   * Per route, not global: Steam's block is on the address that was
   * refused, and stopping every other address because one was throttled
   * would turn a single bad moment into an outage for the whole site.
   * That is what used to happen when there was one global key.
   *
   * Insisting during the penalty renews it, so the only way out is to
   * wait — for that address.
   */
  async markSteamBlocked(routeId: string): Promise<void> {
    await this.redis.set(
      InventoryCacheService.blockedKey(routeId),
      '1',
      'EX',
      300,
    );
    this.logger.error(
      `Egress ${routeId} blocked for 5 minutes after a 429 from Steam`,
    );
  }

  async isBlocked(routeId: string): Promise<boolean> {
    return (
      (await this.redis.exists(InventoryCacheService.blockedKey(routeId))) === 1
    );
  }

  /** True when every route is serving a penalty. */
  async allBlocked(routeIds: string[]): Promise<boolean> {
    for (const id of routeIds) {
      if (!(await this.isBlocked(id))) return false;
    }
    return true;
  }

  private static slotKey(routeId: string): string {
    return `steam:inventory:slot:${routeId}`;
  }

  private static blockedKey(routeId: string): string {
    return `steam:inventory:blocked:${routeId}`;
  }

  /**
   * A freshness window somewhere in the jitter band below the policy
   * value. Never above it, so the promise the policy makes holds.
   */
  private static jitteredFreshness(): number {
    return (
      InventoryCacheService.FRESH_SECONDS -
      Math.floor(Math.random() * InventoryCacheService.FRESH_JITTER_SECONDS)
    );
  }

  private key(steamId: string): string {
    return `inventory:${steamId}`;
  }
}
