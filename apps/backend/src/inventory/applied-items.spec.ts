import { extractApplied, withScrape, type AppliedItem } from './applied-items';

/**
 * HTML copied from a real Steam response, unedited.
 * If Valve changes the format, these tests break — which is the point.
 */
const REAL_STICKER_INFO =
  '<br><div id="sticker_info" class="sticker_info" style="border: 2px solid rgb(102, 102, 102); border-radius: 6px; width=100; margin:4px; padding:8px;"><center>' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/recoil/ak47_recoil_gold.bd3d66b2215a95ed966dce1dbc907b6594ed050f.png" title="Sticker: Hello AK-47 (Gold)">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/mystik.458d518d5985d780551ea60ce2c8c9ff92830efe.png" title="Sticker: Clan-Mystik | Katowice 2014">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/dignitas.e1d16be85014b4f04fa93f06a62a7068235fd56f.png" title="Sticker: Team Dignitas | Katowice 2014">' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/stickers/emskatowice2014/titan.c6594b1f3592efec6f5261228f9e5a90a45760a6.png" title="Sticker: Titan | Katowice 2014">' +
  '<br>Sticker: Hello AK-47 (Gold), Clan-Mystik | Katowice 2014, Team Dignitas | Katowice 2014, Titan | Katowice 2014</center></div>';

const REAL_KEYCHAIN_INFO =
  '<br><div id="keychain_info" class="keychain_info" style="border: 2px solid rgb(102, 102, 102);"><center>' +
  '<img width=64 height=48 src="https://cdn.steamstatic.com/apps/730/icons/econ/keychains/missinglink/kc_missinglink_guerilla.8cfcb67206c227f0961b95eda81d2f49efc879be.png" title="Charm: Lil\' Crass">' +
  "<br>Charm: Lil' Crass</center></div>";

