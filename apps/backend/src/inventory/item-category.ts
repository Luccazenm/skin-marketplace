import { ItemCategory } from '@prisma/client';

/**
 * Traduz a tag `Type` da Steam para a nossa categoria.
 *
 * Usamos `internal_name` e NUNCA o nome localizado: "Rifle" vira "Fuzil"
 * se o idioma da requisição mudar, enquanto `CSGO_Type_Rifle` é estável.
 *
 * Repare em `Type_Hands`: as luvas não seguem o prefixo `CSGO_Type_` que
 * todo o resto usa. É inconsistência da própria Valve, e qualquer
 * mapeamento que tente deduzir pelo prefixo erra justamente nelas.
 */
const POR_INTERNAL_NAME: Record<string, ItemCategory> = {
  // --- têm float e paint seed ---
  CSGO_Type_Rifle: ItemCategory.RIFLE,
  CSGO_Type_Pistol: ItemCategory.PISTOL,
  CSGO_Type_SMG: ItemCategory.SMG,
  CSGO_Type_SniperRifle: ItemCategory.SNIPER_RIFLE,
  CSGO_Type_Shotgun: ItemCategory.SHOTGUN,
  CSGO_Type_Machinegun: ItemCategory.MACHINEGUN,
  CSGO_Type_Knife: ItemCategory.KNIFE,
  Type_Hands: ItemCategory.GLOVES,
  // Zeus x27. Tem skin e float, mas a Valve o põe numa família própria.
  CSGO_Type_Equipment: ItemCategory.EQUIPMENT,

  // --- sem padrão próprio ---
  // Nem todos são fungíveis: agente aceita patch e deixa de ser
  // intercambiável assim que recebe um.
  CSGO_Tool_Sticker: ItemCategory.STICKER,
  CSGO_Type_WeaponCase: ItemCategory.CONTAINER,
  CSGO_Tool_WeaponCase_KeyTag: ItemCategory.KEY,
  CSGO_Type_Spray: ItemCategory.GRAFFITI,
  CSGO_Type_MusicKit: ItemCategory.MUSIC_KIT,
  Type_CustomPlayer: ItemCategory.AGENT,
  CSGO_Tool_Patch: ItemCategory.PATCH,
  CSGO_Tool_Keychain: ItemCategory.CHARM,
  CSGO_Tool_Name_TagTag: ItemCategory.TOOL,

  // --- normalmente intransferíveis ---
  CSGO_Type_Collectible: ItemCategory.COLLECTIBLE,
  CSGO_Type_Ticket: ItemCategory.PASS,
};

/**
 * Categorias com float e paint seed próprios. São as únicas em que
 * Item.float e companhia fazem sentido.
 *
 * ATENÇÃO: isto NÃO é o mesmo que "categorias em que os exemplares se
 * diferenciam". Um agente pode receber até 3 patches, e patch aplicado
 * não volta para o inventário — só pode ser destruído. Então um agente
 * com patches é permanentemente distinto de um agente limpo, mesmo sem
 * ter float algum. O mesmo vale para chaveiro preso a uma arma.
 *
 * A segunda fonte de unicidade são as aplicações (sticker, patch,
 * chaveiro), hoje modeladas de forma parcial em ItemSticker — que só
 * cobre sticker de arma. Ver docs/pendencias.md.
 */
const COM_PADRAO_UNICO = new Set<ItemCategory>([
  ItemCategory.RIFLE,
  ItemCategory.PISTOL,
  ItemCategory.SMG,
  ItemCategory.SNIPER_RIFLE,
  ItemCategory.SHOTGUN,
  ItemCategory.MACHINEGUN,
  ItemCategory.KNIFE,
  ItemCategory.GLOVES,
  // "Zeus x27 | Olympus (Factory New)" tem exterior no nome como
  // qualquer skin — logo, tem float.
  ItemCategory.EQUIPMENT,
]);

/**
 * Categorias que a Steam nunca deixa trocar. Serve para explicar ao
 * usuário que o bloqueio é definitivo, e não uma espera.
 */
const NUNCA_NEGOCIAVEL = new Set<ItemCategory>([
  ItemCategory.COLLECTIBLE,
  ItemCategory.PASS,
]);

export function categoriaDe(internalName: string | null): ItemCategory {
  if (!internalName) {
    return ItemCategory.OTHER;
  }

  return POR_INTERNAL_NAME[internalName] ?? ItemCategory.OTHER;
}

export function temPadraoUnico(categoria: ItemCategory): boolean {
  return COM_PADRAO_UNICO.has(categoria);
}

export function nuncaNegociavel(categoria: ItemCategory): boolean {
  return NUNCA_NEGOCIAVEL.has(categoria);
}

export type MotivoBloqueio = 'permanente' | 'indisponivel';

/**
 * Por que este item não pode ser depositado agora — ou null se pode.
 *
 * Aqui há um limite dos dados que a Steam entrega, e ele é importante:
 * ela NÃO diferencia bloqueio definitivo de trade lock temporário. Uma
 * medalha e uma skin recém-recebida chegam idênticas, ambas com
 * `tradable: 0` e `market_tradable_restriction: 7`, sem data de
 * liberação em lugar nenhum.
 *
 * Por categoria só dá para ter certeza de um lado: medalha e passe nunca
 * serão negociáveis. Para o resto seria chute — e chutar "volta em 7
 * dias" é pior que não dizer nada, porque existem itens gratuitos (music
 * kit da Valve, por exemplo) que ficam bloqueados para sempre e o usuário
 * esperaria por uma liberação que nunca vem.
 *
 * Então 'indisponivel' é deliberadamente vago: cobre os dois casos sem
 * prometer prazo. A data real do trade lock só aparece quando o item
 * entra em custódia e lemos Item.tradeLockUntil.
 */
export function motivoBloqueio(
  categoria: ItemCategory,
  tradable: boolean,
): MotivoBloqueio | null {
  if (tradable) {
    return null;
  }

  return nuncaNegociavel(categoria) ? 'permanente' : 'indisponivel';
}
