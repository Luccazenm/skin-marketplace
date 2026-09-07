import { Fragment, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { useTranslation } from 'react-i18next';
import { X, Package } from 'lucide-react';
import type { InventoryItem, ItemPrice } from '@/lib/api';
import {
  AppliedPopup,
  AppliedValueProvider,
  useAppliedHover,
  type AppliedValue,
} from './AppliedPopup';
import { fromCents, payoutAfterFee, toCents, usd } from '@/lib/money';
import { rarityStyle } from '@/lib/rarity';
import { useSuggestion } from '@/lib/use-suggestion';
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
 * **Every slot that has no data says so.** The prices are real now, but
 * an item no market carries still has none, and the 30-day history is
 * still being collected — each says that plainly instead of showing a
 * number. The storefront's version of this screen fills those with
 * invented figures — $3.38 a sticker, a hardcoded history array, a
 * "pattern" derived from the float — and none of that is carried over.
 */
export function SellDetail({
  item,
  price,
  market,
  onPriceChange,
  feePercent,
  minimumCents,
  isListed,
  onList,
  onInstantSell,
  instantSellNotice,
  onClose,
}: {
  item: InventoryItem;
  price: string;
  /** The market's price for the skin itself. Absent when it has none. */
  market: ItemPrice | undefined;
  onPriceChange: (price: string) => void;
  /** Sell it to the platform now, at the offer on the button. */
  onInstantSell: (amount: string) => void;
  /** Shown under the button when the sale could not be started. */
  instantSellNotice: string | null;
  /** From GET /api/config, never assumed. */
  feePercent: number | null;
  /**
   * The lowest price the backend will accept, in cents. Also from the
   * config: it is derived from the commission there, and a copy here
   * would let this screen offer a price the server refuses.
   */
  minimumCents: number;
  isListed: boolean;
  onList: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Starts on the history, which is the slot the design has always had
  // here. The description is the other half of the same panel rather
  // than a second one below it: both answer "what am I looking at",
  // and stacking them would push the price out of view.
  const [tab, setTab] = useState<'history' | 'description'>('history');

  const r = rarityStyle(rarityKeyForItem(item));
  const stickers = stickersOf(item);
  const charms = charmsOf(item);

  const applied = [...charms, ...stickers];

  // The suggestion is computed by the backend, from the item in the
  // inventory rather than from anything on this screen: the transfer
  // rates, the scrape and the cap are money rules, and money rules in a
  // browser are rules a browser can argue with. Asked for here rather
  // than by the grid — it is one request per opened item, not one per
  // card in a grid of two hundred.
  const { suggestion } = useSuggestion(item.assetId);

  const breakdown =
    suggestion && suggestion.suggested !== null ? suggestion : null;

  /** What each piece adds, keyed by name, for the labels on the images. */
  const parts = new Map(
    (breakdown?.applied ?? []).map((a) => [a.marketHashName, a]),
  );

  /**
   * What the popup says about a piece on this item: its own price, and
   * what the suggestion above worked out that it adds here. The second
   * half is the reason the modal supplies this rather than the grid —
   * the grid has no suggestion to quote from.
   */
  const valueOf = (marketHashName: string): AppliedValue => {
    const part = parts.get(marketHashName);

    return {
      own: part?.own == null ? null : Number(part.own),
      adds: part == null ? null : Number(part.adds),
    };
  };

  const hover = useAppliedHover();

  const cents = toCents(price);
  const priced = cents !== null && cents >= minimumCents;

  /**
   * Typed something, and it is not enough. Kept apart from "typed
   * nothing yet" so an empty field is not an error and a rejected one
   * says why — the alternative is a LIST ITEM button that refuses to
   * light up and never explains itself.
   */
  const tooLow = cents !== null && cents > 0 && cents < minimumCents;

  const payout =
    priced && feePercent !== null ? payoutAfterFee(price, feePercent) : null;

  return (
    <AppliedValueProvider value={valueOf}>
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
                  ({t(`wear.${item.exterior}`, { defaultValue: item.exterior })})
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
                <div className="font-mono text-[12px] uppercase tracking-wider mb-2" style={{ color: r.color }}>
                  {t('item.applied')}
                </div>
                {/* No names here: five copies of one sticker would be
                    five identical lines of truncated text, and the image
                    already says which it is. The full name is on hover,
                    in the same popup the grid card uses. */}
                <div className="flex flex-wrap gap-2">
                  {applied.map((piece, i) => {
                    const part = parts.get(piece.marketHashName);

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
                          <div className="font-mono text-[11px] font-semibold" style={{ color: '#f0c040' }}>
                            {piece.wear === 0 ? t('item.untouched') : `${Math.round(piece.wear * 100)}%`}
                          </div>
                        )}
                        {/* What this piece sells for by itself. A dash
                            where no market carries it — plenty of old
                            stickers have none, and a zero would read as
                            worthless rather than as unlisted. */}
                        <div
                          className="font-mono text-[11px] font-semibold"
                          style={{ color: part?.own ? '#e8eaf0' : '#4a4f68' }}
                        >
                          {part?.own ? usd(Number(part.own)) : '—'}
                        </div>

                        {/* And what it actually adds to this weapon,
                            underneath, in green — the two numbers side by
                            side are the whole argument. A $3,422 Titan
                            adding $60 says more than any sentence about
                            transfer rates could. */}
                        {part && (
                          <div className="font-mono text-[11px] font-semibold" style={{ color: '#4ade80' }}>
                            +{usd(Number(part.adds))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="px-5 pb-5">
              {/* Two headings, not two buttons in a box: they sit where
                  the single "HISTORY" label sat, and the separator is
                  the whole affordance. The inactive one is dimmed to the
                  colour every muted label on this screen uses, so the
                  pair reads as one line with one of them chosen. */}
              <div className="flex items-center gap-2 mb-1">
                {(['history', 'description'] as const).map((name, i) => (
                  <Fragment key={name}>
                    {i > 0 && (
                      <span
                        className="font-mono text-[12px]"
                        style={{ color: '#3a3f55' }}
                        aria-hidden
                      >
                        /
                      </span>
                    )}
                    <button
                      onClick={() => setTab(name)}
                      aria-pressed={tab === name}
                      className="font-mono text-[12px] uppercase tracking-wider transition-colors cursor-pointer"
                      style={{ color: tab === name ? r.color : '#4a4f68' }}
                    >
                      {t(`item.${name}`)}
                    </button>
                  </Fragment>
                ))}
              </div>

              {tab === 'history' ? (
                <>
                  <div className="font-mono text-[11px] uppercase tracking-wider mb-3" style={{ color: '#6c7290' }}>
                    {t('item.priceHistory')}
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
                      <span className="font-mono text-[12px]" style={{ color: '#4a4f68' }}>
                        {t('item.buildingSeries')}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <Description
                  text={item.catalog?.description ?? null}
                  flavor={item.catalog?.flavorText ?? null}
                  emptyLabel={t('item.noDescription')}
                />
              )}
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
                  <span className="font-mono text-[13px]" style={{ color: '#6c7290' }}>Float</span>
                  {/* All ten decimals: this is the number that separates
                      one copy of a skin from another, and rounding it
                      loses exactly what makes it worth more. */}
                  <span className="font-mono text-[13px] font-semibold" style={{ color: '#e8eaf0' }}>
                    {item.float.toFixed(10)}
                  </span>
                </div>
              </div>
            )}

            <div className="px-5 py-4 border-b flex flex-col gap-2" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Row
                label={t('item.rarity')}
                value={
                  item.rarity
                    ? t(`rarity.${rarityKeyForItem(item)}`, { defaultValue: item.rarity })
                    : '—'
                }
                color={r.color}
              />
              {item.exterior && (
                <Row
                  label={t('item.wear')}
                  value={t(`wear.${item.exterior}`, { defaultValue: item.exterior })}
                />
              )}
              {/* The real paint seed. The storefront derives a "pattern"
                  from the float, which is not what a pattern is — this
                  one comes from Steam. */}
              {item.paintSeed !== null && <Row label="Pattern" value={String(item.paintSeed)} />}
            </div>

            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[13px]" style={{ color: '#6c7290' }}>{t('item.recommended')}</span>
                <span
                  className="font-mono text-base font-semibold"
                  style={{ color: breakdown ? '#e8eaf0' : '#4a4f68' }}
                >
                  {breakdown ? usd(Number(breakdown.suggested)) : '—'}
                </span>
              </div>

              {/* What the number is made of. The whole reason it is
                  itemised: a seller looking at four Katowice stickers
                  needs to see that the rifle is $30 of the total and the
                  stickers are $61, not $5,821 — and a single figure says
                  none of that. */}
              {/* Hidden when the floor lifted the price: the parts add up
                  to what the item is worth, and the number above them is
                  the platform's minimum instead. A breakdown that does
                  not sum to the figure it sits under is worse than no
                  breakdown — the whole reason it is itemised is that the
                  arithmetic is checkable. */}
              {breakdown && !breakdown.atMinimum && applied.length > 0 && (
                <div className="flex flex-col gap-1 mb-3">
                  <Part label={t('sell.part.skin')} value={usd(Number(breakdown.base))} />
                  {Number(breakdown.stickers) > 0 && (
                    <Part
                      label={t('sell.part.stickers')}
                      value={`+${usd(Number(breakdown.stickers))}`}
                    />
                  )}
                  {Number(breakdown.charms) > 0 && (
                    <Part label={t('sell.part.charm')} value={`+${usd(Number(breakdown.charms))}`} />
                  )}
                </div>
              )}

              {market ? (
                <InstantSell
                  buyout={market.buyout}
                  onSell={onInstantSell}
                  notice={instantSellNotice}
                />
              ) : (
                <div className="font-mono text-[12px] leading-relaxed" style={{ color: '#4a4f68' }}>
                  {t('sell.noMarket')}
                </div>
              )}
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              <div>
                <div className="font-mono text-[12px] uppercase tracking-wider mb-1.5" style={{ color: '#6c7290' }}>
                  {t('sell.yourPrice')}
                </div>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: '#6c7290' }}>$</span>
                  {/* The border is set inline and changes colour on an
                      invalid price, so hover and focus are a ring
                      instead — a separate shadow that composes with it
                      rather than fighting it.

                      Focus had no mark at all before this: `outline-none`
                      with nothing put back, on the one field somebody has
                      to type a number into. */}
                  <input
                    value={price}
                    onChange={(e) => onPriceChange(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    autoFocus
                    className="w-full pl-6 pr-2 py-2 rounded font-mono text-base font-semibold transition-shadow focus:outline-none hover:ring-1 hover:ring-white/20 focus:ring-2 focus:ring-[#f0c040]/50"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${price && !priced ? '#e84060' : 'rgba(255,255,255,0.1)'}`,
                      color: '#e8eaf0',
                    }}
                  />
                </div>

                {tooLow && (
                  <div className="font-mono text-[11px] leading-relaxed mt-1.5" style={{ color: '#e84060' }}>
                    {t('sell.minimum', { amount: fromCents(minimumCents) })}
                  </div>
                )}
              </div>

              <div>
                <div className="font-mono text-[12px] uppercase tracking-wider mb-1.5" style={{ color: '#6c7290' }}>
                  {t('sell.youReceive')}
                  {feePercent !== null && (
                    <span style={{ color: '#4a4f68' }}>{t('sell.afterFee', { fee: feePercent })}</span>
                  )}
                </div>
                <div
                  className="w-full px-2.5 py-2 rounded font-mono text-base font-semibold"
                  style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: payout ? '#4ade80' : '#4a4f68' }}
                >
                  {payout ? `$${payout}` : '—'}
                </div>
              </div>

              {/* The same treatment, guarded on `enabled:` — a button
                  that lights up while it refuses to be pressed is worse
                  than one that never lights up at all. */}
              <button
                onClick={onList}
                disabled={!priced}
                className="w-full py-2.5 rounded font-display text-[15px] font-bold tracking-wide transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:cursor-pointer enabled:hover:brightness-110 enabled:active:translate-y-px enabled:active:brightness-95"
                style={{
                  background: isListed ? 'rgba(255,255,255,0.08)' : '#f0c040',
                  color: isListed ? '#e8eaf0' : '#08090d',
                }}
              >
                {isListed ? t('sell.removeFromList') : t('sell.listItem')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {hover.detail && <AppliedPopup applied={hover.detail.applied} anchor={hover.detail.anchor} />}
    </div>
    </AppliedValueProvider>
  );
}

/**
 * The platform's offer to buy the item outright.
 *
 * The amount is on the button on purpose: an "instant sell" that reveals
 * its price on the next screen is a button nobody should press, and this
 * one is irreversible — we pay, we hold, and the seller does not get the
 * item back if the price moves the next day.
 *
 * **The offer prices the base skin only**, and nothing here says so:
 * the requirement to state it was dropped on 2026-08-25, because the
 * suggested price above is now itemised into the skin and what each
 * applied piece adds. The offer sits beside that breakdown rather than
 * beside nothing.
 */
function InstantSell({
  buyout,
  onSell,
  notice,
}: {
  buyout: ItemPrice['buyout'];
  onSell: (amount: string) => void;
  /** Why pressing it did nothing, once it has been pressed. */
  notice: string | null;
}) {
  const { t } = useTranslation();

  // No offer says nothing at all, whatever the reason for it — the
  // absent button is the whole message, and the grid already leaves the
  // bolt off this card. It used to explain a slow-trading item in a
  // sentence, which drew attention to something the seller cannot act
  // on and made an ordinary item look like a rejected one.
  if (buyout.amount === null) return null;

  return (
    <>
      {/* Brightness and a glow rather than a colour swap: the background
          is set inline, and hovering something that changes shade is the
          cheapest way to say a control is live. The press moves it a
          pixel down, which is the other half of feeling like a button. */}
      <button
        onClick={() => onSell(buyout.amount)}
        className="w-full py-2.5 rounded font-display text-[13px] font-bold tracking-wide cursor-pointer transition-all duration-150 hover:brightness-110 hover:shadow-[0_0_18px_rgba(74,222,128,0.35)] active:translate-y-px active:brightness-95"
        style={{ background: '#4ade80', color: '#08090d' }}
      >
        {t('sell.instantSell', { amount: buyout.amount })}
      </button>

      {notice && (
        <div
          className="rounded px-2.5 py-2 font-mono text-[12px] leading-relaxed mt-2"
          style={{
            background: 'rgba(240,192,64,0.08)',
            border: '1px solid rgba(240,192,64,0.25)',
            color: '#f0c040',
          }}
        >
          {notice}
        </div>
      )}
    </>
  );
}

/**
 * Valve's own words about the model.
 *
 * **English, in every language.** The text is Valve's, the CS2 client
 * localises it and our dataset carries only the English — so the choice
 * was between English everywhere and nothing outside English. It falls
 * under the same rule as the weapon names: their words, not ours.
 *
 * The flavour line is set apart in italics because that is what it is —
 * a joke at the end, not a fact about the skin — and roughly half the
 * catalog has none, so it is absent rather than empty when missing.
 */
function Description({
  text,
  flavor,
  emptyLabel,
}: {
  text: string | null;
  flavor: string | null;
  emptyLabel: string;
}) {
  if (!text && !flavor) {
    return (
      <div className="font-mono text-[12px] leading-relaxed" style={{ color: '#4a4f68' }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 140 }}>
      {text && (
        <p className="font-mono text-[12px] leading-relaxed" style={{ color: '#9da3c0' }}>
          {text}
        </p>
      )}
      {flavor && (
        <p className="font-mono text-[12px] italic leading-relaxed" style={{ color: '#6c7290' }}>
          {flavor}
        </p>
      )}
    </div>
  );
}

/** One line of the suggestion's arithmetic. */
function Part({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[12px]" style={{ color: '#6c7290' }}>
        {label}
      </span>
      <span className="font-mono text-[12px] font-semibold" style={{ color: '#9da3c0' }}>
        {value}
      </span>
    </div>
  );
}

function Row({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[13px]" style={{ color: '#6c7290' }}>{label}</span>
      <span
        className="font-mono text-[13px] font-semibold"
        style={{ color: muted ? '#4a4f68' : (color ?? '#e8eaf0') }}
      >
        {value}
      </span>
    </div>
  );
}
