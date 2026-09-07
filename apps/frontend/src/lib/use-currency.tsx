import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getExchangeRates } from './api';
import {
  fromUsdCents,
  minimumMinor,
  minorDigits,
  minorToPlain,
  parseMinor,
  toUsdCents,
} from './currency-math';
import { activeLanguage } from './i18n';
import { BASE_CURRENCY, isSupported } from './currencies';

/**
 * Which currency prices are read in, and how to draw one.
 *
 * **Every figure on screen is in the reader's currency. Everything
 * stored is in dollars.** The ledger is USD and settlement is USD or
 * crypto, so the conversion happens at the edge — on the way to the
 * screen, and on the way back from a field somebody typed into — and
 * nowhere in between. A rate never reaches the database.
 *
 * Two hooks, because they carry different risk. `useMoney` decorates a
 * number that already exists and cannot be wrong by more than a
 * rounding; `useMoneyEntry` decides what a seller is paid, and every
 * function behind it has a test in `currency-math.spec.ts`.
 *
 * The rate is read once per session and held: it cannot move between
 * somebody typing a price and that price being sent, which is the one
 * way this could quote a figure and store another.
 *
 * A context rather than props because the price appears at every depth
 * of both grids, the trade bar, three modals and a hover popup —
 * threading a rate through all of that would put a currency argument in
 * a dozen components that have no other business with money.
 */
interface CurrencyState {
  currency: string;
  setCurrency: (code: string) => void;
  /**
   * The account's saved currency, used only if this browser has no
   * choice of its own. See `applyAccountDefault` below.
   */
  applyAccountDefault: (code: string) => void;
  /** USD -> selected. 1 while the rates are in flight, or for USD. */
  rate: number;
  /**
   * USD -> any currency, for the one job that needs a rate other than
   * the current one: re-expressing a price already typed when the
   * reader switches currency.
   */
  rateOf: (code: string) => number;
  /** True until the table has arrived, so a caller can hold a skeleton. */
  loading: boolean;
  /** A market price, drawn in the reader's currency and locale. */
  money: (usd: number) => string;
}

const STORAGE_KEY = 'nextskins.currency';

const CurrencyContext = createContext<CurrencyState>({
  currency: BASE_CURRENCY,
  setCurrency: () => {},
  applyAccountDefault: () => {},
  rate: 1,
  rateOf: () => 1,
  loading: false,
  money: (usd) => formatMoney(usd, BASE_CURRENCY, 'en'),
});

/**
 * `1234.5` -> `$1,234.50`, `R$ 6.331,26`, `¥192,795`.
 *
 * `Intl` rather than a symbol glued to a number: it knows that German
 * writes `1.234,50 €` with the symbol last, that Japanese yen has no
 * decimal places, and that the grouping separator is not a comma
 * everywhere. Hand-rolling that is how a price ends up reading as a
 * thousand times its value to somebody.
 *
 * Falls back to the plain number if the runtime rejects the currency,
 * which is better than throwing inside a render.
 */
