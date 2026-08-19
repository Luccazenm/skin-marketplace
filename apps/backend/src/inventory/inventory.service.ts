import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseEgress, type EgressRoute } from './egress';
import {
  CatalogEnrichmentService,
  type EnrichedInventoryItem,
} from './catalog-enrichment.service';
import { InventoryCacheService } from './inventory-cache.service';
import {
  SteamInventoryService,
  type InventoryItem,
} from './steam-inventory.service';

export type InventoryResponse =
  | {
      status: 'ok';
      items: EnrichedInventoryItem[];
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
 * The same answer before the catalog is consulted.
 *
 * Kept separate so the decision about WHEN to call Steam stays readable
 * on its own, with the enrichment layered on top in one place instead of
 * on each of its five exits.
 */
type RawInventoryResponse =
  | {
      status: 'ok';
      items: InventoryItem[];
      fetchedAt: Date;
      cached: boolean;
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

  /**
   * The ways out to Steam, read once at boot.
   *
   * Steam limits the inventory endpoint per IP, so this list is the
   * site's inventory capacity: one route is about 900 reads an hour,
   * ten is ten times that. It is configuration rather than code so that
   * growing it needs no deploy of anything but an environment variable.
   */
  private readonly routes: EgressRoute[];
  private readonly routeIds: string[];

  constructor(
    private readonly steam: SteamInventoryService,
    private readonly cache: InventoryCacheService,
    private readonly catalog: CatalogEnrichmentService,
    config: ConfigService,
  ) {
    const { routes, skipped } = parseEgress(
      config.get<string>('STEAM_EGRESS') ?? '',
    );

    this.routes = routes;
    this.routeIds = routes.map((r) => r.id);

    for (const entry of skipped) {
      // Loud, because the operator meant to have that capacity and does
      // not: a silently dropped address is a limit nobody can explain.
      this.logger.error(`Ignoring STEAM_EGRESS entry: ${entry}`);
    }

    this.logger.log(
      `Steam egress: ${routes.length} route(s) — ${this.routeIds.join(', ')}`,
    );
  }

  /**
   * @param force skip the freshness check and go to Steam, if a route is
   *   free. The rate limit still applies — this bypasses the cache, not
   *   the limiter, or it would be a way for anyone to spend the site's
   *   whole Steam budget by holding down a button.
   */
  async getInventory(
    steamId: string,
    force = false,
  ): Promise<InventoryResponse> {
    const result = await this.readInventory(steamId, force);

    if (result.status !== 'ok') {
      return result;
    }

    return { ...result, items: await this.catalog.enrich(result.items) };
  }

  private async readInventory(
    steamId: string,
    force: boolean,
  ): Promise<RawInventoryResponse> {
    const cached = await this.cache.get(steamId);

    // 1. Current data: never touch Steam. Unless the user asked, which
    //    is the case where their inventory changed a moment ago and the
    //    freshness window is exactly what is in their way.
    if (cached && !cached.stale && !force) {
      return {
        status: 'ok',
        items: cached.items,
        fetchedAt: cached.fetchedAt,
        cached: true,
        stale: false,
      };
    }

    // 2. Every route is serving a penalty after a 429. Insisting now
    //    only renews them, so we serve whatever we have.
    if (await this.cache.allBlocked(this.routeIds)) {
      return cached ? this.serveStale(cached) : { status: 'rate_limited' };
    }

    // 3. One call at a time per route. With a single route this is the
    //    same single-file queue as before; with several they run side by
    //    side, which is the whole point of having them.
    const routeId = await this.cache.tryReserveCall(this.routeIds);

    if (routeId === null) {
      return cached ? this.serveStale(cached) : { status: 'rate_limited' };
    }

    const route = this.routes.find((r) => r.id === routeId)!;
    const result = await this.steam.fetchInventory(steamId, route.dispatcher);

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
      // Only the address that was refused stops. The others carry on.
      await this.cache.markSteamBlocked(routeId);
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
  }): RawInventoryResponse {
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
