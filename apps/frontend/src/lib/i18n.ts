import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import { FALLBACK, LANGUAGES } from './languages';

/**
 * Translation, and the rules around it.
 *
 * **English is the source.** Every key exists in `en.json`, so a missing
 * translation falls back to English rather than to the key — a screen
 * showing `sell.listItem` is worse than one showing the English words,
 * and with sixteen languages the gap between "translated" and "shipped"
 * is where the site will live for a long time.
 *
 * **Catalogues load on demand.** Bundling sixteen would put fifteen
 * unread ones in front of every visitor. Only English ships with the
 * app, because something has to be on screen before the first fetch
 * lands.
 */

/**
 * A fake locale that no human reads, for finding what breaks the layout.
 *
 * German runs about a third longer than English and Finnish worse; a
 * card sized to "Sell instantly" splits or clips on either. Rather than
 * discovering that once per language after the translations arrive,
 * `?lang=pseudo` renders every string padded and accented — the text
 * stays recognisable while occupying the space the longest real
 * translation will.
 *
 * Development only. It is generated from English at runtime, so it
 * covers every key the moment the key exists.
 */
const PSEUDO = 'pseudo';

const ACCENTS: Record<string, string> = {
  a: 'ȧ', e: 'ḗ', i: 'ī', o: 'ő', u: 'ŭ', c: 'ƈ', n: 'ƞ', s: 'ş', t: 'ŧ',
  A: 'Ȧ', E: 'Ḗ', I: 'Ī', O: 'Ő', U: 'Ŭ',
};

function pseudoise(value: unknown): unknown {
  if (typeof value === 'string') {
    // Placeholders are left alone: mangling `{{count}}` would break the
    // interpolation this exists to test, not the layout.
    const marked = value.replace(
      /(\{\{[^}]+\}\})|([A-Za-z])/g,
      (_, placeholder: string | undefined, letter: string | undefined) =>
        placeholder ?? ACCENTS[letter as string] ?? (letter as string),
    );

    // A third longer, which is roughly where German and Russian land.
    const padding = '·'.repeat(Math.ceil(value.length * 0.35));
    return `⟦${marked}${padding}⟧`;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, pseudoise(v)]),
    );
  }

  return value;
}

/** Loaded once each; i18next holds them after that. */
const loaded = new Set([FALLBACK]);

/**
 * "pt-BR" and "pt-PT" are both served by `pt.json`.
 *
 * The detector reports what the browser says, which is a full tag. The
 * catalogues are named by language alone, so asking for `pt-BR.json`
 * finds nothing and quietly leaves the site in English — which is
 * exactly what happened the first time this ran.
 */
function baseOf(code: string): string {
  return code.split('-')[0].toLowerCase();
}

export async function loadLanguage(tag: string): Promise<void> {
  const code = baseOf(tag);
  if (loaded.has(code) || code === PSEUDO) return;

  try {
    const catalogue = (await import(`../locales/${code}.json`)) as {
      default: Record<string, unknown>;
    };

    i18next.addResourceBundle(code, 'translation', catalogue.default, true, true);
    loaded.add(code);
  } catch {
    // No catalogue for that language yet. English shows through, which
    // is the intended state for every language until it is translated —
    // not an error, and not worth interrupting anybody over.
    loaded.add(code);
  }
}

/**
 * Which language the picker should show as chosen.
 *
 * **Not `resolvedLanguage`.** That reports the first language in the
 * fallback chain that had resources at the moment it resolved, and our
 * catalogues arrive after `init` — so a site correctly rendering
 * Portuguese reported "en", and the picker put its tick on English.
 *
 * `language` is what was actually asked for, which is what the picker
 * is asking about. Reduced to the base so "pt-BR" ticks "Português".
 */
export function activeLanguage(): string {
  return baseOf(i18next.language || FALLBACK);
}

export async function changeLanguage(code: string): Promise<void> {
  await loadLanguage(code);
  await i18next.changeLanguage(code);
}

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      [FALLBACK]: { translation: en },
      ...(import.meta.env.DEV
        ? { [PSEUDO]: { translation: pseudoise(en) as Record<string, unknown> } }
        : {}),
    },
    fallbackLng: FALLBACK,
    supportedLngs: [
      ...LANGUAGES.map((l) => l.code),
      ...(import.meta.env.DEV ? [PSEUDO] : []),
    ],
    // "pt-BR" and "pt-PT" both read the `pt` catalogue. Without this a
    // browser set to pt-BR matches nothing and lands on English.
    load: 'languageOnly',
    detection: {
      // The stored choice wins over the browser: somebody who picked a
      // language meant it, including picking English on a Portuguese
      // machine. `?lang=` is first so pseudo can be reached by URL.
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'nextskins.language',
      caches: ['localStorage'],
    },
    interpolation: {
      // React escapes what it renders; doing it twice turns an
      // apostrophe into `&#39;` on screen.
      escapeValue: false,
    },
  });

// The detector may have chosen a language whose catalogue is not in the
// bundle. Fetch it now rather than showing English for a beat and then
// swapping — the first paint is the one people judge.
void loadLanguage(i18next.language);

export default i18next;
