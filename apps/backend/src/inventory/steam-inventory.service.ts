import { Injectable, Logger } from '@nestjs/common';
import type { Dispatcher } from 'undici';
import { ItemCategory } from '@prisma/client';
import { extractApplied, withScrape, type AppliedItem } from './applied-items';
import {
  blockReason,
  categoryOf,
  hasUniquePattern,
  neverTradable,
  type BlockReason,
} from './item-category';

/** An inventory item, with asset and description already merged. */
export interface InventoryItem {
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  iconUrl: string | null;
  /** Category derived from the Type tag — not from the item name. */
  category: ItemCategory;
  /** Tradable right now, according to Steam. */
  tradable: boolean;
  marketable: boolean;
  /** Can be deposited here: tradable and not permanently blocked. */
  depositable: boolean;
  /**
   * Why it cannot be deposited. 'permanent' for medals and the like,
   * 'unavailable' for an item merely waiting out Valve's 7 days.
   */
  blockReason: BlockReason | null;
  /** Has its own float and paint seed (weapon, knife, gloves). */
  hasUniquePattern: boolean;
  /**
   * Stickers, patches and charms applied.
   *
   * Distinguishes units as much as the float does — sometimes more: an AK
   * with four Katowice 2014 stickers is worth orders of magnitude above
   * the clean skin. It is also what makes a patched agent distinct from a
   * plain one, despite agents having no float.
   */
  applied: AppliedItem[];
  /** Localized labels, for display only. */
  rarity: string | null;
  exterior: string | null;
  typeLabel: string | null;
  /**
   * Real wear, from 0 to 1. `null` for items without a pattern of their
   * own (case, capsule, agent) or when Steam did not send it.
   *
   * Comes from the inventory itself, not from the inspect link: Valve
   * started delivering it in `asset_properties`. That is what removes the
   * need for an inspect account connected to the game.
   */
  float: number | null;
  /** Pattern seed. Defines Doppler phase, Case Hardened blue. */
  paintSeed: number | null;
  /**
   * Inspect link with placeholders already resolved, to open in game. We
   * no longer need it to obtain float and pattern.
   */
  inspectLink: string | null;
}

export type InventoryResult =
  | { status: 'ok'; items: InventoryItem[] }
  /** Private inventory or restricted profile. */
  | { status: 'private' }
  /** Per-IP limit exceeded. See the class comment. */
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Reads a user's CS2 inventory.
 *
 * CAREFUL — per-IP limit:
 * This endpoint is public and uses no API key. Steam limits by IP
 * address, and the IP here is OUR server's: one user hammering refresh
 * can get Steam to block everyone else for hours.
 *
 * This service makes the raw call and nothing else. Caching and rate
 * control live in the layer above — calling this directly from a request
 * handler is asking for a 429.
 */
@Injectable()
export class SteamInventoryService {
  /** 730 = CS2. Context 2 is where tradable items live. */
  private static readonly APP_ID = 730;
  private static readonly CONTEXT_ID = 2;

  /**
   * The community settled on 2000 as a safe ceiling; above that the block
   * comes faster. Bigger inventories require pagination.
   */
  private static readonly COUNT = 2000;

  private readonly logger = new Logger(SteamInventoryService.name);

