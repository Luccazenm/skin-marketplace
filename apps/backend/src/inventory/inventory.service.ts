import { Injectable, Logger } from '@nestjs/common';
import { InventoryCacheService } from './inventory-cache.service';
import {
  SteamInventoryService,
  type InventoryItem,
} from './steam-inventory.service';

export type InventoryResponse =
  | {
      status: 'ok';
      items: InventoryItem[];
      fetchedAt: Date;
      /** Data served from the cache, without asking Steam now. */
      cached: boolean;
      /** Past its freshness window — Steam could not be reached. */
      stale: boolean;
    }
  | { status: 'private' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Decides WHEN it is worth talking to Steam.
 *
 * The golden rule: stale data beats an error. An inventory from ten
 * minutes ago is practically identical to the current one, while an
 * empty screen saying "try again" is no use at all — and it pushes the
 * user to refresh, which makes exactly the problem we are avoiding
 * worse.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly steam: SteamInventoryService,
    private readonly cache: InventoryCacheService,
  ) {}

  async getInventory(steamId: string): Promise<InventoryResponse> {
    const cached = await this.cache.get(steamId);

    // 1. Current data: never touch Steam.
    if (cached && !cached.stale) {
      return {
        status: 'ok',
        items: cached.items,
        fetchedAt: cached.fetchedAt,
        cached: true,
        stale: false,
      };
    }

    // 2. We are serving a penalty after a 429. Insisting now only renews
    //    the block, so we serve whatever we have.
    if (await this.cache.isBlocked()) {
      return cached ? this.serveStale(cached) : { status: 'rate_limited' };
    }

    // 3. Only one call to Steam at a time, for the whole server.
    if (!(await this.cache.tryReserveCall())) {
      return cached ? this.serveStale(cached) : { status: 'rate_limited' };
    }

    const result = await this.steam.fetchInventory(steamId);

    if (result.status === 'ok') {
      await this.cache.set(steamId, result.items);

      return {
        status: 'ok',
        items: result.items,
        fetchedAt: new Date(),
        cached: false,
        stale: false,
      };
    }

    if (result.status === 'rate_limited') {
      await this.cache.markSteamBlocked();
      return cached ? this.serveStale(cached) : { status: 'rate_limited' };
    }

    // A private inventory does NOT fall back to the cache: if the person
    // just closed their profile, serving the old contents would show
    // items they decided to hide.
    if (result.status === 'private') {
      return { status: 'private' };
    }

    // A passing Steam failure: the stale cache is still useful.
    return cached
      ? this.serveStale(cached)
      : { status: 'error', message: result.message };
  }

  private serveStale(hit: {
    items: InventoryItem[];
    fetchedAt: Date;
  }): InventoryResponse {
    this.logger.warn(
      `Serving inventory from ${hit.fetchedAt.toISOString()} — Steam unavailable or rate-limited`,
    );

    return {
      status: 'ok',
      items: hit.items,
      fetchedAt: hit.fetchedAt,
      cached: true,
      stale: true,
    };
  }
}
