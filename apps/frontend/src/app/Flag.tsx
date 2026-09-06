import { BR, CN, ES, RU, US } from 'country-flag-icons/react/3x2';

/**
 * The flags in the language picker.
 *
 * The list used emoji — `🇺🇸`, `🇧🇷` — and on Windows an emoji flag is not
 * a flag: the platform ships no glyph for a pair of regional indicator
 * letters, so it draws the letters instead and the menu read "US", "BR",
 * "ES". The characters were right; the font had nothing to show for
 * them, and changing the data would have changed nothing.
 *
 * **Drawn by `country-flag-icons`, not by us.** The first version here
 * was five hand-written SVGs, which meant Brazil without its celestial
 * globe, Spain without its arms and fifty stars reduced to twenty dots.
 * Invisible at 18px and wrong the moment a flag appears anywhere larger
 * — and a national symbol is exactly the thing somebody notices.
 *
 * The package exports one component per flag, so only the five imported
 * above reach the bundle. The argument for hand-drawing them was that a
 * package would carry two hundred; it does not.
 */

export type FlagCode = 'US' | 'BR' | 'ES' | 'RU' | 'CN';

const FLAGS = { US, BR, ES, RU, CN } as const;

/**
 * One flag at 3:2, the ratio the package draws and four of these five
 * officially use.
 *
 * The hairline is not decoration: three of them are white at an edge,
 * and on a dark menu a white flag with no outline stops being a
 * rectangle.
 */
export function Flag({ code, size = 18 }: { code: FlagCode; size?: number }) {
  const Drawing = FLAGS[code];

  return (
    <Drawing
      width={size}
      height={(size / 3) * 2}
      className="flex-shrink-0 rounded-[1px]"
      style={{ outline: '1px solid rgba(255,255,255,0.15)', outlineOffset: -1 }}
      aria-hidden="true"
    />
  );
}
