/**
 * Turning what somebody typed in their own currency into the dollars we
 * store.
 *
 * **This is money entry, not display.** Everything in `use-currency`
 * decorates a number that already exists; this decides what a seller is
 * paid. A listing is stored in USD, so a price typed as `R$100` has to
 * become `1950` cents and back again without either side drifting.
 *
 * Integers throughout, for the reason the rest of the money code gives:
 * the moment a price is a float, `0.1 + 0.2` stops being `0.3`, and on
 * a payout that is somebody's money.
 *
 * `rate` here always means **units of the local currency per one US
 * dollar** — `5.127` for BRL, `156.12` for JPY, `1` for USD itself.
 */

/**
 * How many decimal places the currency actually has.
 *
 * Yen and won have none: `¥1` is the smallest unit there is, and
 * treating them like dollars would read a typed `3000` as thirty yen.
 * Asked of `Intl` rather than listed here, so a currency added to the
 * picker cannot arrive with the wrong assumption attached.
 */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency })
        .resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * What was typed, in the currency's smallest unit. Null when it is not
 * a price.
 *
 * Accepts a dot or a comma as the decimal mark, because the field is
 * shown in the reader's own locale and half of them type `12,34`.
 * **Grouping separators are refused** rather than guessed at: `1.234`
 * means one and a bit to an American and one thousand two hundred to a
 * Brazilian, and a parser that picks one silently turns a R$1.234
 * listing into R$1,23.
 *
 * A currency with no decimals refuses any separator at all.
 */
export function parseMinor(text: string, digits: number): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const separators = (trimmed.match(/[.,]/g) ?? []).length;
  if (separators > 1) return null;
  if (separators === 1 && digits === 0) return null;

  const pattern =
    digits === 0
      ? /^\d+$/
      : new RegExp(`^\\d+(?:[.,]\\d{1,${digits}})?$`);

  if (!pattern.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split(/[.,]/);

  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
}

/** `1234` minor units at 2 digits -> `"12.34"`, for an API that wants USD. */
export function minorToPlain(minor: number, digits: number): string {
  if (digits === 0) return String(minor);

  const whole = Math.floor(minor / 10 ** digits);
  const fraction = String(minor % 10 ** digits).padStart(digits, '0');

  return `${whole}.${fraction}`;
}

/**
 * Local minor units -> US cents.
 *
 * Rounded to nearest rather than floored. Floor would quietly shave a
 * cent off every conversion in the same direction, and over a listing
 * page that direction is always away from the seller.
 */
export function toUsdCents(
  minor: number,
  digits: number,
  rate: number,
): number {
  if (!Number.isFinite(rate) || rate <= 0) return minor;

  return Math.round((minor * 100) / (10 ** digits * rate));
}

/** US cents -> local minor units, for showing a figure we hold in dollars. */
export function fromUsdCents(
  usdCents: number,
  digits: number,
  rate: number,
): number {
  if (!Number.isFinite(rate) || rate <= 0) return usdCents;

  return Math.round((usdCents / 100) * rate * 10 ** digits);
}

/**
 * The smallest amount that may be typed in this currency.
 *
 * Not simply the minimum converted: the conversion rounds, so the
 * smallest local amount that *survives* it is lower than the rounded
 * equivalent. At $0.02 and 5.127 BRL/USD the naive answer is R$0.11,
 * but R$0.08 already converts to two cents — and refusing R$0.08 while
 * accepting it on the server is the screen lying about its own rule.
 *
 * Derived by inverting the rounding: the boundary is where
 * `minUsdCents - 0.5` sits, and anything at or above it rounds up.
 */
export function minimumMinor(
  minUsdCents: number,
  digits: number,
  rate: number,
): number {
  if (!Number.isFinite(rate) || rate <= 0) return minUsdCents;

  const boundary = ((minUsdCents - 0.5) * 10 ** digits * rate) / 100;

  // Never below one minor unit: a currency cannot be paid in less.
  return Math.max(1, Math.ceil(boundary));
}
