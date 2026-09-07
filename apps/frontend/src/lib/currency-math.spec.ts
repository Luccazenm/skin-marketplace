import { describe, expect, it } from 'vitest';
import { CURRENCIES, symbolFor } from './currencies';
import { formatMoney } from './use-currency';
import {
  fromUsdCents,
  minimumMinor,
  minorDigits,
  minorToPlain,
  parseMinor,
  toUsdCents,
} from './currency-math';

/**
 * The arithmetic between what a seller types and what we store.
 *
 * A listing is held in USD; the field is in whatever currency they read
 * in. Everything here is about the seam between the two, which is where
 * money entry goes wrong: a separator read as the wrong thing, a
 * currency assumed to have cents when it does not, or a rounding that
 * always leans the same way.
 */

// The real rates, read from the provider on 2026-09-06.
const BRL = 5.127075;
const JPY = 156.1195;

describe('minorDigits', () => {
  it.each([
    ['USD', 2],
    ['BRL', 2],
    ['EUR', 2],
  ])('gives %s two places', (currency, digits) => {
    expect(minorDigits(currency)).toBe(digits);
  });

  /**
   * The one that breaks a naive implementation. ¥1 is the smallest unit
   * there is, so treating yen like dollars reads a typed 3000 as ¥30.
   */
  it.each([['JPY'], ['KRW']])('gives %s none', (currency) => {
    expect(minorDigits(currency)).toBe(0);
  });
});

describe('parseMinor', () => {
  it('reads a dot as the decimal mark', () => {
    expect(parseMinor('12.34', 2)).toBe(1234);
  });

  it('reads a comma as the decimal mark, because half the world types one', () => {
    expect(parseMinor('12,34', 2)).toBe(1234);
  });

  it('pads a short fraction rather than misreading it', () => {
    expect(parseMinor('12,3', 2)).toBe(1230);
  });

  it('reads a whole number', () => {
    expect(parseMinor('100', 2)).toBe(10000);
  });

  /**
   * The dangerous one. "1.234" is one-and-a-bit to an American and one
   * thousand two hundred to a Brazilian; guessing turns a R$1.234
   * listing into R$1,23. Refused instead.
   */
  it('refuses a grouping separator instead of guessing which it is', () => {
    expect(parseMinor('1.234,56', 2)).toBeNull();
    expect(parseMinor('1,234.56', 2)).toBeNull();
  });

  it('refuses more decimals than the currency has', () => {
    expect(parseMinor('12.345', 2)).toBeNull();
  });

  it('refuses any separator on a currency with no decimals', () => {
    expect(parseMinor('3000.5', 0)).toBeNull();
    expect(parseMinor('3000', 0)).toBe(3000);
  });

  it.each([[''], ['   '], ['abc'], ['-5'], ['1e3'], ['.'], ['12.']])(
    'refuses %p',
    (text) => {
      expect(parseMinor(text, 2)).toBeNull();
    },
  );

  it('ignores surrounding space', () => {
    expect(parseMinor('  12,34  ', 2)).toBe(1234);
  });
});

describe('toUsdCents', () => {
  it('leaves dollars alone', () => {
    expect(toUsdCents(1234, 2, 1)).toBe(1234);
  });

  it('converts reais to cents', () => {
    // R$100.00 at 5.127075 -> $19.5045 -> 1950 cents
    expect(toUsdCents(10000, 2, BRL)).toBe(1950);
  });

  /** Yen has no minor unit, so ¥3000 is 3000, not 300000. */
  it('converts yen without inventing a minor unit', () => {
    expect(toUsdCents(3000, 0, JPY)).toBe(1922);
  });

  /**
   * Rounds to nearest, not down. Flooring would shave a fraction of a
   * cent off every conversion in the same direction, and that direction
   * is always away from the seller.
   */
  it('rounds to nearest rather than towards us', () => {
    // R$0.08 -> $0.0156 -> 2 cents, not 1
    expect(toUsdCents(8, 2, BRL)).toBe(2);
  });

  it('falls back to the typed figure when the rate is unusable', () => {
    expect(toUsdCents(1234, 2, 0)).toBe(1234);
    expect(toUsdCents(1234, 2, Number.NaN)).toBe(1234);
  });
});

describe('fromUsdCents', () => {
  it('leaves dollars alone', () => {
    expect(fromUsdCents(1950, 2, 1)).toBe(1950);
  });

  /**
    * Note the two centavos. R$100 becomes $19.50 becomes R$99.98: the
    * dollar has only two decimals, so it cannot carry every real back.
    *
    * **R$99.98 is what the screen shows**, including in the field once
    * it is left. The listing is $19.50 and $19.50 is R$99.98; showing
    * the R$100 that was typed would quote a figure we did not keep,
    * and those two centavos would come back as a support ticket the
    * first time a seller checked.
    */
  it('shows a dollar figure in reais, losing what the cent cannot hold', () => {
    expect(fromUsdCents(1950, 2, BRL)).toBe(9998);
  });

  it('shows a dollar figure in yen, whole', () => {
    expect(fromUsdCents(1922, 0, JPY)).toBe(3001);
  });
});

