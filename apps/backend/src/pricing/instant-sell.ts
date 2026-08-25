/**
 * What the platform offers to buy an item for, right now.
 *
 * This is not brokering a sale: we pay immediately, hold the item and
 * carry the risk of reselling it. The discount is the price of that
 * risk, and Valve's 7-day trade lock makes a week of it unavoidable on
 * every purchase.
 *
 * **Anchored on the bid, never on a listing price.** A listing is what
 * somebody is asking; the bid is what somebody will actually hand over.
 * Discounting from the ask is how you end up paying more than you could
 * liquidate at. Decided 2026-08-19.
 *
 * **It prices the base skin only** — stickers, charms and pattern are
 * not valued. Also deliberate: transfer rates run from under 1% to over
 * 50% and no source gives them with confidence. The consequence has to
 * be said on screen wherever the offer appears, because an AK worth
 * thousands for its Katowice stickers gets an offer for a clean AK.
 */

/** The spread bands, and what each one costs the seller. */
interface Band {
  /** Applies when the spread is at or below this. */
  upTo: number;
  /** Taken off the bid. 0.1 = 10%. */
  discount: number;
}

/**
 * Wider spread, worse offer: the spread is how long we expect to be
 * holding it, and how far the price can move before we are out.
 *
 * These numbers are to be calibrated against real trading, not to be
 * right first time. Above the last band there is no offer at all —
 * refusing is a valid answer and the expected one for an illiquid item.
 */
const BANDS: Band[] = [
  { upTo: 0.05, discount: 0.1 },
  { upTo: 0.12, discount: 0.15 },
  { upTo: 0.25, discount: 0.25 },
];

export type InstantSellOffer =
  | {
      ok: true;
      /** USD, as a string with two decimals — this is money we pay. */
      amount: string;
      /** Taken off the bid. 0.15 = 15%. */
      discount: number;
      /** What the discount was chosen from. */
      spread: number;
    }
  | { ok: false; reason: NoOfferReason };

/**
 * `no_bid` — nobody has a buy order open, so there is no floor to
 * discount from and no evidence anyone wants it.
 *
 * `illiquid` — the gap between what people ask and what they pay is
 * wide enough that we could be holding this for a long time at a price
 * nobody has agreed to.
 */
export type NoOfferReason = 'no_bid' | 'illiquid';

/**
 * The offer for one item, or a refusal.
 *
 * Takes the two numbers it actually depends on rather than a whole
 * price, so the rule can be read and tested without a market behind it.
 */
export function instantSellOffer(
  bid: number | null,
  spread: number | null,
): InstantSellOffer {
  // No bid is not a low offer, it is no offer. A zero here would become
  // a button reading "sell instantly for $0.00".
  if (bid === null || bid <= 0) return { ok: false, reason: 'no_bid' };

  // A negative spread means the highest bid sits above the lowest ask,
  // which happens in real data when the two sides are measured moments
  // apart. It is the tightest possible market, not a bargain, so it
  // takes the first band rather than being refused.
  const band = BANDS.find((b) => (spread ?? 0) <= b.upTo);

  if (!band) return { ok: false, reason: 'illiquid' };

  const cents = Math.round(bid * 100);

  // Rounded up, so the cent that cannot be split goes to the seller
  // rather than to us. It is one cent, and it is the direction that
  // does not need explaining to anybody — the same choice the payout
  // makes with the commission.
  const offer = Math.ceil(cents * (1 - band.discount));

  return {
    ok: true,
    amount: fromCents(offer),
    discount: band.discount,
    spread: spread ?? 0,
  };
}

/** 2494 -> "24.94". Two decimals always, so offers line up. */
function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