  /**
   * @param dispatcher which way out to Steam, or null for the machine's
   *   own address. The caller picks it, because the caller is what holds
   *   the per-route rate limit.
   */
  async fetchInventory(
    steamId: string,
    dispatcher: Dispatcher | null = null,
  ): Promise<InventoryResult> {
    const url =
      `https://steamcommunity.com/inventory/${steamId}` +
      `/${SteamInventoryService.APP_ID}/${SteamInventoryService.CONTEXT_ID}` +
      `?l=english&count=${SteamInventoryService.COUNT}`;

    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
        // Node's fetch takes a dispatcher, which is how the call is
        // bound to one source address or sent through one proxy. Absent,
        // it goes out however the machine would normally route it.
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (error) {
      this.logger.warn(`Network failure reading inventory: ${String(error)}`);
      return { status: 'error', message: 'Steam did not respond in time' };
    }

    if (response.status === 429) {
      // Not the user's fault: it is our IP that blew the quota.
      this.logger.error('Steam returned 429 — per-IP inventory limit reached');
      return { status: 'rate_limited' };
    }

    // A private profile or inventory returns 403. Steam also uses 401
    // when the profile is restricted in other ways.
    if (response.status === 403 || response.status === 401) {
      return { status: 'private' };
    }

    if (!response.ok) {
      this.logger.warn(`Steam returned ${response.status} for the inventory`);
      return {
        status: 'error',
        message: `Steam returned ${response.status}`,
      };
    }

    const body = (await response.json()) as SteamInventoryResponse | null;

    // An empty inventory returns success without the arrays — not an error.
    if (!body?.assets || !body.descriptions) {
      return { status: 'ok', items: [] };
    }

    return {
      status: 'ok',
      items: this.merge(
        body.assets,
        body.descriptions,
        body.asset_properties ?? [],
        steamId,
      ),
    };
  }

