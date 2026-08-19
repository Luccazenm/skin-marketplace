import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';

/**
 * Sort options for a page listing items the user owns.
 *
 * No "Discount": that compares a listing against a market reference, and
 * an item sitting in someone's Steam inventory has neither. Offering it
 * would be a control that does nothing.
 *
 * No "Newest" or "Oldest" either. Steam's inventory order is not an age,
 * and neither is ours — the assetId changes on every trade, so anything
 * derived from it would sort by "when it last moved between accounts",
 * which is not what the label promises.
 */
export const SELL_SORTS = [
  'Default',
  'Highest Price',
  'Lowest Price',
  'Highest Float',
  'Lowest Float',
];

export const TRADE_SORTS = [...SELL_SORTS, 'Discount'];

/** The compact sort control used beside a search field. */
export function MiniSortDropdown({
  value,
  onChange,
  options = TRADE_SORTS,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* The same box as the buttons beside it — gap, padding, radius and
          border all matched. Two controls sitting side by side at
          different heights read as a mistake, and here the difference was
          only that this one had no text to set the line height. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-xs transition-colors"
        style={{
          background: open ? 'rgba(240,192,64,0.1)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open ? 'rgba(240,192,64,0.3)' : 'rgba(255,255,255,0.08)'}`,
          color: value !== 'Default' ? '#f0c040' : '#9da3c0',
        }}
        title="Sort"
      >
        <SlidersHorizontal className="w-3 h-3 flex-shrink-0" />
        {/* Naming the current sort rather than hiding it behind an icon:
            the order items appear in is not self-evident from looking at
            them, so without the label the only way to know what is
            applied is to open the menu. */}
        {value}
        <ChevronDown
          className="w-2.5 h-2.5 flex-shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}
        />
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 rounded overflow-hidden"
          style={{ background: '#10121a', border: '1px solid rgba(255,255,255,0.08)', minWidth: '140px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
        >
          {options.map((s) => (
            <button
              key={s}
              onClick={() => { onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 font-mono text-xs flex items-center justify-between gap-3 transition-colors"
              style={{ background: value === s ? 'rgba(240,192,64,0.08)' : 'transparent', color: value === s ? '#f0c040' : '#9da3c0' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = value === s ? 'rgba(240,192,64,0.12)' : 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = value === s ? 'rgba(240,192,64,0.08)' : 'transparent')}
            >
              {s}
              {value === s && <Check className="w-3 h-3 flex-shrink-0" style={{ color: '#f0c040' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
