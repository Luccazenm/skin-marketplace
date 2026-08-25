import { suggestedPrice, type AppliedInput } from './suggested-price';

/**
 * The price suggestion.
 *
 * Two things are pinned hardest: the cap, because it is what makes the
 * number usable at all, and the fact that the parts always sum to the
 * total, because the screen shows the parts.
 */
describe('suggestedPrice', () => {
  const sticker = (
    marketHashName: string,
    priceCents: number | null,
    wear: number | null = 0,
  ): AppliedInput => ({ kind: 'STICKER', marketHashName, priceCents, wear });

  const charm = (priceCents: number | null): AppliedInput => ({
    kind: 'CHARM',
    marketHashName: "Charm | Lil' Crass",
    priceCents,
    wear: null,
  });

  const KATO_TITAN = 'Sticker | Titan (Holo) | Katowice 2014';

  it('suggests the skin alone when nothing is applied', () => {
    const s = suggestedPrice(3080, [])!;

    expect(s.totalCents).toBe(3080);
    expect(s.stickerCents).toBe(0);
    expect(s.charmCents).toBe(0);
    expect(s.stickerCapped).toBe(false);
  });

  /**
   * An ordinary sticker transfers half a percent, which on a $2 sticker
   * is a cent. That is the honest answer, and the reason the screen has
   * to show the breakdown: someone who put four stickers on a rifle
   * expects the price to move, and it does not.
   */
  it('adds almost nothing for ordinary stickers', () => {
    const s = suggestedPrice(3000, [
      sticker('Sticker | Ninjas in Pyjamas | 2020 RMR', 200),
    ])!;

    expect(s.stickerCents).toBe(1);
    expect(s.totalCents).toBe(3001);
  });

  it('transfers 5% of a Katowice 2014 holo', () => {
    // One sticker, intact, no diminishing: 100000 × 0.05.
    const s = suggestedPrice(1000000, [sticker(KATO_TITAN, 100000)])!;

    expect(s.stickerCents).toBe(5000);
    expect(s.stickerCapped).toBe(false);
  });

  it('transfers 3% of a Crown Foil', () => {
    const s = suggestedPrice(1000000, [
      sticker('Sticker | Crown (Foil)', 100000),
    ])!;

    expect(s.stickerCents).toBe(3000);
  });

  /**
   * The expensive mistake would be reading an unknown sticker as a
   * Katowice. Anything unrecognised takes the ordinary rate.
   */
  it('reads an unknown sticker as ordinary rather than as rare', () => {
    const s = suggestedPrice(1000000, [
      sticker('Sticker | Something Valve Shipped Yesterday', 100000),
    ])!;

    expect(s.stickerCents).toBe(500);
  });

  /**
   * A Katowice 2014 paper sticker is not the holo the 5–15% band was
   * measured on, but it is not ordinary either — it takes the 3–8%
   * band. Reading it as ordinary is a mistake this codebase actually
   * made: it gave the worked example below a $14.56 sticker premium and
   * never reached the cap, which is the opposite of what the
   * calibration in CLAUDE.md concluded.
   */
  it('gives a paper Katowice its own band, between holo and ordinary', () => {
    const s = suggestedPrice(1000000, [
      sticker('Sticker | Team Dignitas | Katowice 2014', 100000),
    ])!;

    expect(s.stickerCents).toBe(3000);
  });

  /**
   * The real item from CLAUDE.md, priced from the real inventory on
   * 2026-08-25: $5,821.27 of stickers on a $30.80 AK-47 Blue Laminate.
   * Uncapped this suggestion runs into the hundreds; capped it is the
   * only number a seller can act on.
   */
  it('caps the stickers at twice the skin', () => {
    const s = suggestedPrice(3080, [
      sticker('Sticker | Hello AK-47 (Gold)', 488),
      sticker('Sticker | Clan-Mystik | Katowice 2014', 132269),
      sticker('Sticker | Team Dignitas | Katowice 2014', 107138),
      sticker('Sticker | Titan | Katowice 2014', 342232),
    ])!;

    expect(s.stickerCapped).toBe(true);
    expect(s.stickerCents).toBe(6160);
    expect(s.totalCents).toBe(9240);

    // 61.60 of 5,821.27 is an effective transfer of 1.06%. CLAUDE.md
    // reached 1.50% on the same rifle and recorded CS.MONEY paying
    // 1.57% for it — the same order of magnitude, from the cap rather
    // than from the rate, which is the point the calibration makes.
    const own = 488 + 132269 + 107138 + 342232;
    expect(s.stickerCents / own).toBeCloseTo(0.0106, 4);
  });

  // The screen prints the parts next to the images, so they have to add
  // up to the number printed above them.
  it('keeps the parts summing to the total once capped', () => {
    const s = suggestedPrice(3080, [
      sticker('Sticker | Hello AK-47 (Gold)', 488),
      sticker(KATO_TITAN, 342232),
      sticker(KATO_TITAN, 342232),
    ])!;

    const summed = s.applied.reduce((sum, a) => sum + a.addsCents, 0);

    expect(summed).toBe(s.stickerCents + s.charmCents);
    expect(s.baseCents + summed).toBe(s.totalCents);
  });

  /**
   * A charm detaches intact and can be sold on its own — the only cost
   * is a $0.99 pack — so it is added whole, and it is outside the cap
   * for the same reason.
   */
  it('adds a charm at full value', () => {
    const s = suggestedPrice(3000, [charm(1250)])!;

    expect(s.charmCents).toBe(1250);
    expect(s.totalCents).toBe(4250);
  });

  it('leaves a charm out of the sticker cap', () => {
    const s = suggestedPrice(1000, [
      sticker(KATO_TITAN, 342232),
      charm(50000),
    ])!;

    // Stickers capped at 2 × 1000; the charm is added on top of that.
    expect(s.stickerCents).toBe(2000);
    expect(s.charmCents).toBe(50000);
    expect(s.totalCents).toBe(53000);
  });

  /** Four stickers are worth half their transfer each, not four times one. */
  it('applies diminishing returns across four stickers', () => {
    const one = suggestedPrice(10000000, [sticker(KATO_TITAN, 100000)])!;
    const four = suggestedPrice(10000000, [
      sticker(KATO_TITAN, 100000),
      sticker(KATO_TITAN, 100000),
      sticker(KATO_TITAN, 100000),
      sticker(KATO_TITAN, 100000),
    ])!;

    expect(one.stickerCents).toBe(5000);
    // 4 × 5000 × 0.5, not 4 × 5000.
    expect(four.stickerCents).toBe(10000);
  });

  describe('scrape', () => {
    const at = (wear: number | null) =>
      suggestedPrice(10000000, [sticker(KATO_TITAN, 100000, wear)])!
        .stickerCents;

    it('keeps everything on an intact sticker', () => {
      expect(at(0)).toBe(5000);
    });

    it('halves a lightly scraped one', () => {
      expect(at(0.2)).toBe(2500);
    });

    it('quarters one at half', () => {
      expect(at(0.5)).toBe(1250);
    });

    it('leaves a tenth on a heavily scraped one', () => {
      expect(at(0.75)).toBe(500);
    });

    it('leaves nothing below a fifth remaining', () => {
      expect(at(0.9)).toBe(0);
    });

    /**
     * The wrong direction to err in, chosen anyway: the alternative
     * deletes a $3,000 Titan from the sum over a field Steam did not
     * send, and the cap bounds what it can cost us.
     */
    it('treats an unknown scrape as intact', () => {
      expect(at(null)).toBe(5000);
    });
  });

  describe('refusals', () => {
    it('suggests nothing when the skin has no price', () => {
      expect(suggestedPrice(null, [sticker(KATO_TITAN, 342232)])).toBeNull();
      expect(suggestedPrice(0, [])).toBeNull();
    });

    // A sticker no market carries adds nothing, rather than the whole
    // item losing its suggestion over one piece.
    it('ignores an applied piece with no price', () => {
      const s = suggestedPrice(3000, [
        sticker('Sticker | Mirage (Gold)', null),
        charm(null),
      ])!;

      expect(s.totalCents).toBe(3000);
      expect(s.applied.every((a) => a.addsCents === 0)).toBe(true);
    });
  });
});
