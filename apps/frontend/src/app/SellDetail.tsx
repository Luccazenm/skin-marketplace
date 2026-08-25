import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { X, Package } from 'lucide-react';
import type { InventoryItem, ItemPrice } from '@/lib/api';
import { AppliedPopup, useAppliedHover } from './AppliedPopup';
import { payoutAfterFee, toCents, usd } from '@/lib/money';
import { rarityStyle } from '@/lib/rarity';
import { usePrices } from '@/lib/use-prices';
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
  market,
  onPriceChange,
  feePercent,
  isListed,
  onList,
  onClose,
}: {
  item: InventoryItem;
  price: string;
  /** The market's price for the skin itself. Absent when it has none. */
  market: ItemPrice | undefined;
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

  // Each applied piece priced as what it is: an item of its own, with
  // its own market. Asked for here rather than by the grid, because a
  // grid of two hundred weapons carries a thousand stickers and nobody
  // is looking at them until they open one.
  const applied = [...charms, ...stickers];
  const appliedMarket = usePrices(applied.map((a) => a.marketHashName));

  const appliedTotal = applied.reduce(
    (sum, a) => sum + (appliedMarket.prices[a.marketHashName]?.ask ?? 0),
    0,
  );

  /**
   * The stickers are worth at least as much as the skin they are on.
   *
   * Not a valuation — it is the question of which half of the item the
   * recommendation describes. The number below prices the skin alone, so
   * on an AK-47 Blue Laminate carrying $5,821 of Katowice stickers it
   * reads $30.80, and a button that fills that in with one click is a
   * way to lose thousands by accident. Above this line the suggestion
   * stops being offered and says why.
   *
   * The real answer is the capped `base + stickers + charm` suggestion,
   * which needs a transfer rate per sticker and is not written yet.
   * Until it is, refusing to suggest beats suggesting the wrong half.
   */
  const appliedDominates = market !== undefined && appliedTotal >= market.ask;

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

            {applied.length > 0 && (
              <div className="px-5 pb-5">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: r.color }}>
                    Applied
                  </span>
                  {/* The sum of what these pieces sell for on their own.
                      Said in those words on the line below, because the
                      number is meaningless without them: it is not what
                      the weapon is worth, and on a Katowice rifle it can
                      be twenty times the skin. */}
                  {appliedTotal > 0 && (
                    <span className="font-mono text-[10px]" style={{ color: '#9da3c0' }}>
                      {usd(appliedTotal)} on their own
                    </span>
                  )}
                </div>
                {/* No names here: five copies of one sticker would be
                    five identical lines of truncated text, and the image
                    already says which it is. The full name is on hover,
                    in the same popup the grid card uses. */}
                <div className="flex flex-wrap gap-2">
                  {applied.map((piece, i) => {
                    const own = appliedMarket.prices[piece.marketHashName];

                    return (
                      <div
                        key={`${piece.position}-${i}`}
                        onMouseEnter={(e) =>
                          hover.open(piece, e.currentTarget.getBoundingClientRect())
                        }
                        onMouseLeave={hover.close}
                        className="flex flex-col items-center gap-1 p-2 rounded"
                        style={{ background: 'rgba(255,255,255,0.04)', width: 72 }}
                      >
                        <div className="w-12 h-12 flex items-center justify-center">
                          {piece.imageUrl && (
                            <img src={piece.imageUrl} alt={piece.name} className="max-h-full max-w-full object-contain" />
                          )}
                        </div>
                        {/* Charms do not scrape, and a sticker the backend
                            could not match a scrape to has none either — so
                            the line is absent rather than empty. */}
                        {piece.wear !== null && (
                          <div className="font-mono text-[9px] font-semibold" style={{ color: '#f0c040' }}>
                            {piece.wear === 0 ? 'Untouched' : `${Math.round(piece.wear * 100)}%`}
                          </div>
                        )}
                        {/* What this piece sells for by itself. A dash
                            where no market carries it — plenty of old
                            stickers have none, and a zero would read as
                            worthless rather than as unlisted. */}
                        <div
                          className="font-mono text-[9px] font-semibold"
                          style={{ color: own ? '#e8eaf0' : '#4a4f68' }}
                        >
                          {own ? usd(own.ask) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* The sentence that stops someone reading the total
                    above as their rifle's price. Both halves are true and
                    they point opposite ways, which is exactly why both
                    are here: a sticker mostly dies on the gun, a charm
                    comes off whole. */}
                <div className="font-mono text-[10px] leading-relaxed mt-2" style={{ color: '#6c7290' }}>
                  {stickers.length > 0 && (
                    <div>
                      Stickers are destroyed when removed, so only a small
                      part of that reaches what the weapon sells for.
                    </div>
                  )}
                  {charms.length > 0 && (
                    <div>
                      A charm comes off intact and can be sold on its own.
                    </div>
                  )}
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
              {/* The frame, with nothing in it yet. Every price read on
                  this screen is being stored, so the series is being
                  built from today forward — but nobody can build one
                  backwards, and drawing a line through four hours of
                  readings and calling it 30 days would be a lie with a
                  chart around it. */}
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
                    Building the series — not enough days yet
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
              {/* Listings standing on the market, not sales — depth, not
                  turnover. Forty thousand of a case says it will always
                  sell; twenty-five of a knife says the next price is
                  whatever the next buyer feels like. */}
              <Row
                label="Listings"
                value={
                  market?.askVolume != null
                    ? market.askVolume.toLocaleString('en-US')
                    : '—'
                }
                muted={market?.askVolume == null}
              />
              {/* What someone is offering to pay right now, against what
                  someone is asking. The gap between the two is how fast
                  the item moves, and it is the number a seller wants
                  before deciding what to charge. */}
              <Row
                label="Highest bid"
                value={market?.bid != null ? usd(market.bid) : '—'}
                muted={market?.bid == null}
              />
            </div>

            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[11px]" style={{ color: '#6c7290' }}>Recommended</span>
                <span
                  className="font-mono text-sm font-semibold"
                  style={{ color: market ? '#e8eaf0' : '#4a4f68' }}
                >
                  {market ? usd(market.ask) : '—'}
                </span>
              </div>

              {market ? (
                <>
                  {appliedDominates ? (
                    /* Loud, and where the button was: this is the one
                       place on the screen someone can lose a lot of
                       money in a single click, and a grey footnote under
                       a bright number is not a warning. */
                    <div
                      className="rounded px-2.5 py-2 font-mono text-[10px] leading-relaxed"
                      style={{
                        background: 'rgba(232,64,96,0.08)',
                        border: '1px solid rgba(232,64,96,0.25)',
                        color: '#f0a0b0',
                      }}
                    >
                      What is on this is worth more than the skin itself —
                      {' '}{usd(appliedTotal)} against {usd(market.ask)}. We
                      do not price applied stickers yet, so there is no
                      suggestion here worth taking. Set this one yourself.
                    </div>
                  ) : (
                    /* Offered, never applied for you. The seller sets the
                       number on this screen — a price that filled itself
                       in is one nobody chose. */
                    <button
                      onClick={() => onPriceChange(market.ask.toFixed(2))}
                      className="w-full py-1.5 rounded font-mono text-[10px] uppercase tracking-wider transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#9da3c0',
                      }}
                    >
                      Use this price
                    </button>
                  )}

                  {/* Where it came from and how old it is. A price with
                      neither is an assertion, and the first question from
                      anyone who disagrees with one is which market. */}
                  <div className="font-mono text-[10px] leading-relaxed mt-2" style={{ color: '#4a4f68' }}>
                    Lowest listing on {market.market}, {freshness(market.quotedAt)}.
                    {stickers.length > 0 && !appliedDominates && (
                      <> This is the skin alone — the stickers on it are not counted.</>
                    )}
                  </div>
                </>
              ) : (
                <div className="font-mono text-[10px] leading-relaxed" style={{ color: '#4a4f68' }}>
                  No market carries this one, so there is nothing to
                  compare against. The price is yours to decide.
                </div>
              )}
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

/**
 * How long ago the market was measured, in words.
 *
 * Deliberately vague past the first hour: the difference between three
 * and four minutes decides whether a price is worth acting on, the
 * difference between nine and ten hours does not.
 */
function freshness(quotedAt: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(quotedAt).getTime()) / 1000),
  );

  if (seconds < 90) return 'measured just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `measured ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `measured ${hours}h ago`;

  return `measured ${Math.round(hours / 24)}d ago`;
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
