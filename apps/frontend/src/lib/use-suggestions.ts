import { useEffect, useState } from 'react';
import { getSuggestions, type Suggestion } from './api';

/** A NUL, for the same reason `use-prices` uses one: ids are opaque. */
const SEPARATOR = String.fromCharCode(0);

/**
 * Suggested prices for a set of items you own, and what a trade would
 * credit for each.
 *
 * One request for the whole set. The Trade screen values an inventory
 * of two hundred, and a hook that asked per item would be two hundred
 * round trips for a screen that opens in a second.
 *
 * Keyed on the sorted set of ids, so re-sorting or re-rendering the
 * grid does not re-fetch.
 */
export function useSuggestions(assetIds: string[]): {
  suggestions: Record<string, Suggestion>;
  loading: boolean;
} {
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [loading, setLoading] = useState(false);

  const key = [...new Set(assetIds)].sort().join(SEPARATOR);

  useEffect(() => {
    const ids = key.length > 0 ? key.split(SEPARATOR) : [];

    if (ids.length === 0) {
      setSuggestions({});
      return;
    }

    let current = true;
    setLoading(true);

    getSuggestions(ids)
      .then((result) => {
        if (current) setSuggestions(result);
      })
      .catch(() => {
        // No suggestion is a state the screens already draw — an item no
        // market carries has none either. Failing loudly would replace a
        // working grid with an error over a figure that is advice.
        if (current) setSuggestions({});
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      // The set changed before this landed.
      current = false;
    };
  }, [key]);

  return { suggestions, loading };
}
