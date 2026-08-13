import { Test } from '@nestjs/testing';
import { ItemCategory } from '@prisma/client';
import { SteamInventoryService } from './steam-inventory.service';

/**
 * Este serviço decide o que o usuário vê do próprio inventário. Além de
 * chamar a Steam, ele junta duas listas separadas e interpreta tags — e
 * um erro aqui mostra o item errado, ou deixa de mostrar um que existe.
 */
describe('SteamInventoryService', () => {
  let service: SteamInventoryService;
  let fetchMock: jest.SpyInstance;

  const STEAM_ID = '76561198832746931';

  /**
   * Resposta da Steam: `assets` são as instâncias que a pessoa tem,
   * `descriptions` são os metadados compartilhados. Vários assets apontam
   * para a mesma description — é assim que 50 caixas iguais não repetem
   * nome e imagem 50 vezes.
   */
  const resposta = (corpo: unknown, status = 200) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(corpo),
    } as Response);

  /**
   * Formato da description como a Steam devolve. Quase tudo é opcional de
   * propósito: vários testes omitem campos para exercitar item incompleto,
   * e é assim que ela chega de verdade.
   */
  interface Descricao {
    classid: string;
    instanceid?: string;
    market_hash_name?: string;
    icon_url?: string;
    tradable?: number;
    marketable?: number;
    tags?: {
      category: string;
      internal_name?: string;
      localized_tag_name?: string;
    }[];
    actions?: { name?: string; link?: string }[];
  }

  const descricaoAk: Descricao = {
    classid: '310777179',
    instanceid: '302028390',
    market_hash_name: 'AK-47 | Redline (Field-Tested)',
    icon_url: 'abc123',
    tradable: 1,
    marketable: 1,
    tags: [
      {
        category: 'Type',
        internal_name: 'CSGO_Type_Rifle',
        localized_tag_name: 'Rifle',
      },
      {
        category: 'Rarity',
        internal_name: 'Rarity_Rare_Weapon',
        localized_tag_name: 'Classified',
      },
      {
        category: 'Exterior',
        internal_name: 'WearCategory2',
        localized_tag_name: 'Field-Tested',
      },
    ],
    actions: [
      {
        name: 'Inspect in Game...',
        link: 'steam://rungame/730/x/+csgo_econ_action_preview%20S%owner_steamid%A%assetid%D123456',
      },
    ],
  };

  const inventarioCom = (
    assets: unknown[],
    descriptions: unknown[] = [descricaoAk],
  ) => ({ assets, descriptions, total_inventory_count: assets.length });

  const asset = (assetid: string, desc: Descricao = descricaoAk) => ({
    appid: 730,
    contextid: '2',
    assetid,
    classid: desc.classid,
    instanceid: desc.instanceid,
    amount: '1',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SteamInventoryService],
    }).compile();

    service = moduleRef.get(SteamInventoryService);
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  describe('a requisição', () => {
    it('pede o inventário de CS2 no contexto de itens negociáveis', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([])));

      await service.fetchInventory(STEAM_ID);

      const [url] = fetchMock.mock.calls[0] as [string];

      // 730 é o CS2 e o contexto 2 é onde ficam os itens negociáveis —
      // por isso item de outro jogo não tem como aparecer.
      expect(url).toContain(`/inventory/${STEAM_ID}/730/2`);
      // Teto que a comunidade convergiu; acima disso o bloqueio vem antes.
      expect(url).toContain('count=2000');
      // O idioma fixa os rótulos de exibição; a lógica usa internal_name.
      expect(url).toContain('l=english');
    });
  });

  describe('falhas', () => {
    it('trata 429 como limite atingido, não como erro genérico', async () => {
      fetchMock.mockReturnValue(resposta({}, 429));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'rate_limited',
      });
    });

    it('trata 403 como inventário privado', async () => {
      fetchMock.mockReturnValue(resposta({}, 403));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'private',
      });
    });

    it('trata 401 como inventário privado', async () => {
      fetchMock.mockReturnValue(resposta({}, 401));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'private',
      });
    });

    it('trata outros status como erro', async () => {
      fetchMock.mockReturnValue(resposta({}, 500));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('error');
    });

    it('trata queda de rede como erro, sem estourar', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('error');
    });

    // Conta sem itens devolve sucesso sem os arrays. Tratar como erro
    // mostraria "falha ao carregar" para quem só tem inventário vazio.
    it('inventário vazio é sucesso com lista vazia', async () => {
      fetchMock.mockReturnValue(resposta({ success: 1 }));

      await expect(service.fetchInventory(STEAM_ID)).resolves.toEqual({
        status: 'ok',
        items: [],
      });
    });
  });

  describe('combinação de assets com descriptions', () => {
    it('resolve os metadados pelo par classid + instanceid', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);

      expect(r.status).toBe('ok');
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].marketHashName).toBe('AK-47 | Redline (Field-Tested)');
      expect(r.items[0].assetId).toBe('111');
    });

    // O caso que justifica a Steam separar as duas listas.
    it('repete a mesma descrição para vários assets', async () => {
      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111'), asset('222'), asset('333')])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(3);
      expect(r.items.map((i) => i.assetId)).toEqual(['111', '222', '333']);
      expect(new Set(r.items.map((i) => i.marketHashName)).size).toBe(1);
    });

    // Devolver item pela metade seria pior: apareceria sem nome na tela.
    it('ignora asset cuja descrição não veio', async () => {
      const orfao = { ...asset('999'), classid: '000', instanceid: '000' };

      fetchMock.mockReturnValue(resposta(inventarioCom([asset('111'), orfao])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].assetId).toBe('111');
    });

    it('trata instanceid ausente como zero dos dois lados', async () => {
      const desc = { ...descricaoAk, instanceid: undefined };
      const semInstance = { ...asset('111'), instanceid: undefined };

      fetchMock.mockReturnValue(resposta(inventarioCom([semInstance], [desc])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items).toHaveLength(1);
      expect(r.items[0].instanceId).toBe('0');
    });
  });

  describe('classificação', () => {
    it('usa internal_name, não o rótulo traduzido', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.RIFLE);
      expect(r.items[0].hasUniquePattern).toBe(true);
      // Os rótulos traduzidos ficam à parte, só para exibir
      expect(r.items[0].typeLabel).toBe('Rifle');
      expect(r.items[0].rarity).toBe('Classified');
      expect(r.items[0].exterior).toBe('Field-Tested');
    });

    it('cai em OTHER quando o tipo não está mapeado', async () => {
      const desconhecido = {
        ...descricaoAk,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_CoisaNova' }],
      };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', desconhecido)], [desconhecido])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.OTHER);
    });

    it('não estoura quando o item não tem tags', async () => {
      const semTags = { ...descricaoAk, tags: undefined };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', semTags)], [semTags])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].category).toBe(ItemCategory.OTHER);
      expect(r.items[0].rarity).toBeNull();
    });
  });

  describe('depositável', () => {
    it('item negociável pode ser depositado', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].depositable).toBe(true);
      expect(r.items[0].blockReason).toBeNull();
    });

    // Medalha nunca poderá ser trocada — é diferente de estar esperando.
    it('medalha é bloqueio permanente', async () => {
      const medalha = {
        ...descricaoAk,
        market_hash_name: '2024 Service Medal',
        tradable: 0,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_Collectible' }],
      };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', medalha)], [medalha])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].depositable).toBe(false);
      expect(r.items[0].blockReason).toBe('permanente');
    });

    // A Steam não distingue trade lock de bloqueio definitivo, então o
    // rótulo é vago de propósito — prometer prazo seria chute.
    it('arma não negociável fica como indisponível, sem prazo', async () => {
      const travada = { ...descricaoAk, tradable: 0 };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', travada)], [travada])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].blockReason).toBe('indisponivel');
    });
  });

  describe('inspect link', () => {
    // É por ele que float e paint seed são obtidos depois; com o
    // placeholder por resolver, o link não serve para nada.
    it('substitui os placeholders por steamId e assetId', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([asset('98765')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toContain(`S${STEAM_ID}`);
      expect(r.items[0].inspectLink).toContain('A98765');
      expect(r.items[0].inspectLink).not.toContain('%assetid%');
      expect(r.items[0].inspectLink).not.toContain('%owner_steamid%');
    });

    it('fica nulo quando o item não tem link de inspeção', async () => {
      const caixa = {
        ...descricaoAk,
        market_hash_name: 'Dreams & Nightmares Case',
        actions: undefined,
        tags: [{ category: 'Type', internal_name: 'CSGO_Type_WeaponCase' }],
      };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', caixa)], [caixa])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toBeNull();
      expect(r.items[0].category).toBe(ItemCategory.CONTAINER);
    });

    it('ignora ação que não seja de inspeção', async () => {
      const comOutraAcao = {
        ...descricaoAk,
        actions: [{ name: 'Abrir na loja', link: 'https://exemplo/loja' }],
      };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', comOutraAcao)], [comOutraAcao])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].inspectLink).toBeNull();
    });
  });

  describe('imagem', () => {
    it('monta a URL completa a partir do icon_url', async () => {
      fetchMock.mockReturnValue(resposta(inventarioCom([asset('111')])));

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].iconUrl).toBe(
        'https://community.cloudflare.steamstatic.com/economy/image/abc123',
      );
    });

    it('fica nula quando o item não tem ícone', async () => {
      const semIcone = { ...descricaoAk, icon_url: undefined };

      fetchMock.mockReturnValue(
        resposta(inventarioCom([asset('111', semIcone)], [semIcone])),
      );

      const r = await service.fetchInventory(STEAM_ID);
      if (r.status !== 'ok') return;

      expect(r.items[0].iconUrl).toBeNull();
    });
  });
});
