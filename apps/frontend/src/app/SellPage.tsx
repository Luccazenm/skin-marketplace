import { useEffect, useMemo, useState } from 'react';
import { Package, Lock, X, RotateCw } from 'lucide-react';
import {
  ApiError,
  getPlatformConfig,
  requestDeposit,
  type AppliedItem,
  type InventoryItem,
} from '@/lib/api';
import { fromCents, payoutAfterFee, toCents } from '@/lib/money';
import { rarityStyle } from '@/lib/rarity';
import { AppliedPopup } from './AppliedPopup';
import { SellDetail } from './SellDetail';
import { MiniSortDropdown, SELL_SORTS } from './MiniSortDropdown';
import {
  appliedLabel,
  charmsOf,
  isStatTrak,
  rarityKeyForItem,
  stickersOf,
  useInventory,
  type InventoryFailure,
} from '@/lib/use-inventory';

/**
 * Selling: pick items from the Steam inventory, price them, confirm.
 *
 * One step for the user and two for us — the Trade Bot asks for the
 * items, and they are listed the moment it receives them. This screen is
 * the first half; the listing appears on its own once the trade goes
 * through.
 */
export function SellPage({
  signedIn,
  hasTradeUrl,
  onDeposited,
}: {
  signedIn: boolean;
  hasTradeUrl: boolean;
  /** Tells the header a notification may have arrived. */
  onDeposited: () => void;
}) {
  const inventory = useInventory(signedIn);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('Default');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  // The commission comes from the backend: it decides what the seller is
  // paid, and a constant here would keep quoting the old number the day
  // it changes. Null until it answers, and the payout box says nothing
  // rather than guessing at 5%.
  const [feePercent, setFeePercent] = useState<number | null>(null);

  useEffect(() => {
    getPlatformConfig()
      .then((c) => setFeePercent(c.platformFeePercent))
      .catch(() => setFeePercent(null));
  }, []);

  // Only what can actually be deposited is offered for sale. The rest is
  // still counted, and said out loud below, because an item silently
  // missing from your own inventory reads as a bug.
  const sellable = useMemo(
    () => inventory.items.filter((i) => i.depositable),
    [inventory.items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? sellable.filter((i) => i.marketHashName.toLowerCase().includes(q))
      : sellable;

    if (sort === 'Default') return matched;

    // Items with nothing to sort by go last, whichever direction is
    // asked for. Treating a missing float as 0 would put every sticker,
    // case and graffiti — three quarters of a real inventory — at the top
    // of "Lowest Float", which is worse than not sorting at all.
    const by = (
      value: (i: InventoryItem) => number | null,
      descending: boolean,
    ) =>
      [...matched].sort((a, b) => {
        const x = value(a);
        const y = value(b);

        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;

        return descending ? y - x : x - y;
      });

    const priceOf = (i: InventoryItem) => {
      const p = prices[i.assetId];
      return isValidPrice(p) ? Number(p) : null;
    };

    switch (sort) {
      case 'Highest Price':
        return by(priceOf, true);
      case 'Lowest Price':
        return by(priceOf, false);
      case 'Highest Float':
        return by((i) => i.float, true);
      case 'Lowest Float':
        return by((i) => i.float, false);
      default:
        return matched;
    }
  }, [sellable, search, sort, prices]);

  const selectedItems = useMemo(
    () => sellable.filter((i) => selected.includes(i.assetId)),
    [sellable, selected],
  );

  function toggle(assetId: string) {
    setSelected((prev) =>
      prev.includes(assetId)
        ? prev.filter((id) => id !== assetId)
        : [...prev, assetId],
    );
  }

  /** Every selected item needs a price above zero before this can go. */
  const priced = selectedItems.every((i) => isValidPrice(prices[i.assetId]));
  const canSubmit =
    hasTradeUrl && selectedItems.length > 0 && priced && !submitting;

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);

    try {
      await requestDeposit(
        selectedItems.map((i) => ({
          assetId: i.assetId,
          price: prices[i.assetId],
        })),
      );

      // The confirmation is a notification now, under the bell, not a
      // line on a page the user is about to leave. All this has to do is
      // tell the header to look.
      onDeposited();
      setSelected([]);
      setPrices({});
      // The assetIds we just sent are now spoken for, and the backend
      // will refuse them a second time. Re-reading keeps the grid honest.
      await inventory.reload();
    } catch (cause) {
      setSubmitError(
        cause instanceof ApiError
          ? cause.message
          : 'We could not reach the server. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!signedIn) {
    return <Notice title="Sign in to sell" body="Your Steam inventory is read live, so we need to know who you are first." />;
  }

  if (inventory.loading) {
    return <Notice title="Reading your inventory…" body="This comes live from Steam." />;
  }

  if (inventory.failure) {
    return <FailureNotice failure={inventory.failure} message={inventory.failureMessage} onRetry={() => void inventory.reload()} />;
  }

  return (
    <div className="flex gap-0" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden pt-6 pb-4 pr-6">
        {/* The toolbar sits inside this column, not above the split, so
            the whole top edge narrows with the grid when the sell panel
            opens. It costs the search a sideways shift on that first
            pick — the alternative was a toolbar hanging over the panel.

            Three columns rather than a flex row: equal outer columns keep
            the search in the true centre of whatever width the column
            currently has. In a flex row it would drift by the difference
            between the two sides, wandering as the count went from
            "9 sellable" to "177 sellable". */}
        <div className="grid items-center gap-3 mb-3 flex-shrink-0" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
          <span className="font-mono text-xs" style={{ color: '#9da3c0' }}>
            <span className="font-semibold" style={{ color: '#e8eaf0' }}>{filtered.length}</span> sellable
          </span>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inventory..."
            className="w-[26rem] max-w-full px-3 py-2 rounded-lg font-mono text-xs focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8eaf0' }}
          />

          <div className="flex justify-end items-center gap-2">
            {/* The freshness window is an hour, which is what lets one
                address serve hundreds of people rather than dozens. That
                window is only affordable because this button exists: it
                is the way out for the person who traded a moment ago and
                is looking at an inventory that does not show it yet. */}
            <button
              onClick={() => void inventory.refresh()}
              disabled={inventory.refreshing}
              title={
                inventory.fetchedAt
                  ? `Read from Steam at ${inventory.fetchedAt.toLocaleTimeString()}`
                  : 'Read from Steam again'
              }
              className="flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-xs transition-colors disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#9da3c0',
              }}
            >
              <RotateCw
                className={`w-3 h-3 ${inventory.refreshing ? 'animate-spin' : ''}`}
              />
              {inventory.refreshing ? 'Reading…' : 'Refresh'}
            </button>
            <MiniSortDropdown value={sort} onChange={setSort} options={SELL_SORTS} />
          </div>
        </div>

        {/* Said out loud rather than hidden: an item missing from your own
            inventory with no explanation reads as a bug. */}
        {inventory.data && inventory.data.blocked > 0 && (
          <div className="mb-3 font-mono text-[11px] flex-shrink-0" style={{ color: '#6c7290' }}>
            {inventory.data.blocked} of {inventory.data.total} items cannot be
            traded on Steam — medals, and anything still under a trade hold.
          </div>
        )}

        {inventory.data?.stale && (
          <div className="mb-3 font-mono text-[11px] flex-shrink-0" style={{ color: '#f0c040' }}>
            Steam is slow right now, so this list may be a few minutes old.
          </div>
        )}

        {filtered.length === 0 ? (
          <Notice title="Nothing to sell here" body={search ? 'No item matches that search.' : 'No item in this inventory can be traded on Steam.'} />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {filtered.map((item) => (
                <ItemCard
                  key={item.assetId}
                  item={item}
                  selected={selected.includes(item.assetId)}
                  price={prices[item.assetId]}
                  onToggle={() => toggle(item.assetId)}
                  onOpen={() => setDetailFor(item.assetId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {detailFor && (() => {
        const item = sellable.find((i) => i.assetId === detailFor);
        if (!item) return null;

        return (
          <SellDetail
            item={item}
            price={prices[item.assetId] ?? ''}
            onPriceChange={(p) => setPrices((prev) => ({ ...prev, [item.assetId]: p }))}
            feePercent={feePercent}
            isListed={selected.includes(item.assetId)}
            onList={() => { toggle(item.assetId); setDetailFor(null); }}
            onClose={() => setDetailFor(null)}
          />
        );
      })()}

      {/* The panel only exists while something is selected. Reserving the
          column would leave a permanent empty rectangle beside a full
          grid; letting the grid have the width back costs a reflow when
          the first item is picked, which is the cheaper of the two.

          Wider than it was: each row now carries the picture, the facts
          that tell two identical-looking skins apart, and both money
          fields side by side. At the old 320 those two fields would have
          been about 130px each, which is not enough for "$1,240.00". */}
      {selectedItems.length > 0 && (
        <div className="hidden lg:flex flex-col flex-shrink-0 pt-6 pb-4 overflow-hidden" style={{ width: 380, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
          <SellPanel
            items={selectedItems}
            prices={prices}
            setPrice={(assetId, price) => setPrices((p) => ({ ...p, [assetId]: price }))}
            onRemove={toggle}
            onClear={() => { setSelected([]); setPrices({}); }}
            feePercent={feePercent}
            hasTradeUrl={hasTradeUrl}
            canSubmit={canSubmit}
            submitting={submitting}
            error={submitError}
            onSubmit={() => void submit()}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Prices are strings all the way to the API — a JSON number is a float,
 * and this is money. Up to two decimals, and something above zero.
 */
function isValidPrice(value: string | undefined): boolean {
  return !!value && /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

/**
 * A column of applied items — stickers on one side, a charm on the
 * other.
 *
 * It lives inside the illustration and scales with it: on hover the
 * illustration gives up 38px so the action button can slide in, and a
 * stack that ignored that would spill over the name and the price.
 *
 * One badge per unit, never grouped by name: five copies of the same
 * sticker can each be scraped differently, and one can be worth several
 * times another.
 */
function AppliedStack({
  items,
  side,
  hovered,
}: {
  items: AppliedItem[];
  side: 'left' | 'right';
  hovered: boolean;
}) {
  // 24 at rest, 20 hovered. The hover size is set by the worst case —
  // five stickers, which is CS2's cap — where anything larger pushes the
  // bottom badge over the card's footer.
  const size = hovered ? 20 : 24;

  // Which badge is being pointed at, and where it is. The rect is read
  // on enter rather than tracked: the popup is anchored to the badge,
  // and the badge does not move while the pointer is on it.
  const [detail, setDetail] = useState<{ applied: AppliedItem; anchor: DOMRect } | null>(null);

  return (
    <div
      className="absolute flex flex-col gap-0.5 z-10"
      style={{ top: 6, [side]: 6 }}
    >
      {items.map((applied, i) => (
        <div
          key={`${applied.slot}-${i}`}
          aria-label={appliedLabel(applied)}
          onMouseEnter={(e) =>
            setDetail({ applied, anchor: e.currentTarget.getBoundingClientRect() })
          }
          onMouseLeave={() => setDetail(null)}
          className="rounded-sm flex items-center justify-center overflow-hidden transition-all duration-200"
          style={{
            width: size,
            height: size,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {applied.imageUrl ? (
            <img
              src={applied.imageUrl}
              alt=""
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5" />
              <circle cx="6" cy="6" r="1.5" fill="#c0c4d8" />
            </svg>
          )}
        </div>
      ))}

      {detail && (
        <AppliedPopup applied={detail.applied} anchor={detail.anchor} />
      )}
    </div>
  );
}

/**
 * The same card the storefront uses, with the buy action swapped for
 * listing.
 *
 * Two things differ from the Market card, and both because the data
 * differs rather than by choice: the illustration is the real Steam
 * image instead of a drawn weapon, and the price slot shows what the
 * seller has typed rather than a market price — there is no market
 * price for an item that is not on sale yet.
 */
function ItemCard({ item, selected, price, onToggle, onOpen }: { item: InventoryItem; selected: boolean; price: string | undefined; onToggle: () => void; onOpen: () => void }) {
  const r = rarityStyle(rarityKeyForItem(item));
  const stickers = stickersOf(item);
  const charms = charmsOf(item);
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered;

  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full text-left rounded overflow-hidden border transition-colors duration-200 cursor-pointer flex flex-col"
      style={{
        height: '230px',
        borderColor: active ? r.color : 'rgba(255,255,255,0.07)',
        background: `linear-gradient(160deg, ${r.from}, ${r.to})`,
        boxShadow: active ? `0 0 20px ${r.glow}` : 'none',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: r.color }} />

      <div
        className="relative flex-1 flex items-center justify-center px-4 overflow-hidden transition-all duration-200"
        style={{ paddingTop: hovered ? '8px' : '16px', paddingBottom: hovered ? '8px' : '16px' }}
      >
        {/* Inside the illustration, not the card: this is the box that
            shrinks when the LIST ITEM button slides up, and a stack of
            five badges anchored to the card would spill over the name and
            the price instead of shrinking with everything else.

            One badge per unit, still never grouped by name: five copies
            of the same sticker can each be scraped differently, and one
            can be worth several times another. The name and the scrape
            are on hover. */}
        {stickers.length > 0 && (
          <AppliedStack items={stickers} side="right" hovered={hovered} />
        )}

        {/* The charm goes opposite the stickers so neither has to make
            room for the other: a weapon can carry five stickers and a
            charm at once, and that is the card that runs out of space
            first. */}
        {charms.length > 0 && (
          <AppliedStack items={charms} side="left" hovered={hovered} />
        )}

        {isStatTrak(item) && (
          <span className="absolute bottom-1.5 left-2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded z-10" style={{ background: 'rgba(240,192,64,0.2)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.3)' }}>ST</span>
        )}
        <div className="w-full h-full max-w-[160px] flex items-center justify-center">
          {item.iconUrl ? (
            <img src={item.iconUrl} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
          ) : (
            <Package className="w-10 h-10" style={{ color: r.color, opacity: 0.4 }} />
          )}
        </div>
      </div>

      <div className="mx-3" style={{ height: '1px', background: 'rgba(255,255,255,0.07)' }} />

      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            {/* The weapon comes from the catalog, split there so no second
                name-splitter exists in the browser. Cases, stickers and
                graffiti have no weapon, so the line is simply absent. */}
            <div className="text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5" style={{ color: r.color }}>
              {item.catalog?.weapon ?? item.typeLabel ?? ''}
            </div>
            <div className="font-display text-sm font-semibold leading-tight truncate" style={{ color: '#e8eaf0' }}>
              {item.catalog?.skinName ?? item.marketHashName}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            {/* Three quarters of a real inventory has no float and no
                exterior. Each line appears only when it has something to
                say, rather than leaving empty fields across the grid. */}
            {item.exterior && <div className="font-mono text-[9px]" style={{ color: '#6c7290' }}>{item.exterior}</div>}
            {item.float !== null && <div className="font-mono text-[9px]" style={{ color: r.color }}>{item.float.toFixed(4)}</div>}
          </div>
        </div>
        <div className="flex items-center justify-between">
          {/* Shown through cents rather than as typed, so the column
              reads as prices: "5" becomes 5.00, "42.5" becomes 42.50,
              and "0100" becomes 100.00 instead of $0100. The stored
              value stays exactly what was typed — this is display. */}
          <div className="font-mono font-semibold text-sm leading-none" style={{ color: isValidPrice(price) ? '#f0f2f8' : '#4a4f68' }}>
            {isValidPrice(price) ? `$${fromCents(toCents(price)!)}` : 'Not priced'}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateRows: hovered ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div className="px-3 pb-2.5">
            {/* Its own click target, so the two paths do not fight: the
                card opens the detail, this adds straight to the list.
                Without it, listing ten items would mean opening and
                closing ten dialogs. */}
            <div
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className="w-full text-center text-xs font-semibold py-1.5 rounded font-display tracking-wide transition-opacity duration-200 cursor-pointer"
              style={{
                background: selected ? 'rgba(255,255,255,0.08)' : '#f0c040',
                color: selected ? '#e8eaf0' : '#08090d',
                opacity: hovered ? 1 : 0,
              }}
            >
              {selected ? 'REMOVE' : 'LIST ITEM'}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/** One fact about the item, small enough to sit three to a row. */
function Chip({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <span
      className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded"
      style={
        accent
          ? { background: 'rgba(240,192,64,0.2)', color: '#f0c040', border: '1px solid rgba(240,192,64,0.3)' }
          : { background: 'rgba(255,255,255,0.06)', color: '#9da3c0', border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      {text}
    </span>
  );
}

function SellPanel(props: {
  items: InventoryItem[];
  prices: Record<string, string>;
  setPrice: (assetId: string, price: string) => void;
  onRemove: (assetId: string) => void;
  onClear: () => void;
  /** Null until /api/config answers — the payout stays blank rather than guessing. */
  feePercent: number | null;
  hasTradeUrl: boolean;
  canSubmit: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="px-5 mb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold" style={{ color: '#e8eaf0' }}>Sell</div>
          <div className="font-mono text-[10px]" style={{ color: '#6c7290' }}>
            {props.items.length} selected
          </div>
        </div>
        <button onClick={props.onClear} className="font-mono text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: '#9da3c0', border: '1px solid rgba(255,255,255,0.08)' }}>
          Clear
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5" style={{ scrollbarWidth: 'none' }}>
        <div className="flex flex-col gap-2">
          {props.items.map((item) => {
            const r = rarityStyle(rarityKeyForItem(item));
            const price = props.prices[item.assetId] ?? '';

            const valid = isValidPrice(price);
            const payout =
              valid && props.feePercent !== null
                ? payoutAfterFee(price, props.feePercent)
                : null;

            return (
              <div key={item.assetId} className="rounded border overflow-hidden" style={{ borderColor: r.color + '40', background: 'rgba(13,15,23,0.6)' }}>
                {/* Image beside the facts, not above them: the picture is
                    how you recognise which of four AK-47s this row is,
                    and the float and pattern are what make it a different
                    item from an identical-looking one. */}
                <div className="flex gap-2.5 p-2.5">
                  <div
                    className="w-[84px] h-[64px] rounded flex-shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ background: `linear-gradient(160deg, ${r.from}, ${r.to})` }}
                  >
                    {item.iconUrl ? (
                      <img src={item.iconUrl} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                    ) : (
                      <Package className="w-6 h-6" style={{ color: r.color, opacity: 0.4 }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-start gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] truncate" style={{ color: '#6c7290' }}>
                          {item.catalog?.weapon ?? item.typeLabel ?? ''}
                          {item.exterior ? ` · ${item.exterior}` : ''}
                        </div>
                        <div className="font-display text-xs font-semibold truncate" style={{ color: '#e8eaf0' }}>
                          {item.catalog?.skinName ?? item.marketHashName}
                        </div>
                      </div>
                      <button onClick={() => props.onRemove(item.assetId)} className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.07)' }}>
                        <X className="w-3 h-3" style={{ color: '#9da3c0' }} />
                      </button>
                    </div>

                    {/* Only what this copy actually has. A case has no
                        float and no pattern, and printing a dash for each
                        would fill the row with absences. */}
                    <div className="flex flex-wrap items-center gap-1">
                      {isStatTrak(item) && <Chip text="ST" accent />}
                      {item.float !== null && <Chip text={item.float.toFixed(4)} />}
                      {item.paintSeed !== null && <Chip text={`#${item.paintSeed}`} />}
                    </div>
                  </div>
                </div>

                {/* Both numbers side by side, because the second is the
                    one the seller actually cares about and reading it
                    should not need scrolling or arithmetic. */}
                <div className="grid grid-cols-2 gap-2 px-2.5 pb-2.5">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: '#6c7290' }}>Your price</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px]" style={{ color: '#6c7290' }}>$</span>
                      <input
                        value={price}
                        onChange={(e) => props.setPrice(item.assetId, e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-full pl-5 pr-2 py-1.5 rounded font-mono text-xs font-semibold focus:outline-none"
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          border: `1px solid ${price && !valid ? '#e84060' : 'rgba(255,255,255,0.1)'}`,
                          color: '#e8eaf0',
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-wider truncate" style={{ color: '#6c7290' }}>
                      You receive
                      {props.feePercent !== null && (
                        <span style={{ color: '#4a4f68' }}> · {props.feePercent}%</span>
                      )}
                    </span>
                    <div
                      className="w-full px-2 py-1.5 rounded font-mono text-xs font-semibold truncate"
                      style={{
                        background: 'rgba(74,222,128,0.08)',
                        border: '1px solid rgba(74,222,128,0.2)',
                        color: payout ? '#4ade80' : '#4a4f68',
                      }}
                    >
                      {payout ? `$${payout}` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-5 pt-3 flex-shrink-0 flex flex-col gap-2">
        {/* The lock is not a warning, it is a fact about what happens
            next: Valve holds the item for 7 days after the bot receives
            it, and the buyer sees that countdown on the listing. */}
        <div className="flex items-start gap-1.5 font-mono text-[10px] leading-relaxed" style={{ color: '#6c7290' }}>
          <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Valve locks traded items for 7 days. Your listing goes up
            straight away, showing the days left; buyers choose knowing
            that.
          </span>
        </div>

        {!props.hasTradeUrl && (
          <div className="font-mono text-[10px]" style={{ color: '#f0c040' }}>
            Add your trade URL at the top of the page first — without it
            the Trade Bot cannot send you the offer.
          </div>
        )}

        {props.error && (
          <div className="font-mono text-[10px]" style={{ color: '#e84060' }}>{props.error}</div>
        )}

        <button
          onClick={props.onSubmit}
          disabled={!props.canSubmit}
          className="w-full py-2 rounded font-display text-xs font-bold tracking-wide transition-opacity disabled:opacity-40"
          style={{ background: '#f0c040', color: '#08090d' }}
        >
          {props.submitting ? 'SENDING…' : `SELL ${props.items.length} ITEM${props.items.length > 1 ? 'S' : ''}`}
        </button>
      </div>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="font-display text-sm font-bold" style={{ color: '#e8eaf0' }}>{title}</div>
      <div className="font-mono text-[11px] max-w-sm" style={{ color: '#6c7290' }}>{body}</div>
    </div>
  );
}

/**
 * Each failure gets its own words, because each has a different way out:
 * a private inventory the person fixes themselves, a rate limit is worth
 * waiting through, and an outage is worth retrying.
 */
function FailureNotice({ failure, message, onRetry }: { failure: InventoryFailure; message: string | null; onRetry: () => void }) {
  const copy: Record<InventoryFailure, { title: string; body: string; retry: boolean }> = {
    signed_out: {
      title: 'Sign in to sell',
      body: 'Your Steam inventory is read live, so we need to know who you are first.',
      retry: false,
    },
    private: {
      title: 'Your Steam inventory is private',
      body: message ?? 'Under Profile > Privacy on Steam, set "Inventory" to public, then try again.',
      retry: true,
    },
    rate_limited: {
      title: 'Steam is rate-limiting us',
      body: 'Too many inventory reads at once. This clears on its own in a few minutes.',
      retry: true,
    },
    unavailable: {
      title: 'We could not read your inventory',
      body: message ?? 'Steam did not answer. This is usually brief.',
      retry: true,
    },
  };

  const { title, body, retry } = copy[failure];

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="font-display text-sm font-bold" style={{ color: '#e8eaf0' }}>{title}</div>
      <div className="font-mono text-[11px] max-w-sm" style={{ color: '#6c7290' }}>{body}</div>
      {retry && (
        <button onClick={onRetry} className="px-4 py-1.5 rounded font-display text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.07)', color: '#e8eaf0', border: '1px solid rgba(255,255,255,0.12)' }}>
          TRY AGAIN
        </button>
      )}
    </div>
  );
}
