/**
 * The trading community's shorthand for wear, and deliberately not
 * translated.
 *
 * FN, MW, FT, WW and BS are written the same on a Brazilian forum, a
 * Russian one and a Chinese one — they are closer to ticker symbols
 * than to words, and the full name is one click away in the detail.
 *
 * They are also the only thing that fits a card. A grid card gives the
 * wear about 58px; "Field-Tested" needs 65 and "Testada em Campo" 86,
 * so the full name clipped on every card once prices and labels were
 * read in Portuguese.
 *
 * In `lib` rather than beside one of the grids because three screens
 * draw it — Market, Trade and Sell — and a second copy is how the
 * Sell cards ended up spelling it out while the others did not.
 */
const SHORT: Record<string, string> = {
  'Factory New': 'FN',
  'Minimal Wear': 'MW',
  'Field-Tested': 'FT',
  'Well-Worn': 'WW',
  'Battle-Scarred': 'BS',
};

/**
 * `"Field-Tested"` -> `"FT"`.
 *
 * Anything unrecognised comes back unchanged rather than blank: Valve
 * could ship a sixth wear tomorrow, and a card that then showed nothing
 * would be worse than one showing a word that is merely long.
 */
export function wearShort(exterior: string): string {
  return SHORT[exterior] ?? exterior;
}
