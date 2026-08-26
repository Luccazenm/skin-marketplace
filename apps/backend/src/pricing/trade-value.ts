import { commission } from './commission';

/**
 * What an item is worth inside a trade — which is two numbers, not one.
 *
 * The same skin is priced differently depending on which side of the
 * trade it sits on: less when you hand it over, more when you take it.
 * That gap is the business. Measured on CS.MONEY on 2026-08-22, a skin
 * with a R$ 929.62 reference traded at R$ 895.41 from a user's
 * inventory and R$ 1,061.19 from theirs — −3.7% and +14.2%, an 18.5%
 * round trip.
 *
 * **The two sides are deliberately not symmetric.** Yours carries the
 * commission — the sell flow's own `commission`, minimum cent and all,
 * so the two can never drift apart — and nothing else. Ours carries the commission plus what it
 * costs to hold stock at all: capital parked in items, the risk that
 * the price moves while we hold them, and the week of trade lock on
 * everything we receive.
 *
 * **A trade pays better than an instant sell, on purpose.** There we
 * hand over cash and keep the item; here we hand over an item we
 * already own. Cash is the scarcer of the two, so the discount that
 * prices cash risk has no business in an operation that spends stock.
 * That is why 5% here sits beside 10–25% there.
 *
 * **Both sides are priced off the suggestion, not the bare skin** —
 * `base + stickers + charm`, capped. Decided 2026-08-26: an AK carrying
 * thousands in Katowice stickers becomes our stock with the stickers on
 * it, and valuing it as a clean AK is the same grievance the instant
 * sell warns about, only larger.
 *
 * Integer cents throughout.
 */

/**
 * Added to our item's reference price when you take it out of a trade.
 *
 * Commission plus the cost of having the item in the first place. Below
 * the +14.2% measured on CS.MONEY, deliberately: their number is the
 * one a competitor wrote a blog post about.
 */
export const TAKE_PREMIUM = 0.12;

/**
 * What we credit you for an item you hand over.
 *
 * The sell flow's `commission` and nothing else, so the two can never
 * drift: the percentage, the rounding towards you, and the one-cent
 * minimum all come from the same place.
 *
 * **Can be zero**, on an item worth a cent — the minimum fee is the
 * whole of it. Callers have to say that in words rather than printing
 * "$0.00", which would read as a price rather than as a refusal.
 */
export function valueGiving(
  referenceCents: number,
  feePercent: number,
): number {
  return commission(referenceCents, feePercent).payoutCents;
}

/**
 * Whether an item may go into a trade at all.
 *
 * It may when handing it over leaves you with something. That works out
 * to a reference of two cents — the same floor a listing has, reached
 * from the other direction: below it the minimum commission is the
 * whole price, and a trade that credits nothing is not a trade, it is
 * us collecting junk.
 *
 * Derived rather than written as its own threshold, so it cannot drift
 * away from the commission that produces it.
 */
export function tradeEligible(
  referenceCents: number,
  feePercent: number,
): boolean {
  return valueGiving(referenceCents, feePercent) > 0;
}

/**
 * What you pay for an item you take from our stock.
 *
 * Rounded **down**, which is the same rule read from the other side:
 * the odd cent stays with you rather than with us.
 */
export function valueTaking(referenceCents: number): number {
  return Math.floor(referenceCents * (1 + TAKE_PREMIUM));
}

/**
 * What a straight swap of one item for an identical one costs, as a
 * fraction. The number that describes the business, and the one to
 * watch when either side is tuned.
 *
 * Above the prices where the minimum fee bites, which is anything past
 * about twenty cents — below that the commission is a flat cent and the
 * ratio means nothing.
 */
export function roundTripCost(feePercent: number): number {
  return (1 + TAKE_PREMIUM) / (1 - feePercent / 100) - 1;
}
