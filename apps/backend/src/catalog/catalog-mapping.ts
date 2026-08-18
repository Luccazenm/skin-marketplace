import { ItemCategory, SkinVariant } from '@prisma/client';

/** A catalog entry, normalized and ready to store. */
export interface CatalogEntry {
  marketHashName: string;
  category: ItemCategory;
  rarity: string;
  /** Every origin. Empty when the item comes from no crate at all. */
  collections: string[];
  variant: SkinVariant;
  weapon: string | null;
  skinName: string | null;
  minFloat: number | null;
  maxFloat: number | null;
  imageUrl: string | null;
  description: string | null;
  /** The italic line at the end of the description. */
  flavorText: string | null;
}

/**
 * Splits the description from the flavor text.
 *
 * Valve ships both together, with the flavor in `<i>` at the end:
 *
 *   "Powerful and reliable, the AK-47 ... a red pinstripe.
 *    <i>Never be afraid to push it to the limit</i>"
 *
 * We store them separately and **without HTML**. No tags because handing
 * third-party markup to the screen would force the frontend to sanitize —
 * and an item page is where someone decides to sell something expensive,
 * not a place to inject HTML of external origin.
 */
export function splitDescription(raw: string | undefined): {
  description: string | null;
  flavorText: string | null;
} {
  if (!raw?.trim()) {
    return { description: null, flavorText: null };
  }

  const italic = /<i>([\s\S]*?)<\/i>/i.exec(raw);
  const flavorText = italic ? clean(italic[1]) : null;
  const description = clean(raw.replace(/<i>[\s\S]*?<\/i>/gi, ''));

  return {
    description: description || null,
    flavorText: flavorText || null,
  };
}

