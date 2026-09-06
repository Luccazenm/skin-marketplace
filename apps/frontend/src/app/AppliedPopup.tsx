import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMoney } from '@/lib/use-currency';
import { createPortal } from 'react-dom';
import type { AppliedItem } from '@/lib/api';

/**
 * How long the pointer has to rest on a badge before the popup opens.
 *
 * Without a delay the popup fires on the way past. The badges sit in a
 * column a few pixels apart, so crossing a card to reach the price
 * flashes up to five popups in a row — the screen reacting to a movement
 * that was never a question.
 *
 * A second is long enough that only a deliberate pause opens it, and
 * short enough that the pause does not feel like waiting.
 */
const HOVER_DELAY_MS = 1000;

interface HoverTarget {
  applied: AppliedItem;
  anchor: DOMRect;
}

/**
 * Hover state for a row or column of applied badges, opening on a pause
 * rather than on contact.
 *
 * Shared rather than written per stack so the delay is one number: the
 * badges appear on the grid card, in the sell panel and in the detail
 * modal, and three copies would drift apart.
 */
export function useAppliedHover() {
  const [detail, setDetail] = useState<HoverTarget | null>(null);
  const timer = useRef<number | null>(null);

  function cancel() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  // A pointer can leave by the badge unmounting — the sell panel drops
  // the row when the item is removed — and a timer left running would
  // then open a popup anchored to something no longer on screen.
  useEffect(() => cancel, []);

  return {
    detail,
    /**
     * Call from onMouseEnter. The rect is read here, synchronously,
     * because `currentTarget` is null by the time the timer fires.
     */
    open(applied: AppliedItem, anchor: DOMRect) {
      cancel();
      timer.current = window.setTimeout(
        () => setDetail({ applied, anchor }),
        HOVER_DELAY_MS,
      );
    },
    /** Call from onMouseLeave. Also drops a pause that never completed. */
    close() {
      cancel();
      setDetail(null);
    },
  };
}

/** What a screen knows about one applied piece, if anything. */
export interface AppliedValue {
  /** What it sells for on its own, in USD. Null where nothing carries it. */
  own: number | null;
  /**
   * What it adds to the item it is on, in USD. Null on screens that have
   * not worked out a suggestion — the grid shows the badges long before
   * anybody opens one.
   *
   * A number, not a formatted string: the popup formats it in the
   * reader's currency like every other figure, and one that arrived
   * pre-formatted would be stuck in dollars.
   */
  adds: number | null;
}

const NOTHING: AppliedValue = { own: null, adds: null };

/**
 * Where the popup gets its numbers.
 *
 * A context rather than a prop because the badges sit three components
 * deep, on two screens, and neither `AppliedBadges` nor `AppliedRow` has
 * any other reason to know what a sticker costs. The default answers
 * nothing, so a screen that has no prices draws the dashes it drew
 * before this existed.
 */
const AppliedValues = createContext<(marketHashName: string) => AppliedValue>(
  () => NOTHING,
);

export const AppliedValueProvider = AppliedValues.Provider;

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
  const { t } = useTranslation();
  const money = useMoney();

  // Read from context rather than passed in: the badges are three
  // components deep in two different screens, and threading a price map
  // through `AppliedBadges` and `AppliedRow` would put a money argument
  // in two components that have no other business with money.
  const { own, adds } = useContext(AppliedValues)(applied.marketHashName);

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

        {/* What it sells for by itself. A dash where no market carries
            it — plenty of old stickers have none — and a dash again on
            screens that never asked for prices, because an absent number
            and an unknown one look the same to whoever is reading. */}
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#6c7290' }}>
            {t('item.value')}
          </span>
          <span
            className="font-mono text-xs font-semibold"
            style={{ color: own ? '#e8eaf0' : '#4a4f68' }}
          >
            {own ? money(own) : '—'}
          </span>
        </div>

        {/* And what it actually adds to the weapon, where that has been
            worked out. The two side by side are the point: a $3,422
            Titan adding $36 is the whole lesson about applied stickers,
            and it needs no sentence. */}
        {adds != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#6c7290' }}>
              {t('item.addsHere')}
            </span>
            <span className="font-mono text-xs font-semibold" style={{ color: '#4ade80' }}>
              +{money(adds)}
            </span>
          </div>
        )}

        {/* Charms do not scrape, so the row is absent rather than empty.
            A sticker whose scrape the backend could not match to this
            copy is also absent: it refuses to guess, and a wrong scrape
            moves the price. */}
        {applied.wear !== null && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#6c7290' }}>
              {t('item.scraped')}
            </span>
            <span
              className="font-mono text-xs font-semibold"
              style={{ color: '#f0c040' }}
            >
              {applied.wear === 0 ? t('item.untouched') : `${Math.round(applied.wear * 100)}%`}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
