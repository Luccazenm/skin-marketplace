import { useState } from 'react';
import { X, Package } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import type { AppliedItem, InventoryItem } from '@/lib/api';
import { AppliedPopup, useAppliedHover } from './AppliedPopup';
import { payoutAfterFee, toCents } from '@/lib/money';
import { rarityStyle } from '@/lib/rarity';
import {
  charmsOf,
  isStatTrak,
  rarityKeyForItem,
  stickersOf,
} from '@/lib/use-inventory';

/**
 * The item detail, opened from the Sell grid.
 *
 * It mirrors the storefront's detail layout on purpose, so that filling
 * in the missing halves later is a matter of supplying data rather than
 * rebuilding the screen.
 *
 * **Every slot that has no data says so.** No price source is
 * subscribed, so the price, the market volume, the recommended price and
 * the 30-day history have nothing behind them, and each shows that
 * plainly instead of a number. The storefront's version of this screen
 * fills those with invented figures — $3.38 a sticker, a hardcoded
 * history array, a "pattern" derived from the float — and none of that
 * is carried over here.
 */
export function SellDetail({
  item,
  price,
  onPriceChange,
  feePercent,
  isListed,
  onList,
  onClose,
}: {
  item: InventoryItem;
  price: string;
  onPriceChange: (price: string) => void;
  /** From GET /api/config, never assumed. */
  feePercent: number | null;
  isListed: boolean;
  onList: () => void;
  onClose: () => void;
}) {
  const r = rarityStyle(rarityKeyForItem(item));
  const stickers = stickersOf(item);
  const charms = charmsOf(item);

  const hover = useAppliedHover();

  const priced = toCents(price) !== null && toCents(price)! > 0;
  const payout =
    priced && feePercent !== null ? payoutAfterFee(price, feePercent) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-lg border overflow-hidden flex flex-col"
        style={{ background: '#0f1117', borderColor: 'rgba(255,255,255,0.1)', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: 'rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isStatTrak(item) && (
              <span
                className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: 'rgba(240,192,64,0.2)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.3)' }}
              >
                ST
              </span>
            )}
            <h2 className="font-display text-lg font-bold truncate" style={{ color: '#e8eaf0' }}>
              {item.catalog?.weapon
                ? `${item.catalog.weapon} | ${item.catalog.skinName ?? ''}`
                : item.marketHashName}
              {item.exterior && (
                <span className="font-mono text-sm font-normal ml-2" style={{ color: '#6c7290' }}>
                  ({item.exterior})
                </span>
              )}
            </h2>
          </div>
          <button onClick={onClose} className="flex-shrink-0 ml-3">
            <X className="w-5 h-5" style={{ color: '#9da3c0' }} />
          </button>
        </div>

        <div className="h-0.5 flex-shrink-0" style={{ background: r.color }} />

        <div className="flex flex-col md:flex-row min-h-0 overflow-y-auto">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-center p-8" style={{ minHeight: 200 }}>
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="max-h-48 max-w-full object-contain" />
              ) : (
                <Package className="w-16 h-16" style={{ color: r.color, opacity: 0.4 }} />
              )}
            </div>

            {(stickers.length > 0 || charms.length > 0) && (
              <div className="px-5 pb-5">
                <div className="font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: r.color }}>
                  Applied
                </div>
                {/* No names here: five copies of one sticker would be
                    five identical lines of truncated text, and the image
                    already says which it is. The full name is on hover,
                    in the same popup the grid card uses. */}
                <div className="flex flex-wrap gap-2">
                  {[...charms, ...stickers].map((applied, i) => (
                    <div
                      key={`${applied.slot}-${i}`}
                      onMouseEnter={(e) =>
                        hover.open(applied, e.currentTarget.getBoundingClientRect())
                      }
                      onMouseLeave={hover.close}
                      className="flex flex-col items-center gap-1 p-2 rounded"
                      style={{ background: 'rgba(255,255,255,0.04)', width: 64 }}
                    >
                      <div className="w-12 h-12 flex items-center justify-center">
                        {applied.imageUrl && (
                          <img src={applied.imageUrl} alt={applied.name} className="max-h-full max-w-full object-contain" />
                        )}
                      </div>
                      {/* Charms do not scrape, and a sticker the backend
                          could not match a scrape to has none either — so
                          the line is absent rather than empty. */}
                      {applied.wear !== null && (
                        <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0c040' }}>
                          {applied.wear === 0 ? 'Untouched' : `${Math.round(applied.wear * 100)}%`}
                        </div>
                      )}
                      {/* The slot the value will occupy. Empty until a
                          price source is subscribed — a sticker's worth
                          is most of what a stickered weapon is worth. */}
                      <div className="font-mono text-[9px]" style={{ color: '#4a4f68' }}>—</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 pb-5">
              <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: r.color }}>
                History
              </div>
              <div className="font-mono text-[9px] uppercase tracking-wider mb-3" style={{ color: '#6c7290' }}>
                30-day price history
              </div>
              {/* The frame, with nothing in it. Kept so the shape of the
                  screen is settled before the data arrives, and left
                  visibly empty so nobody mistakes a placeholder line for
                  a real series. */}
              <div className="relative" style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[]}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#3a3f55' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#3a3f55' }} axisLine={false} tickLine={false} width={28} />
                    <Line type="monotone" dataKey="price" stroke={r.color} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-[10px]" style={{ color: '#4a4f68' }}>
                    No price history yet
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            className="w-full md:w-72 flex-shrink-0 flex flex-col"
            style={{ borderLeft: '1px solid rgba(255,255,255,0.07)' }}
          >
            {item.float !== null && (
              <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                {/* The bar spans 0 to 1, so the marker sits at the float
                    itself. Clamped only so a value outside that range
                    cannot push the pointer off the bar — Steam should
                    never send one, and if it does, a pointer pinned to
                    the end is a better answer than one in the margin. */}
                <div className="relative w-full mb-2" style={{ paddingTop: 7 }}>
                  <div
                    className="absolute"
                    style={{
                      left: `${Math.min(Math.max(item.float, 0), 1) * 100}%`,
                      top: 0,
                      transform: 'translateX(-50%)',
                      width: 0,
                      height: 0,
                      borderLeft: '4px solid transparent',
                      borderRight: '4px solid transparent',
                      borderTop: '5px solid #e8eaf0',
                    }}
                  />
                  <div
                    className="w-full h-1.5 rounded-full"
                    style={{ background: 'linear-gradient(90deg,#4ade80,#f0c040,#f87171,#7f1d1d)' }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px]" style={{ color: '#6c7290' }}>Float</span>
                  {/* All ten decimals: this is the number that separates
                      one copy of a skin from another, and rounding it
                      loses exactly what makes it worth more. */}
                  <span className="font-mono text-[11px] font-semibold" style={{ color: '#e8eaf0' }}>
                    {item.float.toFixed(10)}
                  </span>
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-b flex flex-col gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Row label="Rarity" value={item.rarity ?? '—'} color={r.color} />
              {item.exterior && <Row label="Wear" value={item.exterior} />}
              {/* The real paint seed. The storefront derives a "pattern"
                  from the float, which is not what a pattern is — this
                  one comes from Steam. */}
              {item.paintSeed !== null && <Row label="Pattern" value={String(item.paintSeed)} />}
              <Row label="Volume" value="—" muted />
            </div>

            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[11px]" style={{ color: '#6c7290' }}>Recommended</span>
                <span className="font-mono text-sm" style={{ color: '#4a4f68' }}>—</span>
              </div>
              <div className="font-mono text-[10px] leading-relaxed" style={{ color: '#4a4f68' }}>
                Waiting on a market price source. Until then this is yours
                to decide.
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#6c7290' }}>
                  Your price
                </div>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs" style={{ color: '#6c7290' }}>$</span>
                  <input
                    value={price}
                    onChange={(e) => onPriceChange(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    autoFocus
                    className="w-full pl-6 pr-2 py-2 rounded font-mono text-sm font-semibold focus:outline-none"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${price && !priced ? '#e84060' : 'rgba(255,255,255,0.1)'}`,
                      color: '#e8eaf0',
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#6c7290' }}>
                  You receive
                  {feePercent !== null && (
                    <span style={{ color: '#4a4f68' }}> · after {feePercent}% fee</span>
                  )}
                </div>
                <div
                  className="w-full px-2.5 py-2 rounded font-mono text-sm font-semibold"
                  style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: payout ? '#4ade80' : '#4a4f68' }}
                >
                  {payout ? `$${payout}` : '—'}
                </div>
              </div>

              <button
                onClick={onList}
                disabled={!priced}
                className="w-full py-2.5 rounded font-display text-sm font-bold tracking-wide transition-opacity disabled:opacity-40"
                style={{
                  background: isListed ? 'rgba(255,255,255,0.08)' : '#f0c040',
                  color: isListed ? '#e8eaf0' : '#08090d',
                }}
              >
                {isListed ? 'REMOVE FROM LIST' : 'LIST ITEM'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {hover.detail && <AppliedPopup applied={hover.detail.applied} anchor={hover.detail.anchor} />}
    </div>
  );
}

function Row({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px]" style={{ color: '#6c7290' }}>{label}</span>
      <span
        className="font-mono text-[11px] font-semibold"
        style={{ color: muted ? '#4a4f68' : (color ?? '#e8eaf0') }}
      >
        {value}
      </span>
    </div>
  );
}
