import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getInventory,
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
  reload: () => Promise<void>;
}

/**
 * The user's Steam inventory, read live through the backend.
 *
 * Nothing is cached here on purpose: the backend already caches for two
 * minutes and holds a global limiter, because Steam limits that endpoint
 * per IP and the IP is the server's. A second cache in the browser would
 * only add a way for the two to disagree.
 */
export function useInventory(enabled: boolean): InventoryState {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failure, setFailure] = useState<InventoryFailure | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setFailure('signed_out');
      setFailureMessage(null);
      return;
    }

    setLoading(true);

    try {
      setData(await getInventory());
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

  return {
    data,
    items: data?.items ?? [],
    loading,
    failure,
    failureMessage,
    reload: load,
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

/** How many stickers are on the item — charms and patches are not stickers. */
export function stickerCount(item: InventoryItem): number {
  return item.applied.filter((a) => a.kind === 'STICKER').length;
}

/** StatTrak™ is part of the market name, and it is what Steam calls it. */
export function isStatTrak(item: InventoryItem): boolean {
  return item.marketHashName.includes('StatTrak');
}
