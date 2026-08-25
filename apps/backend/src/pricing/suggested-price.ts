/**
 * What to suggest a seller asks for an item.
 *
 *     suggested = base
 *               + min( Σ sticker × SP% × scrape × diminishing, 2 × base )
 *               + charm in full
 *
 * **It is a suggestion and never called a market price.** The seller
 * sets the number; this exists so they do not have to research four
 * stickers to name one. Every part of it is a measured band with a
 * range, and the ranges are wide — which is exactly why the cap below
 * carries most of the weight.
 *
 * **No float premium.** No source reviewed gives a method for one, and a
 * factor invented here would be the screen asserting something nobody
 * can check.
 *
 * **Position is deliberately not used.** It multiplies real transfer by
 * 0.5 to 2.5, and we cannot know it: the slot we have is the order Steam
 * returns, and Valve itself swaps positions between the web inventory
 * and the game. A known error we cannot remove, and one more reason the
 * figure is a suggestion.
 *
 * Everything here is integer cents. A percentage of a float price is
 * where money starts drifting.
 */

/** One piece applied to the item, with what it sells for on its own. */
export interface AppliedInput {
  kind: 'STICKER' | 'PATCH' | 'CHARM';
  /** As it is listed on its own, e.g. `Sticker | Titan | Katowice 2014`. */
  marketHashName: string;
  /** Its own market price in cents, or null where no market carries it. */
  priceCents: number | null;
  /** Scrape, 0 = intact, 1 = nearly gone. Null when unknown. */
  wear: number | null;
}

/** What one applied piece contributes, and why. */
export interface AppliedContribution {
  marketHashName: string;
  kind: AppliedInput['kind'];
  /** Its own price, unchanged. Null where it has none. */
  priceCents: number | null;
  /** What it adds to the weapon, in cents. */
  addsCents: number;
  /** The transfer rate used. 1 for a charm, which is added whole. */
  rate: number;
}

export interface SuggestedPrice {
  /** The skin on its own, in cents. */
  baseCents: number;
  /** After the cap, so the parts below sum to the total. */
  stickerCents: number;
  charmCents: number;
  /** True when the stickers were worth more than twice the skin. */
  stickerCapped: boolean;
  totalCents: number;
  /** One entry per applied piece, in the order given. */
  applied: AppliedContribution[];
}

/**
 * How much of a sticker's own price survives being applied.
 *
 * **The low end of each measured band, on purpose.** A suggestion that
 * is too low is one the seller raises in a second; one that is too high
 * is an item that quietly never sells, and they will not know why. The
 * bands themselves came from 19/08's research:
 *
 * - ordinary tournament sticker: 0.5–1.5%
 * - modern Major holo: 0.5–2%
 * - Crown Foil: 3–8%
 * - Katowice 2014 holo: 5–15%
 *
 * The often-quoted "50%" only ever applied to a Katowice holo on a skin
 * people actually want, and it is not in this table for that reason.
 *
 * Numbers to calibrate against real sales, not to be right first time.
 */
const KATOWICE_2014_HOLO = 0.05;

/**
 * Katowice 2014 in any finish, and Crown Foil, share the 3–8% band.
 *
 * The paper ones are in here because of the worked example in
 * CLAUDE.md, which is this exact item: an AK-47 Blue Laminate carrying
 * Clan-Mystik, Team Dignitas and Titan — all paper — and which applies
 * 3–8% to them, not the ordinary rate. Reading "Katowice 2014 holo:
 * 5–15%" as "everything else from that tournament is ordinary" gave
 * that rifle a $14.56 sticker premium and never reached the cap, which
 * is the opposite of what the calibration concluded.
 */
const KATOWICE_2014 = 0.03;
const CROWN_FOIL = 0.03;

/**
 * Everything else, including a modern Major holo — its band is 0.5–2%,
 * and the low end of that is the ordinary rate anyway.
 */
const ORDINARY = 0.005;

/**
 * Four stickers are worth 50–70% of their transfer each, not four times
 * one. Indexed by how many are on the weapon; the low end again.
 */
const DIMINISHING = [1, 1, 0.83, 0.67, 0.5];

/**
 * How much of the transfer a scraped sticker keeps.
 *
 * Measured retention runs roughly 100% intact, 50–75% lightly scraped,
 * 25–50% at half, 10–25% heavily, and near nothing below a fifth
 * remaining. Keyed on the scrape we already read from Steam, again at
 * the low end of each band.
 */
function scrapeRetention(wear: number | null): number {
  // Unknown scrape is treated as intact. It is the wrong direction to
  // err in, and it is chosen anyway: the alternative deletes a $3,000
  // Titan from the sum over a field Steam did not send. The cap is what
  // bounds the damage — the whole contribution still cannot exceed twice
  // the skin.
  if (wear === null || wear === 0) return 1;

  if (wear <= 0.25) return 0.5;
  if (wear <= 0.5) return 0.25;
  if (wear <= 0.75) return 0.1;

  // Below a fifth remaining it is decoration, not value.
  return 0;
}

