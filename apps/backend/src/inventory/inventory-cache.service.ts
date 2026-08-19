import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { InventoryItem } from './steam-inventory.service';

interface CacheEntry {
  items: InventoryItem[];
  /** The moment it came from Steam. */
  fetchedAt: number;
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
 * Serving stale data beats refusing: an inventory from ten minutes ago
 * is practically identical to the current one, and the alternative is an
 * empty screen with an error message.
 */
@Injectable()
export class InventoryCacheService {
  /** Below this, the data counts as current. */
  private static readonly FRESH_SECONDS = 120;

  /** How long the data stays around to serve as a fallback. */
  private static readonly RETENTION_SECONDS = 60 * 60;

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
      stale: ageSeconds > InventoryCacheService.FRESH_SECONDS,
    };
  }

  async set(steamId: string, items: InventoryItem[]): Promise<void> {
    const entry: CacheEntry = { items, fetchedAt: Date.now() };

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

  private key(steamId: string): string {
    return `inventory:${steamId}`;
  }
}
