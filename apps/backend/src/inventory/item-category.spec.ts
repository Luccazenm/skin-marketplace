import { ItemCategory } from '@prisma/client';
import {
  acceptsSticker,
  blockReason,
  categoryOf,
  hasUniquePattern,
  neverTradable,
} from './item-category';

describe('categoryOf', () => {
  it('maps the types that have float and paint seed', () => {
    expect(categoryOf('CSGO_Type_Rifle')).toBe(ItemCategory.RIFLE);
    expect(categoryOf('CSGO_Type_Knife')).toBe(ItemCategory.KNIFE);
    expect(categoryOf('CSGO_Type_SniperRifle')).toBe(ItemCategory.SNIPER_RIFLE);
  });

  it('maps the types without a pattern of their own', () => {
    expect(categoryOf('CSGO_Tool_Sticker')).toBe(ItemCategory.STICKER);
    expect(categoryOf('CSGO_Type_WeaponCase')).toBe(ItemCategory.CONTAINER);
    expect(categoryOf('Type_CustomPlayer')).toBe(ItemCategory.AGENT);
  });

  // Valve's own inconsistency: gloves skip the `CSGO_Type_` prefix that
  // everything else uses. Any mapping that infers from the prefix breaks
  // exactly on gloves — which are among the most expensive items in the
  // game.
  it('recognises gloves despite the different prefix', () => {
    expect(categoryOf('Type_Hands')).toBe(ItemCategory.GLOVES);
    expect(hasUniquePattern(categoryOf('Type_Hands'))).toBe(true);
  });

  it('falls back to OTHER for unknown or missing type', () => {
    expect(categoryOf('CSGO_Type_SomethingNew')).toBe(ItemCategory.OTHER);
    expect(categoryOf(null)).toBe(ItemCategory.OTHER);
  });

  // The localized name must never be accepted: if someone changes
  // l=english, the whole classification would break silently.
  it('does not accept the localized label', () => {
    expect(categoryOf('Rifle')).toBe(ItemCategory.OTHER);
    expect(categoryOf('Fuzil')).toBe(ItemCategory.OTHER);
  });
});

/**
 * This used to be a catalog column (`hasStickerSlots`) and was never
 * populated: it read `false` for all 33,950 items, including every
 * weapon. It became a function because the information was already in the
 * category — a column duplicating another is a column that diverges.
 */
describe('acceptsSticker', () => {
  it('holds for weapons', () => {
    for (const c of [
      ItemCategory.RIFLE,
      ItemCategory.PISTOL,
      ItemCategory.SMG,
      ItemCategory.SNIPER_RIFLE,
      ItemCategory.SHOTGUN,
      ItemCategory.MACHINEGUN,
    ]) {
      expect(acceptsSticker(c)).toBe(true);
    }
  });

  // Zeus is its own Valve family but takes stickers like any weapon.
  // Confirmed with the operator.
  it('holds for the Zeus', () => {
    expect(acceptsSticker(ItemCategory.EQUIPMENT)).toBe(true);
  });

  // They have a float but no slots. That is what separates this function
  // from hasUniquePattern — and why neither can be derived from the other.
  it('does not hold for knives and gloves, despite their pattern', () => {
    expect(acceptsSticker(ItemCategory.KNIFE)).toBe(false);
    expect(acceptsSticker(ItemCategory.GLOVES)).toBe(false);
    expect(hasUniquePattern(ItemCategory.KNIFE)).toBe(true);
  });

  it.each([
    ItemCategory.STICKER,
    ItemCategory.CONTAINER,
    ItemCategory.AGENT,
    ItemCategory.CHARM,
    ItemCategory.OTHER,
  ])('does not hold for %s', (c) => {
    expect(acceptsSticker(c)).toBe(false);
  });
});

describe('hasUniquePattern', () => {
  it('holds for what has float and paint seed', () => {
    for (const c of [
      ItemCategory.RIFLE,
      ItemCategory.PISTOL,
      ItemCategory.SMG,
      ItemCategory.SNIPER_RIFLE,
      ItemCategory.SHOTGUN,
      ItemCategory.MACHINEGUN,
      ItemCategory.KNIFE,
      ItemCategory.GLOVES,
    ]) {
      expect(hasUniquePattern(c)).toBe(true);
    }
  });

  it('does not hold for fungible items', () => {
    for (const c of [
      ItemCategory.CONTAINER,
      ItemCategory.STICKER,
      ItemCategory.AGENT,
      ItemCategory.GRAFFITI,
      ItemCategory.MUSIC_KIT,
      ItemCategory.COLLECTIBLE,
    ]) {
      expect(hasUniquePattern(c)).toBe(false);
    }
  });
});

describe('blockReason', () => {
  it('does not block a tradable item', () => {
    expect(blockReason(ItemCategory.RIFLE, true)).toBeNull();
  });

  it('marks as permanent what can never be traded', () => {
    expect(blockReason(ItemCategory.COLLECTIBLE, false)).toBe('permanent');
    expect(blockReason(ItemCategory.PASS, false)).toBe('permanent');
  });

  // Steam returns a medal and a trade-locked skin identically:
  // tradable=0, market_tradable_restriction=7, no release date. Saying
  // "back in 7 days" would be a guess, and there are free items locked
  // forever — the user would wait for nothing.
  it('uses the vague label when we cannot tell if it is temporary', () => {
    expect(blockReason(ItemCategory.RIFLE, false)).toBe('unavailable');
    expect(blockReason(ItemCategory.MUSIC_KIT, false)).toBe('unavailable');
  });

  it('keeps a medal permanent even if Steam says tradable', () => {
    // Should not happen, but if it does we would rather not promise a
    // deposit Steam will refuse later.
    expect(neverTradable(ItemCategory.COLLECTIBLE)).toBe(true);
  });
});
