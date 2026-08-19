import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getInventory,
  type AppliedItem,
  type InventoryItem,
  type InventoryResponse,
} from './api';

/**
 * Why the inventory failed, as a code rather than a sentence.
 *
 * Each one needs different words and a different offer on screen: a
 * private inventory the person fixes themselves in Steam's settings, a
 * rate limit is worth waiting out, and an outage is worth retrying. A
 * single "something went wrong" would collapse three different actions
 * into one dead end.
 */
export type InventoryFailure =
  | 'private'
  | 'rate_limited'
  | 'unavailable'
  | 'signed_out';

export interface InventoryState {
  data: InventoryResponse | null;
  items: InventoryItem[];
  loading: boolean;
  failure: InventoryFailure | null;
  /** The backend's own message, already written to tell the user what to do. */
  failureMessage: string | null;
  /** Re-read, honouring the cache. */
  reload: () => Promise<void>;
  /**
   * Ask Steam now, skipping the freshness window — for the person who
   * just traded and is looking at an inventory that does not show it.
   */
  refresh: () => Promise<void>;
  /** True while a manual refresh is in flight. */
  refreshing: boolean;
  /** When the data on screen was read from Steam. */
  fetchedAt: Date | null;
}

/**
 * The user's Steam inventory, read live through the backend.
 *
 * Nothing is cached here on purpose: the backend already holds the
 * freshness window and the rate limiter, because Steam limits that
 * endpoint per IP and the IP is the server's. A second cache in the
 * browser would only add a way for the two to disagree — and it is the
 * backend that knows when the copy was actually read from Steam.
 */
export function useInventory(enabled: boolean): InventoryState {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failure, setFailure] = useState<InventoryFailure | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setFailure('signed_out');
      setFailureMessage(null);
      return;
    }

    setLoading(true);

    try {
      setData(await getInventory(force ? { refresh: true } : {}));
      setFailure(null);
      setFailureMessage(null);
    } catch (error) {
      setData(null);

      if (error instanceof ApiError) {
        setFailure(failureFor(error.status));
        // The API writes its messages to say what to do, so it is worth
        // showing rather than replacing with our own guess.
        setFailureMessage(error.message);
      } else {
        setFailure('unavailable');
        setFailureMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return {
    data,
    items: data?.items ?? [],
    loading,
    failure,
    failureMessage,
    reload: () => load(),
    refresh,
    refreshing,
    fetchedAt: data ? new Date(data.fetchedAt) : null,
  };
}

function failureFor(status: number): InventoryFailure {
  if (status === 401) return 'signed_out';
  if (status === 403) return 'private';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

// ---------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------

/**
 * Steam's rarity names mapped onto the palette's keys.
 *
 * Valve runs two parallel ladders with the same six colours: weapons go
 * Consumer → Industrial → Mil-Spec → Restricted → Classified → Covert,
 * while stickers, graffiti, cases, capsules and medals go Base → High
 * Grade → Remarkable → Exotic → Extraordinary → Contraband. A grade on
 * one ladder shares its colour with the grade at the same height on the
 * other.
 *
 * Both ladders are here because a real inventory is mostly the second
 * one: of 191 items in the account this was checked against, 168 carried
 * a name from the sticker ladder. Mapping only the weapon names would
 * have painted seven items in nine and left the screen a wall of grey.
 *
 * Anything unrecognised falls back to the neutral tone rather than
 * throwing: a new grade from Valve should make one item look plain, not
 * break the page.
 */
const RARITY_BY_GRADE: Record<string, string> = {
  // Weapons
  'consumer grade': 'consumer',
  'industrial grade': 'industrial',
  'mil-spec grade': 'milspec',
  restricted: 'restricted',
  classified: 'classified',
  covert: 'covert',

  // Stickers, graffiti, containers, capsules, medals
  'base grade': 'consumer',
  'high grade': 'industrial',
  remarkable: 'milspec',
  exotic: 'restricted',
  extraordinary: 'classified',

  // Both ladders end here, and it is the only grade Valve stopped issuing
  contraband: 'covert',
};

export function rarityKey(rarity: string | null): string {
  if (!rarity) return 'consumer';

  return RARITY_BY_GRADE[rarity.trim().toLowerCase()] ?? 'consumer';
}

/**
 * The palette key for an item, category included.
 *
 * Knives and gloves get the gold ★ regardless of their grade — Valve
 * marks them apart from every other item, the storefront filter already
 * calls them "★ Knife/Glove", and going by grade alone would paint a
 * knife the same red as an ordinary Covert rifle.
 */
export function rarityKeyForItem(item: InventoryItem): string {
  if (item.category === 'KNIFE' || item.category === 'GLOVES') {
    return 'rare';
  }

  return rarityKey(item.rarity);
}

/**
 * The stickers on the item, in the order Steam returned them.
 *
 * Charms and patches are filtered out: they are applied items too, but
 * they are not stickers and do not scrape.
 *
 * Every unit is its own entry, never grouped by name — five copies of
 * the same sticker can each be scraped differently, and one can be worth
 * several times another.
 */
export function stickersOf(item: InventoryItem): AppliedItem[] {
  return item.applied.filter((a) => a.kind === 'STICKER');
}

/** How many stickers are on the item — charms and patches are not stickers. */
export function stickerCount(item: InventoryItem): number {
  return stickersOf(item).length;
}

/**
 * The charms on the item.
 *
 * CS2 allows one per weapon, but this returns a list like the stickers
 * do: the shape comes from Steam, and a screen that assumes exactly one
 * would drop the second the day Valve allows it.
 */
export function charmsOf(item: InventoryItem): AppliedItem[] {
  return item.applied.filter((a) => a.kind === 'CHARM');
}

/**
 * What to show on hover: the name, plus how scraped it is when that
 * applies and is known.
 *
 * `wear` runs 0 to 1 where 0 is untouched, so it reads as a percentage
 * scraped. Null means either that this kind does not scrape — charms and
 * patches never do — or that the backend could not match a scrape to
 * this particular copy and refused to guess. Saying nothing covers both,
 * and a wrong scrape moves the price.
 */
export function appliedLabel(applied: AppliedItem): string {
  if (applied.wear === null) return applied.name;
  if (applied.wear === 0) return `${applied.name} — untouched`;

  return `${applied.name} — ${Math.round(applied.wear * 100)}% scraped`;
}

/** StatTrak™ is part of the market name, and it is what Steam calls it. */
export function isStatTrak(item: InventoryItem): boolean {
  return item.marketHashName.includes('StatTrak');
}
