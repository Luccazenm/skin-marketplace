/**
 * Money arithmetic in integer cents.
 *
 * Everything here takes and returns strings, because that is how prices
 * travel from the input to the API and on to Postgres' Decimal. The
 * moment a price becomes a JS number it is a float, and `0.1 + 0.2`
 * stops being `0.3` — on a payout that is somebody's money.
 */

/** "42.50" -> 4250. Null when the text is not a price. */
export function toCents(value: string | undefined): number | null {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value)) return null;

  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 4250 -> "42.50". Always two decimals, so prices line up in a column. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);

  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * What the seller keeps after the platform's commission.
 *
 * Rounded half-up on the fee, so the cent that cannot be split goes to
 * the seller rather than to us. It is one cent, and it is the direction
 * that does not need explaining to anybody.
 *
 * This is an estimate for the screen. The authoritative figure is
 * computed by the backend when the sale closes and frozen onto the
 * order — the listing price can move afterwards, that number cannot.
 */
export function payoutAfterFee(
  price: string,
  feePercent: number,
): string | null {
  const cents = toCents(price);
  if (cents === null) return null;

  const fee = Math.floor((cents * feePercent) / 100);
  return fromCents(cents - fee);
}
