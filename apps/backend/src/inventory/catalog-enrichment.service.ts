import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { InventoryItem } from './steam-inventory.service';

/** What the catalog knows about an item, beyond what Steam returns. */
export interface CatalogFacts {
  /** e.g. "AK-47". Null for stickers, cases and anything with no weapon. */
  weapon: string | null;
  /** e.g. "Redline". Null on vanilla knives and on items with no skin. */
  skinName: string | null;
  /** Where it drops from. Empty when the catalog has no origin for it. */
  collections: string[];
  /** The model's description, without HTML. */
  description: string | null;
}

/** An inventory item with whatever the catalog could add to it. */
export type EnrichedInventoryItem = InventoryItem & {
  catalog: CatalogFacts | null;
};

/**
 * Fills inventory items in with what the catalog already knows.
 *
 * Steam's inventory endpoint returns one name — "AK-47 | Redline
 * (Field-Tested)" — and nothing else about the model. The screen wants
 * the weapon and the skin apart, and the catalog already holds them
 * split, because `catalog-mapping.ts` did that work at import time for
 * all 33,950 items.
 *
 * Doing it here rather than in the browser is the point: a second
 * splitter written in the frontend would be a copy of that logic, free
 * to drift from it, and the two would disagree on exactly the awkward
 * cases it was written for — vanilla knives, StatTrak™ prefixes, the
 * Zeus.
 *
 * The catalog is consulted on every read instead of being folded into
 * the cached payload, so a re-sync of the catalog shows up immediately
 * and a cached inventory never pins stale model data.
 */
@Injectable()
export class CatalogEnrichmentService {
  constructor(private readonly prisma: PrismaService) {}

  async enrich(items: InventoryItem[]): Promise<EnrichedInventoryItem[]> {
    if (items.length === 0) {
      return [];
    }

    // One query for the whole page. The names repeat — fifty identical
    // cases share a name — so the set is smaller than the item count.
    const names = [...new Set(items.map((i) => i.marketHashName))];

    const templates = await this.prisma.skinTemplate.findMany({
      where: { marketHashName: { in: names } },
      select: {
        marketHashName: true,
        weapon: true,
        skinName: true,
        collections: true,
        description: true,
      },
    });

    const byName = new Map(templates.map((t) => [t.marketHashName, t]));

    return items.map((item) => {
      const template = byName.get(item.marketHashName);

      // Null, not an empty object: "the catalog does not know this item"
      // is a real answer the screen may want to show differently from
      // "known, but with no weapon". An item can legitimately be missing
      // — the catalog mirrors a public dataset, and Valve ships new
      // items before it catches up.
      return {
        ...item,
        catalog: template
          ? {
              weapon: template.weapon,
              skinName: template.skinName,
              collections: template.collections,
              description: template.description,
            }
          : null,
      };
    });
  }
}