describe('extractApplied', () => {
  it('reads the four stickers of a real AK', () => {
    const r = extractApplied([
      { name: 'sticker_info', value: REAL_STICKER_INFO },
    ]);

    expect(r).toHaveLength(4);
    expect(r.map((a) => a.name)).toEqual([
      'Hello AK-47 (Gold)',
      'Clan-Mystik | Katowice 2014',
      'Team Dignitas | Katowice 2014',
      'Titan | Katowice 2014',
    ]);
    expect(r.every((a) => a.kind === 'STICKER')).toBe(true);
    expect(r[0].imageUrl).toContain('ak47_recoil_gold');
  });

  // The order is the slot position: a Katowice in position 1 is worth
  // something different from the same sticker in position 3.
  it('numbers positions in the order Steam returns them', () => {
    const r = extractApplied([
      { name: 'sticker_info', value: REAL_STICKER_INFO },
    ]);

    expect(r.map((a) => a.position)).toEqual([0, 1, 2, 3]);
  });

  // The block is named keychain_info but the title says "Charm". We use
  // the title, which is what Valve shows the user.
  it('reads a charm despite the mismatched block name', () => {
    const r = extractApplied([
      { name: 'keychain_info', value: REAL_KEYCHAIN_INFO },
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('CHARM');
    expect(r[0].name).toBe("Lil' Crass");
  });

  it('joins stickers and charm from the same item, numbering per kind', () => {
    const r = extractApplied([
      { name: 'sticker_info', value: REAL_STICKER_INFO },
      { name: 'keychain_info', value: REAL_KEYCHAIN_INFO },
    ]);

    expect(r).toHaveLength(5);
    // Position counts per kind: the charm is its own 0, not the 4th.
    expect(r.find((a) => a.kind === 'CHARM')!.position).toBe(0);
  });

  it('reads an agent patch', () => {
    const html =
      '<div id="patch_info"><center>' +
      '<img src="https://cdn/patch1.png" title="Patch: Guerrilla Warfare">' +
      '</center></div>';

    const r = extractApplied([{ name: 'patch_info', value: html }]);

    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('PATCH');
    expect(r[0].name).toBe('Guerrilla Warfare');
  });

  it('decodes HTML entities in the name', () => {
    const html =
      '<div id="sticker_info">' +
      '<img src="https://cdn/x.png" title="Sticker: Fnatic &amp; Co (Foil)">' +
      '</div>';

    const r = extractApplied([{ name: 'sticker_info', value: html }]);

    expect(r[0].name).toBe('Fnatic & Co (Foil)');
  });

  it('ignores blocks that are not applications', () => {
    const r = extractApplied([
      { name: 'description', value: '<img src="x" title="Sticker: Fake">' },
      { name: 'exterior_wear', value: 'Factory New' },
      { name: 'blank', value: ' ' },
    ]);

    expect(r).toHaveLength(0);
  });

  /**
   * The name each piece is listed under on its own, which is what the
   * price lists are keyed by. Checked against live data on 2026-08-25:
   * 24 of the 25 applied pieces in a real inventory came back priced
   * under exactly these names, the 25th being one BUFF does not carry.
   */
  it('builds the market name each piece is sold under', () => {
    const r = extractApplied([
      { name: 'sticker_info', value: REAL_STICKER_INFO },
      { name: 'keychain_info', value: REAL_KEYCHAIN_INFO },
    ]);

    expect(r.map((a) => a.marketHashName)).toEqual([
      'Sticker | Hello AK-47 (Gold)',
      'Sticker | Clan-Mystik | Katowice 2014',
      'Sticker | Team Dignitas | Katowice 2014',
      'Sticker | Titan | Katowice 2014',
      "Charm | Lil' Crass",
    ]);
  });

  it('names a patch as a patch, not as a sticker', () => {
    const html =
      '<div id="patch_info"><center>' +
      '<img src="https://cdn/patch1.png" title="Patch: Guerrilla Warfare">' +
      '</center></div>';

    expect(
      extractApplied([{ name: 'patch_info', value: html }])[0].marketHashName,
    ).toBe('Patch | Guerrilla Warfare');
  });

  // The decoded name, not the raw one: "Sticker | Fnatic &amp; Co" is
  // not a name any market has ever heard of.
  it('builds the market name from the decoded name', () => {
    const html =
      '<div id="sticker_info">' +
      '<img src="https://cdn/x.png" title="Sticker: Fnatic &amp; Co (Foil)">' +
      '</div>';

    expect(
      extractApplied([{ name: 'sticker_info', value: html }])[0].marketHashName,
    ).toBe('Sticker | Fnatic & Co (Foil)');
  });

  it('returns an empty list without throwing when there are no descriptions', () => {
    expect(extractApplied(undefined)).toEqual([]);
    expect(extractApplied([])).toEqual([]);
    expect(extractApplied([{ name: 'sticker_info' }])).toEqual([]);
  });
});

describe('withScrape', () => {
  const applied = (kind: AppliedItem['kind'], position = 0): AppliedItem => ({
    kind,
    name: `${kind} ${position}`,
    marketHashName: `${kind} | ${position}`,
    imageUrl: null,
    position,
    wear: null,
  });

  it('pairs scrape levels in order', () => {
    const r = withScrape(
      [applied('STICKER', 0), applied('STICKER', 1)],
      [0.63, 0.84],
    );

    expect(r.map((a) => a.wear)).toEqual([0.63, 0.84]);
  });

  // The only link between the two Steam sources is the order. Pairing
  // lists of different lengths would assign one sticker's scrape level to
  // another, and scrape level moves the price directly.
  it('does not guess when the counts disagree', () => {
    const r = withScrape([applied('STICKER', 0), applied('STICKER', 1)], [0.5]);

    expect(r.map((a) => a.wear)).toEqual([null, null]);
  });

  // Charms do not scrape and do not appear in asset_accessories, so they
  // must not consume a position in the pairing.
  it('leaves the charm out of the count', () => {
    const r = withScrape([applied('STICKER', 0), applied('CHARM', 0)], [0.42]);

    expect(r[0].wear).toBe(0.42);
    expect(r[1].wear).toBeNull();
  });

  it('treats an intact sticker as zero, not as missing', () => {
    const r = withScrape([applied('STICKER', 0)], [0]);

    expect(r[0].wear).toBe(0);
  });
});
