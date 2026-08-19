import React, { useState, useMemo, useEffect, type ReactNode } from "react";
import {
  Search,
  ShoppingCart,
  Bell,
  X,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  SlidersHorizontal,
  Zap,
  Star,
  ArrowUpRight,
  ArrowRight,
  Package,
  User,
  Check,
  Tag,
  RotateCw,
  // Not the DOM's Lock: without this import TypeScript resolves the
  // global and reports it is not a valid component.
  Lock,
  Trash2,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { logout, startSteamLogin, type InventoryItem } from "@/lib/api";
import { rarityStyle } from "@/lib/rarity";
import { AppliedPopup, useAppliedHover } from "./AppliedPopup";
import {
  appliedLabel,
  charmsOf,
  isStatTrak,
  rarityKeyForItem,
  stickersOf,
  useInventory,
} from "@/lib/use-inventory";
import { useSession } from "@/lib/use-session";
import { SellPage } from "./SellPage";
import { TradeUrlBanner } from "./TradeUrlBanner";
import { NotificationBell } from "./NotificationBell";
import { MiniSortDropdown } from "./MiniSortDropdown";

/* ─── Rarity config ─────────────────────────────────────────────────── */
const RARITY: Record<string, { label: string; color: string; glow: string; from: string; to: string }> = {
  consumer:   { label: "Consumer",    color: "#b0b0b0", glow: "rgba(176,176,176,0.2)", from: "#181818", to: "#111111" },
  industrial: { label: "Industrial",  color: "#5b9bd5", glow: "rgba(91,155,213,0.2)",  from: "#0b1520", to: "#090f17" },
  milspec:    { label: "Mil-Spec",    color: "#4b69ff", glow: "rgba(75,105,255,0.2)",  from: "#0a0c1e", to: "#080914" },
  restricted: { label: "Restricted",  color: "#8847ff", glow: "rgba(136,71,255,0.2)",  from: "#0f0a1e", to: "#0a0714" },
  classified: { label: "Classified",  color: "#d32ee6", glow: "rgba(211,46,230,0.2)",  from: "#180a1e", to: "#100614" },
  covert:     { label: "Covert",      color: "#eb4b4b", glow: "rgba(235,75,75,0.2)",   from: "#1e0909", to: "#140606" },
  rare:       { label: "★ Knife/Glove", color: "#f0c040", glow: "rgba(240,192,64,0.2)", from: "#1a1404", to: "#111002" },
};

/* ─── Skin data ─────────────────────────────────────────────────────── */
interface Skin {
  id: number;
  name: string;
  weapon: string;
  wear: string;
  price: number;
  rarity: keyof typeof RARITY;
  float: number;
  trend: number;
  discount: number;
  volume: number;
  stickers: number;
  charms: boolean;
  statTrak: boolean;
}

const SKINS_RAW: Skin[] = [
  { id: 1,  name: "Redline",         weapon: "AK-47",       wear: "Field-Tested",  price: 42.50,   rarity: "classified", float: 0.217, trend: +3.2,  discount: -8.4,  volume: 1240, stickers: 0, charms: false, statTrak: false },
  { id: 2,  name: "Dragon Lore",     weapon: "AWP",         wear: "Factory New",   price: 8420.00, rarity: "covert",     float: 0.032, trend: +12.1, discount: +3.2,  volume: 18,   stickers: 4, charms: true,  statTrak: false },
  { id: 3,  name: "Howl",            weapon: "M4A4",        wear: "Minimal Wear",  price: 3150.00, rarity: "covert",     float: 0.089, trend: -2.4,  discount: -12.7, volume: 34,   stickers: 0, charms: false, statTrak: true  },
  { id: 4,  name: "Fade",            weapon: "Glock-18",    wear: "Factory New",   price: 380.00,  rarity: "restricted", float: 0.011, trend: +5.7,  discount: -5.1,  volume: 412,  stickers: 0, charms: true,  statTrak: false },
  { id: 5,  name: "Blaze",           weapon: "Desert Eagle",wear: "Factory New",   price: 520.00,  rarity: "classified", float: 0.019, trend: +1.3,  discount: +7.8,  volume: 287,  stickers: 2, charms: false, statTrak: false },
  { id: 6,  name: "Fade",            weapon: "Butterfly Knife", wear: "Factory New", price: 1890.00, rarity: "rare",    float: 0.008, trend: +8.9,  discount: -2.3,  volume: 56,   stickers: 0, charms: false, statTrak: false },
  { id: 7,  name: "Fire Serpent",    weapon: "AK-47",       wear: "Field-Tested",  price: 890.00,  rarity: "covert",     float: 0.243, trend: -1.1,  discount: -18.5, volume: 98,   stickers: 3, charms: true,  statTrak: false },
  { id: 8,  name: "Hyper Beast",     weapon: "M4A1-S",      wear: "Factory New",   price: 68.00,   rarity: "covert",     float: 0.034, trend: +0.4,  discount: +1.2,  volume: 892,  stickers: 0, charms: false, statTrak: false },
  { id: 9,  name: "Kill Confirmed",  weapon: "USP-S",       wear: "Minimal Wear",  price: 145.00,  rarity: "covert",     float: 0.098, trend: +2.8,  discount: -6.9,  volume: 543,  stickers: 1, charms: false, statTrak: true  },
  { id: 10, name: "Doppler",         weapon: "Karambit",    wear: "Factory New",   price: 2640.00, rarity: "rare",       float: 0.004, trend: +6.4,  discount: -4.4,  volume: 29,   stickers: 0, charms: true,  statTrak: false },
  { id: 11, name: "Asiimov",         weapon: "AK-47",       wear: "Field-Tested",  price: 28.00,   rarity: "classified", float: 0.221, trend: -0.7,  discount: +5.3,  volume: 2341, stickers: 0, charms: false, statTrak: false },
  { id: 12, name: "Neo-Noir",        weapon: "AWP",         wear: "Factory New",   price: 12.40,   rarity: "classified", float: 0.041, trend: +0.2,  discount: -1.8,  volume: 5621, stickers: 0, charms: false, statTrak: false },
  { id: 13, name: "Printstream",     weapon: "M4A1-S",      wear: "Factory New",   price: 74.00,   rarity: "covert",     float: 0.006, trend: +4.1,  discount: -9.2,  volume: 689,  stickers: 0, charms: true,  statTrak: true  },
  { id: 14, name: "Emerald",         weapon: "Desert Eagle",wear: "Factory New",   price: 98.00,   rarity: "covert",     float: 0.014, trend: +2.2,  discount: +2.6,  volume: 344,  stickers: 0, charms: false, statTrak: false },
  { id: 15, name: "Icarus Fell",     weapon: "Karambit",    wear: "Factory New",   price: 3200.00, rarity: "rare",       float: 0.019, trend: +9.3,  discount: -7.1,  volume: 21,   stickers: 0, charms: false, statTrak: false },
  { id: 16, name: "Chatterbox",      weapon: "Galil AR",    wear: "Factory New",   price: 12.40,   rarity: "restricted", float: 0.041, trend: +0.2,  discount: +4.0,  volume: 5621, stickers: 0, charms: false, statTrak: false },

  // SMGs
  { id: 17, name: "Neon Rider",      weapon: "MP9",         wear: "Factory New",   price: 18.50,   rarity: "covert",     float: 0.021, trend: +1.4,  discount: -3.2,  volume: 1820, stickers: 0, charms: false, statTrak: false },
  { id: 18, name: "Killing Spree",   weapon: "MAC-10",      wear: "Factory New",   price: 7.80,    rarity: "classified", float: 0.044, trend: -0.5,  discount: +2.1,  volume: 3200, stickers: 0, charms: true,  statTrak: false },
  { id: 19, name: "Bloodsport",      weapon: "MP5-SD",      wear: "Factory New",   price: 9.20,    rarity: "classified", float: 0.018, trend: +2.3,  discount: -5.8,  volume: 2410, stickers: 1, charms: false, statTrak: false },
  { id: 20, name: "Phosphor",        weapon: "MP7",         wear: "Factory New",   price: 11.30,   rarity: "classified", float: 0.031, trend: +0.8,  discount: -1.9,  volume: 1980, stickers: 0, charms: false, statTrak: true  },
  { id: 21, name: "Asiimov",         weapon: "P90",         wear: "Field-Tested",  price: 34.00,   rarity: "covert",     float: 0.198, trend: +3.1,  discount: -6.4,  volume: 890,  stickers: 0, charms: false, statTrak: false },
  { id: 22, name: "Cobalt Halftone", weapon: "PP-Bizon",    wear: "Factory New",   price: 4.20,    rarity: "restricted", float: 0.062, trend: -0.3,  discount: +1.4,  volume: 4100, stickers: 0, charms: false, statTrak: false },
  { id: 23, name: "Crime Scene",     weapon: "UMP-45",      wear: "Factory New",   price: 6.50,    rarity: "classified", float: 0.029, trend: +1.1,  discount: -2.7,  volume: 2750, stickers: 0, charms: true,  statTrak: false },

  // Heavy
  { id: 24, name: "Bulldozer",       weapon: "Nova",        wear: "Factory New",   price: 5.10,    rarity: "milspec",    float: 0.055, trend: +0.4,  discount: +0.8,  volume: 3800, stickers: 0, charms: false, statTrak: false },
  { id: 25, name: "Firecobra",       weapon: "Sawed-Off",   wear: "Factory New",   price: 3.80,    rarity: "restricted", float: 0.038, trend: -0.6,  discount: +3.2,  volume: 2900, stickers: 0, charms: false, statTrak: false },
  { id: 26, name: "Urban Hazard",    weapon: "MAG-7",       wear: "Minimal Wear",  price: 8.90,    rarity: "classified", float: 0.091, trend: +1.8,  discount: -4.1,  volume: 1640, stickers: 0, charms: false, statTrak: false },
  { id: 27, name: "Ambush",         weapon: "XM1014",      wear: "Factory New",   price: 4.60,    rarity: "restricted", float: 0.047, trend: +0.2,  discount: +2.3,  volume: 3100, stickers: 0, charms: false, statTrak: false },
  { id: 28, name: "Tooth Fairy",     weapon: "M249",        wear: "Factory New",   price: 6.20,    rarity: "classified", float: 0.033, trend: +1.5,  discount: -3.8,  volume: 1890, stickers: 2, charms: false, statTrak: false },
  { id: 29, name: "Ultralight",      weapon: "Negev",       wear: "Factory New",   price: 5.70,    rarity: "classified", float: 0.041, trend: -0.9,  discount: +1.6,  volume: 2200, stickers: 0, charms: false, statTrak: false },

  // More pistols
  { id: 30, name: "Cyrex",           weapon: "Five-SeveN",  wear: "Factory New",   price: 22.00,   rarity: "classified", float: 0.014, trend: +2.6,  discount: -7.3,  volume: 1320, stickers: 0, charms: false, statTrak: false },
  { id: 31, name: "Asiimov",         weapon: "P250",        wear: "Factory New",   price: 8.40,    rarity: "covert",     float: 0.026, trend: +1.2,  discount: -2.9,  volume: 2100, stickers: 0, charms: true,  statTrak: false },
  { id: 32, name: "Howl",            weapon: "P2000",       wear: "Factory New",   price: 5.90,    rarity: "classified", float: 0.038, trend: +0.7,  discount: +1.8,  volume: 3400, stickers: 0, charms: false, statTrak: false },
  { id: 33, name: "Crimson Web",     weapon: "Tec-9",       wear: "Minimal Wear",  price: 14.70,   rarity: "classified", float: 0.112, trend: +3.4,  discount: -5.6,  volume: 980,  stickers: 0, charms: false, statTrak: true  },
  { id: 34, name: "Fade",            weapon: "R8 Revolver", wear: "Factory New",   price: 31.50,   rarity: "classified", float: 0.009, trend: +4.8,  discount: -9.1,  volume: 720,  stickers: 0, charms: false, statTrak: false },
  { id: 35, name: "Orion",           weapon: "CZ75-Auto",   wear: "Factory New",   price: 11.20,   rarity: "classified", float: 0.022, trend: +1.9,  discount: -4.4,  volume: 1560, stickers: 0, charms: false, statTrak: false },
  { id: 36, name: "Wasteland Rebel", weapon: "Dual Berettas",wear: "Factory New",  price: 6.80,    rarity: "classified", float: 0.051, trend: +0.6,  discount: +2.7,  volume: 2800, stickers: 0, charms: false, statTrak: false },

  // More rifles
  { id: 37, name: "Fever Dream",     weapon: "AUG",         wear: "Factory New",   price: 16.40,   rarity: "covert",     float: 0.027, trend: +2.1,  discount: -6.8,  volume: 1100, stickers: 0, charms: false, statTrak: false },
  { id: 38, name: "Styx",            weapon: "FAMAS",       wear: "Factory New",   price: 7.30,    rarity: "classified", float: 0.036, trend: +0.9,  discount: -2.3,  volume: 2600, stickers: 0, charms: false, statTrak: false },
  { id: 39, name: "Pulse",           weapon: "SG 553",      wear: "Factory New",   price: 9.80,    rarity: "classified", float: 0.019, trend: +1.7,  discount: -3.5,  volume: 1780, stickers: 1, charms: false, statTrak: false },
  { id: 40, name: "Detour",          weapon: "SSG 08",      wear: "Field-Tested",  price: 12.60,   rarity: "covert",     float: 0.187, trend: +2.8,  discount: -4.9,  volume: 1240, stickers: 0, charms: false, statTrak: true  },
  { id: 41, name: "Contractor",      weapon: "G3SG1",       wear: "Factory New",   price: 8.10,    rarity: "milspec",    float: 0.044, trend: +0.5,  discount: +1.2,  volume: 2300, stickers: 0, charms: false, statTrak: false },
  { id: 42, name: "Hyper Beast",     weapon: "SCAR-20",     wear: "Factory New",   price: 14.90,   rarity: "covert",     float: 0.031, trend: +1.6,  discount: -5.2,  volume: 950,  stickers: 0, charms: true,  statTrak: false },

  // ST + 5 sticker examples
  { id: 49, name: "Asiimov",         weapon: "AWP",         wear: "Factory New",   price: 210.00,  rarity: "covert",     float: 0.018, trend: +4.1,  discount: -11.2, volume: 312,  stickers: 5, charms: false, statTrak: true  },
  { id: 50, name: "Redline",         weapon: "AK-47",       wear: "Field-Tested",  price: 68.00,   rarity: "classified", float: 0.224, trend: +2.3,  discount: -7.8,  volume: 890,  stickers: 5, charms: true,  statTrak: true  },
  { id: 51, name: "Hyper Beast",     weapon: "M4A4",        wear: "Minimal Wear",  price: 95.00,   rarity: "covert",     float: 0.073, trend: +3.6,  discount: -9.1,  volume: 540,  stickers: 5, charms: false, statTrak: true  },
  { id: 52, name: "Printstream",     weapon: "USP-S",       wear: "Factory New",   price: 185.00,  rarity: "covert",     float: 0.009, trend: +5.8,  discount: -6.4,  volume: 274,  stickers: 4, charms: false, statTrak: true  },

  // More knives & gloves
  { id: 43, name: "Doppler",         weapon: "M9 Bayonet",  wear: "Factory New",   price: 890.00,  rarity: "rare",       float: 0.007, trend: +5.2,  discount: -3.8,  volume: 42,   stickers: 0, charms: false, statTrak: false },
  { id: 44, name: "Marble Fade",     weapon: "Flip Knife",  wear: "Factory New",   price: 620.00,  rarity: "rare",       float: 0.011, trend: +4.1,  discount: -6.2,  volume: 67,   stickers: 0, charms: false, statTrak: false },
  { id: 45, name: "Tiger Tooth",     weapon: "Bayonet",     wear: "Factory New",   price: 480.00,  rarity: "rare",       float: 0.003, trend: +3.7,  discount: -2.9,  volume: 88,   stickers: 0, charms: false, statTrak: false },
  { id: 46, name: "Crimson Web",     weapon: "Gut Knife",   wear: "Minimal Wear",  price: 210.00,  rarity: "rare",       float: 0.082, trend: +2.4,  discount: -4.5,  volume: 134,  stickers: 0, charms: false, statTrak: false },
  { id: 47, name: "Pandora's Box",   weapon: "Sport Gloves",wear: "Field-Tested",  price: 1240.00, rarity: "rare",       float: 0.231, trend: +7.8,  discount: -8.3,  volume: 24,   stickers: 0, charms: false, statTrak: false },
  { id: 48, name: "Overtake",        weapon: "Driver Gloves",wear: "Minimal Wear", price: 680.00,  rarity: "rare",       float: 0.096, trend: +5.6,  discount: -5.1,  volume: 38,   stickers: 0, charms: false, statTrak: false },
];

// Deterministic shuffle so items from different categories are interleaved
const SKINS = [...SKINS_RAW].sort((a, b) => {
  const hash = (n: number) => ((n * 2654435761) >>> 0);
  return hash(a.id) - hash(b.id);
});

const PRICE_HISTORY = [
  { d: "Jun 3",  p: 38.2 },
  { d: "Jun 8",  p: 39.8 },
  { d: "Jun 13", p: 37.5 },
  { d: "Jun 18", p: 41.1 },
  { d: "Jun 23", p: 40.3 },
  { d: "Jun 28", p: 43.7 },
  { d: "Jul 2",  p: 42.5 },
];

const RECENT_SALES = [
  { name: "AK-47 | Redline FT",       price: 42.50,   user: "dk_vapor",     time: "2m" },
  { name: "AWP | Asiimov FT",          price: 86.20,   user: "xX_sniper_Xx", time: "5m" },
  { name: "Glock-18 | Fade FN",        price: 382.00,  user: "trademaster",  time: "8m" },
  { name: "M4A4 | Howl MW",            price: 3148.50, user: "whale404",     time: "12m" },
  { name: "USP-S | Kill Confirmed MW", price: 143.75,  user: "css_grinder",  time: "15m" },
  { name: "Karambit | Doppler FN",     price: 2639.00, user: "knifetrader",  time: "19m" },
];

/* ─── Weapon pattern SVGs ───────────────────────────────────────────── */
const WEAPON_PATHS: Record<string, string> = {
  // Rifles
  "AK-47":        "M6 16h4l2-2h16l2 2h4v3H6v-3zm2-4h20l2-8H6l2 8z",
  "AWP":          "M4 18l2-2h24l2 2H4zm3-4l1-10h18l1 10H7z",
  "M4A4":         "M6 17h4l1-2h14l1 2h4v2H6v-2zm2-3l1-9h16l1 9H8z",
  "M4A1-S":       "M6 17h3l2-2h13l2 2h4v2H6v-2zm1-3l2-9h16l2 9H7z",
  "Galil AR":     "M5 16h4l2-2h14l2 2h3v3H5v-3zm2-4h18l2-7H5l2 7z",
  "AUG":          "M6 17h3l2-2h12l2 2h5v2H6v-2zm1-3l2-8h16l2 8H7z",
  "FAMAS":        "M5 17h4l1-2h13l3 2h4v2H5v-2zm2-3l1-8h15l2 8H7z",
  "SG 553":       "M6 17h4l2-2h12l2 2h4v2H6v-2zm2-3l1-8h15l2 8H8z",
  "SSG 08":       "M4 18l2-2h22l2 2H4zm3-3l1-9h16l2 9H7z",
  "G3SG1":        "M4 18l3-2h20l2 2H4zm3-3l2-9h14l2 9H7z",
  "SCAR-20":      "M4 18l2-2h22l3 2H4zm4-3l1-9h14l3 9H8z",
  // Pistols
  "Glock-18":     "M10 8h12v8l-2 4H12l-2-4V8zM8 8h2v10H8V8z",
  "Desert Eagle": "M10 8h11v8l-1 4H13l-2-3V8zM8 9h2v9H8V9z",
  "USP-S":        "M10 9h10v7l-2 4H13l-1-3V9zM8 9h2v9H8V9z",
  "Five-SeveN":   "M10 9h10v6l-2 5H13l-1-3V9zM8 9h2v9H8V9z",
  "P250":         "M10 9h9v6l-2 5H13l-1-3V9zM8 9h2v9H8V9z",
  "P2000":        "M10 9h10v6l-2 5H13l-1-3V9zM8 9h2v9H8V9z",
  "Tec-9":        "M9 8h11v7l-2 5H12l-1-3V8zM7 9h2v9H7V9z",
  "R8 Revolver":  "M10 7h8v5l4 3-4 3v2H10l-2-4V7zM8 8h2v10H8V8z",
  "CZ75-Auto":    "M10 9h9v6l-2 5H13l-1-4V9zM8 9h2v9H8V9z",
  "Dual Berettas":"M8 9h8v8l-2 3H10l-1-3V9zM16 9h8v8l-2 3H18l-1-3V9z",
  // SMGs
  "MP9":          "M7 15h4l1-2h10l1 2h3v3H7v-3zm1-3l1-7h12l1 7H8z",
  "MAC-10":       "M6 15h4l1-2h9l2 2h4v3H6v-3zm1-3l1-7h12l2 7H7z",
  "MP5-SD":       "M5 16h4l2-2h10l2 2h5v2H5v-2zm2-3l1-7h14l1 7H7z",
  "MP7":          "M6 16h4l1-2h11l2 2h4v2H6v-2zm1-3l1-7h13l2 7H7z",
  "P90":          "M5 14h4l2-3h12l2 3h5v4H5v-4zm1-4l2-5h14l2 5H6z",
  "PP-Bizon":     "M6 16h4l1-2h10l2 2h5v2H6v-2zm1-3l1-6h13l2 6H7z",
  "UMP-45":       "M6 15h3l2-2h11l2 2h4v3H6v-3zm1-3l2-7h12l2 7H7z",
  // Heavy
  "Nova":         "M5 14h5l1-2h10l1 2h6v5H5v-5zm2-3l2-6h12l2 6H7z",
  "Sawed-Off":    "M6 14h5l1-2h8l1 2h7v5H6v-5zm2-3l2-6h10l2 6H8z",
  "MAG-7":        "M5 14h5l2-2h9l2 2h5v5H5v-5zm2-3l2-6h11l2 6H7z",
  "XM1014":       "M4 15h5l1-2h12l1 2h5v4H4v-4zm3-3l1-6h12l2 6H7z",
  "M249":         "M4 16h5l2-2h14l2 2h3v3H4v-3zm2-4h20l2-7H4l2 7z",
  "Negev":        "M4 16h4l2-2h15l2 2h3v3H4v-3zm2-4h19l2-7H4l2 7z",
  // Knives & gloves
  "Karambit":     "M16 6c0 0-8 4-8 10l2 4c2-4 4-8 10-8l2-4c-2-1-4-2-6-2z",
  "Butterfly Knife": "M14 5l2 16H14L12 5h2zM18 5l-2 16h2l2-16h-2z",
  "M9 Bayonet":   "M8 14h16l2-2H8v2zM6 14h2v6H6v-6zM24 12l4 2-4 2v-4z",
  "Flip Knife":   "M10 14h14l2-2H10v2zM8 14h2v6H8v-6zM24 12l4 2-4 2v-4z",
  "Bayonet":      "M8 14h16l2-2H8v2zM6 14h2v6H6v-6zM24 12l4 2-4 2v-4z",
  "Gut Knife":    "M10 15h12l2-3-2-3H10l1 3-1 3zM8 12h2v8H8v-8z",
  "Sport Gloves": "M10 8h12l2 4-2 4H10l2-4-2-4zM8 10h2v8H8v-8z",
  "Driver Gloves":"M10 8h12l2 4-2 4H10l2-4-2-4zM8 10h2v8H8v-8z",
};

function WeaponSVG({ weapon, color }: { weapon: string; color: string }) {
  const path = WEAPON_PATHS[weapon] || WEAPON_PATHS["AK-47"];
  return (
    <svg viewBox="0 0 32 32" className="w-full h-full" fill="none">
      <path d={path} fill={color} opacity={0.9} />
    </svg>
  );
}

/* ─── Dual range slider ─────────────────────────────────────────────── */
function DualRangeSlider({
  min, max, onMinChange, onMaxChange,
}: {
  min: number; max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef<"min" | "max" | null>(null);

  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));

  const getVal = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width);
  };

  const onMouseDown = (handle: "min" | "max") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = handle;

    const onMove = (ev: MouseEvent) => {
      const v = getVal(ev.clientX);
      if (dragging.current === "min") onMinChange(Math.min(v, max - 0.001));
      else onMaxChange(Math.max(v, min + 0.001));
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const pMin = min * 100;
  const pMax = max * 100;
  const accent = "#f0c040";

  const [minInput, setMinInput] = React.useState(min.toFixed(3));
  const [maxInput, setMaxInput] = React.useState(max.toFixed(3));

  // Sync inputs when slider moves
  React.useEffect(() => { setMinInput(min.toFixed(3)); }, [min]);
  React.useEffect(() => { setMaxInput(max.toFixed(3)); }, [max]);

  const commitMin = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onMinChange(Math.min(clamp(v), max - 0.001));
    else setMinInput(min.toFixed(3));
  };
  const commitMax = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onMaxChange(Math.max(clamp(v), min + 0.001));
    else setMaxInput(max.toFixed(3));
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8eaf0",
  };

  return (
    <div className="px-2 pb-1">
      {/* Inputs */}
      <div className="flex items-center gap-2 mb-3">
        <input
          value={minInput}
          onChange={(e) => setMinInput(e.target.value)}
          onBlur={(e) => commitMin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitMin(minInput)}
          className="w-full px-2 py-1.5 rounded font-mono text-xs text-center focus:outline-none"
          style={inputStyle}
          placeholder="0.000"
        />
        <span className="font-mono text-xs text-muted-foreground flex-shrink-0">—</span>
        <input
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          onBlur={(e) => commitMax(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitMax(maxInput)}
          className="w-full px-2 py-1.5 rounded font-mono text-xs text-center focus:outline-none"
          style={inputStyle}
          placeholder="1.000"
        />
      </div>

      {/* Slider */}
      <div ref={trackRef} className="relative h-1 rounded-full mx-1" style={{ background: "rgba(255,255,255,0.1)" }}>
        <div
          className="absolute h-full rounded-full"
          style={{ left: `${pMin}%`, right: `${100 - pMax}%`, background: accent }}
        />
        <div
          onMouseDown={onMouseDown("min")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-grab active:cursor-grabbing"
          style={{ left: `${pMin}%`, background: "#1a1d28", borderColor: accent }}
        />
        <div
          onMouseDown={onMouseDown("max")}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 cursor-grab active:cursor-grabbing"
          style={{ left: `${pMax}%`, background: "#1a1d28", borderColor: accent }}
        />
      </div>
      <div className="flex justify-between font-mono text-[9px] mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>
        <span>0.000</span>
        <span>1.000</span>
      </div>
    </div>
  );
}

/* ─── Weapon group (collapsible) ───────────────────────────────────── */
function WeaponGroup({
  group,
  weaponFilter,
  onToggle,
}: {
  group: { label: string; items: string[] };
  weaponFilter: string[];
  onToggle: (w: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = group.items.filter((w) => weaponFilter.includes(w)).length;

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded transition-colors hover:bg-white/5 group"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest transition-colors" style={{ color: open ? "#c0c4d8" : "#6b7194" }}>
            {group.label}
          </span>
          {activeCount > 0 && (
            <span className="font-mono text-[10px] font-bold px-1 rounded" style={{ background: "rgba(240,192,64,0.2)", color: "#f0c040" }}>
              {activeCount}
            </span>
          )}
        </div>
        <span
          className="w-4 h-4 rounded flex items-center justify-center font-mono text-xs font-bold leading-none transition-colors"
          style={{
            background: open ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.04)",
            color: open ? "#f0c040" : "#9da3c0",
          }}
        >
          {open ? "−" : "+"}
        </span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? `${group.items.length * 44}px` : "0px", opacity: open ? 1 : 0 }}
      >
        <div className="space-y-0.5 pl-1 pb-1">
          {group.items.map((w) => (
            <FilterOption
              key={w}
              active={weaponFilter.includes(w)}
              onClick={() => onToggle(w)}
            >
              <span className="font-mono text-sm" style={{ color: weaponFilter.includes(w) ? "#e8eaf0" : "#6b7194" }}>{w}</span>
              {weaponFilter.includes(w) && <Check className="w-2.5 h-2.5" style={{ color: "#f0c040" }} />}
            </FilterOption>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Filter option row ────────────────────────────────────────────── */
function FilterOption({
  active,
  onClick,
  children,
  accentColor = "#f0c040",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  accentColor?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-all duration-100"
      style={{
        background: active
          ? `${accentColor}18`
          : hovered
          ? "rgba(255,255,255,0.06)"
          : "transparent",
        borderLeft: active ? `2px solid ${accentColor}` : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Collapsible filter section ───────────────────────────────────── */
function FilterSection({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 group"
      >
        <span className="font-mono text-sm uppercase tracking-widest transition-colors" style={{ color: "#d0d4e8" }}>
          {title}
        </span>
        <span
          className="w-4 h-4 rounded flex items-center justify-center transition-colors font-mono text-xs leading-none font-bold flex-shrink-0"
          style={{
            background: open ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.06)",
            color: open ? "#f0c040" : "#9da3c0",
          }}
        >
          {open ? "−" : "+"}
        </span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? "9999px" : "0px", opacity: open ? 1 : 0 }}
      >
        <div className="pb-3 px-1">{children}</div>
      </div>
    </div>
  );
}

/* ─── Skin card ─────────────────────────────────────────────────────── */
function SkinCard({ skin, onClick }: { skin: Skin; onClick: () => void }) {
  const r = RARITY[skin.rarity];
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full text-left rounded overflow-hidden border transition-colors duration-200 cursor-pointer flex flex-col"
      style={{
        height: "230px",
        borderColor: hovered ? r.color : "rgba(255,255,255,0.07)",
        background: `linear-gradient(160deg, ${r.from}, ${r.to})`,
        boxShadow: hovered ? `0 0 20px ${r.glow}` : "none",
      }}
    >
      {/* Rarity strip */}
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: r.color }} />

      {/* Stickers — top right, one per row */}
      {skin.stickers > 0 && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5 z-10">
          {Array.from({ length: skin.stickers }).map((_, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-sm flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5"/>
                <circle cx="6" cy="6" r="1.5" fill="#c0c4d8"/>
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* Illustration — flex-1 so it fills remaining space above the footer */}
      <div
        className="relative flex-1 flex items-center justify-center px-4 overflow-hidden transition-all duration-200"
        style={{ paddingTop: hovered ? "8px" : "16px", paddingBottom: hovered ? "8px" : "16px" }}
      >
        {skin.statTrak && (
          <span className="absolute bottom-1.5 left-2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded z-10" style={{ background: "rgba(240,192,64,0.2)", color: "#f0c040", border: "1px solid rgba(240,192,64,0.3)" }}>ST</span>
        )}
        <div className="w-full h-full max-w-[160px]">
          <WeaponSVG weapon={skin.weapon} color={r.color} />
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3" style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

      {/* Info footer */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <div className="text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5" style={{ color: r.color }}>{skin.weapon}</div>
            <div className="font-display text-sm font-semibold text-foreground leading-tight truncate">{skin.name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono text-[9px] text-muted-foreground">{skin.wear}</div>
            <div className="font-mono text-[9px]" style={{ color: r.color }}>{skin.float.toFixed(4)}</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="font-mono font-semibold text-sm leading-none" style={{ color: "#f0f2f8" }}>
            ${skin.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="font-mono text-[11px] font-semibold" style={{ color: skin.discount <= 0 ? "#4ade80" : "#f87171" }}>
            {skin.discount <= 0 ? "" : "+"}{skin.discount}%
          </div>
        </div>
      </div>

      {/* Buy button */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: hovered ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-2.5">
            <div
              className="w-full text-center text-xs font-semibold py-1.5 rounded font-display tracking-wide transition-opacity duration-200"
              style={{ background: "#f0c040", color: "#08090d", opacity: hovered ? 1 : 0 }}
            >
              BUY NOW
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ─── Generic nav dropdown ──────────────────────────────────────────── */
function NavDropdown<T extends string>({
  value, onChange, options, compactTrigger = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; sub: string }[];
  compactTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value)!;

  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded font-mono text-xs transition-colors"
        style={{
          background: open ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${open ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)"}`,
          color: "#e8eaf0",
        }}
      >
        <span>{current.label}</span>
        {!compactTrigger && <span className="text-muted-foreground">{current.sub}</span>}
        <ChevronDown className="w-3 h-3 text-muted-foreground transition-transform" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 rounded overflow-hidden"
          style={{ background: "#10121a", border: "1px solid rgba(255,255,255,0.08)", minWidth: "160px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full text-left px-3 py-2 font-mono text-xs transition-colors flex items-center justify-between gap-4"
              style={{ background: value === o.value ? "rgba(240,192,64,0.08)" : "transparent", color: value === o.value ? "#f0c040" : "#9da3c0" }}
              onMouseEnter={e => (e.currentTarget.style.background = value === o.value ? "rgba(240,192,64,0.12)" : "rgba(255,255,255,0.04)")}
              onMouseLeave={e => (e.currentTarget.style.background = value === o.value ? "rgba(240,192,64,0.08)" : "transparent")}
            >
              <span className="flex items-center gap-2">
                <span>{o.label}</span>
                <span className="text-muted-foreground">{o.sub}</span>
              </span>
              {value === o.value && <Check className="w-3 h-3 flex-shrink-0" style={{ color: "#f0c040" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LANGUAGES = [
  { value: "EN", label: "🇺🇸", sub: "English"    },
  { value: "PT", label: "🇧🇷", sub: "Português"   },
  { value: "ES", label: "🇪🇸", sub: "Español"     },
  { value: "RU", label: "🇷🇺", sub: "Русский"     },
  { value: "ZH", label: "🇨🇳", sub: "中文"         },
] as const;

const CURRENCIES = [
  { value: "USD", label: "$",  sub: "USD" },
  { value: "BRL", label: "R$", sub: "BRL" },
  { value: "EUR", label: "€",  sub: "EUR" },
  { value: "RUB", label: "₽",  sub: "RUB" },
  { value: "CNY", label: "¥",  sub: "CNY" },
] as const;

/* ─── Sort dropdown ─────────────────────────────────────────────────── */
function SortDropdown({ sort, setSort }: { sort: string; setSort: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded font-mono text-xs transition-colors"
        style={{
          background: open ? "rgba(240,192,64,0.1)" : "#10121a",
          border: `1px solid ${open ? "rgba(240,192,64,0.3)" : "rgba(255,255,255,0.08)"}`,
          color: "#e8eaf0",
        }}
      >
        <span>{sort}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground transition-transform" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 z-50 rounded overflow-hidden"
          style={{ background: "#10121a", border: "1px solid rgba(255,255,255,0.08)", minWidth: "130px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          {SORTS.map((s) => (
            <button
              key={s}
              onClick={() => { setSort(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 font-mono text-xs transition-colors flex items-center justify-between gap-4"
              style={{
                background: sort === s ? "rgba(240,192,64,0.08)" : "transparent",
                color: sort === s ? "#f0c040" : "#9da3c0",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = sort === s ? "rgba(240,192,64,0.12)" : "rgba(255,255,255,0.04)")}
              onMouseLeave={e => (e.currentTarget.style.background = sort === s ? "rgba(240,192,64,0.08)" : "transparent")}
            >
              {s}
              {sort === s && <Check className="w-3 h-3" style={{ color: "#f0c040" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Detail modal ──────────────────────────────────────────────────── */
function SkinDetail({ skin, onClose, ctaLabel = "ADD TO CART", onCta, showSellInputs = false }: { skin: Skin; onClose: () => void; ctaLabel?: string; onCta?: (price: string) => void; showSellInputs?: boolean }) {
  const r = RARITY[skin.rarity];
  const [tab] = useState<"history">("history");
  const [listingPrice, setListingPrice] = useState(skin.price.toFixed(2));
  const instantPrice = skin.price * 0.70;

  // Float bar: 0=FN 0.07, MW 0.15, FT 0.38, WW 0.45, BS 1.0
  const floatPct = Math.min(skin.float / 1.0, 1) * 100;

  // Mock sticker slots (4 slots)
  const mockStickers = [
    { color: r.color,   label: "S1", price: 3.38, wear: 0  },
    { color: "#e84060", label: "S2", price: 2.71, wear: 12 },
    { color: "#4ade80", label: "S3", price: 4.09, wear: 0  },
    { color: "#60a5fa", label: "S4", price: 7.21, wear: 55 },
  ];

  const charmValue   = skin.charms   ? 24.15 * 0.95 : 0;
  const stickerValue = skin.stickers > 0
    ? Array.from({ length: skin.stickers }).reduce<number>((sum, _, i) => sum + mockStickers[i % 4].price, 0) * 0.10
    : 0;
  const recommendedPrice = skin.price + charmValue + stickerValue;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="relative w-full rounded-xl border overflow-hidden flex flex-col"
        style={{ maxWidth: 860, maxHeight: "90vh", background: "#10121a", borderColor: "rgba(255,255,255,0.1)" }}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-2 min-w-0">
            {skin.statTrak && (
              <span className="font-mono text-xs font-bold flex-shrink-0" style={{ color: "#f0c040" }}>StatTrak™</span>
            )}
            <h2 className="font-display text-lg font-bold text-foreground truncate">
              {skin.weapon} | {skin.name}
              <span className="font-mono text-sm font-normal text-muted-foreground ml-2">({skin.wear})</span>
            </h2>
          </div>
          <button onClick={onClose} className="flex-shrink-0 ml-4 p-1.5 rounded transition-colors hover:bg-white/5 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT: illustration + stickers + tabs ───────────────── */}
          <div className="flex flex-col flex-1 min-w-0 border-r" style={{ borderColor: "rgba(255,255,255,0.07)" }}>

            {/* Weapon illustration area */}
            <div className="relative flex items-center justify-center px-8 flex-shrink-0"
              style={{ height: 220, background: `linear-gradient(160deg, ${r.color}18 0%, rgba(10,12,20,0) 100%)` }}>
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: r.color, opacity: 0.6 }} />
              <div className="w-full max-w-xs">
                <WeaponSVG weapon={skin.weapon} color={r.color} />
              </div>
            </div>

            {/* Sticker slots */}
            {(skin.stickers > 0 || skin.charms) && (
              <div className="px-5 py-3 border-t border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="flex items-end justify-center gap-3">
                  {/* Charm first */}
                  {skin.charms && (
                    <>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <div className="w-10 h-10 rounded flex items-center justify-center"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <Star className="w-5 h-5" style={{ color: "#e8eaf0" }} />
                        </div>
                        <span className="font-mono text-[9px] text-foreground">$24.15</span>
                      </div>
                      {skin.stickers > 0 && (
                        <div className="self-stretch w-px mx-1 flex-shrink-0" style={{ background: "rgba(255,255,255,0.1)" }} />
                      )}
                    </>
                  )}
                  {/* Stickers */}
                  {Array.from({ length: skin.stickers }).map((_, i) => {
                    const s = mockStickers[i % 4];
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0">
                        <div className="relative w-10 h-10 rounded flex items-center justify-center"
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <div className="w-6 h-6 rounded-full" style={{ background: s.color + "80", border: `1px solid ${s.color}60` }} />
                          <span className="absolute -top-1.5 -left-1.5 font-mono text-[8px] font-bold px-0.5 rounded leading-none"
                            style={{ background: "rgba(0,0,0,0.7)", color: s.wear === 0 ? "#9da3c0" : s.wear > 50 ? "#f87171" : "#facc15", border: "1px solid rgba(255,255,255,0.12)" }}>
                            {s.wear}%
                          </span>
                        </div>
                        <span className="font-mono text-[9px] text-foreground">${s.price.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* History label */}
            <div className="px-5 pt-3 pb-0 flex-shrink-0">
              <span className="font-display text-[11px] uppercase tracking-widest font-semibold" style={{ color: r.color }}>History</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-5" style={{ scrollbarWidth: "none" }}>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">30-Day Price History</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart key={`detail-chart-${skin.id}`} data={PRICE_HISTORY}>
                  <XAxis key="detail-xaxis" dataKey="d" tick={{ fill: "#9da3c0", fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                  <YAxis key="detail-yaxis" tick={{ fill: "#9da3c0", fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                  <Tooltip
                    key="detail-tooltip"
                    contentStyle={{ background: "#1a1d28", border: `1px solid ${r.color}40`, borderRadius: 4, fontFamily: "JetBrains Mono", fontSize: 11 }}
                    labelStyle={{ color: r.color }}
                    itemStyle={{ color: "#e8eaf0" }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "Price"]}
                  />
                  <Line key="detail-line" type="monotone" dataKey="p" name="Price" stroke={r.color} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT: stats + buy ──────────────────────────────────── */}
          <div className="flex flex-col flex-shrink-0 overflow-y-auto" style={{ width: 280, scrollbarWidth: "none" }}>

            {/* Float bar */}
            <div className="px-5 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {/* Gradient bar */}
              <div className="relative h-2 rounded-full mb-2 overflow-hidden"
                style={{ background: "linear-gradient(to right, #4ade80 0%, #a3e635 15%, #facc15 38%, #fb923c 45%, #f87171 100%)" }}>
                <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-lg"
                  style={{ left: `calc(${floatPct}% - 5px)`, background: "#fff" }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">Float</span>
                <span className="font-mono text-[11px] text-foreground font-semibold">{skin.float.toFixed(10)}</span>
              </div>
            </div>

            {/* Attributes */}
            <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {[
                ["Rarity", r.label, r.color],
                ["Wear", skin.wear, null],
                ["Pattern", String(Math.floor(skin.float * 1000) % 1000), null],
                ["Volume", `${skin.volume}/day`, null],
              ].map(([label, val, color]) => (
                <div key={label} className="flex items-center justify-between py-1.5">
                  <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: color ?? "#e8eaf0" }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Sticker value + recommended price */}
            <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              {skin.charms && (
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] text-muted-foreground">Charm</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: "#4ade80" }}>+ ${charmValue.toFixed(2)}</span>
                </div>
              )}
              {skin.stickers > 0 && (
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] text-muted-foreground">Rare stickers</span>
                  <span className="font-mono text-[11px] font-semibold" style={{ color: "#4ade80" }}>+ ${stickerValue.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono text-[11px] text-muted-foreground">Recommended</span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: "#4ade80" }}>${recommendedPrice.toFixed(2)}</span>
              </div>
              <div className="font-mono text-[9px] text-muted-foreground leading-relaxed">Based on recent market sales and float value.</div>
            </div>

            {/* Price + trend */}
            <div className="px-5 py-4 flex-shrink-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Current price</div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-display text-2xl font-bold text-foreground">
                  ${skin.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                <span className="font-mono text-xs px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: skin.discount <= 0 ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)", color: skin.discount <= 0 ? "#4ade80" : "#f87171" }}>
                  {skin.discount <= 0 ? "" : "+"}{skin.discount}%
                </span>
              </div>
              <div className="font-mono text-xs mb-4" style={{ color: skin.trend >= 0 ? "#4ade80" : "#f87171" }}>
                {skin.trend >= 0 ? "▲" : "▼"} {Math.abs(skin.trend)}% past 7 days
              </div>

              {showSellInputs && (
                <div className="mb-3">
                  <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground block mb-1.5">Listing price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">$</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={listingPrice}
                      onChange={(e) => setListingPrice(e.target.value)}
                      className="w-full pl-7 pr-3 py-2.5 rounded-lg font-mono text-sm font-semibold focus:outline-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8eaf0" }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 px-0.5">
                    <span className="font-mono text-[10px] text-muted-foreground">You receive</span>
                    <span className="font-mono text-[10px] font-semibold" style={{ color: "#4ade80" }}>
                      ${(Math.max(0, parseFloat(listingPrice) || 0) * (1 - 0.05)).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => { onCta?.(listingPrice); onClose(); }}
                className="w-full py-3 rounded-lg font-display font-bold text-sm tracking-wide transition-all hover:opacity-90 mb-2"
                style={{ background: "#f0c040", color: "#08090d", boxShadow: "0 0 24px rgba(240,192,64,0.2)" }}>
                {ctaLabel}
              </button>

              {showSellInputs && (
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-lg font-display font-bold text-sm tracking-wide transition-all hover:opacity-80"
                  style={{ background: "linear-gradient(135deg, #e84060, #c0284a)", color: "#fff", boxShadow: "0 0 20px rgba(232,64,96,0.35)" }}>
                  SELL INSTANTLY FOR ${instantPrice.toFixed(2)}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Trade mock data ───────────────────────────────────────────────── */
interface TradeItem {
  skinId: number;
  name: string;
  weapon: string;
  wear: string;
  price: number;
  rarity: keyof typeof RARITY;
}

interface TradeOffer {
  id: number;
  user: string;
  timeAgo: string;
  type: "overpay" | "even" | "underpay";
  offers: TradeItem[];
  wants: TradeItem[];
}

const TRADE_OFFERS: TradeOffer[] = [
  {
    id: 1,
    user: "dk_vapor",
    timeAgo: "3h",
    type: "overpay",
    offers: [
      { skinId: 1,  name: "Redline",      weapon: "AK-47",        wear: "FT",  price: 42.50,   rarity: "classified" },
      { skinId: 8,  name: "Hyper Beast",  weapon: "M4A1-S",       wear: "FN",  price: 68.00,   rarity: "covert"     },
    ],
    wants: [
      { skinId: 9,  name: "Kill Confirmed", weapon: "USP-S",      wear: "MW",  price: 145.00,  rarity: "covert"     },
    ],
  },
  {
    id: 2,
    user: "xX_pro_Xx",
    timeAgo: "1h",
    type: "even",
    offers: [
      { skinId: 7,  name: "Fire Serpent", weapon: "AK-47",        wear: "FT",  price: 890.00,  rarity: "covert"     },
    ],
    wants: [
      { skinId: 6,  name: "Fade",         weapon: "Butterfly Knife", wear: "FN", price: 1890.00, rarity: "rare"    },
    ],
  },
  {
    id: 3,
    user: "knifetrader99",
    timeAgo: "30m",
    type: "overpay",
    offers: [
      { skinId: 10, name: "Doppler",      weapon: "Karambit",     wear: "FN",  price: 2640.00, rarity: "rare"       },
      { skinId: 14, name: "Emerald",      weapon: "Desert Eagle", wear: "FN",  price: 98.00,   rarity: "covert"     },
    ],
    wants: [
      { skinId: 15, name: "Icarus Fell",  weapon: "Karambit",     wear: "FN",  price: 3200.00, rarity: "rare"       },
    ],
  },
  {
    id: 4,
    user: "skinflip_eu",
    timeAgo: "5h",
    type: "underpay",
    offers: [
      { skinId: 11, name: "Asiimov",      weapon: "AK-47",        wear: "FT",  price: 28.00,   rarity: "classified" },
      { skinId: 12, name: "Neo-Noir",     weapon: "AWP",          wear: "FN",  price: 12.40,   rarity: "classified" },
      { skinId: 16, name: "Chatterbox",   weapon: "Galil AR",     wear: "FN",  price: 12.40,   rarity: "restricted" },
    ],
    wants: [
      { skinId: 5,  name: "Blaze",        weapon: "Desert Eagle", wear: "FN",  price: 520.00,  rarity: "classified" },
    ],
  },
  {
    id: 5,
    user: "m4_collector",
    timeAgo: "2h",
    type: "even",
    offers: [
      { skinId: 3,  name: "Howl",         weapon: "M4A4",         wear: "MW",  price: 3150.00, rarity: "covert"     },
    ],
    wants: [
      { skinId: 2,  name: "Dragon Lore",  weapon: "AWP",          wear: "FN",  price: 8420.00, rarity: "covert"     },
    ],
  },
  {
    id: 6,
    user: "trash2treasure",
    timeAgo: "45m",
    type: "overpay",
    offers: [
      { skinId: 13, name: "Printstream",  weapon: "M4A1-S",       wear: "FN",  price: 74.00,   rarity: "covert"     },
      { skinId: 4,  name: "Fade",         weapon: "Glock-18",     wear: "FN",  price: 380.00,  rarity: "restricted" },
    ],
    wants: [
      { skinId: 43, name: "Doppler",      weapon: "M9 Bayonet",   wear: "FN",  price: 890.00,  rarity: "rare"       },
    ],
  },
  {
    id: 7,
    user: "glove_god",
    timeAgo: "6h",
    type: "even",
    offers: [
      { skinId: 47, name: "Pandora's Box", weapon: "Sport Gloves", wear: "FT", price: 1240.00, rarity: "rare"       },
    ],
    wants: [
      { skinId: 48, name: "Overtake",     weapon: "Driver Gloves", wear: "MW", price: 680.00,  rarity: "rare"       },
      { skinId: 46, name: "Crimson Web",  weapon: "Gut Knife",    wear: "MW",  price: 210.00,  rarity: "rare"       },
    ],
  },
  {
    id: 8,
    user: "awp_only",
    timeAgo: "20m",
    type: "underpay",
    offers: [
      { skinId: 12, name: "Neo-Noir",     weapon: "AWP",          wear: "FN",  price: 12.40,   rarity: "classified" },
      { skinId: 40, name: "Detour",       weapon: "SSG 08",       wear: "FT",  price: 12.60,   rarity: "covert"     },
    ],
    wants: [
      { skinId: 2,  name: "Dragon Lore",  weapon: "AWP",          wear: "FN",  price: 8420.00, rarity: "covert"     },
    ],
  },
  {
    id: 9,
    user: "flippers_cs",
    timeAgo: "4h",
    type: "overpay",
    offers: [
      { skinId: 44, name: "Marble Fade",  weapon: "Flip Knife",   wear: "FN",  price: 620.00,  rarity: "rare"       },
      { skinId: 30, name: "Cyrex",        weapon: "Five-SeveN",   wear: "FN",  price: 22.00,   rarity: "classified" },
    ],
    wants: [
      { skinId: 45, name: "Tiger Tooth",  weapon: "Bayonet",      wear: "FN",  price: 480.00,  rarity: "rare"       },
    ],
  },
  {
    id: 10,
    user: "stickerking_cz",
    timeAgo: "12m",
    type: "even",
    offers: [
      { skinId: 5,  name: "Blaze",        weapon: "Desert Eagle", wear: "FN",  price: 520.00,  rarity: "classified" },
      { skinId: 9,  name: "Kill Confirmed", weapon: "USP-S",      wear: "MW",  price: 145.00,  rarity: "covert"     },
    ],
    wants: [
      { skinId: 6,  name: "Fade",         weapon: "Butterfly Knife", wear: "FN", price: 1890.00, rarity: "rare"    },
    ],
  },
];

/* ─── Trade skin card (compact, selectable) ─────────────────────────── */
function TradeSkinCard({
  skin,
  selected,
  onClick,
}: {
  skin: Skin;
  selected: boolean;
  onClick: () => void;
  side?: "left" | "right";
}) {
  const r = RARITY[skin.rarity];
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full text-left rounded overflow-hidden border transition-colors duration-200 cursor-pointer flex flex-col"
      style={{
        height: "230px",
        borderColor: selected ? r.color : hovered ? r.color : "rgba(255,255,255,0.07)",
        background: selected
          ? `linear-gradient(160deg, ${r.color}28, ${r.color}0e)`
          : `linear-gradient(160deg, ${r.from}, ${r.to})`,
        boxShadow: active ? `0 0 20px ${r.glow}` : "none",
      }}
    >
      {/* Rarity strip */}
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: r.color }} />

      {/* Stickers — top right */}
      {skin.stickers > 0 && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5 z-10">
          {Array.from({ length: skin.stickers }).map((_, i) => (
            <div key={i} className="w-5 h-5 rounded-sm flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5"/>
                <circle cx="6" cy="6" r="1.5" fill="#c0c4d8"/>
              </svg>
            </div>
          ))}
        </div>
      )}

      {/* Illustration */}
      <div className="relative flex-1 flex items-center justify-center px-4 overflow-hidden transition-all duration-200"
        style={{ paddingTop: active ? "8px" : "16px", paddingBottom: active ? "8px" : "16px" }}>
        {skin.statTrak && (
          <span className="absolute bottom-1.5 left-2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded z-10"
            style={{ background: "rgba(240,192,64,0.2)", color: "#f0c040", border: "1px solid rgba(240,192,64,0.3)" }}>ST</span>
        )}
        <div className="w-full h-full max-w-[160px]">
          <WeaponSVG weapon={skin.weapon} color={r.color} />
        </div>
      </div>

      {/* Divider */}
      <div className="mx-3" style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

      {/* Info footer */}
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <div className="text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5" style={{ color: r.color }}>{skin.weapon}</div>
            <div className="font-display text-sm font-semibold text-foreground leading-tight truncate">{skin.name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-mono text-[9px] text-muted-foreground">{skin.wear}</div>
            <div className="font-mono text-[9px]" style={{ color: r.color }}>{skin.float.toFixed(4)}</div>
          </div>
        </div>
        <div className="font-mono font-semibold text-sm leading-none" style={{ color: "#f0f2f8" }}>
          ${skin.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      {/* Action row — opens on hover only, matching the Sell grid. */}
      <div style={{ display: "grid", gridTemplateRows: hovered ? "1fr" : "0fr", transition: "grid-template-rows 200ms ease" }}>
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-2.5">
            <div className="w-full text-center text-xs font-semibold py-1.5 rounded font-display tracking-wide transition-opacity duration-200"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "#f0c040",
                color: selected ? "#e8eaf0" : "#08090d",
                opacity: hovered ? 1 : 0,
              }}>
              {selected ? "DESELECT" : "SELECT"}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ─── Trade page ─────────────────────────────────────────────────────── */

/**
 * One real inventory item, offered into a trade.
 *
 * The same card as `TradeSkinCard` above, against a real item instead of
 * a mock one: the artwork is Steam's own image rather than a drawn
 * weapon, and there is no price, because a Steam inventory does not
 * carry one and no price source is wired up yet. The right-hand side of
 * this screen is still the mock storefront, which is where the prices on
 * this page come from.
 */
function TradeInventoryCard({
  item,
  selected,
  onClick,
}: {
  item: InventoryItem;
  selected: boolean;
  onClick: () => void;
}) {
  const r = rarityStyle(rarityKeyForItem(item));
  const applied = [...charmsOf(item), ...stickersOf(item)];
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered;

  // The same hook the Sell screen uses, so the pause before the popup is
  // one number for the whole site rather than a copy that drifts.
  const hover = useAppliedHover();

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full text-left rounded overflow-hidden border transition-colors duration-200 cursor-pointer flex flex-col"
      style={{
        height: "230px",
        borderColor: active ? r.color : "rgba(255,255,255,0.07)",
        background: selected
          ? `linear-gradient(160deg, ${r.color}28, ${r.color}0e)`
          : `linear-gradient(160deg, ${r.from}, ${r.to})`,
        boxShadow: active ? `0 0 20px ${r.glow}` : "none",
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: r.color }} />

      {/* One badge per unit, never grouped by name — five copies of one
          sticker can each be scraped differently, and one can be worth
          several times another. Same popup and same pause as the Sell
          screen: the scrape moves the price, so it is worth reading
          wherever the item is on screen. */}
      {applied.length > 0 && (
        <div className="absolute top-2 right-2 flex flex-col gap-0.5 z-10">
          {applied.map((a, i) => (
            <div
              key={`${a.slot}-${i}`}
              aria-label={appliedLabel(a)}
              onMouseEnter={(e) => hover.open(a, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={hover.close}
              className="rounded-sm flex items-center justify-center overflow-hidden transition-all duration-200"
              style={{
                width: active ? 18 : 22,
                height: active ? 18 : 22,
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {a.imageUrl ? (
                <img src={a.imageUrl} alt="" className="w-full h-full object-contain" loading="lazy" />
              ) : (
                <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="#c0c4d8" strokeWidth="1" strokeDasharray="2 1.5" />
                  <circle cx="6" cy="6" r="1.5" fill="#c0c4d8" />
                </svg>
              )}
            </div>
          ))}

          {hover.detail && (
            <AppliedPopup applied={hover.detail.applied} anchor={hover.detail.anchor} />
          )}
        </div>
      )}

      <div
        className="relative flex-1 flex items-center justify-center px-4 overflow-hidden transition-all duration-200"
        style={{ paddingTop: active ? "8px" : "16px", paddingBottom: active ? "8px" : "16px" }}
      >
        {isStatTrak(item) && (
          <span className="absolute bottom-1.5 left-2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded z-10" style={{ background: "rgba(240,192,64,0.2)", color: "#f0c040", border: "1px solid rgba(240,192,64,0.3)" }}>ST</span>
        )}
        <div className="w-full h-full max-w-[160px] flex items-center justify-center">
          {item.iconUrl ? (
            <img src={item.iconUrl} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
          ) : (
            <Package className="w-10 h-10" style={{ color: r.color, opacity: 0.4 }} />
          )}
        </div>
      </div>

      <div className="mx-3" style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

      {/* Stacked rather than two columns. These cards land around 90px
          wide in the trade layout, and side by side the fixed-width wear
          and float took the whole row — the name and the weapon were
          being squeezed to literally zero and every card read as blank. */}
      <div className="px-2 py-2 flex flex-col gap-0.5 min-w-0">
        <div className="text-[9px] font-mono uppercase tracking-wider leading-none truncate" style={{ color: r.color }}>
          {item.catalog?.weapon ?? item.typeLabel ?? ""}
        </div>
        <div className="font-display text-xs font-semibold text-foreground leading-tight truncate">
          {item.catalog?.skinName ?? item.marketHashName}
        </div>
        <div className="flex items-baseline justify-between gap-1 font-mono text-[9px] min-w-0">
          <span className="truncate" style={{ color: "#6c7290" }}>{item.exterior ?? ""}</span>
          {item.float !== null && (
            <span className="flex-shrink-0" style={{ color: r.color }}>{item.float.toFixed(4)}</span>
          )}
        </div>

        {/* The value slot. Empty on purpose for now: a Steam inventory
            carries no price, PriceSnapshot has no rows and no provider
            adapter is written yet, so anything printed here would be
            invented — and this is the number a trade is judged on.
            The line is here so the card does not move when the price
            source lands; only this string changes. */}
        <div className="font-mono font-semibold text-xs leading-none pt-0.5" style={{ color: "#4a4f68" }}>
          Not priced
        </div>
      </div>

      {/* Same behaviour as the Sell grid: the row opens on hover only,
          not on selection. A selected card already says so through its
          border and glow, and leaving the button up on every pick turns
          a grid of twenty choices into a wall of buttons. */}
      <div style={{ display: "grid", gridTemplateRows: hovered ? "1fr" : "0fr", transition: "grid-template-rows 200ms ease" }}>
        <div style={{ overflow: "hidden" }}>
          <div className="px-3 pb-2.5">
            <div className="w-full text-center text-xs font-semibold py-1.5 rounded font-display tracking-wide transition-opacity duration-200"
              style={{
                background: selected ? "rgba(255,255,255,0.08)" : "#f0c040",
                color: selected ? "#e8eaf0" : "#08090d",
                opacity: hovered ? 1 : 0,
              }}>
              {selected ? "DESELECT" : "SELECT"}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/**
 * Valve's wear names, shortened to what fits.
 *
 * The cart card is 84px wide and the line has to hold the wear, the
 * float and often StatTrak. "Factory New / 0.0395" does not fit and gets
 * cut mid-word; "FN / 0.0395" does, and these are the abbreviations the
 * trading community already uses.
 */
const WEAR_SHORT: Record<string, string> = {
  "Factory New": "FN",
  "Minimal Wear": "MW",
  "Field-Tested": "FT",
  "Well-Worn": "WW",
  "Battle-Scarred": "BS",
};

/**
 * One picked item, as it appears in the trade bar at the top.
 *
 * Small on purpose — the bar has to hold a dozen of these without
 * pushing the grids off screen, so it carries only what distinguishes
 * one copy from another: the artwork, the wear and float, the price, and
 * a way to drop it.
 */
function TradeCartCard({
  color,
  meta,
  price,
  priceMuted = false,
  lockDays,
  onRemove,
  children,
}: {
  color: string;
  /** The line that tells two identical-looking copies apart. */
  meta: string;
  price: string;
  /** True when the figure is a placeholder rather than a number. */
  priceMuted?: boolean;
  lockDays?: number | null;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="flex-shrink-0 rounded overflow-hidden border flex flex-col"
      style={{ width: 84, background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <div className="relative h-[52px] flex items-center justify-center px-1.5" style={{ background: `linear-gradient(160deg, ${color}22, transparent)` }}>
        {/* Valve holds a traded item for 7 days, and the countdown is
            part of what the other side is agreeing to. */}
        {lockDays != null && lockDays > 0 && (
          <span className="absolute top-0.5 left-0.5 font-mono text-[7px] px-1 rounded flex items-center gap-0.5" style={{ background: "rgba(0,0,0,0.55)", color: "#c0c4d8" }}>
            <Lock className="w-2 h-2" />{lockDays}d
          </span>
        )}
        {children}
      </div>

      <div className="px-1.5 pb-1 pt-0.5 flex flex-col gap-0.5">
        <div className="font-mono text-[8px] truncate" style={{ color }}>{meta}</div>
        <div className="font-mono text-[9px] font-semibold truncate" style={{ color: priceMuted ? "#4a4f68" : "#f0f2f8" }}>
          {price}
        </div>
      </div>

      <button
        onClick={onRemove}
        className="w-full py-1 flex items-center justify-center transition-colors"
        style={{ background: "rgba(232,64,96,0.12)", borderTop: "1px solid rgba(232,64,96,0.2)" }}
        aria-label="Remove from trade"
      >
        <Trash2 className="w-2.5 h-2.5" style={{ color: "#e84060" }} />
      </button>
    </div>
  );
}

/**
 * One side of the trade bar: a heading, a total, and the picked items.
 *
 * Both sides share this shell so they stay symmetrical — the whole point
 * of the bar is comparing one against the other, and two layouts that
 * drift apart make that harder than it needs to be.
 */
function TradeSide({
  title,
  total,
  totalMuted,
  count,
  align,
  collapsed,
  onToggleCollapse,
  empty,
  children,
}: {
  title: string;
  total: string;
  totalMuted: boolean;
  count: number;
  /** "left" mirrors the header to the other edge, as the two sides face each other. */
  align: "left" | "right";
  collapsed: boolean;
  onToggleCollapse: () => void;
  empty: string;
  children: ReactNode;
}) {
  // No Clear here: each column below the bar already has one, and two
  // buttons doing the same thing within a few hundred pixels only makes
  // the reader check which is which.
  const header = (
    <button
      onClick={onToggleCollapse}
      className="flex items-center gap-1.5 font-display text-xs font-bold tracking-wide flex-shrink-0"
      style={{ color: "#e8eaf0" }}
    >
      <ChevronDown
        className="w-3 h-3"
        style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 150ms" }}
      />
      {title}
    </button>
  );

  const totalNode = (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="font-mono text-xs font-semibold" style={{ color: totalMuted ? "#6c7290" : "#f0f2f8" }}>{total}</span>
      <span
        className="font-mono text-[9px] px-1.5 rounded-full"
        style={{ background: count > 0 ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.05)", color: count > 0 ? "#f0c040" : "#6c7290" }}
      >
        {count}
      </span>
    </div>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {header}
        <div className={align === "right" ? "mr-auto" : "ml-auto"}>{totalNode}</div>
      </div>

      {/* The heading mirrors to the outer edge, but the cards do not:
          both rows fill from the middle outwards, so the two sides sit
          either side of the Trade button and read as one comparison
          rather than two lists pushed to opposite walls. */}
      {!collapsed && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin", minHeight: 86 }}>
          {count === 0 ? (
            <span className="font-mono text-[10px] italic self-center" style={{ color: "#4a4f68" }}>{empty}</span>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

/** Why the inventory column is empty, said rather than left blank. */
function TradeInventoryNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5 px-6 text-center">
      <div className="font-display text-xs font-bold" style={{ color: "#e8eaf0" }}>{title}</div>
      <div className="font-mono text-[10px] leading-relaxed max-w-xs" style={{ color: "#6c7290" }}>{body}</div>
    </div>
  );
}

function TradePage({ signedIn }: { signedIn: boolean }) {
  // The left side is the user's real Steam inventory, read through the
  // same hook the Sell screen uses — same cache, same rate limiter, same
  // refresh. The right side is still the mock storefront, which is what
  // it stays until the catalog endpoint exists.
  const inventory = useInventory(signedIn);

  // Selected by assetId, the string Steam gives each item. The mock had
  // numeric ids; a real inventory has none, and the assetId is what the
  // deposit and the trade offer are built from.
  const [mySelected, setMySelected]     = useState<string[]>([]);
  const [mktSelected, setMktSelected]   = useState<number[]>([]);
  // One flag for both sides: they are meant to be read against each
  // other, so collapsing one and not the other only makes that harder.
  const [cartCollapsed, setCartCollapsed] = useState(false);
  const [mySearch, setMySearch]         = useState("");
  const [mktSearch, setMktSearch]       = useState("");
  const [mktRarity, setMktRarity]         = useState<string[]>([]);
  const [mktExterior, setMktExterior]     = useState<string[]>([]);
  const [mktWeapon, setMktWeapon]         = useState<string[]>([]);
  const [mktPriceMin, setMktPriceMin]     = useState("");
  const [mktPriceMax, setMktPriceMax]     = useState("");
  const [mktFloatMin, setMktFloatMin]     = useState(0);
  const [mktFloatMax, setMktFloatMax]     = useState(1);
  const [mktStatTrak, setMktStatTrak]     = useState<"yes"|"no"|null>(null);
  const [mktStickers, setMktStickers]     = useState<"yes"|"no"|null>(null);
  const [mktCharms, setMktCharms]         = useState<"yes"|"no"|null>(null);
  const [mktSort, setMktSort]             = useState("Default");
  const [mySort, setMySort]               = useState("Default");

  const toggleMy  = (id: string) => setMySelected((p)  => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleMkt = (id: number) => setMktSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleMR  = (v: string)  => setMktRarity((p)   => p.includes(v)  ? p.filter((x) => x !== v)  : [...p, v]);
  const toggleME  = (v: string)  => setMktExterior((p) => p.includes(v)  ? p.filter((x) => x !== v)  : [...p, v]);
  const toggleMW  = (v: string)  => setMktWeapon((p)   => p.includes(v)  ? p.filter((x) => x !== v)  : [...p, v]);



  // Only what can actually leave the account. On the Sell screen the
  // blocked items are shown and counted, because "where is my knife" is
  // a question worth answering there; here they would be items you can
  // click and then cannot trade, which is worse than not offering them.
  const myTradable = useMemo(
    () => inventory.items.filter((i) => i.depositable),
    [inventory.items],
  );

  const myFiltered = useMemo(() => {
    const q = mySearch.trim().toLowerCase();

    let out = myTradable.filter((i) => {
      if (!q) return true;
      return (
        i.marketHashName.toLowerCase().includes(q) ||
        (i.catalog?.skinName ?? '').toLowerCase().includes(q) ||
        (i.catalog?.weapon ?? '').toLowerCase().includes(q)
      );
    });

    // Price sorts are absent rather than broken: a Steam inventory
    // carries no price, and there is no price source wired up yet. The
    // options that remain are the ones the data can answer.
    const byFloat = (dir: 1 | -1) => (a: InventoryItem, b: InventoryItem) => {
      // Items without a float sit at the end either way — a case is not
      // "float 0", and sorting it as if it were puts containers above
      // every factory-new skin.
      if (a.float === null) return 1;
      if (b.float === null) return -1;
      return (a.float - b.float) * dir;
    };

    if (mySort === "Highest Float") out = [...out].sort(byFloat(-1));
    if (mySort === "Lowest Float")  out = [...out].sort(byFloat(1));
    return out;
  }, [myTradable, mySearch, mySort]);

  const mktFiltered = useMemo(() => {
    let out = SKINS.filter((s) => {
      const q = mktSearch.toLowerCase();
      if (q && !s.name.toLowerCase().includes(q) && !s.weapon.toLowerCase().includes(q)) return false;
      if (mktRarity.length > 0   && !mktRarity.includes(RARITY[s.rarity].label)) return false;
      if (mktExterior.length > 0 && !mktExterior.includes(s.wear)) return false;
      if (mktWeapon.length > 0   && !mktWeapon.includes(s.weapon)) return false;
      const pMin = parseFloat(mktPriceMin);
      const pMax = parseFloat(mktPriceMax);
      if (!isNaN(pMin) && s.price < pMin) return false;
      if (!isNaN(pMax) && s.price > pMax) return false;
      if (s.float < mktFloatMin || s.float > mktFloatMax) return false;
      if (mktStatTrak === "yes" && !s.statTrak) return false;
      if (mktStatTrak === "no"  &&  s.statTrak) return false;
      if (mktStickers === "yes" && s.stickers === 0) return false;
      if (mktStickers === "no"  && s.stickers  >  0) return false;
      if (mktCharms === "yes" && !s.charms) return false;
      if (mktCharms === "no"  &&  s.charms) return false;
      return true;
    });
    if (mktSort === "Highest Price")    out = [...out].sort((a, b) => b.price - a.price);
    if (mktSort === "Lowest Price")     out = [...out].sort((a, b) => a.price - b.price);
    if (mktSort === "Highest Float")    out = [...out].sort((a, b) => b.float - a.float);
    if (mktSort === "Lowest Float")     out = [...out].sort((a, b) => a.float - b.float);
    if (mktSort === "Discount") out = [...out].sort((a, b) => a.discount - b.discount);
    return out;
  }, [mktSearch, mktRarity, mktExterior, mktWeapon, mktPriceMin, mktPriceMax, mktFloatMin, mktFloatMax, mktStatTrak, mktStickers, mktCharms, mktSort]);

  const myItems  = myTradable.filter((i) => mySelected.includes(i.assetId));
  const mktItems = SKINS.filter((s) => mktSelected.includes(s.id));
  const mktTotal = mktItems.reduce((sum, s) => sum + s.price, 0);
  const canTrade = myItems.length > 0 && mktItems.length > 0;

  const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8eaf0",
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── TOP: the trade itself ─────────────────────────────────────
          Above the grids rather than beside them. What you have picked
          is the thing you keep checking while you browse, and in a
          narrow side column it could only ever be a list of names — here
          each pick keeps its artwork, its float and its price, which is
          what you are actually comparing. Collapsible because it costs
          vertical space that the grids also want. */}
      <div className="flex-shrink-0 border-b flex items-start gap-3 px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.015)" }}>
        <TradeSide
          title="Your offer"
          // A summed value, the same slot the other side uses — but it
          // stays "Not priced" until there is a price source. Every card
          // beneath it says the same, so the total agrees with its parts
          // rather than inventing a figure they cannot add up to.
          total={myItems.length > 0 ? "Not priced" : "—"}
          totalMuted
          count={myItems.length}
          align="left"
          collapsed={cartCollapsed}
          onToggleCollapse={() => setCartCollapsed((c) => !c)}
          empty="Pick from your inventory"
        >
          {myItems.map((item) => {
            const rs = rarityStyle(rarityKeyForItem(item));
            return (
              <TradeCartCard
                key={item.assetId}
                color={rs.color}
                meta={[
                  isStatTrak(item) ? "ST" : null,
                  item.exterior ? (WEAR_SHORT[item.exterior] ?? item.exterior) : null,
                  item.float !== null ? item.float.toFixed(4) : null,
                ].filter(Boolean).join(" / ")}
                price="Not priced"
                priceMuted
                onRemove={() => toggleMy(item.assetId)}
              >
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                ) : (
                  <Package className="w-5 h-5" style={{ color: rs.color, opacity: 0.4 }} />
                )}
              </TradeCartCard>
            );
          })}
        </TradeSide>

        {/* The action, between the two sides it acts on. */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5" style={{ width: 168 }}>
          <button
            disabled={!canTrade}
            className="w-full py-2 rounded-lg font-display font-bold text-sm tracking-widest transition-all"
            style={{
              background: canTrade ? "#f0c040" : "rgba(240,192,64,0.1)",
              color: canTrade ? "#08090d" : "#4a3e12",
              cursor: canTrade ? "pointer" : "not-allowed",
              boxShadow: canTrade ? "0 0 20px rgba(240,192,64,0.25)" : "none",
            }}
          >
            {canTrade ? "TRADE" : "SELECT ITEMS"}
          </button>

          {/* Where the difference between the two sides belongs, and
              cannot be computed: your side has no price source. */}
          <div className="font-mono text-[9px] text-center leading-tight" style={{ color: "#4a4f68" }}>
            {canTrade
              ? "Your side is not valued yet"
              : "Pick from both sides"}
          </div>
        </div>

        <TradeSide
          title="You receive"
          total={mktItems.length > 0 ? `$${mktTotal.toFixed(2)}` : "—"}
          totalMuted={mktItems.length === 0}
          count={mktItems.length}
          align="right"
          collapsed={cartCollapsed}
          onToggleCollapse={() => setCartCollapsed((c) => !c)}
          empty="Pick from the market"
        >
          {mktItems.map((s) => {
            const rs = RARITY[s.rarity];
            return (
              <TradeCartCard
                key={s.id}
                color={rs.color}
                meta={[s.statTrak ? "ST" : null, WEAR_SHORT[s.wear] ?? s.wear, s.float.toFixed(4)].filter(Boolean).join(" / ")}
                price={`$${s.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                onRemove={() => toggleMkt(s.id)}
              >
                <div className="w-full h-full py-1">
                  <WeaponSVG weapon={s.weapon} color={rs.color} />
                </div>
              </TradeCartCard>
            );
          })}
        </TradeSide>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">

      {/* ── LEFT: User inventory ──────────────────────────────────── */}
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-wide text-foreground">Your Inventory</div>
            <div className="font-mono text-[10px] text-muted-foreground">
              {inventory.loading ? "reading Steam…" : `${myTradable.length} tradable`}
              {mySelected.length > 0 && <span style={{ color: "#f0c040" }}> · {mySelected.length} selected</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Same window as the Sell screen, so the same way out for
                someone who just traded and does not see it yet. */}
            <button
              onClick={() => void inventory.refresh()}
              disabled={inventory.refreshing}
              title={inventory.fetchedAt ? `Read from Steam at ${inventory.fetchedAt.toLocaleTimeString()}` : "Read from Steam again"}
              className="font-mono text-[9px] px-2 py-1 rounded transition-colors flex items-center gap-1 disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.05)", color: "#9da3c0", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <RotateCw className={`w-2.5 h-2.5 ${inventory.refreshing ? "animate-spin" : ""}`} />
              {inventory.refreshing ? "Reading…" : "Refresh"}
            </button>
            {mySelected.length > 0 && mySelected.length < myFiltered.length && (
              <button
                onClick={() => setMySelected([])}
                className="font-mono text-[9px] px-2 py-1 rounded transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", color: "#9da3c0", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                Clear
              </button>
            )}
            {/* Select All takes what is on screen, not the whole
                inventory: with a search active, selecting the 180 items
                you filtered away is never what the button looked like it
                would do. */}
            {(() => {
              const allShown = myFiltered.length > 0 && myFiltered.every((i) => mySelected.includes(i.assetId));
              return (
                <button
                  onClick={() => setMySelected(allShown ? [] : myFiltered.map((i) => i.assetId))}
                  disabled={myFiltered.length === 0}
                  className="font-mono text-[9px] px-2 py-1 rounded transition-all disabled:opacity-40"
                  style={{
                    background: allShown ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.05)",
                    color: allShown ? "#f0c040" : "#9da3c0",
                    border: `1px solid ${allShown ? "rgba(240,192,64,0.3)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {allShown ? "Deselect All" : "Select All"}
                </button>
              );
            })()}
          </div>
        </div>

        {/* Search + Sort */}
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              value={mySearch}
              onChange={(e) => setMySearch(e.target.value)}
              placeholder="Search inventory..."
              className="w-full pl-7 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none"
              style={inputStyle}
            />
          </div>
          <MiniSortDropdown value={mySort} onChange={setMySort} />
        </div>

        {/* No running total here any more: the bar at the top of the
            screen carries it, and repeating it directly underneath was
            the same number twice within 40px. */}

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2" style={{ scrollbarWidth: "none" }}>
          {!signedIn ? (
            <TradeInventoryNotice
              title="Sign in to trade"
              body="Your Steam inventory is what you offer, so we need to know whose it is."
            />
          ) : inventory.loading ? (
            <TradeInventoryNotice title="Reading your inventory…" body="This comes from Steam, so it can take a moment." />
          ) : inventory.failure ? (
            <TradeInventoryNotice
              title="Could not read your inventory"
              body={inventory.failureMessage ?? "Try again in a moment."}
            />
          ) : myFiltered.length === 0 ? (
            <TradeInventoryNotice
              title={mySearch ? "Nothing matches that search" : "Nothing here can be traded"}
              body={
                mySearch
                  ? "Clear the search to see everything you can offer."
                  : "Items still under Valve's 7-day trade hold, and anything Steam marks untradable, cannot be offered."
              }
            />
          ) : (
            // auto-fill rather than a fixed six: the column shares the
            // screen with the filters and the market, so six put the
            // cards at 84px — narrower than the wear label they carry.
            // A minimum width lets the count fall to what actually fits.
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
              {myFiltered.map((item) => (
                <TradeInventoryCard
                  key={item.assetId}
                  item={item}
                  selected={mySelected.includes(item.assetId)}
                  onClick={() => toggleMy(item.assetId)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── CENTER: Filters + Trade summary ──────────────────────── */}
      <div
        className="flex flex-col flex-shrink-0 overflow-hidden"
        style={{ width: 200, borderLeft: "1px solid rgba(255,255,255,0.07)", borderRight: "1px solid rgba(255,255,255,0.07)" }}
      >
        {/* Filters header */}
        <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-wide text-foreground">Filters</div>
            <div className="font-mono text-[10px] text-muted-foreground">Applied to market</div>
          </div>
          {(mktRarity.length > 0 || mktExterior.length > 0 || mktWeapon.length > 0 || mktPriceMin || mktPriceMax || mktFloatMin > 0 || mktFloatMax < 1 || mktStatTrak || mktStickers || mktCharms) && (
            <button
              onClick={() => { setMktRarity([]); setMktExterior([]); setMktWeapon([]); setMktPriceMin(""); setMktPriceMax(""); setMktFloatMin(0); setMktFloatMax(1); setMktStatTrak(null); setMktStickers(null); setMktCharms(null); }}
              className="font-mono text-[9px] px-2 py-1 rounded transition-colors flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.05)", color: "#9da3c0", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Filters scroll area */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {/* Price */}
          <FilterSection title="Price" defaultOpen={false}>
            <div className="px-1 pt-1.5 pb-1 space-y-1.5">
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">$</span>
                <input type="number" min="0" value={mktPriceMin} onChange={(e) => setMktPriceMin(e.target.value)} placeholder="MIN"
                  className="w-full pl-5 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none" style={inputStyle} />
              </div>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">$</span>
                <input type="number" min="0" value={mktPriceMax} onChange={(e) => setMktPriceMax(e.target.value)} placeholder="MAX"
                  className="w-full pl-5 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none" style={inputStyle} />
              </div>
            </div>
          </FilterSection>

          {/* Rarity */}
          <FilterSection title="Rarity" defaultOpen={false}>
            <div className="space-y-0.5 pt-1">
              {Object.entries(RARITY).map(([key, r]) => (
                <FilterOption key={key} active={mktRarity.includes(r.label)} onClick={() => toggleMR(r.label)} accentColor={r.color}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.color }} />
                    <span className="font-mono text-xs truncate" style={{ color: mktRarity.includes(r.label) ? r.color : "#6b7194" }}>{r.label}</span>
                  </div>
                  {mktRarity.includes(r.label) && <Check className="w-2.5 h-2.5 flex-shrink-0" style={{ color: r.color }} />}
                </FilterOption>
              ))}
            </div>
          </FilterSection>

          {/* Exterior */}
          <FilterSection title="Exterior" defaultOpen={false}>
            <div className="space-y-0.5 pt-1">
              {["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"].map((w) => (
                <FilterOption key={w} active={mktExterior.includes(w)} onClick={() => toggleME(w)}>
                  <span className="font-mono text-xs" style={{ color: mktExterior.includes(w) ? "#e8eaf0" : "#6b7194" }}>{w}</span>
                  {mktExterior.includes(w) && <Check className="w-2.5 h-2.5" style={{ color: "#f0c040" }} />}
                </FilterOption>
              ))}
            </div>
          </FilterSection>

          {/* Type */}
          <FilterSection title="Type" defaultOpen={false}>
            <div className="pt-1 space-y-0.5">
              {WEAPON_GROUPS.map((group) => (
                <WeaponGroup
                  key={group.label}
                  group={group}
                  weaponFilter={mktWeapon}
                  onToggle={toggleMW}
                />
              ))}
            </div>
          </FilterSection>

          {/* Float */}
          <FilterSection title="Float" defaultOpen={false}>
            <div className="pt-3">
              <DualRangeSlider
                min={mktFloatMin}
                max={mktFloatMax}
                onMinChange={setMktFloatMin}
                onMaxChange={setMktFloatMax}
              />
            </div>
          </FilterSection>

          {/* Others */}
          <FilterSection title="Others" defaultOpen={false}>
            <div className="space-y-1 pt-2">
              {([
                { label: "StatTrak™", value: mktStatTrak, set: setMktStatTrak },
                { label: "Stickers",  value: mktStickers, set: setMktStickers },
                { label: "Charms",    value: mktCharms,   set: setMktCharms   },
              ] as { label: string; value: "yes"|"no"|null; set: (v: "yes"|"no"|null) => void }[]).map(({ label, value, set }) => (
                <div key={label} className="px-2 py-1.5">
                  <div className="font-mono text-xs mb-1.5" style={{ color: value ? "#e8eaf0" : "#6b7194" }}>{label}</div>
                  <div className="flex gap-1.5">
                    {(["yes", "no"] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => set(value === opt ? null : opt)}
                        className="flex-1 py-1 rounded font-mono text-[10px] font-semibold uppercase tracking-wider transition-all duration-150"
                        style={{
                          background: value === opt ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.04)",
                          color: value === opt ? "#f0c040" : "#6b7194",
                          border: `1px solid ${value === opt ? "rgba(240,192,64,0.35)" : "rgba(255,255,255,0.07)"}`,
                        }}
                      >
                        {opt === "yes" ? "With" : "Without"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </FilterSection>

        </div>

      </div>

      {/* ── RIGHT: Market ─────────────────────────────────────────── */}
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="min-w-0">
            <div className="font-display text-sm font-bold tracking-wide text-foreground">Market</div>
            {/* How many listings exist is not the shopper's business,
                and it is a number that only ever flatters or embarrasses
                us. What is selected still matters. */}
            <div className="font-mono text-[10px] text-muted-foreground">
              {mktSelected.length > 0 ? <span style={{ color: "#f0c040" }}>{mktSelected.length} selected</span> : " "}
            </div>
          </div>
          {mktSelected.length > 0 && (
            <button
              onClick={() => setMktSelected([])}
              className="font-mono text-[9px] px-2 py-1 rounded transition-colors flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.05)", color: "#9da3c0", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Search + Sort */}
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              value={mktSearch}
              onChange={(e) => setMktSearch(e.target.value)}
              placeholder="Search market..."
              className="w-full pl-7 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none"
              style={inputStyle}
            />
          </div>
          <MiniSortDropdown value={mktSort} onChange={setMktSort} />
        </div>

        {/* The running total lives in the bar at the top, for the same
            reason it was dropped from the inventory column. */}

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2" style={{ scrollbarWidth: "none" }}>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
            {mktFiltered.map((skin) => (
              <TradeSkinCard
                key={skin.id}
                skin={skin}
                selected={mktSelected.includes(skin.id)}
                onClick={() => toggleMkt(skin.id)}
                side="right"
              />
            ))}
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}

/* ─── (unused legacy modal kept for reference) ─────────────────────── */
function _NewTradeModal({ onClose }: { onClose: () => void }) {
  const [mySelected, setMySelected] = useState<number[]>([]);
  const [wantSelected, setWantSelected] = useState<number[]>([]);
  const [wantSearch, setWantSearch] = useState("");

  const myInventory = SKINS.slice(0, 16);
  const wantResults = wantSearch.length > 0
    ? SKINS.filter((s) =>
        s.name.toLowerCase().includes(wantSearch.toLowerCase()) ||
        s.weapon.toLowerCase().includes(wantSearch.toLowerCase())
      ).slice(0, 16)
    : SKINS.slice(16, 32);

  const toggleMy = (id: number) =>
    setMySelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleWant = (id: number) =>
    setWantSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const myItems = myInventory.filter((s) => mySelected.includes(s.id));
  const wantItems = SKINS.filter((s) => wantSelected.includes(s.id));
  const myTotal = myItems.reduce((sum, s) => sum + s.price, 0);
  const wantTotal = wantItems.reduce((sum, s) => sum + s.price, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
      <div
        className="relative w-full rounded-lg border overflow-hidden flex flex-col"
        style={{ maxWidth: 900, maxHeight: "90vh", background: "#10121a", borderColor: "rgba(240,192,64,0.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <span className="font-display text-lg font-bold tracking-wide" style={{ color: "#f0c040" }}>NEW TRADE OFFER</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden gap-0">
          {/* Left: Your items */}
          <div className="flex flex-col border-r flex-1" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
            <div className="px-4 py-2 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Your Items</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
                {myInventory.map((skin) => {
                  const r = RARITY[skin.rarity];
                  const selected = mySelected.includes(skin.id);
                  return (
                    <button
                      key={skin.id}
                      onClick={() => toggleMy(skin.id)}
                      className="relative rounded border flex flex-col items-center gap-1 p-1.5 transition-all duration-150"
                      style={{
                        background: selected ? `${r.color}18` : "rgba(255,255,255,0.03)",
                        borderColor: selected ? r.color : "rgba(255,255,255,0.08)",
                        boxShadow: selected ? `0 0 10px ${r.glow}` : "none",
                      }}
                    >
                      {selected && (
                        <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "#f0c040" }}>
                          <Check className="w-2 h-2 text-black" />
                        </div>
                      )}
                      <div className="w-12 h-8">
                        <WeaponSVG weapon={skin.weapon} color={r.color} />
                      </div>
                      <div className="font-mono text-[8px] text-center truncate w-full" style={{ color: r.color }}>{skin.weapon}</div>
                      <div className="font-mono text-[9px] font-semibold text-center truncate w-full" style={{ color: "#e8eaf0" }}>{skin.name}</div>
                      <div className="font-mono text-[9px]" style={{ color: "#f0c040" }}>${skin.price.toFixed(0)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: You want */}
          <div className="flex flex-col flex-1">
            <div className="px-4 py-2 border-b flex-shrink-0 flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">You Want</span>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <input
                  value={wantSearch}
                  onChange={(e) => setWantSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-6 pr-2 py-1 rounded font-mono text-xs focus:outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e8eaf0" }}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
                {wantResults.map((skin) => {
                  const r = RARITY[skin.rarity];
                  const selected = wantSelected.includes(skin.id);
                  return (
                    <button
                      key={skin.id}
                      onClick={() => toggleWant(skin.id)}
                      className="relative rounded border flex flex-col items-center gap-1 p-1.5 transition-all duration-150"
                      style={{
                        background: selected ? `${r.color}18` : "rgba(255,255,255,0.03)",
                        borderColor: selected ? r.color : "rgba(255,255,255,0.08)",
                        boxShadow: selected ? `0 0 10px ${r.glow}` : "none",
                      }}
                    >
                      {selected && (
                        <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "#f0c040" }}>
                          <Check className="w-2 h-2 text-black" />
                        </div>
                      )}
                      <div className="w-12 h-8">
                        <WeaponSVG weapon={skin.weapon} color={r.color} />
                      </div>
                      <div className="font-mono text-[8px] text-center truncate w-full" style={{ color: r.color }}>{skin.weapon}</div>
                      <div className="font-mono text-[9px] font-semibold text-center truncate w-full" style={{ color: "#e8eaf0" }}>{skin.name}</div>
                      <div className="font-mono text-[9px]" style={{ color: "#f0c040" }}>${skin.price.toFixed(0)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: selected summary + post */}
        <div className="border-t px-5 py-3 flex-shrink-0 flex items-center gap-4" style={{ borderColor: "rgba(255,255,255,0.07)", background: "#0d0f18" }}>
          {/* My side */}
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Offering ({myItems.length})</div>
            <div className="flex gap-1 flex-wrap">
              {myItems.length === 0
                ? <span className="font-mono text-[10px] text-muted-foreground italic">None selected</span>
                : myItems.map((s) => (
                    <span key={s.id} className="font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: RARITY[s.rarity].color }}>
                      {s.weapon} | {s.name}
                    </span>
                  ))}
            </div>
            {myItems.length > 0 && (
              <div className="font-mono text-[10px]" style={{ color: "#f0c040" }}>Total: ${myTotal.toFixed(2)}</div>
            )}
          </div>

          <ArrowRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />

          {/* Want side */}
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Wanting ({wantItems.length})</div>
            <div className="flex gap-1 flex-wrap">
              {wantItems.length === 0
                ? <span className="font-mono text-[10px] text-muted-foreground italic">None selected</span>
                : wantItems.map((s) => (
                    <span key={s.id} className="font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: RARITY[s.rarity].color }}>
                      {s.weapon} | {s.name}
                    </span>
                  ))}
            </div>
            {wantItems.length > 0 && (
              <div className="font-mono text-[10px]" style={{ color: "#f0c040" }}>Total: ${wantTotal.toFixed(2)}</div>
            )}
          </div>

          <button
            onClick={onClose}
            disabled={myItems.length === 0 || wantItems.length === 0}
            className="flex-shrink-0 px-5 py-2 rounded font-display font-bold text-sm tracking-wide transition-opacity"
            style={{
              background: myItems.length > 0 && wantItems.length > 0 ? "#f0c040" : "rgba(240,192,64,0.25)",
              color: myItems.length > 0 && wantItems.length > 0 ? "#08090d" : "#6b5d20",
              cursor: myItems.length > 0 && wantItems.length > 0 ? "pointer" : "not-allowed",
            }}
          >
            POST TRADE
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── (unused legacy component) ─────────────────────────────────────── */
function _TradeOfferCard({ offer }: { offer: TradeOffer }) {
  const typeColors: Record<string, string> = {
    overpay: "#4ade80",
    even:    "#f0c040",
    underpay: "#f87171",
  };
  const typeLabel: Record<string, string> = {
    overpay:  "OVERPAY",
    even:     "EVEN",
    underpay: "UNDERPAY",
  };

  const offerTotal = offer.offers.reduce((s, i) => s + i.price, 0);
  const wantTotal  = offer.wants.reduce((s, i)  => s + i.price, 0);

  const initials = offer.user.slice(0, 2).toUpperCase();

  const ItemMini = ({ item }: { item: TradeItem }) => {
    const r = RARITY[item.rarity];
    return (
      <div
        className="flex flex-col items-center gap-0.5 rounded border p-1.5"
        style={{ background: `linear-gradient(135deg, ${r.from}, ${r.to})`, borderColor: r.color + "40", minWidth: 64 }}
      >
        <div className="w-12 h-8">
          <WeaponSVG weapon={item.weapon} color={r.color} />
        </div>
        <div className="font-mono text-[8px] text-center leading-tight truncate w-full" style={{ color: r.color }}>{item.weapon}</div>
        <div className="font-mono text-[9px] font-semibold text-center truncate w-full" style={{ color: "#e8eaf0" }}>{item.name}</div>
        <div className="font-mono text-[9px]" style={{ color: "#f0c040" }}>${item.price >= 1000 ? (item.price / 1000).toFixed(1) + "k" : item.price.toFixed(0)}</div>
      </div>
    );
  };

  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-3"
      style={{ background: "#10121a", borderColor: "rgba(255,255,255,0.07)" }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs font-bold flex-shrink-0"
            style={{ background: "rgba(240,192,64,0.15)", color: "#f0c040", border: "1px solid rgba(240,192,64,0.3)" }}
          >
            {initials}
          </div>
          <div>
            <div className="font-mono text-xs font-semibold" style={{ color: "#e8eaf0" }}>{offer.user}</div>
            <div className="font-mono text-[9px] text-muted-foreground">{offer.timeAgo} ago</div>
          </div>
        </div>
        <span
          className="font-mono text-[9px] font-bold px-2 py-0.5 rounded"
          style={{ background: typeColors[offer.type] + "20", color: typeColors[offer.type], border: `1px solid ${typeColors[offer.type]}40` }}
        >
          {typeLabel[offer.type]}
        </span>
      </div>

      {/* Items row */}
      <div className="flex items-center gap-3">
        {/* Offers side */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Offers</div>
          <div className="flex gap-1.5 flex-wrap">
            {offer.offers.map((item, i) => <ItemMini key={i} item={item} />)}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Wants side */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Wants</div>
          <div className="flex gap-1.5 flex-wrap">
            {offer.wants.map((item, i) => <ItemMini key={i} item={item} />)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="font-mono text-[10px]">
            <span className="text-muted-foreground">Offer: </span>
            <span style={{ color: "#f0c040" }}>${offerTotal.toFixed(2)}</span>
          </div>
          <div className="font-mono text-[10px]">
            <span className="text-muted-foreground">Want: </span>
            <span style={{ color: "#f0c040" }}>${wantTotal.toFixed(2)}</span>
          </div>
          <div className="font-mono text-[10px]">
            <span className="text-muted-foreground">Diff: </span>
            <span style={{ color: offerTotal >= wantTotal ? "#4ade80" : "#f87171" }}>
              {offerTotal >= wantTotal ? "+" : ""}${(offerTotal - wantTotal).toFixed(2)}
            </span>
          </div>
        </div>
        <button
          className="px-3 py-1 rounded font-display font-bold text-xs tracking-wide hover:opacity-80 transition-opacity"
          style={{ background: "#f0c040", color: "#08090d" }}
        >
          SEND OFFER
        </button>
      </div>
    </div>
  );
}

/* ─── Main app ──────────────────────────────────────────────────────── */
const RARITIES = ["All", "Covert", "Classified", "Restricted", "Mil-Spec", "Rare"];
const WEAPON_GROUPS: { label: string; items: string[] }[] = [
  { label: "Knives", items: ["Bayonet", "Bowie Knife", "Butterfly Knife", "Falchion Knife", "Flip Knife", "Gut Knife", "Huntsman Knife", "Karambit", "M9 Bayonet", "Navaja Knife", "Nomad Knife", "Paracord Knife", "Shadow Daggers", "Skeleton Knife", "Stiletto Knife", "Survival Knife", "Talon Knife", "Ursus Knife"] },
  { label: "Gloves", items: ["Bloodhound Gloves", "Broken Fang Gloves", "Driver Gloves", "Hand Wraps", "Hydra Gloves", "Moto Gloves", "Specialist Gloves", "Sport Gloves"] },
  { label: "Pistols", items: ["CZ75-Auto", "Desert Eagle", "Dual Berettas", "Five-SeveN", "Glock-18", "P2000", "P250", "R8 Revolver", "Tec-9", "USP-S"] },
  { label: "SMG", items: ["MAC-10", "MP5-SD", "MP7", "MP9", "P90", "PP-Bizon", "UMP-45"] },
  { label: "Rifles", items: ["AK-47", "AUG", "AWP", "FAMAS", "G3SG1", "Galil AR", "M4A1-S", "M4A4", "SCAR-20", "SG 553", "SSG 08"] },
  { label: "Heavy", items: ["M249", "MAG-7", "Negev", "Nova", "Sawed-Off", "XM1014"] },
  { label: "Miscellany", items: ["Case Key", "Capsule Key", "Charms", "Stickers", "Cases", "Graffiti", "Music Kits", "Pins", "Agents", "Patches", "Zeus"] },
];
// No "Newest"/"Oldest": the only thing resembling an age here is the
// assetId, which changes on every trade. Sorting by it would order items
// by when they last moved between accounts, which is not what the label
// promises.
const SORTS    = ["Default", "Discount", "Highest Price", "Lowest Price", "Highest Float", "Lowest Float"];

export default function App() {
  const [search, setSearch]         = useState("");
  const [rarityFilter, setRarity]   = useState<string[]>([]);
  const [weaponFilter, setWeapon]   = useState<string[]>([]);
  const [exteriorFilter, setExterior] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [floatMin, setFloatMin] = useState(0);
  const [floatMax, setFloatMax] = useState(1);
  const [filterStatTrak, setFilterStatTrak] = useState<"yes" | "no" | null>(null);
  const [filterStickers, setFilterStickers] = useState<"yes" | "no" | null>(null);
  const [filterCharms, setFilterCharms]     = useState<"yes" | "no" | null>(null);

  function toggle(set: React.Dispatch<React.SetStateAction<string[]>>, value: string) {
    set((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }
  const [sort, setSort]             = useState("Default");
  const [selectedSkin, setSelected] = useState<Skin | null>(null);
  // The cart starts empty because the backend has no cart yet, and a
  // number here would be the screen asserting something no endpoint can
  // back. It becomes a real read when that endpoint exists.
  const [cartCount] = useState(0);

  // Bumped whenever something happened that may have produced a
  // notification, so the bell refetches. Better than polling on a timer
  // for an event the page itself just caused.
  const [notificationsKey, setNotificationsKey] = useState(0);
  const [filtersOpen, setFilters]   = useState(false);
  const [activeNav, setActiveNav]   = useState("Market");
  const [language, setLanguage]     = useState("EN");
  const [currency, setCurrency]     = useState("USD");

  // Who is logged in, straight from the backend. Nothing about the
  // account is kept locally: the balance and what the account may do
  // come from /api/auth/me on every load.
  const session = useSession();

  // The backend owns the display currency, so once it answers, it wins
  // over the local default.
  useEffect(() => {
    if (session.user) setCurrency(session.user.displayCurrency);
  }, [session.user]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut]     = useState(false);

  /**
   * Signing out has to clear the session on the SERVER, not just locally:
   * the cookie is httpOnly, and the backend revokes the token in Redis so
   * a copied one stops working too.
   *
   * The session is re-read afterwards rather than assumed empty — if the
   * request failed, the user is still signed in and the header must keep
   * saying so instead of showing a logged-out screen that lies.
   */
  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      // Swallowed on purpose: the refresh below settles the real state,
      // whichever way the request went.
    } finally {
      await session.refresh();
      setSigningOut(false);
      setUserMenuOpen(false);
    }
  }

  const filtered = useMemo(() => {
    let out = SKINS.filter((s) => {
      const q = search.toLowerCase();
      if (q && !s.name.toLowerCase().includes(q) && !s.weapon.toLowerCase().includes(q)) return false;
      const min = parseFloat(priceMin);
      const max = parseFloat(priceMax);
      if (!isNaN(min) && s.price < min) return false;
      if (!isNaN(max) && s.price > max) return false;
      if (rarityFilter.length > 0 && !rarityFilter.includes(RARITY[s.rarity].label)) return false;
      if (weaponFilter.length > 0 && !weaponFilter.includes(s.weapon)) return false;
      if (exteriorFilter.length > 0 && !exteriorFilter.includes(s.wear)) return false;
      if (s.float < floatMin || s.float > floatMax) return false;
      if (filterStatTrak === "yes" && !s.statTrak) return false;
      if (filterStatTrak === "no"  &&  s.statTrak) return false;
      if (filterStickers === "yes" && s.stickers === 0) return false;
      if (filterStickers === "no"  && s.stickers  >  0) return false;
      if (filterCharms === "yes" && !s.charms) return false;
      if (filterCharms === "no"  &&  s.charms) return false;
      return true;
    });

    if (sort === "Discount") out = [...out].sort((a, b) => a.discount - b.discount);
    if (sort === "Highest Price")    out = [...out].sort((a, b) => b.price - a.price);
    if (sort === "Lowest Price")     out = [...out].sort((a, b) => a.price - b.price);
    if (sort === "Highest Float")    out = [...out].sort((a, b) => b.float - a.float);
    if (sort === "Lowest Float")     out = [...out].sort((a, b) => a.float - b.float);
    return out;
  }, [search, priceMin, priceMax, floatMin, floatMax, rarityFilter, weaponFilter, exteriorFilter, filterStatTrak, filterStickers, filterCharms, sort]);

  const hasActiveFilters = priceMin || priceMax || floatMin > 0 || floatMax < 1 || rarityFilter.length > 0 || weaponFilter.length > 0 || exteriorFilter.length > 0 || filterStatTrak || filterStickers || filterCharms || search;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .font-display { font-family: 'Rajdhani', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>

      {/* ── Navigation ───────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 border-b" style={{ background: "rgba(8,9,13,0.95)", borderColor: "rgba(255,255,255,0.07)", backdropFilter: "blur(12px)" }}>
        <div className="w-full px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: "#f0c040" }}>
              <Zap className="w-4 h-4 text-black" />
            </div>
            <span className="font-display text-xl font-bold tracking-wider" style={{ color: "#f0c040" }}>NextSkins</span>
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-1 ml-4">
            {["Market", "Trade", "Sell"].map((n) => (
              <button
                key={n}
                onClick={() => setActiveNav(n)}
                className="px-3 py-1.5 rounded font-display text-sm font-semibold tracking-wide transition-colors"
                style={{
                  color: activeNav === n ? "#f0c040" : "#9da3c0",
                  background: activeNav === n ? "rgba(240,192,64,0.1)" : "transparent",
                }}
              >
                {n}
              </button>
            ))}
          </div>

          {/* No search here. Each screen searches a different thing —
              the storefront, your own inventory, a trade's two sides —
              and a single box in the header would have to guess which,
              or change meaning as you navigate. Every screen carries its
              own, worded for what it actually filters. */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-2">
              <NavDropdown value={language} onChange={setLanguage} options={LANGUAGES as unknown as { value: string; label: string; sub: string }[]} compactTrigger />
              <NavDropdown value={currency} onChange={setCurrency} options={CURRENCIES as unknown as { value: string; label: string; sub: string }[]} />
            </div>
            {/* Balance: shown only when there is a session, because there
                is no such thing as a logged-out balance. It stays the
                string the API returned — turning money into a JS number
                is where cents start disappearing. */}
            {session.user && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded border" style={{ borderColor: "rgba(240,192,64,0.3)", background: "rgba(240,192,64,0.08)" }}>
                <span className="font-mono text-xs font-semibold" style={{ color: "#f0c040" }}>
                  {session.user.balance} {session.user.displayCurrency}
                </span>
              </div>
            )}
            {/* The bell belongs to an account: an anonymous visitor has
                nothing to be notified about, so it is not shown at all
                when signed out. */}
            {session.user && <NotificationBell reloadKey={notificationsKey} />}
            {/* The cart stays visible either way — it is how someone
                finds what they picked up, signed in or not. Only the
                count is conditional. */}
            <button className="relative text-muted-foreground hover:text-foreground transition-colors">
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-mono font-bold flex items-center justify-center" style={{ background: "#f0c040", color: "#08090d" }}>{cartCount}</span>
              )}
            </button>
            {/* Three states, not two: still asking, signed in, signed
                out. Rendering "sign in" while the answer is in flight
                makes the button flicker on every load for someone who
                is in fact logged in. */}
            {session.loading ? (
              <div className="w-7 h-7 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
            ) : session.user ? (
              /* Avatar alone, no name beside it. The name still travels
                 with it in alt and title, so it is one hover away and a
                 screen reader still announces it — on a site holding
                 money, "which account am I in?" has to stay answerable. */
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((open) => !open)}
                  title={session.user.username}
                  aria-label={`Account: ${session.user.username}`}
                  aria-expanded={userMenuOpen}
                  className="block rounded-full"
                >
                  {session.user.avatarUrl ? (
                    <img
                      src={session.user.avatarUrl}
                      alt={session.user.username}
                      className="w-7 h-7 rounded-full"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </button>

                {userMenuOpen && (
                  <>
                    {/* Catches the click that closes the menu. Without it
                        the only way out is clicking the avatar again,
                        which is not where anyone aims. */}
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div
                      className="absolute right-0 mt-2 w-56 rounded border z-50 overflow-hidden"
                      style={{ background: "#0f1117", borderColor: "rgba(255,255,255,0.1)" }}
                    >
                      {/* The name lives here, spelled out. This is the
                          screen someone opens to check which account
                          they are in before signing out of it. */}
                      <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                        <div className="font-mono text-xs truncate" style={{ color: "#e8eaf0" }}>
                          {session.user.username}
                        </div>
                        <div className="font-mono text-[10px] mt-0.5" style={{ color: "#6c7290" }}>
                          {session.user.steamId}
                        </div>
                      </div>
                      <button
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="w-full text-left px-3 py-2 font-display text-xs font-semibold tracking-wide transition-colors hover:bg-white/5 disabled:opacity-50"
                        style={{ color: "#e84060" }}
                      >
                        {signingOut ? "SIGNING OUT…" : "SIGN OUT"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                onClick={startSteamLogin}
                className="px-3 py-1.5 rounded font-display text-xs font-semibold tracking-wide transition-colors"
                style={{ background: "#f0c040", color: "#08090d" }}
              >
                SIGN IN WITH STEAM
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Account-level, not part of any one flow: a buyer needs a trade
          URL as much as a seller, since it is where the bot delivers
          what they bought. The moment it is needed is the worst moment
          to discover it is missing. */}
      {session.user && !session.user.hasTradeUrl && (
        <TradeUrlBanner onSaved={() => void session.refresh()} />
      )}

      <div className={`w-full px-4 ${activeNav === "Trade" || activeNav === "Sell" ? "py-0" : "py-6"}`}>
        {activeNav === "Trade" ? <TradePage signedIn={!!session.user} /> : activeNav === "Sell" ? (
          <SellPage
            signedIn={!!session.user}
            hasTradeUrl={session.user?.hasTradeUrl ?? false}
            onDeposited={() => setNotificationsKey((k) => k + 1)}
          />
        ) : (
        <div className="flex gap-6">

          {/* ── Sidebar ─────────────────────────────────────────── */}
          <aside className="hidden lg:flex flex-col w-64 flex-shrink-0" style={{ maxHeight: "calc(100vh - 56px)" }}>
            <div className="flex-1 overflow-y-auto flex flex-col gap-4" style={{ scrollbarWidth: "none" }}>
            {/* Header */}
            <div className="pb-1 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="font-display text-sm font-bold tracking-wide text-foreground">Filters</div>
            </div>
            {/* Price */}
            <FilterSection title="Price" defaultOpen={false}>
              <div className="px-2 pt-2 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">From</div>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0"
                        value={priceMin}
                        onChange={(e) => setPriceMin(e.target.value)}
                        placeholder="MIN"
                        className="w-full pl-5 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e8eaf0" }}
                      />
                    </div>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground mt-4">—</div>
                  <div className="flex-1">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground mb-1">To</div>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="0"
                        value={priceMax}
                        onChange={(e) => setPriceMax(e.target.value)}
                        placeholder="MAX"
                        className="w-full pl-5 pr-2 py-1.5 rounded font-mono text-xs focus:outline-none transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e8eaf0" }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </FilterSection>

            <FilterSection title="Rarity" defaultOpen={false}>
              <div className="space-y-0.5 pt-1">
                {Object.entries(RARITY).map(([key, r]) => (
                  <FilterOption
                    key={key}
                    active={rarityFilter.includes(r.label)}
                    onClick={() => toggle(setRarity, r.label)}
                    accentColor={r.color}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                      <span className="font-mono text-sm truncate" style={{ color: rarityFilter.includes(r.label) ? r.color : "#6b7194" }}>
                        {r.label}
                      </span>
                    </div>
                    {rarityFilter.includes(r.label) && <Check className="w-2.5 h-2.5 flex-shrink-0" style={{ color: r.color }} />}
                  </FilterOption>
                ))}
              </div>
            </FilterSection>

            {/* Exterior */}
            <FilterSection title="Exterior" defaultOpen={false}>
              <div className="space-y-0.5 pt-1">
                {["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"].map((wear) => (
                  <FilterOption
                    key={wear}
                    active={exteriorFilter.includes(wear)}
                    onClick={() => toggle(setExterior, wear)}
                  >
                    <span className="font-mono text-sm" style={{ color: exteriorFilter.includes(wear) ? "#e8eaf0" : "#6b7194" }}>{wear}</span>
                    {exteriorFilter.includes(wear) && <Check className="w-2.5 h-2.5" style={{ color: "#f0c040" }} />}
                  </FilterOption>
                ))}
              </div>
            </FilterSection>

            {/* Weapon */}
            <FilterSection title="Type" defaultOpen={false}>
              <div className="pt-1 space-y-0.5">
                {WEAPON_GROUPS.map((group) => (
                  <WeaponGroup
                    key={group.label}
                    group={group}
                    weaponFilter={weaponFilter}
                    onToggle={(w) => toggle(setWeapon, w)}
                  />
                ))}
              </div>
            </FilterSection>

            {/* Others */}
            {/* Float */}
            <FilterSection title="Float" defaultOpen={false}>
              <div className="pt-3">
                <DualRangeSlider
                  min={floatMin}
                  max={floatMax}
                  onMinChange={setFloatMin}
                  onMaxChange={setFloatMax}
                />
              </div>
            </FilterSection>

            <FilterSection title="Others" defaultOpen={false}>
              <div className="space-y-1 pt-2">
                {([
                  { label: "StatTrak™", value: filterStatTrak, set: setFilterStatTrak },
                  { label: "Stickers",  value: filterStickers, set: setFilterStickers },
                  { label: "Charms",    value: filterCharms,   set: setFilterCharms   },
                ] as { label: string; value: "yes" | "no" | null; set: (v: "yes" | "no" | null) => void }[]).map(({ label, value, set }) => (
                  <div key={label} className="px-2 py-1.5">
                    <div className="font-mono text-sm mb-1.5" style={{ color: value ? "#e8eaf0" : "#6b7194" }}>{label}</div>
                    <div className="flex gap-1.5">
                      {(["yes", "no"] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => set(value === opt ? null : opt)}
                          className="flex-1 py-1 rounded font-mono text-[10px] font-semibold uppercase tracking-wider transition-all duration-150"
                          style={{
                            background: value === opt ? "rgba(240,192,64,0.15)" : "rgba(255,255,255,0.04)",
                            color: value === opt ? "#f0c040" : "#6b7194",
                            border: `1px solid ${value === opt ? "rgba(240,192,64,0.35)" : "rgba(255,255,255,0.07)"}`,
                          }}
                        >
                          {opt === "yes" ? "With" : "Without"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </FilterSection>

            {/* Clear Filters button */}
            {hasActiveFilters && (
              <button
                onClick={() => { setPriceMin(""); setPriceMax(""); setFloatMin(0); setFloatMax(1); setRarity([]); setWeapon([]); setExterior([]); setFilterStatTrak(null); setFilterStickers(null); setFilterCharms(null); setSearch(""); }}
                className="w-full py-2 rounded font-mono text-xs transition-colors flex items-center justify-center gap-1.5 mt-2"
                style={{ background: "rgba(255,255,255,0.04)", color: "#9da3c0", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <X className="w-3 h-3" /> Clear Filters
              </button>
            )}
            </div>

            {/* Market stats — fixed below filters */}
            <div className="mt-4 p-3 rounded border flex-shrink-0" style={{ background: "#10121a", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Live Market</div>
              <div className="space-y-2">
                {[
                  { label: "24h Volume",     val: "$1.4M",  up: true  },
                  { label: "Active Listings", val: "48,392", up: false },
                  { label: "Transactions",   val: "12,841", up: true  },
                ].map(({ label, val, up }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
                    <span className="font-mono text-[10px] font-semibold" style={{ color: up ? "#4ade80" : "#e8eaf0" }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* ── Main content ────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* Filter bar.

                Three columns rather than a flex row, matching Sell: equal
                outer columns hold the search in the true centre, where a
                flex row would let it drift by the difference between the
                two sides and wander as the count went from "8 listings"
                to "1,240 listings". */}
            <div className="grid items-center gap-3 mb-4" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setFilters(!filtersOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono border hover:bg-white/5 transition-colors lg:hidden"
                  style={{ borderColor: "rgba(255,255,255,0.08)", color: "#9da3c0" }}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Filters
                </button>
                <div className="font-mono text-sm text-muted-foreground whitespace-nowrap">
                  <span className="text-foreground font-semibold">{filtered.length}</span> listings
                </div>
              </div>

              {/* Moved down from the header, and renamed on the way: up
                  there it had to cover every screen, so it said "skins,
                  weapons"; here it searches one thing and can say so. */}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search market..."
                className="w-[26rem] max-w-full px-3 py-2 rounded-lg font-mono text-xs focus:outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e8eaf0" }}
              />

              <div className="flex justify-end">
                <SortDropdown sort={sort} setSort={setSort} />
              </div>
            </div>

            {/* Skin grid */}
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground font-mono text-sm">
                No skins match your filters.
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: "956px", scrollbarWidth: "none" }}>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))" }}>
                  {filtered.map((skin) => (
                    <SkinCard key={skin.id} skin={skin} onClick={() => setSelected(skin)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right rail: activity ─────────────────────────────── */}
          <aside className="hidden xl:flex flex-col gap-4 w-52 flex-shrink-0">
            <div className="rounded-lg border overflow-hidden" style={{ background: "#10121a", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="px-3 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                <Zap className="w-3 h-3 text-yellow-400" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Live Sales</span>
                <div className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#4ade80" }} />
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {RECENT_SALES.map((s, i) => (
                  <div key={i} className="px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                    <div className="font-mono text-[10px] text-foreground leading-tight mb-0.5 truncate">{s.name}</div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold" style={{ color: "#f0c040" }}>
                        ${s.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground">{s.time} ago</span>
                    </div>
                    <div className="font-mono text-[9px] text-muted-foreground truncate">{s.user}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Trending */}
            <div className="rounded-lg border overflow-hidden" style={{ background: "#10121a", borderColor: "rgba(255,255,255,0.07)" }}>
              <div className="px-3 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                <TrendingUp className="w-3 h-3" style={{ color: "#4ade80" }} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Top Movers</span>
              </div>
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {SKINS.sort((a, b) => b.trend - a.trend).slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
                  >
                    <div>
                      <div className="font-mono text-[10px] text-foreground leading-tight truncate max-w-[110px]">
                        {s.weapon} | {s.name}
                      </div>
                      <div className="font-mono text-[9px] text-muted-foreground">${s.price.toFixed(2)}</div>
                    </div>
                    <div className="flex items-center gap-0.5 font-mono text-[10px] font-semibold" style={{ color: s.trend >= 0 ? "#4ade80" : "#f87171" }}>
                      {s.trend >= 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      {s.trend > 0 ? "+" : ""}{s.trend}%
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sell CTA */}
            <div className="rounded-lg p-4 border" style={{ background: "rgba(232,64,96,0.08)", borderColor: "rgba(232,64,96,0.2)" }}>
              <Package className="w-5 h-5 mb-2" style={{ color: "#e84060" }} />
              <div className="font-display text-sm font-bold text-foreground mb-1">List Your Skins</div>
              <div className="font-mono text-[10px] text-muted-foreground mb-3 leading-relaxed">0% seller fees this week. Instant payouts.</div>
              <button className="w-full py-2 rounded font-display font-bold text-xs tracking-wide hover:opacity-90 transition-opacity" style={{ background: "#e84060", color: "#fff" }}>
                START SELLING
              </button>
            </div>
          </aside>
        </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedSkin && <SkinDetail skin={selectedSkin} onClose={() => setSelected(null)} />}
    </div>
  );
}

