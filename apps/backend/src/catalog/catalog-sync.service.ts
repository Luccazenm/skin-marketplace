import { Injectable, Logger } from '@nestjs/common';
import { ItemCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapItem, type CatalogEntry, type RawItem } from './catalog-mapping';

/** Only what the cross-reference needs; the rest of the file is ignored. */
interface RawGroup {
  name?: string;
  contains?: Array<{ id?: string }>;
  /**
   * Where knives and gloves live inside a case — they are the "rare
   * special item" and do not appear in `contains`. Without reading this
   * field, the catalog's 3,898 knives and gloves would have no origin.
   */
  contains_rare?: Array<{ id?: string }>;
}

export interface SyncResult {
  read: number;
  created: number;
  updated: number;
  /** Non-tradable, without a market name, or a type we do not store. */
  discarded: number;
  failures: number;
}

/**
 * Brings the CS2 item catalog into our database.
 *
 * We mirror instead of querying live for three reasons: the storefront
 * needs to filter and sort, which requires our own indexes; prices hang
 * off our `SkinTemplate`, not off a third party's id; and depending on a
 * public repository per visit would mean the storefront goes down
 * whenever it does.
 *
 * Idempotent: running again updates what changed and duplicates nothing.
 */
@Injectable()
export class CatalogSyncService {
  private static readonly BASE =
    'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';

  /**
   * `skins_not_grouped` is the list with each exterior as its own entry —
   * "Redline (Field-Tested)" separate from "(Minimal Wear)". That matches
   * Steam's `market_hash_name`, and it is how the market quotes them. The
   * grouped version would merge prices that are different.
   */
  private static readonly FILES: Array<[string, ItemCategory | undefined]> = [
    // No default category: the weapon comes from the name and the
    // `weapon` field.
    ['skins_not_grouped', undefined],
    ['stickers', ItemCategory.STICKER],
    ['crates', ItemCategory.CONTAINER],
    ['agents', ItemCategory.AGENT],
    ['keychains', ItemCategory.CHARM],
    ['patches', ItemCategory.PATCH],
    ['graffiti', ItemCategory.GRAFFITI],
    ['music_kits', ItemCategory.MUSIC_KIT],
    ['keys', ItemCategory.KEY],
  ];

  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(
    onProgress?: (file: string, r: SyncResult) => void,
  ): Promise<SyncResult> {
    const total: SyncResult = {
      read: 0,
      created: 0,
      updated: 0,
      discarded: 0,
      failures: 0,
    };

    const origins = await this.mapOrigins();

    for (const [file, category] of CatalogSyncService.FILES) {
      const items = await this.download(file);
      const r = await this.store(items, category, origins);

      total.read += r.read;
      total.created += r.created;
      total.updated += r.updated;
      total.discarded += r.discarded;
      total.failures += r.failures;

      onProgress?.(file, r);
    }

    return total;
  }

  /**
   * Builds `skin_id -> origin names`.
   *
   * The skins file carries no collection at all — the information only
   * exists on the other side, in `collections.json` and `crates.json`,
   * where each group lists what it contains. The key is `skin_id`, the
   * skin without the exterior: the five "Redline" entries share it, and
   * all belong to the same collection.
   *
   * Cross-referencing by id and not by name is what avoids mistakes on
   * skins whose name repeats across different weapons.
   */
  private async mapOrigins(): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();

    for (const file of ['crates', 'collections']) {
      const groups = (await this.download(file)) as RawGroup[];

      for (const g of groups) {
        if (!g.name) {
          continue;
        }

        // `contains_rare` is where knives and gloves live: they are the
        // case's rare special item and do not appear in `contains`.
        for (const item of [
          ...(g.contains ?? []),
          ...(g.contains_rare ?? []),
        ]) {
          if (!item.id) {
            continue;
          }

          // Accumulate, never overwrite. A quarter of the catalog drops
          // from more than one origin — Karambit | Doppler comes from
          // Chroma, Chroma 2 and Chroma 3 — and `set` would let the last
          // one processed erase the others, by accident of iteration
          // order.
          const current = map.get(item.id) ?? new Set<string>();
          current.add(g.name);
          map.set(item.id, current);
        }
      }
    }

    const several = [...map.values()].filter((s) => s.size > 1).length;

    this.logger.log(
      `Origins: ${map.size} items mapped, ${several} from more than one`,
    );

    return map;
  }

  private async download(file: string): Promise<RawItem[]> {
    const url = `${CatalogSyncService.BASE}/${file}.json`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(`${file}.json returned ${response.status}`);
    }

    const body = (await response.json()) as RawItem[] | Record<string, RawItem>;

    // Some files arrive as an object keyed by id instead of a list.
    return Array.isArray(body) ? body : Object.values(body);
  }

  private async store(
    items: RawItem[],
    defaultCategory?: ItemCategory,
    origins?: Map<string, Set<string>>,
  ): Promise<SyncResult> {
    const r: SyncResult = {
      read: items.length,
      created: 0,
      updated: 0,
      discarded: 0,
      failures: 0,
    };

    // The dataset repeats the same market_hash_name across files;
    // deduplicating first avoids pointless round trips to the database.
    const byName = new Map<string, CatalogEntry>();

    for (const raw of items) {
      const entry = mapItem(raw, {
        defaultCategory,
        collections: raw.skin_id
          ? [...(origins?.get(raw.skin_id) ?? [])]
          : undefined,
      });

      if (!entry) {
        r.discarded++;
        continue;
      }

      byName.set(entry.marketHashName, entry);
    }

    for (const entry of byName.values()) {
      try {
        const { marketHashName, ...fields } = entry;

        // Upsert instead of create: the dataset changes (new image,
        // corrected rarity) and running again must reflect that without
        // duplicating.
        //
        // We do NOT touch referencePrice, buyoutEligible or
        // buyoutDiscountPct: those are our decisions, and a catalog sync
        // cannot undo the instant-buyout whitelist.
        const before = await this.prisma.skinTemplate.findUnique({
          where: { marketHashName },
          select: { id: true },
        });

        await this.prisma.skinTemplate.upsert({
          where: { marketHashName },
          create: { marketHashName, ...fields },
          update: fields,
        });

        if (before) {
          r.updated++;
        } else {
          r.created++;
        }
      } catch (error) {
        // One rejected row cannot abort 36,000. Log and move on: the
        // failure counter is what exposes a wrong mapping.
        r.failures++;
        this.logger.warn(
          `Failed on "${entry.marketHashName}" (${entry.category}): ${String(error)}`,
        );
      }
    }

    return r;
  }
}
