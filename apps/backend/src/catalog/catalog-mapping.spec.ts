import { ItemCategory, SkinVariant } from '@prisma/client';
import { mapearItem, type ItemBruto } from './catalog-mapping';

/**
 * O catálogo é onde preço, busca e vitrine se penduram. Classificar
 * errado aqui não quebra nada visivelmente — só faz um adesivo sumir do
 * filtro de adesivos, ou uma arma entrar sem faixa de float e o banco
 * recusar a linha inteira.
 */
describe('mapearItem', () => {
  const ak: ItemBruto = {
    market_hash_name: 'AK-47 | Redline (Field-Tested)',
    weapon: { name: 'AK-47' },
    pattern: { name: 'Redline' },
    rarity: { name: 'Classified' },
    collections: [{ name: 'The Phoenix Collection' }],
    min_float: 0.1,
    max_float: 0.7,
    image: 'https://cdn/ak.png',
  };

  describe('arma', () => {
    it('preenche arma, skin e faixa de float', () => {
      const e = mapearItem(ak)!;

      expect(e.category).toBe(ItemCategory.RIFLE);
      expect(e.weapon).toBe('AK-47');
      expect(e.skinName).toBe('Redline');
      expect(e.minFloat).toBe(0.1);
      expect(e.maxFloat).toBe(0.7);
      expect(e.collections).toEqual(['The Phoenix Collection']);
    });

    // A constraint do banco exige os quatro campos em arma. Sem faixa no
    // dataset, cair no domínio inteiro é melhor que perder o item.
    it('usa a faixa cheia quando o dataset não informa', () => {
      const e = mapearItem({
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
    ])('classifica %s', (arma, esperado) => {
      const e = mapearItem({
        ...ak,
        market_hash_name: `${arma} | Alguma Skin (FT)`,
        weapon: { name: arma },
      })!;

      expect(e.category).toBe(esperado);
    });
  });

  describe('itens sem padrão', () => {
    // O motivo de todo este trabalho: adesivo tem preço próprio, e sem
    // ele no catálogo não dá para mostrar "arma vale X, adesivo vale Y".
    it('adesivo entra sem arma nem float', () => {
      const e = mapearItem({
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
    ])('classifica %s', (nome, esperado) => {
      expect(mapearItem({ market_hash_name: nome })!.category).toBe(esperado);
    });

    // Adesivo de arma tem nome de arma dentro. Testar o prefixo antes
    // evita que ele caia na categoria da arma.
    it('não confunde adesivo de arma com arma', () => {
      const e = mapearItem({
        market_hash_name: 'Sticker | AK-47 | Katowice 2014',
        weapon: { name: 'AK-47' },
      })!;

      expect(e.category).toBe(ItemCategory.STICKER);
      expect(e.weapon).toBeNull();
    });

    it('agente vira AGENT, não arma', () => {
      const e = mapearItem({
        market_hash_name: 'Sir Bloody Miami Darryl | The Professionals',
        rarity: { name: 'Master' },
      })!;

      expect(e.category).toBe(ItemCategory.AGENT);
      expect(e.weapon).toBeNull();
    });
  });

  describe('faca e luva', () => {
    it('★ sem nome de luva é faca', () => {
      const e = mapearItem({
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
    ])('reconhece luva em %s', (nome) => {
      expect(mapearItem({ market_hash_name: nome })!.category).toBe(
        ItemCategory.GLOVES,
      );
    });
  });

  describe('variante', () => {
    // Cada variante é cotada separadamente: mesma skin, preços diferentes.
    it('reconhece StatTrak', () => {
      const e = mapearItem({
        ...ak,
        market_hash_name: 'StatTrak™ AK-47 | Redline (Field-Tested)',
      })!;

      expect(e.variant).toBe(SkinVariant.STATTRAK);
    });

    it('reconhece Souvenir', () => {
      const e = mapearItem({
        ...ak,
        market_hash_name: 'Souvenir AWP | Dragon Lore (Factory New)',
        weapon: { name: 'AWP' },
      })!;

      expect(e.variant).toBe(SkinVariant.SOUVENIR);
    });

    it('normal por padrão', () => {
      expect(mapearItem(ak)!.variant).toBe(SkinVariant.NORMAL);
    });
  });

  describe('o que fica de fora', () => {
    // Guardar preço de algo que a Steam nunca deixa trocar seria guardar
    // preço de algo que não pode ser vendido.
    it.each(['5 Year Veteran Coin', 'Service Medal', 'Operation Riptide Pass'])(
      'descarta %s',
      (nome) => {
        expect(mapearItem({ market_hash_name: nome })).toBeNull();
      },
    );

    it('descarta item sem nome', () => {
      expect(mapearItem({ rarity: { name: 'Classified' } })).toBeNull();
    });

    // 701 dos 11.134 adesivos vêm com market_hash_name nulo: não existem
    // no mercado. Criar template para eles encheria o catálogo de linhas
    // que nenhuma cotação jamais alcança.
    it('descarta item sem nome de mercado, mesmo tendo name', () => {
      expect(
        mapearItem({
          name: 'Sticker | Shooter',
          market_hash_name: null,
          rarity: { name: 'Default' },
        }),
      ).toBeNull();
    });
  });

  describe('categoria vinda do arquivo de origem', () => {
    // O arquivo é autoridade sobre o TIPO; o nome, sobre o caso
    // específico. Cápsula de torneio não diz em lugar nenhum do nome que
    // é uma cápsula — mas veio de crates.json, e isso basta.
    it.each([
      'Katowice 2019 Legends (Holo-Foil)',
      'Stockholm 2021 Patch Pack',
      'StatTrak™ Masterminds 2 Music Kit Box',
      'CS:GO Weapon Case 2',
    ])('classifica %s pelo arquivo', (nome) => {
      expect(
        mapearItem(
          { market_hash_name: nome },
          { categoriaPadrao: ItemCategory.CONTAINER },
        )!.category,
      ).toBe(ItemCategory.CONTAINER);
    });

    // O nome ganha quando reconhece: adesivo listado em crates.json
    // continua sendo adesivo.
    it('não deixa o arquivo sobrescrever o que o nome já resolveu', () => {
      const e = mapearItem(
        { market_hash_name: 'Sticker | Titan | Katowice 2014' },
        { categoriaPadrao: ItemCategory.CONTAINER },
      )!;

      expect(e.category).toBe(ItemCategory.STICKER);
    });

    it('fica em OTHER quando nem nome nem arquivo resolvem', () => {
      expect(
        mapearItem({ market_hash_name: 'Coisa Desconhecida' })!.category,
      ).toBe(ItemCategory.OTHER);
    });
  });

  describe('faca sem pintura', () => {
    // Vanilla existe, é cara, e não tem skin nem float: não há desgaste
    // em superfície não pintada. Foram 40 itens recusados na primeira
    // importação por a constraint exigir skin de toda faca.
    it('entra sem skin e sem faixa de float', () => {
      const e = mapearItem({
        market_hash_name: '★ StatTrak™ Stiletto Knife',
        weapon: { name: 'Stiletto Knife' },
      })!;

      expect(e.category).toBe(ItemCategory.KNIFE);
      expect(e.weapon).toBe('Stiletto Knife');
      expect(e.skinName).toBeNull();
      expect(e.minFloat).toBeNull();
      expect(e.maxFloat).toBeNull();
    });

    // A constraint exige weapon em toda arma. Sem o campo no dataset, o
    // nome é a única fonte — e perder o item seria pior.
    it('deduz a arma do nome quando o dataset não traz', () => {
      expect(mapearItem({ market_hash_name: '★ Karambit' })!.weapon).toBe(
        'Karambit',
      );
      expect(
        mapearItem({ market_hash_name: '★ StatTrak™ Talon Knife' })!.weapon,
      ).toBe('Talon Knife');
    });
  });

  describe('Zeus x27', () => {
    // Tem skin, exterior e float como qualquer arma, mas a Valve o
    // classifica à parte. Sem categoria própria, ficava em OTHER — e
    // OTHER não tem padrão único, então o float dele não apareceria.
    // Regressão: o dataset traz weapon "Zeus x27", então o fluxo passa
    // por categoriaDaArma antes de qualquer checagem por nome. A primeira
    // versão só olhava o nome e o Zeus continuou em OTHER na importação
    // real, apesar de o teste passar.
    it('vira EQUIPMENT quando o dataset traz a arma', () => {
      const e = mapearItem({
        market_hash_name: 'Zeus x27 | Olympus (Factory New)',
        weapon: { name: 'Zeus x27' },
        pattern: { name: 'Olympus' },
        min_float: 0,
        max_float: 0.4,
      })!;

      expect(e.category).toBe(ItemCategory.EQUIPMENT);
      expect(e.weapon).toBe('Zeus x27');
    });

    it('vira EQUIPMENT também sem o campo weapon', () => {
      const e = mapearItem({
        market_hash_name: 'Zeus x27 | Olympus (Factory New)',
        pattern: { name: 'Olympus' },
        min_float: 0,
        max_float: 0.4,
      })!;

      expect(e.category).toBe(ItemCategory.EQUIPMENT);
      expect(e.weapon).toBe('Zeus x27');
      expect(e.skinName).toBe('Olympus');
      expect(e.minFloat).toBe(0);
      expect(e.maxFloat).toBe(0.4);
    });

    it.each([
      'StatTrak™ Zeus x27 | Tosai (Minimal Wear)',
      'Souvenir Zeus x27 | Dragon Snore (Well-Worn)',
    ])('reconhece a variante em %s', (nome) => {
      expect(mapearItem({ market_hash_name: nome })!.category).toBe(
        ItemCategory.EQUIPMENT,
      );
    });
  });

  describe('origem do item', () => {
    // O arquivo de skins não traz coleção nenhuma: ela só existe do
    // outro lado, em collections.json e crates.json, cruzada pelo
    // skin_id.
    it('usa as origens resolvidas por fora', () => {
      const e = mapearItem(
        { ...ak, collections: undefined, skin_id: 'skin-abc' },
        { colecoes: ['The Kilowatt Collection'] },
      )!;

      expect(e.collections).toEqual(['The Kilowatt Collection']);
    });

    // O caso que motivou a lista: guardar só uma seria escolher
    // arbitrariamente qual das três, por ordem de iteração. E a
    // quantidade de origens importa — skin que cai de três caixas tem
    // oferta muito maior que uma exclusiva.
    it('guarda todas as caixas de onde a faca sai', () => {
      const e = mapearItem(
        {
          market_hash_name: '★ Karambit | Doppler (Factory New)',
          weapon: { name: 'Karambit' },
          pattern: { name: 'Doppler' },
          skin_id: 'skin-525ac56c082c',
        },
        { colecoes: ['Chroma Case', 'Chroma 2 Case', 'Chroma 3 Case'] },
      )!;

      expect(e.collections).toEqual([
        'Chroma Case',
        'Chroma 2 Case',
        'Chroma 3 Case',
      ]);
    });

    it('junta o cruzamento com o que o próprio item traz', () => {
      const e = mapearItem(
        { ...ak, crates: [{ name: 'Alguma Caixa' }] },
        { colecoes: ['The Phoenix Collection'] },
      )!;

      expect(e.collections.sort()).toEqual([
        'Alguma Caixa',
        'The Phoenix Collection',
      ]);
    });

    it('não repete a mesma origem vinda de duas fontes', () => {
      const e = mapearItem(ak, { colecoes: ['The Phoenix Collection'] })!;

      expect(e.collections).toEqual(['The Phoenix Collection']);
    });

    it('cai para a cápsula quando o cruzamento não alcança', () => {
      const e = mapearItem({
        market_hash_name: 'Sticker | Titan | Katowice 2014',
        crates: [{ name: 'EMS Katowice 2014 Legends' }],
      })!;

      expect(e.collections).toEqual(['EMS Katowice 2014 Legends']);
    });

    it('fica vazia quando nenhuma fonte informa', () => {
      const e = mapearItem({ ...ak, collections: undefined })!;

      expect(e.collections).toEqual([]);
    });
  });

  describe('descrição', () => {
    const bruta =
      'Powerful and reliable, the AK-47 is one of the most popular ' +
      'assault rifles.\n\n<i>Never be afraid to push it to the limit</i>';

    it('separa a descrição do texto de sabor', () => {
      const e = mapearItem({ ...ak, description: bruta })!;

      expect(e.description).toBe(
        'Powerful and reliable, the AK-47 is one of the most popular assault rifles.',
      );
      expect(e.flavorText).toBe('Never be afraid to push it to the limit');
    });

    // Devolver marcação de terceiro para a tela obrigaria o frontend a
    // sanitizar — e página de item é onde alguém decide vender algo caro.
    it('não deixa passar HTML', () => {
      const e = mapearItem({
        ...ak,
        description: 'Texto <b>com</b> <span style="x">marcação</span>.',
      })!;

      expect(e.description).toBe('Texto com marcação.');
      expect(e.description).not.toContain('<');
    });

    it('converte <br> em quebra de linha', () => {
      const e = mapearItem({ ...ak, description: 'Linha um<br>Linha dois' })!;

      expect(e.description).toBe('Linha um\nLinha dois');
    });

    // Regressão: o dataset traz a quebra como os dois caracteres "\" e
    // "n". Sem converter, o texto "\n\n" aparecia escrito na descrição
    // gravada — apareceu na primeira importação real.
    it('converte quebra escrita com barra invertida', () => {
      const e = mapearItem({
        ...ak,
        description: 'Primeira parte.\\n\\nSegunda parte.',
      })!;

      expect(e.description).toBe('Primeira parte.\n\nSegunda parte.');
      expect(e.description).not.toContain('\\n');
    });

    it('não deixa a quebra literal sobrar no fim', () => {
      const e = mapearItem({
        ...ak,
        description: 'Texto da skin.\\n\\n<i>Sabor</i>',
      })!;

      expect(e.description).toBe('Texto da skin.');
      expect(e.flavorText).toBe('Sabor');
    });

    it('decodifica entidades', () => {
      const e = mapearItem({
        ...ak,
        description: 'Bolt &amp; Chain &quot;especial&quot;',
      })!;

      expect(e.description).toBe('Bolt & Chain "especial"');
    });

    it('aceita descrição sem sabor', () => {
      const e = mapearItem({ ...ak, description: 'Só a descrição.' })!;

      expect(e.description).toBe('Só a descrição.');
      expect(e.flavorText).toBeNull();
    });

    it.each([undefined, '', '   '])('fica nula quando vem %p', (d) => {
      const e = mapearItem({ ...ak, description: d })!;

      expect(e.description).toBeNull();
      expect(e.flavorText).toBeNull();
    });
  });

  describe('formato do dataset', () => {
    it('aceita raridade como texto solto', () => {
      expect(mapearItem({ ...ak, rarity: 'Covert' })!.rarity).toBe('Covert');
    });

    it('usa Unknown quando a raridade não vem', () => {
      expect(mapearItem({ ...ak, rarity: undefined })!.rarity).toBe('Unknown');
    });

    it('cai para crates quando não há collections', () => {
      const e = mapearItem({
        ...ak,
        collections: undefined,
        crates: [{ name: 'Kilowatt Case' }],
      })!;

      expect(e.collections).toEqual(['Kilowatt Case']);
    });

    it('usa name quando falta market_hash_name', () => {
      const e = mapearItem({
        ...ak,
        market_hash_name: undefined,
        name: 'AK-47 | Redline (FT)',
      })!;

      expect(e.marketHashName).toBe('AK-47 | Redline (FT)');
    });
  });
});