function clean(text: string): string {
  return (
    text
      // The dataset ships the line break as the TWO characters "\" and
      // "n", not as a real break. Without converting, "\n\n" would appear
      // written out on the user's screen.
      .replace(/\\r\\n|\\n|\\r/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * A raw item from the public community dataset. Almost everything is
 * optional because the shape varies by type: a sticker has no `weapon`,
 * an agent has no `wear`, a case has neither.
 */
export interface RawItem {
  id?: string;
  /** Description and flavor text together, with HTML. See splitDescription. */
  description?: string;
  /**
   * The skin's identity without the exterior: the five "Redline" entries
   * share the same `skin_id`. It is the key linking a skin to its
   * collection, since `skins_not_grouped` carries no collection at all.
   */
  skin_id?: string;
  name?: string;
  /**
   * An explicit `null` means an item that does not exist on the market —
   * 701 of the 11,134 stickers are like this. Different from absent,
   * which just means an endpoint that omits the field.
   */
  market_hash_name?: string | null;
  rarity?: { name?: string } | string;
  collections?: Array<{ name?: string }>;
  crates?: Array<{ name?: string }>;
  weapon?: { name?: string };
  pattern?: { name?: string };
  min_float?: number;
  max_float?: number;
  stattrak?: boolean;
  souvenir?: boolean;
  image?: string;
  category?: { name?: string };
  type?: string;
}

export interface MappingOptions {
  /** Type from the source file, used when the name does not resolve. */
  defaultCategory?: ItemCategory;
  /**
   * Origins resolved externally, cross-referencing `collections.json` and
   * `crates.json` by `skin_id`. The skins file does not carry this.
   */
  collections?: string[];
}

/**
 * Translates a dataset item into our catalog.
 *
 * Returns `null` for what should not enter. The dataset describes the
 * whole game, including things that will never appear in a marketplace.
 *
 * Classification comes from the NAME, not from the dataset's `type`
 * field: `market_hash_name` is the same identifier Steam uses, so
 * classifying by it keeps catalog and inventory in agreement. Diverging
 * here would mean prices hanging off a template no real item points at.
 */
export function mapItem(
  raw: RawItem,
  options: MappingOptions = {},
): CatalogEntry | null {
  const { defaultCategory, collections } = options;

  // A null market name means an item that does not exist on the market —
  // an old event sticker, a test item. There is no price to hang on it,
  // and creating a template would fill the catalog with rows no quote
  // ever reaches.
  if (raw.market_hash_name === null) {
    return null;
  }

  const marketHashName = (raw.market_hash_name ?? raw.name)?.trim();

  if (!marketHashName) {
    return null;
  }

  const fromName = categoryFromName(marketHashName, raw);

  // The source file is authoritative about the TYPE; the name is
  // authoritative about the specific case. "Katowice 2019 Legends
  // (Holo-Foil)" and "Stockholm 2021 Patch Pack" are capsules whose names
  // say so nowhere — but they came from crates.json, and that is enough.
  const category =
    fromName === ItemCategory.OTHER && defaultCategory
      ? defaultCategory
      : fromName;

  // Medals, trophies and passes are never tradable: storing a price for
  // them would be storing the price of something that cannot be sold.
  if (category === ItemCategory.COLLECTIBLE || category === ItemCategory.PASS) {
    return null;
  }

  const hasPattern = CATEGORIES_WITH_PATTERN.has(category);
  const skinName = hasPattern ? (raw.pattern?.name ?? null) : null;

  // Vanilla knives and gloves ("★ Karambit", "★ StatTrak™ Stiletto Knife")
  // are real, expensive items, but they have no skin and no float: there
  // is no wear on an unpainted surface. Filling a 0–1 range there would
  // be inventing data, and would make the storefront call a vanilla
  // "bad float".
  const painted = hasPattern && skinName !== null;

  return {
    marketHashName,
    category,
    rarity: rarityText(raw.rarity),
    // Merge the three sources and drop repeats: the skin_id cross-check
    // is what catches items dropping from several crates, and the item's
    // own fields cover stickers and capsules, which the cross-check does
    // not reach.
    collections: [
      ...new Set([
        ...(collections ?? []),
        ...(raw.collections ?? []).map((c) => c.name),
        ...(raw.crates ?? []).map((c) => c.name),
      ]),
    ].filter((n): n is string => typeof n === 'string' && n.length > 0),
    variant: variantOf(marketHashName),
    weapon: hasPattern
      ? (raw.weapon?.name ?? weaponFromName(marketHashName))
      : null,
    skinName,
    // When the dataset omits the range of a painted item, fall back to the
    // whole domain: it is the only honest guess, and the constraint
    // requires both filled alongside the skin.
    minFloat: painted ? (raw.min_float ?? 0) : null,
    maxFloat: painted ? (raw.max_float ?? 1) : null,
    imageUrl: raw.image ?? null,
    ...splitDescription(raw.description),
  };
}

/**
 * Last resort when the dataset omits `weapon`: the market name starts
 * with the model, after the "★" and the variants.
 *
 *   "★ StatTrak™ Stiletto Knife"          -> "Stiletto Knife"
 *   "★ Karambit | Doppler (Factory New)"  -> "Karambit"
 */
function weaponFromName(name: string): string | null {
  const cleaned = name
    .replace(/^★\s*/, '')
    .replace(/^StatTrak™\s*/, '')
    .replace(/^Souvenir\s*/, '')
    .split('|')[0]
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

const CATEGORIES_WITH_PATTERN = new Set<ItemCategory>([
  ItemCategory.RIFLE,
  ItemCategory.PISTOL,
  ItemCategory.SMG,
  ItemCategory.SNIPER_RIFLE,
  ItemCategory.SHOTGUN,
  ItemCategory.MACHINEGUN,
  ItemCategory.KNIFE,
  ItemCategory.GLOVES,
  ItemCategory.EQUIPMENT,
]);

/**
 * StatTrak and Souvenir are distinct market entries with their own
 * prices — which is why the variant comes from the name, the same thing
 * Steam uses to tell them apart.
 */
function variantOf(name: string): SkinVariant {
  if (name.includes('StatTrak')) {
    return SkinVariant.STATTRAK;
  }

  if (name.startsWith('Souvenir ')) {
    return SkinVariant.SOUVENIR;
  }

  return SkinVariant.NORMAL;
}

function rarityText(r: RawItem['rarity']): string {
  if (typeof r === 'string') {
    return r;
  }

  return r?.name ?? 'Unknown';
}

/**
 * Classifies by the name prefix, in the order Steam names things.
 *
 * The order matters: "Sticker | Titan" and "Charm | Lil' Crass" must be
 * tested before weapons, otherwise a weapon sticker would land in the
 * weapon's category.
 */
function categoryFromName(name: string, raw: RawItem): ItemCategory {
  for (const [prefix, category] of PREFIXES) {
    if (name.startsWith(prefix)) {
      return category;
    }
  }

  // ★ marks knives and gloves. Gloves identify themselves by model name,
  // because no prefix separates them from knives.
  if (name.startsWith('★')) {
    return GLOVE_NAMES.some((g) => name.includes(g))
      ? ItemCategory.GLOVES
      : ItemCategory.KNIFE;
  }

  if (
    /\bCase$/.test(name) ||
    name.includes('Capsule') ||
    name.includes('Package')
  ) {
    return ItemCategory.CONTAINER;
  }

  if (name.endsWith('Case Key') || name.endsWith('Key')) {
    return ItemCategory.KEY;
  }

  if (/\b(Coin|Medal|Trophy|Service Medal|Pin)\b/.test(name)) {
    return ItemCategory.COLLECTIBLE;
  }

  if (name.includes('Pass')) {
    return ItemCategory.PASS;
  }

  if (TOOLS.has(name)) {
    return ItemCategory.TOOL;
  }

  // Weapon: the name reads "Weapon | Skin" and the dataset carried the
  // weapon.
  if (raw.weapon?.name && name.includes('|')) {
    return weaponCategory(raw.weapon.name);
  }

  if (name.includes('Zeus x27')) {
    return ItemCategory.EQUIPMENT;
  }

  // Agents come as "Name | Faction", with no weapon. This is the last
  // case with a pipe, so only non-weapons reach here.
  if (name.includes('|')) {
    return ItemCategory.AGENT;
  }

  return ItemCategory.OTHER;
}

const PREFIXES: Array<[string, ItemCategory]> = [
  ['Sticker | ', ItemCategory.STICKER],
  ['Patch | ', ItemCategory.PATCH],
  ['Charm | ', ItemCategory.CHARM],
  ['Sealed Graffiti | ', ItemCategory.GRAFFITI],
  ['Graffiti | ', ItemCategory.GRAFFITI],
  ['Music Kit | ', ItemCategory.MUSIC_KIT],
  ['StatTrak™ Music Kit | ', ItemCategory.MUSIC_KIT],
];

const GLOVE_NAMES = ['Gloves', 'Hand Wraps', 'Wraps'];

const TOOLS = new Set([
  'Name Tag',
  'StatTrak™ Swap Tool',
  'CS:GO Case Key',
  'Storage Unit',
]);

/** Same table as the inventory: catalog and reading must agree. */
function weaponCategory(weapon: string): ItemCategory {
  if (RIFLES.has(weapon)) return ItemCategory.RIFLE;
  if (PISTOLS.has(weapon)) return ItemCategory.PISTOL;
  if (SMGS.has(weapon)) return ItemCategory.SMG;
  if (SNIPERS.has(weapon)) return ItemCategory.SNIPER_RIFLE;
  if (SHOTGUNS.has(weapon)) return ItemCategory.SHOTGUN;
  if (MACHINEGUNS.has(weapon)) return ItemCategory.MACHINEGUN;
  if (EQUIPMENT.has(weapon)) return ItemCategory.EQUIPMENT;

  return ItemCategory.OTHER;
}

const RIFLES = new Set([
  'AK-47',
  'AUG',
  'FAMAS',
  'Galil AR',
  'M4A1-S',
  'M4A4',
  'SG 553',
]);

const PISTOLS = new Set([
  'CZ75-Auto',
  'Desert Eagle',
  'Dual Berettas',
  'Five-SeveN',
  'Glock-18',
  'P2000',
  'P250',
  'R8 Revolver',
  'Tec-9',
  'USP-S',
]);

const SMGS = new Set([
  'MAC-10',
  'MP5-SD',
  'MP7',
  'MP9',
  'P90',
  'PP-Bizon',
  'UMP-45',
]);

const SNIPERS = new Set(['AWP', 'G3SG1', 'SCAR-20', 'SSG 08']);

const SHOTGUNS = new Set(['MAG-7', 'Nova', 'Sawed-Off', 'XM1014']);

const MACHINEGUNS = new Set(['M249', 'Negev']);

/**
 * Valve's own family. It has to be here, and not only in the name check:
 * the dataset carries `weapon: "Zeus x27"`, so the flow reaches
 * `weaponCategory` before any textual check — and used to come out of it
 * as OTHER.
 */
const EQUIPMENT = new Set(['Zeus x27']);
