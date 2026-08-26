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
 * commission and nothing else. Ours carries the commission plus what it
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
 * Taken off your item's reference price when you put it into a trade.
 *
 * Our commission, and nothing more — the same 5% the market charges.
 * The costs of holding stock are on the other side, where the stock
 * actually is.
 */
export const GIVE_DISCOUNT = 0.05;

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
 * Rounded **up**, so the cent that cannot be split goes to you. It is
 * one cent, and it is the direction that does not need explaining —
 * the same choice the commission and the buyout offer make.
 */
export function valueGiving(referenceCents: number): number {
  return Math.ceil(referenceCents * (1 - GIVE_DISCOUNT));
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
 * fraction. Exported because it is the number that describes the
 * business, and the one to watch when either side is tuned.
 */
export function roundTripCost(): number {
  return (1 + TAKE_PREMIUM) / (1 - GIVE_DISCOUNT) - 1;
}