  /**
   * Steam returns two separate lists: `assets` are the units the person
   * owns, `descriptions` are the shared metadata. Several assets point at
   * the same description — that is how 50 identical cases avoid repeating
   * name, image and tags 50 times.
   *
   * The link is made by classid + instanceid.
   */
  private merge(
    assets: SteamAsset[],
    descriptions: SteamDescription[],
    properties: SteamAssetProperties[],
    steamId: string,
  ): InventoryItem[] {
    const byKey = new Map<string, SteamDescription>();

    for (const d of descriptions) {
      byKey.set(`${d.classid}_${d.instanceid ?? '0'}`, d);
    }

    // These come keyed by assetid, not classid: they belong to the unit,
    // not the model. Two items of the same skin have different floats.
    const byAsset = new Map<string, SteamAssetProperties>();

    for (const p of properties) {
      byAsset.set(p.assetid, p);
    }

    const items: InventoryItem[] = [];

    for (const asset of assets) {
      const desc = byKey.get(`${asset.classid}_${asset.instanceid ?? '0'}`);

      // Without a description there is no way to identify the skin;
      // skipping is better than returning half an item.
      if (!desc) {
        continue;
      }

      const internalType = this.internalTag(desc, 'Type');
      const category = categoryOf(internalType);
      const tradable = desc.tradable === 1;

      if (category === ItemCategory.OTHER && internalType) {
        // A new Valve type, or something we missed. We log it so it shows
        // up in the mapping instead of disappearing silently.
        this.logger.warn(`Unmapped item type: ${internalType}`);
      }

      const props = byAsset.get(asset.assetid);

      items.push({
        assetId: asset.assetid,
        classId: asset.classid,
        instanceId: asset.instanceid ?? '0',
        marketHashName: desc.market_hash_name,
        iconUrl: desc.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${desc.icon_url}`
          : null,
        category,
        tradable,
        marketable: desc.marketable === 1,
        depositable: tradable && !neverTradable(category),
        blockReason: blockReason(category, tradable),
        hasUniquePattern: hasUniquePattern(category),
        applied: withScrape(
          extractApplied(desc.descriptions),
          this.scrapeLevels(props),
        ),
        rarity: this.displayTag(desc, 'Rarity'),
        exterior: this.displayTag(desc, 'Exterior'),
        typeLabel: this.displayTag(desc, 'Type'),
        float: this.numericProperty(props, PROP.FLOAT),
        paintSeed: this.numericProperty(props, PROP.PAINT_SEED),
        inspectLink: this.inspectLink(desc, steamId, asset.assetid),
      });
    }

    return items;
  }

  /**
   * The tag's UNTRANSLATED value — this is what logic should use.
   * `localized_tag_name` changes with the request language;
   * `internal_name` does not. Using the translated one would break
   * classification silently if the `l=english` parameter ever changed.
   */
  private internalTag(desc: SteamDescription, category: string): string | null {
    return (
      desc.tags?.find((t) => t.category === category)?.internal_name ?? null
    );
  }

  /** Translated value — display only. */
  private displayTag(desc: SteamDescription, category: string): string | null {
    return (
      desc.tags?.find((t) => t.category === category)?.localized_tag_name ??
      null
    );
  }

  /**
   * Reads a per-unit property.
   *
   * Steam sends the number sometimes in `float_value`, sometimes in
   * `int_value`, sometimes as text — and always as a string. A value that
   * does not become a number returns `null` rather than `NaN`: `NaN` would
   * travel silently through the system and surface on a price screen.
   */
  private numericProperty(
    props: SteamAssetProperties | undefined,
    propertyId: number,
  ): number | null {
    const p = props?.asset_properties?.find((x) => x.propertyid === propertyId);

    if (!p) {
      return null;
    }

    const raw = p.float_value ?? p.int_value ?? p.string_value;
    const n = Number(raw);

    return raw !== undefined && Number.isFinite(n) ? n : null;
  }

  /**
   * Scrape level of each applied piece, in the order Steam returns them.
   * Confirmed against a real inventory: 0 is intact.
   */
  private scrapeLevels(props: SteamAssetProperties | undefined): number[] {
    const accessories = props?.asset_accessories;

    if (!accessories?.length) {
      return [];
    }

    return accessories.map((a) => {
      const p = a.parent_relationship_properties?.find(
        (x) => x.propertyid === PROP.SCRAPE,
      );
      const n = Number(p?.float_value);

      return Number.isFinite(n) ? n : 0;
    });
  }

  /**
   * The link arrives with placeholders Steam expects the client to swap:
   *   ...+csgo_econ_action_preview S%owner_steamid%A%assetid%D123456
   */
  private inspectLink(
    desc: SteamDescription,
    steamId: string,
    assetId: string,
  ): string | null {
    const link = desc.actions?.find((a) =>
      a.link?.includes('csgo_econ_action_preview'),
    )?.link;

    if (!link) {
      return null;
    }

    return link
      .replace('%owner_steamid%', steamId)
      .replace('%assetid%', assetId);
  }
}

// ---- Raw shape returned by Steam ----

/**
 * Per-unit property identifiers.
 *
 * These are Valve's magic numbers, undocumented — determined against a
 * real inventory on 2026-08-17 and cross-checked between two known items.
 * If Valve renumbers them, the tests break; that is the desired
 * behaviour.
 */
const PROP = {
  PAINT_SEED: 1,
  FLOAT: 2,
  /** Self-encoded inspect link. Kept for future use. */
  CERTIFICATE: 6,
  /** Scrape level, inside the accessory's parent_relationship_properties. */
  SCRAPE: 4,
} as const;

interface SteamInventoryResponse {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  /**
   * Per-unit data, keyed by assetid: float, paint seed and the applied
   * pieces with each one's scrape level.
   */
  asset_properties?: SteamAssetProperties[];
  total_inventory_count?: number;
}

interface SteamAssetProperties {
  assetid: string;
  asset_properties?: Array<{
    propertyid: number;
    float_value?: string;
    int_value?: string;
    string_value?: string;
    name?: string;
  }>;
  /** Stickers and patches applied, in slot order. */
  asset_accessories?: Array<{
    classid?: string;
    parent_relationship_properties?: Array<{
      propertyid: number;
      float_value?: string;
    }>;
  }>;
}

interface SteamAsset {
  assetid: string;
  classid: string;
  instanceid?: string;
  amount: string;
}

interface SteamDescription {
  classid: string;
  instanceid?: string;
  market_hash_name: string;
  icon_url?: string;
  tradable?: number;
  marketable?: number;
  tags?: Array<{
    category: string;
    /** Stable, untranslated — e.g. "CSGO_Type_Rifle". Use for logic. */
    internal_name?: string;
    /** Translated — e.g. "Rifle". Use for display only. */
    localized_tag_name?: string;
  }>;
  /**
   * Blocks of text and HTML. This is where applied stickers, patches and
   * charms arrive, embedded in HTML — see applied-items.ts.
   */
  descriptions?: Array<{ name?: string; value?: string; type?: string }>;
  actions?: Array<{ link?: string; name?: string }>;
}
