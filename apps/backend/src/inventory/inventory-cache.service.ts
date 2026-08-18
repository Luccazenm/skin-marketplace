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
   * Tries to reserve the right to call Steam right now.
   *
   * This is a GLOBAL limit, not a per-user one: what counts is the
   * server's IP, and there is only one of it. If two users ask at the
   * same time, only one gets through — the other is served from the
   * cache, stale or not.
   *
   * Implemented with SET NX: the key is only created if it does not
   * exist, and it expires on its own. It holds across multiple API
   * instances, since the state lives in Redis and not in process memory.
   */
  async tryReserveCall(): Promise<boolean> {
    const result = await this.redis.set(
      'steam:inventory:slot',
      Date.now().toString(),
      'PX',
      InventoryCacheService.MINIMUM_INTERVAL_MS,
      'NX',
    );

    return result === 'OK';
  }

  /**
   * After a 429, stop trying for a few minutes — for the whole server,
   * since Steam's block is on our IP. Insisting during the penalty
   * renews it, so the only way out is to wait.
   */
  async markSteamBlocked(): Promise<void> {
    await this.redis.set('steam:inventory:blocked', '1', 'EX', 300);
    this.logger.error('Inventory blocked for 5 minutes after a 429 from Steam');
  }

  async isBlocked(): Promise<boolean> {
    return (await this.redis.exists('steam:inventory:blocked')) === 1;
  }

  private key(steamId: string): string {
    return `inventory:${steamId}`;
  }
}
