import { ItemCategory } from '@prisma/client';

/**
 * Translates Steam's `Type` tag into our category.
 *
 * We use `internal_name` and NEVER the localized name: "Rifle" becomes
 * "Fuzil" if the request language changes, while `CSGO_Type_Rifle` is
 * stable.
 *
 * Note `Type_Hands`: gloves do not follow the `CSGO_Type_` prefix that
 * everything else uses. That is Valve's own inconsistency, and any
 * mapping that tries to infer from the prefix breaks precisely on them.
 */
const BY_INTERNAL_NAME: Record<string, ItemCategory> = {
  // --- have float and paint seed ---
  CSGO_Type_Rifle: ItemCategory.RIFLE,
  CSGO_Type_Pistol: ItemCategory.PISTOL,
  CSGO_Type_SMG: ItemCategory.SMG,
  CSGO_Type_SniperRifle: ItemCategory.SNIPER_RIFLE,
  CSGO_Type_Shotgun: ItemCategory.SHOTGUN,
  CSGO_Type_Machinegun: ItemCategory.MACHINEGUN,
  CSGO_Type_Knife: ItemCategory.KNIFE,
  Type_Hands: ItemCategory.GLOVES,
  // Zeus x27. Has a skin and a float, but Valve puts it in its own family.
  CSGO_Type_Equipment: ItemCategory.EQUIPMENT,

  // --- no pattern of their own ---
  // Not all are fungible: an agent takes patches and stops being
  // interchangeable the moment it receives one.
  CSGO_Tool_Sticker: ItemCategory.STICKER,
  CSGO_Type_WeaponCase: ItemCategory.CONTAINER,
  CSGO_Tool_WeaponCase_KeyTag: ItemCategory.KEY,
  CSGO_Type_Spray: ItemCategory.GRAFFITI,
  CSGO_Type_MusicKit: ItemCategory.MUSIC_KIT,
  Type_CustomPlayer: ItemCategory.AGENT,
  CSGO_Tool_Patch: ItemCategory.PATCH,
  CSGO_Tool_Keychain: ItemCategory.CHARM,
  CSGO_Tool_Name_TagTag: ItemCategory.TOOL,

  // --- normally non-transferable ---
  CSGO_Type_Collectible: ItemCategory.COLLECTIBLE,
  CSGO_Type_Ticket: ItemCategory.PASS,
};

/**
 * Categories with their own float and paint seed. These are the only ones
 * where `Item.float` and friends make sense.
 *
 * CAREFUL: this is NOT the same as "categories whose units differ from one
 * another". An agent can hold up to 3 patches, and an applied patch never
 * returns to the inventory — it can only be destroyed. So an agent with
 * patches is permanently distinct from a clean one, despite having no
 * float at all. The same goes for a charm attached to a weapon.
 *
 * The second source of uniqueness is the applied items (sticker, patch,
 * charm), today partially modelled in ItemSticker — which only covers
 * weapon stickers. See docs/open-items.md.
 */
const WITH_UNIQUE_PATTERN = new Set<ItemCategory>([
  ItemCategory.RIFLE,
  ItemCategory.PISTOL,
  ItemCategory.SMG,
  ItemCategory.SNIPER_RIFLE,
  ItemCategory.SHOTGUN,
  ItemCategory.MACHINEGUN,
  ItemCategory.KNIFE,
  ItemCategory.GLOVES,
  // "Zeus x27 | Olympus (Factory New)" carries an exterior in its name
  // like any skin — therefore it has a float.
  ItemCategory.EQUIPMENT,
]);

/**
 * Categories that accept stickers.
 *
 * A function, not a catalog column, because the information already lives
 * in the category — a column duplicating another is a column that
 * diverges, and this one was born wrong: it read `false` for all 33,950
 * items, including every weapon.
 *
 * Note this describes the MODEL ("does this weapon accept stickers?"),
 * not the unit. Which stickers are applied, and how scraped, belongs to
 * `Item` — the catalog holds the clean skin, and the price of a stickered
 * unit is the base skin plus each sticker, shown separately.
 *
 * Knives and gloves have no slots. Zeus x27 does, despite being its own
 * Valve family — confirmed with the operator.
 */
const ACCEPTS_STICKER = new Set<ItemCategory>([
  ItemCategory.RIFLE,
  ItemCategory.PISTOL,
  ItemCategory.SMG,
  ItemCategory.SNIPER_RIFLE,
  ItemCategory.SHOTGUN,
  ItemCategory.MACHINEGUN,
  ItemCategory.EQUIPMENT,
]);

/**
 * Categories Steam never allows trading. Used to tell the user the block
 * is permanent rather than a wait.
 */
const NEVER_TRADABLE = new Set<ItemCategory>([
  ItemCategory.COLLECTIBLE,
  ItemCategory.PASS,
]);

export function categoryOf(internalName: string | null): ItemCategory {
  if (!internalName) {
    return ItemCategory.OTHER;
  }

  return BY_INTERNAL_NAME[internalName] ?? ItemCategory.OTHER;
}

export function hasUniquePattern(category: ItemCategory): boolean {
  return WITH_UNIQUE_PATTERN.has(category);
}

export function neverTradable(category: ItemCategory): boolean {
  return NEVER_TRADABLE.has(category);
}

export function acceptsSticker(category: ItemCategory): boolean {
  return ACCEPTS_STICKER.has(category);
}

export type BlockReason = 'permanent' | 'unavailable';

/**
 * Why this item cannot be deposited right now — or null if it can.
 *
 * There is a limit in the data Steam gives us, and it matters: Steam does
 * NOT distinguish a permanent block from a temporary trade lock. A medal
 * and a freshly received skin arrive identical, both with `tradable: 0`
 * and `market_tradable_restriction: 7`, with no release date anywhere.
 *
 * So we only promise what we can prove: category tells us what is
 * permanently non-tradable; everything else gets the vague label, because
 * promising a deadline we cannot compute is worse than admitting we do
 * not know.
 */
export function blockReason(
  category: ItemCategory,
  tradable: boolean,
): BlockReason | null {
  if (neverTradable(category)) {
    return 'permanent';
  }

  return tradable ? null : 'unavailable';
}