export function formatMoney(
  value: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function storedChoice(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isSupported(stored) ? stored : null;
  } catch {
    // A private window, or storage switched off. Dollars is a fine
    // place to start and the picker still works for this visit.
    return null;
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<string>(
    () => storedChoice() ?? BASE_CURRENCY,
  );

  /**
   * Whether this browser has a choice of its own, decided once at
   * mount and never re-read.
   *
   * It guards the account's saved currency from overwriting a pick.
   * Without it, a signed-in reader could choose reais, reload, and be
   * back in dollars — the account's stored `displayCurrency` winning
   * every time, and no way to change it, because no endpoint updates
   * that field yet.
   */
  const chose = useRef(storedChoice() !== null);

  const [rates, setRates] = useState<Record<string, number> | null>(null);

  // Asked for once, for the whole session: the table covers every
  // currency, so switching between them is arithmetic rather than a
  // request, and the backend caches it for six hours anyway.
  useEffect(() => {
    let cancelled = false;

    getExchangeRates()
      .then((table) => {
        if (!cancelled) setRates(table.rates);
      })
      .catch(() => {
        // Prices stay in dollars. Not worth interrupting anybody over —
        // and the picker keeps working the moment the table arrives.
        if (!cancelled) setRates({ USD: 1 });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Stable across renders, and it has to be.
   *
   * The header applies the account's saved currency in an effect that
   * lists this among its dependencies. A new function on every render
   * re-runs that effect on every render — which is what happened: the
   * picker set BRL, the provider re-rendered, the effect fired and put
   * it straight back to the account's USD, so clicking did nothing.
   */
  const setCurrency = useCallback((code: string) => {
    chose.current = true;
    setCurrencyState(code);

    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Same as above: the choice holds for this visit.
    }
  }, []);

  /**
   * What the account was last saved with. Applied only when this
   * browser is silent — somebody who picked a currency meant it, the
   * same rule the language detector follows.
   */
  const applyAccountDefault = useCallback((code: string) => {
    if (chose.current || !isSupported(code)) return;

    setCurrencyState(code);
  }, []);

  const value = useMemo<CurrencyState>(() => {
    // Unknown currency reads as 1 rather than 0 or NaN: showing the
    // dollar figure under the wrong symbol is wrong, but showing `R$0`
    // on a $3,000 knife is worse.
    const rate = currency === BASE_CURRENCY ? 1 : (rates?.[currency] ?? 1);

    // The reader's language decides the separators and the symbol's
    // side, not their currency: a Brazilian looking at dollars still
    // reads `US$ 1.234,50`.
    const locale = activeLanguage();

    const rateOf = (code: string) =>
      code === BASE_CURRENCY ? 1 : (rates?.[code] ?? 1);

    return {
      currency,
      setCurrency,
      applyAccountDefault,
      rate,
      rateOf,
      loading: rates === null,
      money: (usd: number) => formatMoney(usd * rate, currency, locale),
    };
  }, [currency, rates, setCurrency, applyAccountDefault]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext);
}

/**
 * A price already typed, restated in another currency.
 *
 * Used when the reader switches the picker with prices on the page.
 * Leaving the text alone would turn a `100` meaning R$100 into a `100`
 * meaning $100 the moment the label changed — a listing at five times
 * its intended price, from a click that looked like a display setting.
 *
 * Through dollars, because that is the only scale the two share, and
 * the drift that costs is bounded and tested in `currency-math.spec`.
 */
export function repriceText(
  text: string,
  from: string,
  to: string,
  rateOf: (code: string) => number,
): string | null {
  const fromDigits = minorDigits(from);
  const minor = parseMinor(text, fromDigits);
  if (minor === null) return null;

  const cents = toUsdCents(minor, fromDigits, rateOf(from));
  const toDigits = minorDigits(to);

  return minorToPlain(fromUsdCents(cents, toDigits, rateOf(to)), toDigits);
}

/**
 * Everything a price field needs to work in the reader's currency and
 * still hand the API dollars.
 *
 * Kept apart from `useMoney` because these are different jobs with
 * different stakes. That one decorates a number that already exists;
 * this one decides what a seller is paid, and every function here has
 * a test behind it in `currency-math.spec.ts`.
 */
export function useMoneyEntry() {
  const { currency, rate, rateOf, loading } = useCurrency();
  const locale = activeLanguage();

  // Memoised because callers put it in dependency arrays. A fresh
  // object every render would make the Sell page re-sort its whole
  // inventory on every keystroke.
  return useMemo(() => {
    const digits = minorDigits(currency);

    return {
    currency,
    rateOf,
    digits,

    /**
     * False until the rate table has arrived. A field that accepted a
     * price at a rate of 1 would convert R$100 into $100 — so the entry
     * waits rather than guessing, and only for the first moment of the
     * session.
     */
    ready: !loading,

    /** What was typed, as US cents. Null when it is not a price. */
    toUsdCents(text: string): number | null {
      const minor = parseMinor(text, digits);

      return minor === null ? null : toUsdCents(minor, digits, rate);
    },

    /** What was typed, as the API wants it: a USD decimal string. */
    toUsdString(text: string): string | null {
      const cents = this.toUsdCents(text);

      return cents === null ? null : minorToPlain(cents, 2);
    },

    /**
     * A price the seller typed, drawn back.
     *
     * From their own text, never through dollars: R$100 stored as
     * $19.50 comes back as R$99.98, and a field that corrects what
     * somebody just typed by two centavos is the screen arguing with
     * them.
     */
    formatTyped(text: string): string | null {
      const minor = parseMinor(text, digits);

      return minor === null
        ? null
        : formatMoney(minor / 10 ** digits, currency, locale);
    },

    /** A figure we hold in dollars — a payout, a market price. */
    formatUsdCents(cents: number): string {
      return formatMoney(
        fromUsdCents(cents, digits, rate) / 10 ** digits,
        currency,
        locale,
      );
    },

    /** The floor, in this currency, as the reader would type it. */
    minimum(minUsdCents: number): string {
      return formatMoney(
        minimumMinor(minUsdCents, digits, rate) / 10 ** digits,
        currency,
        locale,
      );
    },

    /** Whether what was typed clears the platform's floor. */
      meetsMinimum(text: string, minUsdCents: number): boolean {
        const cents = this.toUsdCents(text);

        return cents !== null && cents >= minUsdCents;
      },
    };
  }, [currency, rate, rateOf, loading, locale]);
}

/** Just the formatter, for the many places that only draw a price. */
export function useMoney(): (usd: number) => string {
  return useContext(CurrencyContext).money;
}
