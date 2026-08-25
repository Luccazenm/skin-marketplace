import { useEffect, useState } from 'react';
import { getSuggestion, type Suggestion } from './api';

/**
 * The suggested asking price for one item.
 *
 * Asked for by asset id and nothing else — the backend reads the skin,
 * the stickers and their scrape from the inventory it already holds for
 * this session, so nothing about the number comes from here.
 *
 * One item at a time on purpose: this only runs when a detail is open,
 * which is one item by definition, and the alternative would price a
 * thousand stickers for a grid nobody has opened.
 */
export function useSuggestion(assetId: string | null): {
  suggestion: Suggestion | null;
  loading: boolean;
} {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (assetId === null) {
      setSuggestion(null);
      return;
    }

    let current = true;
    setLoading(true);
    // Cleared rather than left standing: the previous item's number on a
    // new item is worse than no number at all.
    setSuggestion(null);

    getSuggestion(assetId)
      .then((result) => {
        if (current) setSuggestion(result);
      })
      .catch(() => {
        // A missing suggestion is a state the screen already draws — an
        // item no market carries has none either. Failing loudly would
        // replace a working detail with an error over a figure that is
        // advice.
        if (current) setSuggestion(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      // A different item was opened before this landed.
      current = false;
    };
  }, [assetId]);

  return { suggestion, loading };
}
