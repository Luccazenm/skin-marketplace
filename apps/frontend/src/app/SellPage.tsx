import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Package, Lock, X, RotateCw, Zap } from 'lucide-react';
import {
  ApiError,
  getPlatformConfig,
  requestDeposit,
  type AppliedItem,
  type InventoryItem,
  type ItemPrice,
  type PlatformConfig,
} from '@/lib/api';
import { payoutCentsAfterFee, toCents } from '@/lib/money';
import { repriceText, useMoneyEntry } from '@/lib/use-currency';
import { symbolFor } from '@/lib/currencies';
import { rarityStyle } from '@/lib/rarity';
import { usePrices } from '@/lib/use-prices';
import {
  AppliedPopup,
  AppliedValueProvider,
  useAppliedHover,
  type AppliedValue,
} from './AppliedPopup';
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
  const { t } = useTranslation();

  // Prices are typed and shown in the reader's currency; the API is
  // handed dollars. Everything that crosses that seam goes through
  // here, which is the only place that knows the rate.
  const money = useMoneyEntry();

  const inventory = useInventory(signedIn);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('Default');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  /**
   * Re-expresses every typed price when the currency changes.
   *
   * The field holds what the seller typed, in the currency they typed
   * it in — so switching from reais to dollars without this would leave
   * a `100` meaning R$100 sitting in a field now labelled `$`, and a
   * listing a hundred times its intended price. Converted through
   * dollars, which is the only scale both sides share.
   *
   * Skipped on the first run: there is nothing typed yet, and the rate
   * table may not have arrived.
   */
  const lastCurrency = useRef(money.currency);

  useEffect(() => {
    const from = lastCurrency.current;
    if (from === money.currency || !money.ready) return;

    lastCurrency.current = money.currency;

    setPrices((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([assetId, text]) => [
          assetId,
          repriceText(text, from, money.currency, money.rateOf) ?? text,
        ]),
      ),
    );
  }, [money]);

  // Why the instant-sell button did nothing. Lives here rather than in
  // the modal because the reason is a fact about the platform, not about
  // the item on screen, and it clears when the modal does.
  const [instantNotice, setInstantNotice] = useState<string | null>(null);

  // The commission and the minimum price both come from the backend:
  // they decide what the seller is paid and what they are allowed to
  // ask, and a constant here would keep quoting the old number the day
  // either changes. Null until it answers, and the payout box says
  // nothing rather than guessing at 5%.
  const [config, setConfig] = useState<PlatformConfig | null>(null);

  useEffect(() => {
    getPlatformConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const feePercent = config?.platformFeePercent ?? null;

  /**
   * The floor, in cents. Two while the config is in flight — the same
   * answer the server gives at the fee we charge, and the server refuses
   * anything under it regardless, so a wrong guess here is caught rather
   * than acted on.
   */
  const minimumCents = config ? (toCents(config.minimumListingPrice) ?? 2) : 2;

  // Only what can actually be deposited is offered for sale. The rest is
  // still counted, and said out loud below, because an item silently
  // missing from your own inventory reads as a bug.
  const sellable = useMemo(
    () => inventory.items.filter((i) => i.depositable),
    [inventory.items],
  );

  // Asked for the whole sellable inventory at once, not per card: two
  // hundred cards mounting would be two hundred requests, and the
  // backend answers a list in one round trip. The hook keys on the set
  // of names, so filtering and sorting do not re-fetch.
  const market = usePrices(
    useMemo(() => sellable.map((i) => i.marketHashName), [sellable]),
  );

  /**
   * Every distinct sticker, patch and charm in the inventory, priced in
   * one go so the hover popup has a number to show.
   *
   * Cheap despite the count of items: applied pieces repeat heavily —
   * a real 178-item inventory here carries 25 distinct ones — and the
   * request is deduplicated and batched anyway. It is the badges on the
   * cards that need this; what each piece *adds* to a weapon is the
   * suggestion's arithmetic, and only the detail asks for that.
   */
  const appliedMarket = usePrices(
    useMemo(
      () => sellable.flatMap((i) => i.applied.map((a) => a.marketHashName)),
      [sellable],
    ),
  );

  const appliedValue = (marketHashName: string): AppliedValue => ({
    own: appliedMarket.prices[marketHashName]?.ask ?? null,
    adds: null,
  });

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

    // The same number the card shows: your asking price where you set
    // one, the market's where you did not. Sorting only by what has been
    // typed would leave "Highest Price" ordering the two items you had
    // already priced and calling the other two hundred a tie.
    const priceOf = (i: InventoryItem) => {
      const typed = money.toUsdCents(prices[i.assetId] ?? '');

      // In dollars, always: an order that mixed the typed figure in
      // reais with the market's in dollars would put a R$5 sticker
      // above a $600 knife.
      if (typed !== null && typed >= minimumCents) return typed / 100;

      return market.prices[i.marketHashName]?.ask ?? null;
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
  }, [sellable, search, sort, prices, market.prices, minimumCents]);

  const selectedItems = useMemo(
    () => sellable.filter((i) => selected.includes(i.assetId)),
    [sellable, selected],
  );

  function toggle(assetId: string) {
    const removing = selected.includes(assetId);

    setSelected((prev) =>
      removing ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );

    // Taking an item off the list forgets what it was going to be
    // listed for, so the card goes back to showing the market's price
    // like every card around it. Keeping the number would leave a price
    // nobody can see the origin of any more, sitting there until the
    // item was picked again.
    if (removing) {
      setPrices((prev) => {
        const { [assetId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  }

  /**
   * Closes the detail, and drops a price typed there but never listed.
   *
   * The rule the whole screen follows: **a card that is not on the list
   * shows the market's price.** Without this, opening an item, typing
   * $1,000 and closing leaves that number sitting on the card in the
   * bright colour that means "you chose this" — attached to nothing, and
   * indistinguishable from a real listing price to whoever scrolls past
   * it later.
   */
  function closeDetail(assetId: string) {
    setDetailFor(null);
    setInstantNotice(null);

    if (selected.includes(assetId)) return;

    setPrices((prev) => {
      const { [assetId]: _abandoned, ...rest } = prev;
      return rest;
    });
  }

  /** Every selected item needs a price above zero before this can go. */
  const priced = selectedItems.every((i) =>
    money.meetsMinimum(prices[i.assetId] ?? '', minimumCents),
  );
  const canSubmit =
    hasTradeUrl && selectedItems.length > 0 && priced && !submitting;

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Converted here and nowhere else. The API takes USD, the field
      // held reais, and this is the last point where both are in view.
      await requestDeposit(
        selectedItems.map((i) => ({
          assetId: i.assetId,
          price: money.toUsdString(prices[i.assetId] ?? '') ?? '0',
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
          : t('sell.unreachable'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!signedIn) {
    return <Notice title={t('sell.failure.signedOutTitle')} body={t('sell.failure.signedOutBody')} />;
  }

  if (inventory.loading) {
    return <Notice title={t('sell.failure.loadingTitle')} body={t('sell.failure.loadingBody')} />;
  }

  if (inventory.failure) {
    return <FailureNotice failure={inventory.failure} message={inventory.failureMessage} onRetry={() => void inventory.reload()} />;
  }

  return (
    // Wraps the grid, the sell panel and the detail alike: all three
    // draw the same badges and open the same popup.
    <AppliedValueProvider value={appliedValue}>
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
            <Trans
              i18nKey="sell.sellable"
              count={filtered.length}
              components={{ n: <span className="font-semibold" style={{ color: '#e8eaf0' }} /> }}
            />
          </span>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inventory.search')}
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
                  ? t('inventory.readAt', { time: inventory.fetchedAt.toLocaleTimeString() })
                  : t('inventory.readAgain')
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
              {inventory.refreshing ? t('inventory.refreshing') : t('inventory.refresh')}
            </button>
            <MiniSortDropdown value={sort} onChange={setSort} options={SELL_SORTS} />
          </div>
        </div>

        {/* Said out loud rather than hidden: an item missing from your own
            inventory with no explanation reads as a bug. */}
        {inventory.data && inventory.data.blocked > 0 && (
          <div className="mb-3 font-mono text-[11px] flex-shrink-0" style={{ color: '#6c7290' }}>
            {t('sell.blocked', {
              blocked: inventory.data.blocked,
              total: inventory.data.total,
            })}
          </div>
        )}

        {inventory.data?.stale && (
          <div className="mb-3 font-mono text-[11px] flex-shrink-0" style={{ color: '#f0c040' }}>
            {t('sell.stale')}
          </div>
        )}

        {filtered.length === 0 ? (
          <Notice
            title={t('sell.emptyTitle')}
            body={search ? t('sell.emptySearch') : t('sell.emptyInventory')}
          />
        ) : (
          // Pulled 8px into the column's own right padding so the
          // scrollbar sits there instead of taking width off the grid.
          // Without it the cards end 8px short of the toolbar above.
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-subtle" style={{ marginRight: -8 }}>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
              {filtered.map((item) => (
                <ItemCard
                  key={item.assetId}
                  item={item}
                  selected={selected.includes(item.assetId)}
                  price={prices[item.assetId]}
                  market={market.prices[item.marketHashName]}
                  minimumCents={minimumCents}
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
            market={market.prices[item.marketHashName]}
            onPriceChange={(p) => setPrices((prev) => ({ ...prev, [item.assetId]: p }))}
            feePercent={feePercent}
            minimumCents={minimumCents}
            isListed={selected.includes(item.assetId)}
            onList={() => { toggle(item.assetId); setDetailFor(null); }}
            onInstantSell={() => setInstantNotice(t(INSTANT_SELL_NOT_OPEN))}
            instantSellNotice={instantNotice}
            onClose={() => { closeDetail(item.assetId); }}
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
            minimumCents={minimumCents}
            hasTradeUrl={hasTradeUrl}
            canSubmit={canSubmit}
            submitting={submitting}
            error={submitError}
            onSubmit={() => void submit()}
          />
        </div>
      )}
    </div>
    </AppliedValueProvider>
  );
}

/**
 * The bolt on a card we would buy outright, and what it means.
 *
 * A popup of our own rather than a `title`: the native tooltip picks its
 * own delay, its own position and its own typeface, and on this grid it
 * would be the one piece of chrome that does not look like the rest of
 * the screen.
 *
 * Portalled for the same reason `AppliedPopup` is — the card is
 * `overflow-hidden` so its artwork keeps rounded corners, and anything
 * nested inside it is clipped at the edge.
 */
function InstantSellMark() {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);

  function cancel() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  // The badge can leave under the pointer — re-sorting the grid drops
  // and rebuilds the cards — and a timer left running would then open a
  // popup anchored to a rectangle that no longer means anything.
  useEffect(() => cancel, []);

  return (
    <>
      <span
        aria-label={t('sell.instantMark')}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          cancel();
          // Shorter than the sticker popup's second: that one guards
          // against a column of five badges flashing past, and this is a
          // single target somebody has aimed at.
          timer.current = window.setTimeout(() => setAnchor(rect), 250);
        }}
        onMouseLeave={() => {
          cancel();
          setAnchor(null);
        }}
        className="flex items-center justify-center rounded flex-shrink-0"
        style={{
          width: 18,
          height: 18,
          background: 'rgba(74,222,128,0.12)',
          border: '1px solid rgba(74,222,128,0.3)',
        }}
      >
        <Zap className="w-3 h-3" style={{ color: '#4ade80' }} fill="#4ade80" />
      </span>

      {anchor && <InstantSellTip anchor={anchor} />}
    </>
  );
}

/** One line, above the badge, kept on screen. */
function InstantSellTip({ anchor }: { anchor: DOMRect }) {
  const { t } = useTranslation();
  const WIDTH = 168;
  const GAP = 8;

  // Centred on the badge, then pushed back inside whichever edge it
  // would have crossed. The badges sit at the right of a card, so on the
  // last column this is always the right edge.
  const left = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - WIDTH / 2),
    window.innerWidth - WIDTH - 8,
  );

  // Above by default, below when there is no room — the top row of the
  // grid sits close enough to the toolbar for that to happen.
  const ESTIMATED_HEIGHT = 34;
  const above = anchor.top - GAP - ESTIMATED_HEIGHT > 8;
  const top = above ? anchor.top - GAP - ESTIMATED_HEIGHT : anchor.bottom + GAP;

  return createPortal(
    <div
      className="fixed z-[100] rounded px-2 py-1.5 font-mono text-[10px] leading-snug text-center pointer-events-none"
      style={{
        left,
        top,
        width: WIDTH,
        background: '#0f1117',
        border: '1px solid rgba(74,222,128,0.3)',
        color: '#9da3c0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      {t('sell.instantTip')}
    </div>,
    document.body,
  );
}

/**
 * The offer is real and computed by the backend, but nothing can act on
 * it yet: buying the item means the Trade Bot fetching it, and
 * `apps/bot-service` is still empty. Said in full rather than left as a
 * dead button — a control that does nothing when pressed is worse than
 * one that explains itself.
 *
 * The key rather than the sentence: this is module scope, where there is
 * no `t` and no language yet, and a constant built at import time would
 * freeze whichever language happened to load first.
 */
const INSTANT_SELL_NOT_OPEN = 'sell.instantNotOpen';

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
  const hover = useAppliedHover();

  return (
    <div
      className="absolute flex flex-col gap-0.5 z-10"
      style={{ top: 6, [side]: 6 }}
    >
      {items.map((applied, i) => (
        <div
          key={`${applied.position}-${i}`}
          aria-label={appliedLabel(applied)}
          onMouseEnter={(e) =>
            hover.open(applied, e.currentTarget.getBoundingClientRect())
          }
          onMouseLeave={hover.close}
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

      {hover.detail && (
        <AppliedPopup applied={hover.detail.applied} anchor={hover.detail.anchor} />
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
function ItemCard({ item, selected, price, market, minimumCents, onToggle, onOpen }: { item: InventoryItem; selected: boolean; price: string | undefined; market: ItemPrice | undefined; /** The lowest price the backend will accept, in cents. */ minimumCents: number; onToggle: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const money = useMoneyEntry();

  // The asking price the seller set, if it clears the floor. Null keeps
  // the card on the market's figure, like every unpriced card near it.
  const typed = money.meetsMinimum(price ?? '', minimumCents)
    ? money.formatTyped(price ?? '')
    : null;

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
            {item.exterior && <div className="font-mono text-[9px]" style={{ color: '#6c7290' }}>{t(`wear.${item.exterior}`, { defaultValue: item.exterior })}</div>}
            {item.float !== null && <div className="font-mono text-[9px]" style={{ color: r.color }}>{item.float.toFixed(4)}</div>}
          </div>
        </div>
        <div className="flex items-center justify-between">
          {/* Your asking price once you have set one, the market's price
              until then. The two are told apart by weight alone: yours
              is bright, the market's is grey. Deselecting an item clears
              the price with it, so a card never keeps a number whose
              origin has scrolled out of the story.

              Formatted rather than shown as typed, so the column reads
              as prices: "5" becomes 5.00, "42,5" becomes 42,50. Drawn
              from the seller's own text and never back through dollars
              — R$100 stored as $19.50 returns as R$99.98, and a card
              that corrects what somebody typed by two centavos is the
              screen arguing with them. */}
          {typed ? (
            <div className="font-mono font-semibold text-sm leading-none" style={{ color: '#f0f2f8' }}>
              {typed}
            </div>
          ) : market ? (
            <div className="font-mono font-semibold text-sm leading-none" style={{ color: '#9da3c0' }}>
              {money.formatUsdCents(Math.round(market.ask * 100))}
            </div>
          ) : (
            <div className="font-mono font-semibold text-sm leading-none" style={{ color: '#4a4f68' }}>
              {t('item.notPriced')}
            </div>
          )}

          {/* We would buy this one outright today.

              On the price row rather than in a corner: the corners hold
              the sticker and charm stacks, and this belongs beside the
              money anyway. Absent rather than greyed out when there is no
              offer — most of an inventory is cases and graffiti nobody
              bids on, and a disabled mark on two thirds of the grid is
              noise, not information.

              The same green as the button it leads to, so the mark and
              the action read as one thing. */}
          {market?.buyout.amount !== null && market !== undefined && (
            <InstantSellMark />
          )}
        </div>
      </div>

      {/* Open while selected, not only on hover: a listed item needs its
          way back visible without hunting for it, and the border alone
          does not offer an action. */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: active ? '1fr' : '0fr',
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
                opacity: active ? 1 : 0,
              }}
            >
              {selected ? t('sell.remove') : t('sell.listItem')}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * The applied stickers and charms, laid out in a line.
 *
 * A row rather than the grid card's column: here there is width and no
 * artwork to avoid covering, and a column would make the panel row twice
 * as tall for the sake of five small squares. Same popup on hover, so
 * the name, value and scrape are one pause away.
 */
function AppliedRow({ items }: { items: AppliedItem[] }) {
  const hover = useAppliedHover();

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((applied, i) => (
        <div
          key={`${applied.position}-${i}`}
          aria-label={appliedLabel(applied)}
          onMouseEnter={(e) =>
            hover.open(applied, e.currentTarget.getBoundingClientRect())
          }
          onMouseLeave={hover.close}
          className="rounded-sm flex items-center justify-center overflow-hidden flex-shrink-0"
          style={{
            width: 18,
            height: 18,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {applied.imageUrl ? (
            <img src={applied.imageUrl} alt="" className="w-full h-full object-contain" loading="lazy" />
          ) : (
            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5" />
              <circle cx="6" cy="6" r="1.5" fill="#c0c4d8" />
            </svg>
          )}
        </div>
      ))}

      {hover.detail && (
        <AppliedPopup applied={hover.detail.applied} anchor={hover.detail.anchor} />
      )}
    </div>
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
  /** The lowest price the backend will accept, in cents. */
  minimumCents: number;
  hasTradeUrl: boolean;
  canSubmit: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoneyEntry();

  return (
    <>
      <div className="px-5 mb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold" style={{ color: '#e8eaf0' }}>{t('sell.panelTitle')}</div>
          <div className="font-mono text-[10px]" style={{ color: '#6c7290' }}>
            {t('sell.selected', { count: props.items.length })}
          </div>
        </div>
        <button onClick={props.onClear} className="font-mono text-[9px] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.05)', color: '#9da3c0', border: '1px solid rgba(255,255,255,0.08)' }}>
          {t('sell.clear')}
        </button>
      </div>

      {/* pr-3 rather than pr-5: the 8px gutter makes up the difference,
          so the rows still end 20px from the panel's edge. */}
      <div className="flex-1 min-h-0 overflow-y-auto pl-5 pr-3 scrollbar-subtle">
        <div className="flex flex-col gap-2">
          {props.items.map((item) => {
            const r = rarityStyle(rarityKeyForItem(item));
            const price = props.prices[item.assetId] ?? '';

            const cents = money.toUsdCents(price);
            const valid = cents !== null && cents >= props.minimumCents;

            // Through dollars on purpose: the payout is ours to compute,
            // the commission is a rule in cents, and the reader sees the
            // answer back in their own currency.
            const payout =
              valid && props.feePercent !== null
                ? money.formatUsdCents(
                    payoutCentsAfterFee(cents, props.feePercent),
                  )
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
                          {item.exterior ? ` · ${t(`wear.${item.exterior}`, { defaultValue: item.exterior })}` : ''}
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
                        would fill the row with absences.

                        Labelled readouts rather than boxes: a bare
                        "0.0395" needs a caption to mean anything, and
                        three bordered chips in a row read as buttons. ST
                        keeps its box because it is a marker, not a
                        measurement, and it is the same badge the grid
                        card uses. */}
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[9px]">
                      {isStatTrak(item) && <Chip text="ST" accent />}
                      {item.float !== null && (
                        <span style={{ color: '#6c7290' }}>
                          Float <span style={{ color: '#c0c4d8' }}>{item.float.toFixed(4)}</span>
                        </span>
                      )}
                      {item.paintSeed !== null && (
                        <span style={{ color: '#6c7290' }}>
                          Pattern <span style={{ color: '#c0c4d8' }}>{item.paintSeed}</span>
                        </span>
                      )}
                    </div>

                    {/* The applied items belong here for the same reason
                        the float does: they are most of what separates
                        this copy from another, and on a stickered rifle
                        they can be worth more than the gun. Charms first,
                        matching the detail modal's order. */}
                    {(charmsOf(item).length > 0 || stickersOf(item).length > 0) && (
                      <AppliedRow items={[...charmsOf(item), ...stickersOf(item)]} />
                    )}
                  </div>
                </div>

                {/* Both numbers side by side, because the second is the
                    one the seller actually cares about and reading it
                    should not need scrolling or arithmetic. */}
                <div className="grid grid-cols-2 gap-2 px-2.5 pb-2.5">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: '#6c7290' }}>{t('sell.yourPrice')}</span>
                    {/* A row rather than a symbol laid over a padded
                        field: the padding only ever fits one symbol, and
                        `R$` and `zł` ran into the number. Same treatment
                        as the detail modal's field. */}
                    <div
                      className="flex items-center gap-1 pl-2 pr-2 py-1.5 rounded focus-within:ring-1 focus-within:ring-[#f0c040]/40"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: `1px solid ${price && !valid ? '#e84060' : 'rgba(255,255,255,0.1)'}`,
                      }}
                    >
                      <span className="font-mono text-[10px] flex-shrink-0" style={{ color: '#6c7290' }}>
                        {symbolFor(money.currency)}
                      </span>
                      <input
                        value={price}
                        onChange={(e) => props.setPrice(item.assetId, e.target.value)}
                        inputMode="decimal"
                        placeholder={money.digits === 0 ? '0' : '0.00'}
                        className="w-full min-w-0 bg-transparent border-0 p-0 font-mono text-xs font-semibold focus:outline-none"
                        style={{ color: '#e8eaf0' }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-wider truncate" style={{ color: '#6c7290' }}>
                      {t('sell.youReceive')}
                      {props.feePercent !== null && (
                        <span style={{ color: '#4a4f68' }}>{t('sell.feeShort', { fee: props.feePercent })}</span>
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
                      {payout ?? '—'}
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
            {t('sell.tradeLock')}
          </span>
        </div>

        {/* No longer says where to add it: the banner that used to sit at
            the top of every screen is being moved, and pointing at a
            place that is not there is worse than not pointing. */}
        {!props.hasTradeUrl && (
          <div className="font-mono text-[10px]" style={{ color: '#f0c040' }}>
            {t('sell.noTradeUrl')}
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
          {props.submitting
            ? t('sell.sending')
            : t('sell.submit', { count: props.items.length })}
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
  const { t } = useTranslation();

  // `message` is the server's own words when it sent any, and those
  // arrive in English — the backend has no idea which language this
  // browser is in. Only the fallbacks are translated; wiring the API's
  // messages through here would need the locale sent with the request,
  // which is its own change.
  const copy: Record<InventoryFailure, { title: string; body: string; retry: boolean }> = {
    signed_out: {
      title: t('sell.failure.signedOutTitle'),
      body: t('sell.failure.signedOutBody'),
      retry: false,
    },
    private: {
      title: t('sell.failure.privateTitle'),
      body: message ?? t('sell.failure.privateBody'),
      retry: true,
    },
    rate_limited: {
      title: t('sell.failure.rateLimitedTitle'),
      body: t('sell.failure.rateLimitedBody'),
      retry: true,
    },
    unavailable: {
      title: t('sell.failure.unavailableTitle'),
      body: message ?? t('sell.failure.unavailableBody'),
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
          {t('sell.tryAgain')}
        </button>
      )}
    </div>
  );
}
