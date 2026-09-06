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
import { activeLanguage } from './i18n';
import { BASE_CURRENCY, isSupported } from './currencies';

/**
 * Which currency prices are read in, and how to draw one.
 *
 * **This converts what an item is worth, never what someone is paid.**
 * Listings are priced in USD and settlement is USD or crypto; a number
 * that leaves or enters a balance stays in dollars and is formatted
 * without going through here. The split is deliberate: a screen that
 * quietly converted a payout would be quoting a figure the ledger has
 * never heard of.
 *
 * **Market and Trade convert. Sell does not, and that is not an
 * oversight.** Sell is where a price gets set, in a field that sends
 * dollars to the API — so every figure on it exists to answer "what
 * dollar price do I put here". A recommended price in reais beside an
 * input in dollars is worse than no conversion at all: it is guidance
 * in the wrong unit. Market and Trade are read, not typed into, and
 * there the reader's own currency is simply easier to judge.
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

    return {
      currency,
      setCurrency,
      applyAccountDefault,
      rate,
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

/** Just the formatter, for the many places that only draw a price. */
export function useMoney(): (usd: number) => string {
  return useContext(CurrencyContext).money;
}
