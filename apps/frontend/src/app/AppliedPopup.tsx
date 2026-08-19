import { createPortal } from 'react-dom';
import type { AppliedItem } from '@/lib/api';

/**
 * The detail card shown while hovering a sticker or charm badge.
 *
 * Rendered through a portal rather than inside the item card: the card
 * is `overflow-hidden` so its artwork keeps rounded corners, and a
 * popup nested in it would be clipped at the edge — which is exactly
 * where it needs to go.
 *
 * Positioned in viewport coordinates for the same reason, and flipped to
 * the other side of the badge when it would run off the right edge. The
 * badge stacks live at the card's corners, so the sticker column on a
 * card near the right of the grid always would.
 */
export function AppliedPopup({
  applied,
  anchor,
}: {
  applied: AppliedItem;
  /** The badge's rect, in viewport coordinates. */
  anchor: DOMRect;
}) {
  const WIDTH = 240;
  const GAP = 10;

  const fitsRight = anchor.right + GAP + WIDTH < window.innerWidth;
  const left = fitsRight ? anchor.right + GAP : anchor.left - GAP - WIDTH;

  // Kept fully on screen vertically: anchored to the badge's top, then
  // pulled up if the bottom would fall past the fold.
  const ESTIMATED_HEIGHT = 300;
  const top = Math.max(
    8,
    Math.min(anchor.top, window.innerHeight - ESTIMATED_HEIGHT - 8),
  );

  return createPortal(
    <div
      className="fixed z-[100] rounded-lg border overflow-hidden pointer-events-none"
      style={{
        left,
        top,
        width: WIDTH,
        background: '#0f1117',
        borderColor: 'rgba(255,255,255,0.12)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
      }}
    >
      {applied.imageUrl && (
        <div
          className="w-full flex items-center justify-center p-4"
          style={{ background: 'rgba(255,255,255,0.04)', height: 140 }}
        >
          <img
            src={applied.imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}

      <div className="px-3 py-2.5 flex flex-col gap-2">
        {/* The full name, wrapping rather than truncated — the reason to
            open this at all is that the badge could not show it. */}
        <div className="font-display text-sm font-semibold leading-snug" style={{ color: '#e8eaf0' }}>
          {applied.name}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#6c7290' }}>
            Value
          </span>
          {/* No price source is subscribed yet, so there is no value to
              show. An em dash says that; a number here would be invented,
              and this one feeds directly into what a seller asks for the
              weapon. */}
          <span className="font-mono text-xs" style={{ color: '#4a4f68' }}>
            —
          </span>
        </div>

        {/* Charms do not scrape, so the row is absent rather than empty.
            A sticker whose scrape the backend could not match to this
            copy is also absent: it refuses to guess, and a wrong scrape
            moves the price. */}
        {applied.wear !== null && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#6c7290' }}>
              Scraped
            </span>
            <span
              className="font-mono text-xs font-semibold"
              style={{ color: applied.wear === 0 ? '#4ade80' : '#f0c040' }}
            >
              {applied.wear === 0 ? 'Untouched' : `${Math.round(applied.wear * 100)}%`}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
