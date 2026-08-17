import { ItemCategory } from '@prisma/client';
import {
  aceitaAdesivo,
  categoriaDe,
  motivoBloqueio,
  nuncaNegociavel,
  temPadraoUnico,
} from './item-category';

describe('categoriaDe', () => {
  it('mapeia os tipos vistos num inventário real', () => {
    expect(categoriaDe('CSGO_Type_Rifle')).toBe(ItemCategory.RIFLE);
    expect(categoriaDe('CSGO_Type_Pistol')).toBe(ItemCategory.PISTOL);
    expect(categoriaDe('CSGO_Type_SMG')).toBe(ItemCategory.SMG);
    expect(categoriaDe('CSGO_Type_SniperRifle')).toBe(
      ItemCategory.SNIPER_RIFLE,
    );
    expect(categoriaDe('CSGO_Type_Knife')).toBe(ItemCategory.KNIFE);
    expect(categoriaDe('CSGO_Type_WeaponCase')).toBe(ItemCategory.CONTAINER);
    expect(categoriaDe('CSGO_Tool_Sticker')).toBe(ItemCategory.STICKER);
    expect(categoriaDe('CSGO_Type_Spray')).toBe(ItemCategory.GRAFFITI);
    expect(categoriaDe('CSGO_Type_MusicKit')).toBe(ItemCategory.MUSIC_KIT);
    expect(categoriaDe('CSGO_Type_Collectible')).toBe(ItemCategory.COLLECTIBLE);
  });

  // A Valve não segue o próprio padrão nas luvas: é Type_Hands, sem o
  // prefixo CSGO_. Qualquer mapeamento por prefixo erraria justo nelas,
  // que estão entre os itens mais caros do jogo.
  it('reconhece luvas apesar do prefixo diferente', () => {
    expect(categoriaDe('Type_Hands')).toBe(ItemCategory.GLOVES);
    expect(temPadraoUnico(categoriaDe('Type_Hands'))).toBe(true);
  });

  it('cai em OTHER para tipo desconhecido ou ausente', () => {
    expect(categoriaDe('CSGO_Type_CoisaNova')).toBe(ItemCategory.OTHER);
    expect(categoriaDe(null)).toBe(ItemCategory.OTHER);
  });

  // Nome traduzido nunca deve ser aceito: se alguém trocar l=english, a
  // classificação inteira quebraria em silêncio.
  it('não aceita o rótulo traduzido', () => {
    expect(categoriaDe('Rifle')).toBe(ItemCategory.OTHER);
    expect(categoriaDe('Fuzil')).toBe(ItemCategory.OTHER);
  });
});

/**
 * Era coluna no catálogo (`hasStickerSlots`) e nunca foi preenchida:
 * ficou `false` nos 33.950 itens, inclusive em toda arma. Virou função
 * porque a informação já estava na categoria — coluna que duplica outra
 * é coluna que diverge.
 */
describe('aceitaAdesivo', () => {
  it('vale para armas', () => {
    for (const c of [
      ItemCategory.RIFLE,
      ItemCategory.PISTOL,
      ItemCategory.SMG,
      ItemCategory.SNIPER_RIFLE,
      ItemCategory.SHOTGUN,
      ItemCategory.MACHINEGUN,
    ]) {
      expect(aceitaAdesivo(c)).toBe(true);
    }
  });

  // Zeus é família própria da Valve, mas aceita adesivo como qualquer
  // arma. Confirmado com quem opera.
  it('vale para o Zeus', () => {
    expect(aceitaAdesivo(ItemCategory.EQUIPMENT)).toBe(true);
  });

  // Têm float, mas não têm slot. É o que separa esta função de
  // temPadraoUnico — e o motivo de não dar para derivar uma da outra.
  it('não vale para faca e luva, apesar de terem padrão', () => {
    expect(aceitaAdesivo(ItemCategory.KNIFE)).toBe(false);
    expect(aceitaAdesivo(ItemCategory.GLOVES)).toBe(false);
    expect(temPadraoUnico(ItemCategory.KNIFE)).toBe(true);
  });

  it.each([
    ItemCategory.STICKER,
    ItemCategory.CONTAINER,
    ItemCategory.AGENT,
    ItemCategory.CHARM,
    ItemCategory.OTHER,
  ])('não vale para %s', (c) => {
    expect(aceitaAdesivo(c)).toBe(false);
  });
});

describe('temPadraoUnico', () => {
  it('vale para o que tem float e paint seed', () => {
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
      expect(temPadraoUnico(c)).toBe(true);
    }
  });

  it('não vale para itens fungíveis', () => {
    for (const c of [
      ItemCategory.CONTAINER,
      ItemCategory.STICKER,
      ItemCategory.AGENT,
      ItemCategory.GRAFFITI,
      ItemCategory.MUSIC_KIT,
      ItemCategory.COLLECTIBLE,
    ]) {
      expect(temPadraoUnico(c)).toBe(false);
    }
  });
});

describe('motivoBloqueio', () => {
  it('não bloqueia item negociável', () => {
    expect(motivoBloqueio(ItemCategory.RIFLE, true)).toBeNull();
  });

  it('marca como permanente o que nunca poderá ser negociado', () => {
    expect(motivoBloqueio(ItemCategory.COLLECTIBLE, false)).toBe('permanente');
    expect(motivoBloqueio(ItemCategory.PASS, false)).toBe('permanente');
  });

  // A Steam entrega medalha e skin em trade lock exatamente iguais:
  // tradable=0, market_tradable_restriction=7, sem data de liberação.
  // Dizer "volta em 7 dias" seria chute, e há itens gratuitos que ficam
  // bloqueados para sempre — o usuário esperaria por nada.
  it('usa rótulo vago quando não dá para saber se é temporário', () => {
    expect(motivoBloqueio(ItemCategory.RIFLE, false)).toBe('indisponivel');
    expect(motivoBloqueio(ItemCategory.MUSIC_KIT, false)).toBe('indisponivel');
  });

  it('medalha continua permanente mesmo se a Steam disser negociável', () => {
    // Não deveria acontecer, mas se acontecer preferimos não prometer
    // depósito de algo que a Steam vai recusar depois.
    expect(nuncaNegociavel(ItemCategory.COLLECTIBLE)).toBe(true);
  });
});