/**
 * The transfer rate for one sticker, from its name.
 *
 * The name is the only thing we can classify on, and it is stable —
 * unlike position. Anything unrecognised falls to the ordinary band
 * rather than being guessed upward: the expensive mistake here is
 * treating a common sticker as a Katowice.
 */
function transferRate(marketHashName: string): number {
  const name = marketHashName.toLowerCase();

  if (name.includes('katowice 2014')) {
    return name.includes('(holo)') ? KATOWICE_2014_HOLO : KATOWICE_2014;
  }

  if (name.includes('crown') && name.includes('(foil)')) {
    return CROWN_FOIL;
  }

  return ORDINARY;
}

/**
 * The suggestion for one item.
 *
 * Returns null when the skin itself has no price: there is nothing to
 * cap the stickers against and nothing to add them to, and a suggestion
 * made of stickers alone would describe an item nobody is selling.
 */
export function suggestedPrice(
  baseCents: number | null,
  applied: AppliedInput[],
): SuggestedPrice | null {
  if (baseCents === null || baseCents <= 0) return null;

  const stickers = applied.filter((a) => a.kind !== 'CHARM');
  const diminishing =
    DIMINISHING[Math.min(stickers.length, DIMINISHING.length - 1)];

  // What each piece would add before the cap, in the order given so the
  // screen can line the numbers up with the images.
  const raw: AppliedContribution[] = applied.map((piece) => {
    if (piece.priceCents === null || piece.priceCents <= 0) {
      return { ...piece, addsCents: 0, rate: 0 };
    }

    // A charm detaches and returns to the inventory intact and tradable
    // — the only cost is a $0.99 detachment pack — so none of its value
    // is lost to the weapon. Stickers are destroyed on removal, which is
    // the whole reason they transfer a fraction.
    if (piece.kind === 'CHARM') {
      return { ...piece, addsCents: piece.priceCents, rate: 1 };
    }

    const rate =
      transferRate(piece.marketHashName) *
      scrapeRetention(piece.wear) *
      diminishing;

    return {
      ...piece,
      addsCents: Math.round(piece.priceCents * rate),
      rate,
    };
  });

  const stickerRaw = raw
    .filter((a) => a.kind !== 'CHARM')
    .reduce((sum, a) => sum + a.addsCents, 0);

  /**
   * **The cap is the load-bearing part, not a safety rail.**
   *
   * Checked against a real item: an AK-47 Blue Laminate carrying
   * $5,821 of Katowice 2014 stickers on a $30.80 skin. The honest
   * transfer range of 3–8% produces suggestions from $150 to $400
   * uncapped, and that spread is useless to a seller. Capped at twice
   * the base it lands on $61.60 whichever end you take.
   *
   * The cap also carries the economics: nobody pays a $500 premium on a
   * $30 rifle, however good the stickers are. Sell the stickers, not the
   * gun.
   */
  const cap = baseCents * 2;
  const stickerCapped = stickerRaw > cap;
  const stickerCents = stickerCapped ? cap : stickerRaw;

  // Scaled back proportionally when the cap bites, so the per-sticker
  // numbers on screen still add up to the total on screen. A breakdown
  // that does not sum is worse than no breakdown.
  const scaled = stickerCapped ? distribute(raw, stickerRaw, cap) : raw;

  const charmCents = raw
    .filter((a) => a.kind === 'CHARM')
    .reduce((sum, a) => sum + a.addsCents, 0);

  return {
    baseCents,
    stickerCents,
    charmCents,
    stickerCapped,
    totalCents: baseCents + stickerCents + charmCents,
    applied: scaled,
  };
}

/**
 * Scales the sticker contributions down to the cap.
 *
 * The rounding remainder goes on the largest sticker, which is the one
 * where a cent is least visible and the one whose share the total is
 * mostly made of anyway.
 */
function distribute(
  applied: AppliedContribution[],
  rawTotal: number,
  cap: number,
): AppliedContribution[] {
  const scaled = applied.map((a) =>
    a.kind === 'CHARM'
      ? a
      : { ...a, addsCents: Math.floor((a.addsCents * cap) / rawTotal) },
  );

  const stickers = scaled.filter((a) => a.kind !== 'CHARM');
  const short = cap - stickers.reduce((sum, a) => sum + a.addsCents, 0);

  if (short === 0 || stickers.length === 0) return scaled;

  const largest = stickers.reduce((a, b) =>
    b.addsCents > a.addsCents ? b : a,
  );
  largest.addsCents += short;

  return scaled;
}