/**
 * How far a round trip drifts, and why the screen shows it rather than
 * hiding it.
 *
 * Storing in dollars means the cent is the resolution: at 5.13 reais to
 * the dollar, one cent is five centavos, and no amount of care recovers
 * what falls between. The bound is half a cent's worth of local
 * currency from the first rounding plus half a unit from the second.
 *
 * The rounding cannot be removed, so it is disclosed: every figure the
 * seller reads is the converted-back value, the field included. Two
 * centavos explained on screen cost nothing; two centavos discovered
 * later cost a support ticket and some trust. These tests pin the size
 * of the gap so it stops being an assumption.
 */
describe('round trip', () => {
  it.each([
    ['BRL', 2, BRL],
    ['JPY', 0, JPY],
    ['USD', 2, 1],
  ])('%s drifts by no more than the cent can hold', (_name, digits, rate) => {
    const bound = Math.ceil(rate / 2) + 1;

    for (const minor of [1, 8, 100, 1234, 10000, 999999]) {
      const back = fromUsdCents(toUsdCents(minor, digits, rate), digits, rate);

      expect(Math.abs(back - minor)).toBeLessThanOrEqual(bound);
    }
  });

  /** Dollars are stored as they are typed, so there is nothing to lose. */
  it('is exact in dollars', () => {
    for (const cents of [1, 2, 100, 1234, 999999]) {
      expect(fromUsdCents(toUsdCents(cents, 2, 1), 2, 1)).toBe(cents);
    }
  });
});

describe('minimumMinor', () => {
  it('is the platform minimum itself in dollars', () => {
    expect(minimumMinor(2, 2, 1)).toBe(2);
  });

  /**
   * Lower than the naive conversion, and deliberately. R$0.11 is $0.02
   * rounded up, but R$0.08 already *converts* to two cents — refusing
   * it on screen while the server accepts it is the screen lying about
   * its own rule.
   */
  it('is the smallest amount that still converts to the minimum', () => {
    const min = minimumMinor(2, 2, BRL);

    expect(min).toBe(8);
    expect(toUsdCents(min, 2, BRL)).toBeGreaterThanOrEqual(2);
    expect(toUsdCents(min - 1, 2, BRL)).toBeLessThan(2);
  });

  it('holds for a currency with no decimals', () => {
    const min = minimumMinor(2, 0, JPY);

    expect(toUsdCents(min, 0, JPY)).toBeGreaterThanOrEqual(2);
    expect(toUsdCents(min - 1, 0, JPY)).toBeLessThan(2);
  });

  it('never asks for less than one unit of the currency', () => {
    expect(minimumMinor(2, 0, 1000)).toBeGreaterThanOrEqual(1);
    expect(minimumMinor(1, 2, 0.0001)).toBe(1);
  });
});

describe('minorToPlain', () => {
  it('writes cents as the API wants them', () => {
    expect(minorToPlain(1950, 2)).toBe('19.50');
    expect(minorToPlain(5, 2)).toBe('0.05');
    expect(minorToPlain(100, 2)).toBe('1.00');
  });

  it('writes a currency with no decimals as a whole number', () => {
    expect(minorToPlain(3000, 0)).toBe('3000');
  });
});

/**
 * Every currency in the picker draws as a symbol, not as its code.
 *
 * Left to itself `Intl` writes the dollar as `US$`, the rouble as
 * `RUB` and the złoty as `PLN` while giving the euro its `€` — so half
 * the picker read as a symbol and half as text. Worse, the field
 * beside a price used a hand-written table and the price used `Intl`,
 * and the two disagreed on the same row.
 *
 * One source now, and this is the guard: a currency added to the list
 * whose narrow symbol is just its code fails here rather than on
 * somebody's screen.
 */
describe('currency symbols', () => {
  it.each(CURRENCIES.map((c) => c.code))('%s is a symbol, not a code', (code) => {
    const symbol = symbolFor(code, 'pt');

    expect(symbol).not.toBe(code);
    expect(symbol.length).toBeLessThanOrEqual(2);
  });

  it('agrees with what the formatter puts in front of the number', () => {
    for (const { code } of CURRENCIES) {
      expect(formatMoney(1, code, 'pt')).toContain(symbolFor(code, 'pt'));
    }
  });

  /** The two that used to print as `US$` and `RUB`. */
  it.each([
    ['USD', '$'],
    ['RUB', '₽'],
    ['PLN', 'zł'],
    ['UAH', '₴'],
  ])('draws %s as %s', (code, symbol) => {
    expect(symbolFor(code, 'pt')).toBe(symbol);
  });
});
