/**
 * The rarity palette, shared by every surface that draws an item.
 *
 * It lives here rather than in App.tsx because the storefront, the sell
 * page and the item detail all colour by rarity, and a second copy would
 * drift — the colours are Valve's, and a card in a slightly different
 * red is the kind of thing nobody reports and everybody notices.
 */
export interface RarityStyle {
  label: string;
  color: string;
  glow: string;
  from: string;
  to: string;
}

export const RARITY: Record<string, RarityStyle> = {
  consumer: {
    label: 'Consumer',
    color: '#b0b0b0',
    glow: 'rgba(176,176,176,0.2)',
    from: '#181818',
    to: '#111111',
  },
  industrial: {
    label: 'Industrial',
    color: '#5b9bd5',
    glow: 'rgba(91,155,213,0.2)',
    from: '#0b1520',
    to: '#090f17',
  },
  milspec: {
    label: 'Mil-Spec',
    color: '#4b69ff',
    glow: 'rgba(75,105,255,0.2)',
    from: '#0a0c1e',
    to: '#080914',
  },
  restricted: {
    label: 'Restricted',
    color: '#8847ff',
    glow: 'rgba(136,71,255,0.2)',
    from: '#0f0a1e',
    to: '#0a0714',
  },
  classified: {
    label: 'Classified',
    color: '#d32ee6',
    glow: 'rgba(211,46,230,0.2)',
    from: '#180a1e',
    to: '#100614',
  },
  covert: {
    label: 'Covert',
    color: '#eb4b4b',
    glow: 'rgba(235,75,75,0.2)',
    from: '#1e0909',
    to: '#140606',
  },
  rare: {
    label: '★ Knife/Glove',
    color: '#f0c040',
    glow: 'rgba(240,192,64,0.2)',
    from: '#1a1404',
    to: '#111002',
  },
};

/** Never undefined: an unknown key falls back to the neutral tone. */
export function rarityStyle(key: string): RarityStyle {
  return RARITY[key] ?? RARITY.consumer;
}
