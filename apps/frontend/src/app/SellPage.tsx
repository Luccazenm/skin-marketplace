import { useMemo, useState } from 'react';
import { Package, Lock, X } from 'lucide-react';
import { ApiError, requestDeposit, type InventoryItem } from '@/lib/api';
import { rarityStyle } from '@/lib/rarity';
import { MiniSortDropdown, SELL_SORTS } from './MiniSortDropdown';
import {
  isStatTrak,
  rarityKeyForItem,
  stickerCount,
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
        <div className="flex items-center gap-3 mb-3 flex-shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your inventory…"
            className="flex-1 px-3 py-2 rounded-lg font-mono text-xs focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8eaf0' }}
          />
          <MiniSortDropdown value={sort} onChange={setSort} options={SELL_SORTS} />
          <span className="font-mono text-xs flex-shrink-0" style={{ color: '#9da3c0' }}>
            <span className="font-semibold" style={{ color: '#e8eaf0' }}>{filtered.length}</span> sellable
          </span>
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
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The panel only exists while something is selected. Reserving the
          column would leave a permanent empty rectangle beside a full
          grid; letting the grid have the width back costs a reflow when
          the first item is picked, which is the cheaper of the two. */}
      {selectedItems.length > 0 && (
        <div className="hidden lg:flex flex-col flex-shrink-0 pt-6 pb-4 overflow-hidden" style={{ width: 320, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
          <SellPanel
            items={selectedItems}
            prices={prices}
            setPrice={(assetId, price) => setPrices((p) => ({ ...p, [assetId]: price }))}
            onRemove={toggle}
            onClear={() => { setSelected([]); setPrices({}); }}
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
 * The same card the storefront uses, with the buy action swapped for
 * listing.
 *
 * Two things differ from the Market card, and both because the data
 * differs rather than by choice: the illustration is the real Steam
 * image instead of a drawn weapon, and the price slot shows what the
 * seller has typed rather than a market price — there is no market
 * price for an item that is not on sale yet.
 */
function ItemCard({ item, selected, price, onToggle }: { item: InventoryItem; selected: boolean; price: string | undefined; onToggle: () => void }) {
  const r = rarityStyle(rarityKeyForItem(item));
  const stickers = stickerCount(item);
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered;

  return (
    <button
      onClick={onToggle}
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

      {stickers > 0 && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5 z-10">
          {Array.from({ length: stickers }).map((_, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-sm flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5" />
                <circle cx="6" cy="6" r="1.5" fill="#c0c4d8" />
              </svg>
            </div>
          ))}
        </div>
      )}

      <div
        className="relative flex-1 flex items-center justify-center px-4 overflow-hidden transition-all duration-200"
        style={{ paddingTop: hovered ? '8px' : '16px', paddingBottom: hovered ? '8px' : '16px' }}
      >
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
          <div className="font-mono font-semibold text-sm leading-none" style={{ color: isValidPrice(price) ? '#f0f2f8' : '#4a4f68' }}>
            {isValidPrice(price) ? `$${price}` : 'Not priced'}
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
            <div
              className="w-full text-center text-xs font-semibold py-1.5 rounded font-display tracking-wide transition-opacity duration-200"
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

function SellPanel(props: {
  items: InventoryItem[];
  prices: Record<string, string>;
  setPrice: (assetId: string, price: string) => void;
  onRemove: (assetId: string) => void;
  onClear: () => void;
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

            return (
              <div key={item.assetId} className="rounded border overflow-hidden" style={{ borderColor: r.color + '40', background: 'rgba(13,15,23,0.6)' }}>
                <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-[11px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
                      {item.catalog?.skinName ?? item.marketHashName}
                    </div>
                    <div className="font-mono text-[9px] truncate" style={{ color: '#6c7290' }}>
                      {item.catalog?.weapon ?? item.typeLabel ?? ''}
                      {item.exterior ? ` · ${item.exterior}` : ''}
                    </div>
                  </div>
                  <button onClick={() => props.onRemove(item.assetId)} className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <X className="w-3 h-3" style={{ color: '#9da3c0' }} />
                  </button>
                </div>

                <div className="px-2.5 pb-2">
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
                        border: `1px solid ${price && !isValidPrice(price) ? '#e84060' : 'rgba(255,255,255,0.1)'}`,
                        color: '#e8eaf0',
                      }}
                    />
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
