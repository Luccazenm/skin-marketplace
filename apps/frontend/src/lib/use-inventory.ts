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
 * Steam's rarity names ("Classified") mapped onto the palette's keys
 * ("classified").
 *
 * Anything unrecognised falls back to the neutral tone rather than
 * throwing: a new rarity from Valve should make an item look plain, not
 * make the page fail to render.
 */
export function rarityKey(rarity: string | null): string {
  if (!rarity) return 'consumer';

  const key = rarity.toLowerCase();
  const known = [
    'consumer',
    'industrial',
    'milspec',
    'restricted',
    'classified',
    'covert',
    'rare',
  ];

  if (key.includes('mil-spec')) return 'milspec';
  return known.find((k) => key.includes(k)) ?? 'consumer';
}

/** How many stickers are on the item — charms and patches are not stickers. */
export function stickerCount(item: InventoryItem): number {
  return item.applied.filter((a) => a.kind === 'STICKER').length;
}

/** StatTrak™ is part of the market name, and it is what Steam calls it. */
export function isStatTrak(item: InventoryItem): boolean {
  return item.marketHashName.includes('StatTrak');
}
