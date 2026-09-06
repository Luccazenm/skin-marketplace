/**
 * The languages the site offers, and the flag each one is shown under.
 *
 * **The language and the country are different codes, and conflating
 * them is the classic locale bug.** Ukrainian is `uk` from `UA`, Czech
 * `cs` from `CZ`, Swedish `sv` from `SE`, Japanese `ja` from `JP`,
 * Korean `ko` from `KR`. Two fields, never one clever string.
 *
 * The country under a language is a choice, not a fact — English is not
 * the United States' alone, and most Spanish-speaking players are in
 * Latin America rather than Spain. It is the convention a picker this
 * size uses; revisiting it is a product decision.
 *
 * Each name is written in its own language. A picker that lists
 * "Japanese" to somebody who reads only Japanese has not helped them.
 *
 * Lives in `lib` rather than beside the header because both the picker
 * and the i18n setup need it, and a second copy would drift.
 */
export interface Language {
  /** BCP 47 code. This is what i18next is given. */
  code: string;
  /** ISO 3166-1 alpha-2, for the flag. */
  country: string;
  /** The language's name, in that language. */
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', country: 'US', name: 'English' },
  { code: 'pt', country: 'BR', name: 'Português' },
  { code: 'es', country: 'ES', name: 'Español' },
  { code: 'ru', country: 'RU', name: 'Русский' },
  { code: 'zh', country: 'CN', name: '中文' },
  { code: 'pl', country: 'PL', name: 'Polski' },
  { code: 'tr', country: 'TR', name: 'Türkçe' },
  { code: 'uk', country: 'UA', name: 'Українська' },
  { code: 'de', country: 'DE', name: 'Deutsch' },
  { code: 'fr', country: 'FR', name: 'Français' },
  { code: 'cs', country: 'CZ', name: 'Čeština' },
  { code: 'sv', country: 'SE', name: 'Svenska' },
  { code: 'ja', country: 'JP', name: '日本語' },
  { code: 'ko', country: 'KR', name: '한국어' },
  { code: 'it', country: 'IT', name: 'Italiano' },
  { code: 'nl', country: 'NL', name: 'Nederlands' },
];

/** English is the source: every key exists here, so nothing can be missing. */
export const FALLBACK = 'en';

export function languageFor(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
