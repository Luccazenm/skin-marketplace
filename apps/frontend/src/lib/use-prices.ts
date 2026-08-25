import { useEffect, useState } from 'react';
import { getPrices, type ItemPrice } from './api';

/**
 * Joins the names into the cache key.
 *
 * A NUL, not a space or a comma: "AK-47 | Redline (Field-Tested)"
 * contains both, and splitting on either would hand the API a hundred
 * fragments instead of four names. Written this way rather than as an
 * escape so it survives every editor and encoding between here and the
 * repository.
 */
const SEPARATOR = String.fromCharCode(0);

export interface PricesState {
  /** Keyed by market hash name. A name with no price is absent. */
  prices: Record<string, ItemPrice>;
  /** True while the first read for the current set is in flight. */
  loading: boolean;
}

/**
 * Market prices for a set of items.
 *
 * **Deliberately separate from loading the items themselves.** The grid
 * draws as soon as Steam answers and the numbers arrive behind it; asking
 * for both at once would hold two hundred cards back for a figure that
 * is decoration until somebody decides to sell.
 *
 * The request is keyed on the sorted set of names rather than the array,
 * so re-sorting the grid or re-rendering does not re-fetch. The backend
 * caches for five minutes anyway, but a request that changes nothing is
 * still a request.
 */
export function usePrices(marketHashNames: string[]): PricesState {
  const [prices, setPrices] = useState<Record<string, ItemPrice>>({});
  const [loading, setLoading] = useState(false);

  const key = [...new Set(marketHashNames)].sort().join(SEPARATOR);

  useEffect(() => {
    const names = key.length > 0 ? key.split(SEPARATOR) : [];

    if (names.length === 0) {
      setPrices({});
      return;
    }

    let current = true;
    setLoading(true);

    getPrices(names)
      .then((result) => {
        if (current) setPrices(result);
      })
      .catch(() => {
        // No prices is a state the screens already draw — an item with
        // no market is ordinary. Failing loudly here would replace a
        // working grid with an error over a number nobody asked for yet.
        if (current) setPrices({});
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      // The set changed before this landed. Writing the old answer would
      // show prices for items no longer on screen.
      current = false;
    };
  }, [key]);

  return { prices, loading };
}
