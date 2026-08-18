import { ItemCategory, SkinVariant } from '@prisma/client';
import { mapItem, type RawItem } from './catalog-mapping';

/**
 * The catalog is where price, search and the storefront hang. Getting the
 * classification wrong breaks nothing visibly — it just makes a sticker
 * disappear from the sticker filter, or lets a weapon in without a float
 * range so the database rejects the whole row.
 */
describe('mapItem', () => {
  const ak: RawItem = {
    market_hash_name: 'AK-47 | Redline (Field-Tested)',
    weapon: { name: 'AK-47' },
    pattern: { name: 'Redline' },
    rarity: { name: 'Classified' },
    collections: [{ name: 'The Phoenix Collection' }],
    min_float: 0.1,
    max_float: 0.7,
    image: 'https://cdn/ak.png',
  };

  describe('weapon', () => {
    it('fills weapon, skin and float range', () => {
      const e = mapItem(ak)!;

      expect(e.category).toBe(ItemCategory.RIFLE);
      expect(e.weapon).toBe('AK-47');
      expect(e.skinName).toBe('Redline');
      expect(e.minFloat).toBe(0.1);
      expect(e.maxFloat).toBe(0.7);
      expect(e.collections).toEqual(['The Phoenix Collection']);
    });

    // The database constraint requires all four fields on a painted item.
    // Without a range in the dataset, falling back to the whole domain
    // beats losing the item.
    it('uses the full range when the dataset omits it', () => {
      const e = mapItem({
        ...ak,
        min_float: undefined,
        max_float: undefined,
      })!;

      expect(e.minFloat).toBe(0);
      expect(e.maxFloat).toBe(1);
    });

    it.each([
      ['AK-47', ItemCategory.RIFLE],
      ['AWP', ItemCategory.SNIPER_RIFLE],
      ['Desert Eagle', ItemCategory.PISTOL],
      ['MP9', ItemCategory.SMG],
      ['Nova', ItemCategory.SHOTGUN],
      ['Negev', ItemCategory.MACHINEGUN],
    ])('classifies %s', (weapon, expected) => {
      const e = mapItem({
        ...ak,
        market_hash_name: `${weapon} | Some Skin (FT)`,
        weapon: { name: weapon },
      })!;

      expect(e.category).toBe(expected);
    });
  });

  describe('items without a pattern', () => {
    // The reason for all this work: a sticker has its own price, and
    // without it in the catalog there is no way to show "the weapon is
    // worth X, each sticker is worth Y".
    it('lets a sticker in without weapon or float', () => {
      const e = mapItem({
        market_hash_name: 'Sticker | Titan | Katowice 2014',
        rarity: { name: 'Legendary' },
      })!;

      expect(e.category).toBe(ItemCategory.STICKER);
      expect(e.weapon).toBeNull();
      expect(e.skinName).toBeNull();
      expect(e.minFloat).toBeNull();
      expect(e.maxFloat).toBeNull();
    });

    it.each([
      ['Sticker | Titan | Katowice 2014', ItemCategory.STICKER],
      ['Patch | Team Liquid | Stockholm 2021', ItemCategory.PATCH],
      ["Charm | Lil' Crass", ItemCategory.CHARM],
      ['Sealed Graffiti | Bomb Squad', ItemCategory.GRAFFITI],
      ['Music Kit | Daniel Sadowski, Crimson Assault', ItemCategory.MUSIC_KIT],
      ['Kilowatt Case', ItemCategory.CONTAINER],
      ['Kilowatt Case Key', ItemCategory.KEY],
      ['Name Tag', ItemCategory.TOOL],
    ])('classifies %s', (name, expected) => {
      expect(mapItem({ market_hash_name: name })!.category).toBe(expected);
    });

    // A weapon sticker carries a weapon name inside it. Testing the
    // prefix first keeps it out of the weapon's category.
    it('does not confuse a weapon sticker with a weapon', () => {
      const e = mapItem({
        market_hash_name: 'Sticker | AK-47 | Katowice 2014',
        weapon: { name: 'AK-47' },
      })!;

      expect(e.category).toBe(ItemCategory.STICKER);
      expect(e.weapon).toBeNull();
    });

    it('maps an agent to AGENT, not to a weapon', () => {
      const e = mapItem({
        market_hash_name: 'Sir Bloody Miami Darryl | The Professionals',
        rarity: { name: 'Master' },
      })!;

      expect(e.category).toBe(ItemCategory.AGENT);
      expect(e.weapon).toBeNull();
    });
  });

  describe('knives and gloves', () => {
    it('treats ★ without a glove name as a knife', () => {
      const e = mapItem({
        market_hash_name: '★ Karambit | Doppler (Factory New)',
        weapon: { name: 'Karambit' },
        pattern: { name: 'Doppler' },
      })!;

      expect(e.category).toBe(ItemCategory.KNIFE);
      expect(e.weapon).toBe('Karambit');
    });

    it.each([
      "★ Sport Gloves | Pandora's Box (Field-Tested)",
      '★ Hand Wraps | Cobalt Skulls (Minimal Wear)',
    ])('recognises gloves in %s', (name) => {
      expect(mapItem({ market_hash_name: name })!.category).toBe(
        ItemCategory.GLOVES,
      );
    });
  });

  describe('variant', () => {
    // Each variant is quoted separately: same skin, different prices.
    it('recognises StatTrak', () => {
      const e = mapItem({
        ...ak,
        market_hash_name: 'StatTrak™ AK-47 | Redline (Field-Tested)',
      })!;

      expect(e.variant).toBe(SkinVariant.STATTRAK);
    });

    it('recognises Souvenir', () => {
      const e = mapItem({
        ...ak,
        market_hash_name: 'Souvenir AWP | Dragon Lore (Factory New)',
        weapon: { name: 'AWP' },
      })!;

      expect(e.variant).toBe(SkinVariant.SOUVENIR);
    });

    it('defaults to normal', () => {
      expect(mapItem(ak)!.variant).toBe(SkinVariant.NORMAL);
    });
  });

  describe('what stays out', () => {
    // Storing a price for something Steam never allows trading would be
    // storing the price of something that cannot be sold.
    it.each(['5 Year Veteran Coin', 'Service Medal', 'Operation Riptide Pass'])(
      'discards %s',
      (name) => {
        expect(mapItem({ market_hash_name: name })).toBeNull();
      },
    );

    it('discards an item without a name', () => {
      expect(mapItem({ rarity: { name: 'Classified' } })).toBeNull();
    });

    // 701 of the 11,134 stickers arrive with a null market_hash_name:
    // they do not exist on the market. Creating templates for them would
    // fill the catalog with rows no quote ever reaches.
    it('discards an item without a market name, even if it has a name', () => {
      expect(
        mapItem({
          name: 'Sticker | Shooter',
          market_hash_name: null,
          rarity: { name: 'Default' },
        }),
      ).toBeNull();
    });
  });

  describe('category from the source file', () => {
    // The file is authoritative about the TYPE; the name, about the
    // specific case. A tournament capsule says nowhere in its name that
    // it is a capsule — but it came from crates.json, and that is enough.
    it.each([
      'Katowice 2019 Legends (Holo-Foil)',
      'Stockholm 2021 Patch Pack',
      'StatTrak™ Masterminds 2 Music Kit Box',
      'CS:GO Weapon Case 2',
    ])('classifies %s by the file', (name) => {
      expect(
        mapItem(
          { market_hash_name: name },
          { defaultCategory: ItemCategory.CONTAINER },
        )!.category,
      ).toBe(ItemCategory.CONTAINER);
    });

    // The name wins when it resolves: a sticker listed in crates.json is
    // still a sticker.
    it('does not let the file override what the name already resolved', () => {
      const e = mapItem(
        { market_hash_name: 'Sticker | Titan | Katowice 2014' },
        { defaultCategory: ItemCategory.CONTAINER },
      )!;

      expect(e.category).toBe(ItemCategory.STICKER);
    });

    it('stays OTHER when neither name nor file resolves', () => {
      expect(mapItem({ market_hash_name: 'Unknown Thing' })!.category).toBe(
        ItemCategory.OTHER,
      );
    });
  });

  describe('vanilla knife', () => {
    // Vanillas exist, are expensive, and have no skin and no float: there
    // is no wear on an unpainted surface. Forty items were rejected on
    // the first import because the constraint demanded a skin on every
    // knife.
    it('enters without a skin and without a float range', () => {
      const e = mapItem({
        market_hash_name: '★ StatTrak™ Stiletto Knife',
        weapon: { name: 'Stiletto Knife' },
      })!;

      expect(e.category).toBe(ItemCategory.KNIFE);
      expect(e.weapon).toBe('Stiletto Knife');
      expect(e.skinName).toBeNull();
      expect(e.minFloat).toBeNull();
      expect(e.maxFloat).toBeNull();
    });

    // The constraint requires a weapon on every weapon. Without the field
    // in the dataset, the name is the only source — and losing the item
    // would be worse.
    it('derives the weapon from the name when the dataset omits it', () => {
      expect(mapItem({ market_hash_name: '★ Karambit' })!.weapon).toBe(
        'Karambit',
      );
      expect(
        mapItem({ market_hash_name: '★ StatTrak™ Talon Knife' })!.weapon,
      ).toBe('Talon Knife');
    });
  });

  describe('Zeus x27', () => {
    // Regression: the dataset carries weapon "Zeus x27", so the flow
    // reaches weaponCategory before any name check. The first version
    // only looked at the name and the Zeus stayed in OTHER on the real
    // import, even though the test passed.
    it('becomes EQUIPMENT when the dataset carries the weapon', () => {
      const e = mapItem({
        market_hash_name: 'Zeus x27 | Olympus (Factory New)',
        weapon: { name: 'Zeus x27' },
        pattern: { name: 'Olympus' },
        min_float: 0,
        max_float: 0.4,
      })!;

      expect(e.category).toBe(ItemCategory.EQUIPMENT);
      expect(e.weapon).toBe('Zeus x27');
    });

    it('becomes EQUIPMENT without the weapon field too', () => {
      const e = mapItem({
        market_hash_name: 'Zeus x27 | Olympus (Factory New)',
        pattern: { name: 'Olympus' },
        min_float: 0,
        max_float: 0.4,
      })!;

      expect(e.category).toBe(ItemCategory.EQUIPMENT);
      expect(e.skinName).toBe('Olympus');
      expect(e.minFloat).toBe(0);
      expect(e.maxFloat).toBe(0.4);
    });

    it.each([
      'StatTrak™ Zeus x27 | Tosai (Minimal Wear)',
      'Souvenir Zeus x27 | Dragon Snore (Well-Worn)',
    ])('recognises the variant in %s', (name) => {
      expect(mapItem({ market_hash_name: name })!.category).toBe(
        ItemCategory.EQUIPMENT,
      );
    });
  });

  describe('item origin', () => {
    // The skins file carries no collection at all: it only exists on the
    // other side, in collections.json and crates.json, cross-referenced
    // by skin_id.
    it('uses the origins resolved externally', () => {
      const e = mapItem(
        { ...ak, collections: undefined, skin_id: 'skin-abc' },
        { collections: ['The Kilowatt Collection'] },
      )!;

      expect(e.collections).toEqual(['The Kilowatt Collection']);
    });

    // The case that motivated the list: storing only one would mean
    // arbitrarily choosing which of the three, by iteration order. And
    // the number of origins matters — a skin dropping from three cases
    // has far more supply than an exclusive one.
    it('stores every case a knife drops from', () => {
      const e = mapItem(
        {
          market_hash_name: '★ Karambit | Doppler (Factory New)',
          weapon: { name: 'Karambit' },
          pattern: { name: 'Doppler' },
          skin_id: 'skin-525ac56c082c',
        },
        { collections: ['Chroma Case', 'Chroma 2 Case', 'Chroma 3 Case'] },
      )!;

      expect(e.collections).toEqual([
        'Chroma Case',
        'Chroma 2 Case',
        'Chroma 3 Case',
      ]);
    });

    it('merges the cross-check with what the item itself carries', () => {
      const e = mapItem(
        { ...ak, crates: [{ name: 'Some Case' }] },
        { collections: ['The Phoenix Collection'] },
      )!;

      expect(e.collections.sort()).toEqual([
        'Some Case',
        'The Phoenix Collection',
      ]);
    });

    it('does not repeat the same origin coming from two sources', () => {
      const e = mapItem(ak, { collections: ['The Phoenix Collection'] })!;

      expect(e.collections).toEqual(['The Phoenix Collection']);
    });

    it('falls back to the capsule when the cross-check does not reach', () => {
      const e = mapItem({
        market_hash_name: 'Sticker | Titan | Katowice 2014',
        crates: [{ name: 'EMS Katowice 2014 Legends' }],
      })!;

      expect(e.collections).toEqual(['EMS Katowice 2014 Legends']);
    });

    it('stays empty when no source informs it', () => {
      const e = mapItem({ ...ak, collections: undefined })!;

      expect(e.collections).toEqual([]);
    });
  });

  describe('description', () => {
    const raw =
      'Powerful and reliable, the AK-47 is one of the most popular ' +
      'assault rifles.\n\n<i>Never be afraid to push it to the limit</i>';

    it('splits the description from the flavor text', () => {
      const e = mapItem({ ...ak, description: raw })!;

      expect(e.description).toBe(
        'Powerful and reliable, the AK-47 is one of the most popular assault rifles.',
      );
      expect(e.flavorText).toBe('Never be afraid to push it to the limit');
    });

    // Handing third-party markup to the screen would force the frontend
    // to sanitize — and an item page is where someone decides to sell
    // something expensive.
    it('lets no HTML through', () => {
      const e = mapItem({
        ...ak,
        description: 'Text <b>with</b> <span style="x">markup</span>.',
      })!;

      expect(e.description).toBe('Text with markup.');
      expect(e.description).not.toContain('<');
    });

    it('converts <br> into a line break', () => {
      const e = mapItem({ ...ak, description: 'Line one<br>Line two' })!;

      expect(e.description).toBe('Line one\nLine two');
    });

    // Regression: the dataset ships the break as the two characters "\"
    // and "n". Without converting, the text "\n\n" appeared written out
    // in the stored description — it showed up on the first real import.
    it('converts a break written with a backslash', () => {
      const e = mapItem({
        ...ak,
        description: 'First part.\\n\\nSecond part.',
      })!;

      expect(e.description).toBe('First part.\n\nSecond part.');
      expect(e.description).not.toContain('\\n');
    });

    it('does not leave the literal break at the end', () => {
      const e = mapItem({
        ...ak,
        description: 'Skin text.\\n\\n<i>Flavor</i>',
      })!;

      expect(e.description).toBe('Skin text.');
      expect(e.flavorText).toBe('Flavor');
    });

    it('decodes entities', () => {
      const e = mapItem({
        ...ak,
        description: 'Bolt &amp; Chain &quot;special&quot;',
      })!;

      expect(e.description).toBe('Bolt & Chain "special"');
    });

    it('accepts a description without flavor text', () => {
      const e = mapItem({ ...ak, description: 'Just the description.' })!;

      expect(e.description).toBe('Just the description.');
      expect(e.flavorText).toBeNull();
    });

    it.each([undefined, '', '   '])('stays null when it arrives as %p', (d) => {
      const e = mapItem({ ...ak, description: d })!;

      expect(e.description).toBeNull();
      expect(e.flavorText).toBeNull();
    });
  });

  describe('dataset shape', () => {
    it('accepts rarity as plain text', () => {
      expect(mapItem({ ...ak, rarity: 'Covert' })!.rarity).toBe('Covert');
    });

    it('uses Unknown when rarity is missing', () => {
      expect(mapItem({ ...ak, rarity: undefined })!.rarity).toBe('Unknown');
    });

    it('falls back to crates when there are no collections', () => {
      const e = mapItem({
        ...ak,
        collections: undefined,
        crates: [{ name: 'Kilowatt Case' }],
      })!;

      expect(e.collections).toEqual(['Kilowatt Case']);
    });

    it('uses name when market_hash_name is missing', () => {
      const e = mapItem({
        ...ak,
        market_hash_name: undefined,
        name: 'AK-47 | Redline (FT)',
      })!;

      expect(e.marketHashName).toBe('AK-47 | Redline (FT)');
    });
  });
});
