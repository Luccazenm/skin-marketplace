/**
 * The currencies a price can be read in.
 *
 * **Display only.** The ledger is USD, listings are priced in USD and
 * settlement is USD or crypto — picking BRL changes what a price is
 * drawn as, never what anybody is charged. Nothing in this file may be
 * used to compute a payout.
 *
 * The list follows the sixteen languages the site offers, because the
 * reason to have both is the same reason: somebody reading in their own
 * language usually wants the price in the money they think in.
 *
 * Two are missing for a reason rather than an oversight. Czech and
 * Swedish readers get no CZK or SEK because the rate provider does not
 * return them — offering a currency we cannot convert to would put a
 * `—` where the price goes. Verified against the live table on
 * 2026-09-06: 51 currencies, those two absent.
 */
export interface Currency {
  /** ISO 4217, and the key into the rate table. */
  code: string;
  /** What the picker shows, kept short because the header is narrow. */
  symbol: string;
}

export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'BRL', symbol: 'R$' },
  { code: 'RUB', symbol: '₽' },
  { code: 'CNY', symbol: '¥' },
  { code: 'PLN', symbol: 'zł' },
  { code: 'TRY', symbol: '₺' },
  { code: 'UAH', symbol: '₴' },
  { code: 'JPY', symbol: '¥' },
  { code: 'KRW', symbol: '₩' },
];

export const BASE_CURRENCY = 'USD';

export function isSupported(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code);
}

/**
 * The symbol to sit inside a price field.
 *
 * The field cannot be formatted by `Intl` while somebody is typing in
 * it, so the symbol is drawn beside it and this is where it comes from.
 * Falls back to the code, which is what `Intl` itself does for a
 * currency with no short form.
 */
export function symbolFor(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}
