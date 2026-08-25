/**
 * The commission, and the floor underneath it.
 *
 * Two rules, and the second exists because of the first:
 *
 * 1. **We never take less than a cent.** A percentage of a small price
 *    rounds to nothing, and a sale that moves an item and earns zero is
 *    a sale we pay Steam's bandwidth for and record for free. The cent
 *    is the smallest unit money has here, so the fee is at least one.
 *
 * 2. **A listing cannot open below the price at which the seller still
 *    keeps a cent.** With rule 1 in force, a $0.01 listing pays out
 *    zero — the fee eats all of it. Refusing that price is kinder than
 *    letting somebody list an item for nothing, and a payout of zero
 *    would be a ledger entry that moves no money.
 *
 * The second is **derived from the first**, not written down beside it.
 * At the 5% we charge today it works out to $0.02; the commission is
 * configurable, and a constant here would go quietly wrong the day it
 * changed.
 *
 * Integer cents throughout. A percentage of a float price is where money
 * starts drifting.
 */

/** The smallest commission we will charge on a sale. */
export const MINIMUM_FEE_CENTS = 1;

/** What the seller has to be left with for the sale to be worth making. */
const MINIMUM_PAYOUT_CENTS = 1;

/**
 * A commission this large means somebody typed the wrong number into
 * the environment. Better to fail loudly at startup than to serve a
 * storefront whose minimum price is $50.
 */
const IMPLAUSIBLE_MINIMUM_CENTS = 1000;

export interface Commission {
  /** What we keep, in cents. Never below `MINIMUM_FEE_CENTS`. */
  feeCents: number;
  /** What the seller receives, in cents. */
  payoutCents: number;
}

/**
 * Splits a sale price between the seller and us.
 *
 * Rounded **down** on the percentage, so the cent that cannot be split
 * goes to the seller rather than to us. It is one cent, and it is the
 * direction that does not need explaining to anybody.
 */
export function commission(priceCents: number, feePercent: number): Commission {
  const proportional = Math.floor((priceCents * feePercent) / 100);
  const feeCents = Math.max(MINIMUM_FEE_CENTS, proportional);

  return { feeCents, payoutCents: priceCents - feeCents };
}

/**
 * The lowest price an item may be listed at.
 *
 * Found by asking rather than asserted: the smallest price at which the
 * seller still keeps a cent after the commission. A loop rather than
 * algebra because `commission` is where the rounding and the floor
 * live, and solving around them by hand is how the two drift apart.
 */
export function minimumListingCents(feePercent: number): number {
  for (
    let price = MINIMUM_FEE_CENTS + MINIMUM_PAYOUT_CENTS;
    price <= IMPLAUSIBLE_MINIMUM_CENTS;
    price++
  ) {
    if (commission(price, feePercent).payoutCents >= MINIMUM_PAYOUT_CENTS) {
      return price;
    }
  }

  throw new Error(
    `A commission of ${feePercent}% leaves the seller nothing at any ` +
      `sane price. Check PLATFORM_FEE_PERCENT.`,
  );
}

/** 2 -> "0.02". Two decimals always, because this is money on a screen. */
export function centsToUsd(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** "0.02" -> 2. Null when the text is not a price. */
export function usdToCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;

  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
