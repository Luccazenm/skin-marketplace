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
}

export const CURRENCIES: Currency[] = [
  { code: 'USD' },
  { code: 'EUR' },
  { code: 'GBP' },
  { code: 'BRL' },
  { code: 'RUB' },
  { code: 'CNY' },
  { code: 'PLN' },
  { code: 'TRY' },
  { code: 'UAH' },
  { code: 'JPY' },
  { code: 'KRW' },
];

export const BASE_CURRENCY = 'USD';

export function isSupported(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code);
}

/**
 * The symbol a price is drawn with — `$`, `₽`, `zł`.
 *
 * **Asked of `Intl`, never listed here.** A hand-written table was the
 * second source of truth for something the formatter also decides, and
 * the two disagreed on screen: the field beside a price showed `₽`
 * while the price itself read `RUB 1.167,60`.
 *
 * `narrowSymbol` is the point. Left to itself `Intl` writes the dollar
 * as `US$`, the rouble as `RUB` and the złoty as `PLN` — a code, not a
 * symbol — while giving the euro its `€`. The narrow form is the one
 * that is a symbol for every currency in the picker.
 *
 * The same locale as the formatter, so the two cannot drift apart.
 */
export function symbolFor(code: string, locale = 'en'): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);

    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}
