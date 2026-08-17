import { ItemCategory, SkinVariant } from '@prisma/client';

/** Uma entrada do catálogo, já normalizada e pronta para gravar. */
export interface EntradaCatalogo {
  marketHashName: string;
  category: ItemCategory;
  rarity: string;
  collection: string | null;
  variant: SkinVariant;
  weapon: string | null;
  skinName: string | null;
  minFloat: number | null;
  maxFloat: number | null;
  imageUrl: string | null;
}

/**
 * Item cru do dataset público da comunidade. Quase tudo é opcional
 * porque o formato varia por tipo: adesivo não tem `weapon`, agente não
 * tem `wear`, caixa não tem nem um nem outro.
 */
export interface ItemBruto {
  id?: string;
  /**
   * Identidade da skin sem o exterior: as cinco entradas de "Redline"
   * compartilham o mesmo `skin_id`. É a chave que liga uma skin à sua
   * coleção, já que `skins_not_grouped` não traz coleção nenhuma.
   */
  skin_id?: string;
  name?: string;
  /**
   * `null` explícito significa item que não existe no mercado — 701 dos
   * 11.134 adesivos estão assim. Diferente de ausente, que é só um
   * endpoint que não traz o campo.
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

/**
 * Traduz um item do dataset para o nosso catálogo.
 *
 * Devolve `null` para o que não deve entrar. O dataset descreve o jogo
 * inteiro, inclusive coisas que nunca vão aparecer num marketplace.
 *
 * Toda a classificação sai do NOME, não do campo `type` do dataset: o
 * `market_hash_name` é o mesmo identificador que a Steam usa, então
 * classificar por ele mantém catálogo e inventário concordando. Divergir
 * aqui significaria ter preço pendurado num template que nenhum item real
 * jamais aponta.
 */
export interface OpcoesMapeamento {
  /** Tipo do arquivo de origem, usado quando o nome não resolve. */
  categoriaPadrao?: ItemCategory;
  /**
   * Coleção resolvida por fora, cruzando `collections.json` pelo
   * `skin_id`. O arquivo de skins não traz esse dado.
   */
  colecao?: string | null;
}

export function mapearItem(
  bruto: ItemBruto,
  opcoes: OpcoesMapeamento = {},
): EntradaCatalogo | null {
  const { categoriaPadrao: categoriaDoArquivo, colecao } = opcoes;
  // Nome de mercado nulo é item que não existe no mercado — adesivo de
  // evento antigo, item de teste. Não tem preço para pendurar, e criar
  // template para ele encheria o catálogo de linhas que nenhuma cotação
  // jamais alcança.
  if (bruto.market_hash_name === null) {
    return null;
  }

  const marketHashName = (bruto.market_hash_name ?? bruto.name)?.trim();

  if (!marketHashName) {
    return null;
  }

  const peloNome = categoriaPeloNome(marketHashName, bruto);

  // O arquivo de origem é autoridade sobre o TIPO; o nome é autoridade
  // sobre o caso específico. "Katowice 2019 Legends (Holo-Foil)" e
  // "Stockholm 2021 Patch Pack" são cápsulas cujo nome não diz isso em
  // lugar nenhum — mas vieram de crates.json, e isso basta.
  const category =
    peloNome === ItemCategory.OTHER && categoriaDoArquivo
      ? categoriaDoArquivo
      : peloNome;

  // Medalha, troféu e passe nunca são negociáveis: guardar preço deles
  // seria guardar preço de algo que não pode ser vendido.
  if (category === ItemCategory.COLLECTIBLE || category === ItemCategory.PASS) {
    return null;
  }

  const temPadrao = CATEGORIAS_COM_PADRAO.has(category);
  const skinName = temPadrao ? (bruto.pattern?.name ?? null) : null;

  // Faca e luva sem pintura ("★ Karambit", "★ StatTrak™ Stiletto Knife")
  // são itens reais e caros, mas não têm skin nem float: não existe
  // desgaste em superfície não pintada. Preencher faixa 0–1 aí seria
  // inventar dado, e faria a vitrine dizer que uma vanilla é "float ruim".
  const pintado = temPadrao && skinName !== null;

  return {
    marketHashName,
    category,
    rarity: textoRaridade(bruto.rarity),
    // Ordem de confiança: a coleção resolvida pelo cruzamento é a mais
    // precisa; depois o campo do próprio item; por último a cápsula ou
    // caixa de onde ele sai, que é o que serve para adesivo.
    collection:
      colecao ??
      bruto.collections?.[0]?.name ??
      bruto.crates?.[0]?.name ??
      null,
    variant: varianteDe(marketHashName),
    weapon: temPadrao
      ? (bruto.weapon?.name ?? armaPeloNome(marketHashName))
      : null,
    skinName,
    // Quando o dataset não traz a faixa de um item pintado, cai no
    // domínio inteiro: é o único palpite honesto, e a constraint exige
    // os dois preenchidos junto com a skin.
    minFloat: pintado ? (bruto.min_float ?? 0) : null,
    maxFloat: pintado ? (bruto.max_float ?? 1) : null,
    imageUrl: bruto.image ?? null,
  };
}

/**
 * Último recurso quando o dataset não traz `weapon`: o nome do mercado
 * começa com o modelo, depois do "★" e das variantes.
 *
 *   "★ StatTrak™ Stiletto Knife"          -> "Stiletto Knife"
 *   "★ Karambit | Doppler (Factory New)"  -> "Karambit"
 */
function armaPeloNome(nome: string): string | null {
  const limpo = nome
    .replace(/^★\s*/, '')
    .replace(/^StatTrak™\s*/, '')
    .replace(/^Souvenir\s*/, '')
    .split('|')[0]
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

  return limpo.length > 0 ? limpo : null;
}

const CATEGORIAS_COM_PADRAO = new Set<ItemCategory>([
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
 * StatTrak e Souvenir são entradas de mercado distintas, com preço
 * próprio — por isso a variante sai do nome, que é o que a Steam usa
 * para diferenciá-las.
 */
function varianteDe(nome: string): SkinVariant {
  if (nome.includes('StatTrak')) {
    return SkinVariant.STATTRAK;
  }

  if (nome.startsWith('Souvenir ')) {
    return SkinVariant.SOUVENIR;
  }

  return SkinVariant.NORMAL;
}

function textoRaridade(r: ItemBruto['rarity']): string {
  if (typeof r === 'string') {
    return r;
  }

  return r?.name ?? 'Unknown';
}

/**
 * Classifica pelo prefixo do nome, na ordem em que a Steam nomeia.
 *
 * A ordem importa: "Sticker | Titan" e "Charm | Lil' Crass" precisam ser
 * testados antes das armas, senão um adesivo de arma cairia na categoria
 * da arma.
 */
function categoriaPeloNome(nome: string, bruto: ItemBruto): ItemCategory {
  for (const [prefixo, categoria] of PREFIXOS) {
    if (nome.startsWith(prefixo)) {
      return categoria;
    }
  }

  // ★ marca faca e luva. Luva se identifica pelo nome do modelo, porque
  // não há prefixo que as separe das facas.
  if (nome.startsWith('★')) {
    return NOMES_DE_LUVA.some((l) => nome.includes(l))
      ? ItemCategory.GLOVES
      : ItemCategory.KNIFE;
  }

  if (
    /\bCase$/.test(nome) ||
    nome.includes('Capsule') ||
    nome.includes('Package')
  ) {
    return ItemCategory.CONTAINER;
  }

  if (nome.endsWith('Case Key') || nome.endsWith('Key')) {
    return ItemCategory.KEY;
  }

  if (/\b(Coin|Medal|Trophy|Service Medal|Pin)\b/.test(nome)) {
    return ItemCategory.COLLECTIBLE;
  }

  if (nome.includes('Pass')) {
    return ItemCategory.PASS;
  }

  if (FERRAMENTAS.has(nome)) {
    return ItemCategory.TOOL;
  }

  // Arma: o nome tem "Arma | Skin" e o dataset trouxe a arma.
  if (bruto.weapon?.name && nome.includes('|')) {
    return categoriaDaArma(bruto.weapon.name);
  }

  if (nome.includes('Zeus x27')) {
    return ItemCategory.EQUIPMENT;
  }

  // Agente vem como "Nome | Facção", sem weapon. É o último caso com
  // barra, então só chega aqui o que não é arma.
  if (nome.includes('|')) {
    return ItemCategory.AGENT;
  }

  return ItemCategory.OTHER;
}

const PREFIXOS: Array<[string, ItemCategory]> = [
  ['Sticker | ', ItemCategory.STICKER],
  ['Patch | ', ItemCategory.PATCH],
  ['Charm | ', ItemCategory.CHARM],
  ['Sealed Graffiti | ', ItemCategory.GRAFFITI],
  ['Graffiti | ', ItemCategory.GRAFFITI],
  ['Music Kit | ', ItemCategory.MUSIC_KIT],
  ['StatTrak™ Music Kit | ', ItemCategory.MUSIC_KIT],
];

const NOMES_DE_LUVA = ['Gloves', 'Hand Wraps', 'Wraps'];

const FERRAMENTAS = new Set([
  'Name Tag',
  'StatTrak™ Swap Tool',
  'CS:GO Case Key',
  'Storage Unit',
]);

/** Mesma tabela do inventário: catálogo e leitura precisam concordar. */
function categoriaDaArma(arma: string): ItemCategory {
  if (RIFLES.has(arma)) return ItemCategory.RIFLE;
  if (PISTOLAS.has(arma)) return ItemCategory.PISTOL;
  if (SMGS.has(arma)) return ItemCategory.SMG;
  if (SNIPERS.has(arma)) return ItemCategory.SNIPER_RIFLE;
  if (ESPINGARDAS.has(arma)) return ItemCategory.SHOTGUN;
  if (METRALHADORAS.has(arma)) return ItemCategory.MACHINEGUN;
  if (EQUIPAMENTOS.has(arma)) return ItemCategory.EQUIPMENT;

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

const PISTOLAS = new Set([
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

const ESPINGARDAS = new Set(['MAG-7', 'Nova', 'Sawed-Off', 'XM1014']);

const METRALHADORAS = new Set(['M249', 'Negev']);

/**
 * Família própria da Valve. Precisa estar aqui, e não só na checagem por
 * nome: o dataset traz `weapon: "Zeus x27"`, então o fluxo passa por
 * `categoriaDaArma` antes de qualquer verificação textual — e saía de lá
 * como OTHER.
 */
const EQUIPAMENTOS = new Set(['Zeus x27']);
