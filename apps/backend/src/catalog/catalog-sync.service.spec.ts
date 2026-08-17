import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * O importador é a parte do catálogo que fala com rede e banco, e a que
 * pode estragar dado já gravado — o `upsert` passa por cima de 33.950
 * linhas a cada rodada. Um erro aqui não aparece na tela: apaga em
 * silêncio uma decisão de negócio.
 *
 * O prefixo TESTE-SYNC isola tudo do catálogo real, que vive no mesmo
 * banco de desenvolvimento.
 */
describe('CatalogSyncService', () => {
  let service: CatalogSyncService;
  let prisma: PrismaService;
  let fetchMock: jest.SpyInstance;

  const PREFIXO = 'TESTE-SYNC';
  const AK = `${PREFIXO} AK-47 | Alfa (Field-Tested)`;
  const FACA = `${PREFIXO} ★ Karambit | Beta (Factory New)`;

  const skin = (nome: string, over: Record<string, unknown> = {}) => ({
    market_hash_name: nome,
    skin_id: `skin-${nome}`,
    weapon: { name: 'AK-47' },
    pattern: { name: 'Alfa' },
    rarity: { name: 'Classified' },
    min_float: 0.1,
    max_float: 0.7,
    image: 'https://cdn/x.png',
    ...over,
  });

  /**
   * Responde por arquivo. O que não for declarado volta vazio — assim
   * cada teste descreve só os arquivos que lhe interessam.
   */
  const responderCom = (porArquivo: Record<string, unknown[]>) => {
    fetchMock.mockImplementation((url: string) => {
      const arquivo = /\/([a-z_]+)\.json$/.exec(url)?.[1] ?? '';

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(porArquivo[arquivo] ?? []),
      } as Response);
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [CatalogSyncService, PrismaService],
    }).compile();

    service = moduleRef.get(CatalogSyncService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await limpar();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await limpar();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const limpar = () =>
    prisma.skinTemplate.deleteMany({
      where: { marketHashName: { startsWith: PREFIXO } },
    });

  const buscar = (marketHashName: string) =>
    prisma.skinTemplate.findUnique({ where: { marketHashName } });

  describe('gravação', () => {
    it('grava o que veio e conta o que fez', async () => {
      responderCom({ skins_not_grouped: [skin(AK)] });

      const r = await service.sincronizar();

      expect(r.criados).toBe(1);
      expect(r.atualizados).toBe(0);

      const t = await buscar(AK);
      expect(t?.weapon).toBe('AK-47');
      expect(t?.skinName).toBe('Alfa');
    });

    // Roda toda vez que sai caixa nova; duplicar seria criar um segundo
    // template para o mesmo item, e o preço se penduraria em um só.
    it('é idempotente: a segunda rodada atualiza, não duplica', async () => {
      responderCom({ skins_not_grouped: [skin(AK)] });

      await service.sincronizar();
      const r = await service.sincronizar();

      expect(r.criados).toBe(0);
      expect(r.atualizados).toBe(1);

      await expect(
        prisma.skinTemplate.count({
          where: { marketHashName: { startsWith: PREFIXO } },
        }),
      ).resolves.toBe(1);
    });

    it('reflete mudança do dataset', async () => {
      responderCom({ skins_not_grouped: [skin(AK)] });
      await service.sincronizar();

      responderCom({
        skins_not_grouped: [skin(AK, { rarity: { name: 'Covert' } })],
      });
      await service.sincronizar();

      expect((await buscar(AK))?.rarity).toBe('Covert');
    });

    // O dataset repete o mesmo market_hash_name entre arquivos.
    it('não vai duas vezes ao banco pelo mesmo item', async () => {
      responderCom({ skins_not_grouped: [skin(AK), skin(AK)] });

      const r = await service.sincronizar();

      expect(r.criados).toBe(1);
    });
  });

  /**
   * O ponto mais perigoso do importador: o `upsert` reescreve linhas que
   * já existem, e algumas colunas são decisão NOSSA, não do dataset.
   * Sobrescrevê-las tiraria uma skin do fluxo rápido — ou pior, deixaria
   * uma entrar — sem ninguém perceber.
   */
  describe('o que a sincronização não pode tocar', () => {
    it('preserva preço de referência e whitelist do fluxo rápido', async () => {
      responderCom({ skins_not_grouped: [skin(AK)] });
      await service.sincronizar();

      await prisma.skinTemplate.update({
        where: { marketHashName: AK },
        data: {
          referencePrice: new Prisma.Decimal(42.5),
          referencePriceAt: new Date(),
          buyoutEligible: true,
          buyoutDiscountPct: new Prisma.Decimal(15),
          salesVolume30d: 300,
        },
      });

      await service.sincronizar();

      const t = await buscar(AK);
      expect(Number(t?.referencePrice)).toBe(42.5);
      expect(t?.buyoutEligible).toBe(true);
      expect(Number(t?.buyoutDiscountPct)).toBe(15);
      expect(t?.salesVolume30d).toBe(300);
    });
  });

  describe('origens', () => {
    // Um quarto do catálogo sai de mais de uma caixa. Sobrescrever em vez
    // de acumular faria a última processada apagar as anteriores.
    // As caixas levam o prefixo porque o arquivo `crates` serve a duas
    // coisas: alimenta o cruzamento de origem E vira template de
    // CONTAINER. Sem prefixo, elas escapam da limpeza e ficam no
    // catálogo real — foi o que aconteceu na primeira versão deste teste.
    it('acumula todas as caixas em que a skin aparece', async () => {
      responderCom({
        skins_not_grouped: [skin(AK)],
        crates: [
          { name: `${PREFIXO} Caixa Um`, contains: [{ id: `skin-${AK}` }] },
          { name: `${PREFIXO} Caixa Dois`, contains: [{ id: `skin-${AK}` }] },
        ],
      });

      await service.sincronizar();

      expect((await buscar(AK))?.collections.sort()).toEqual([
        `${PREFIXO} Caixa Dois`,
        `${PREFIXO} Caixa Um`,
      ]);
    });

    // Faca e luva são o item raro especial e ficam noutro campo. Sem ler
    // `contains_rare`, as 3.898 do catálogo ficariam sem origem.
    it('lê faca de contains_rare, não só de contains', async () => {
      responderCom({
        skins_not_grouped: [
          skin(FACA, {
            weapon: { name: 'Karambit' },
            pattern: { name: 'Beta' },
          }),
        ],
        crates: [
          {
            name: `${PREFIXO} Caixa Com Faca`,
            contains_rare: [{ id: `skin-${FACA}` }],
          },
        ],
      });

      await service.sincronizar();

      expect((await buscar(FACA))?.collections).toEqual([
        `${PREFIXO} Caixa Com Faca`,
      ]);
    });
  });

  describe('o que fica de fora', () => {
    it('conta como descartado o que não deve entrar', async () => {
      responderCom({
        skins_not_grouped: [skin(AK)],
        collectibles: [],
        stickers: [
          // Sem nome de mercado: não existe no mercado.
          { name: `${PREFIXO} Sticker | Fantasma`, market_hash_name: null },
        ],
      });

      const r = await service.sincronizar();

      expect(r.criados).toBe(1);
      expect(r.descartados).toBe(1);
    });
  });

  describe('quando algo dá errado', () => {
    // 36 mil itens por rodada: abortar tudo por causa de uma linha
    // recusada perderia a importação inteira.
    it('conta a falha e segue com o resto do lote', async () => {
      const outra = `${PREFIXO} AK-47 | Gama (Field-Tested)`;

      responderCom({
        skins_not_grouped: [
          skin(AK),
          skin(outra, { pattern: { name: 'Gama' } }),
        ],
      });

      // Só a primeira chamada falha: `spyOn` mantém a implementação real
      // como padrão, então a segunda grava de verdade.
      jest
        .spyOn(prisma.skinTemplate, 'upsert')
        // `never` porque o Prisma devolve um cliente encadeável, não uma
        // Promise crua — e aqui só interessa que rejeite.
        .mockImplementationOnce(
          () => Promise.reject(new Error('banco recusou')) as never,
        );

      const r = await service.sincronizar();

      expect(r.falhas).toBe(1);
      expect(r.criados).toBe(1);
      expect(await buscar(outra)).not.toBeNull();
    });

    // Aqui é o contrário: arquivo que não baixa significa catálogo
    // parcial, e seguir em silêncio deixaria itens sumindo da vitrine
    // sem explicação.
    it('interrompe quando um arquivo não baixa', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve([]),
      });

      await expect(service.sincronizar()).rejects.toThrow('503');
    });
  });

  describe('formato da resposta', () => {
    // Alguns arquivos do dataset vêm indexados por id em vez de lista.
    it('aceita objeto no lugar de lista', async () => {
      fetchMock.mockImplementation((url: string) => {
        const corpo = url.includes('skins_not_grouped')
          ? { 'chave-qualquer': skin(AK) }
          : [];

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(corpo),
        } as Response);
      });

      const r = await service.sincronizar();

      expect(r.criados).toBe(1);
      expect(await buscar(AK)).not.toBeNull();
    });
  });

  it('informa o progresso arquivo a arquivo', async () => {
    responderCom({ skins_not_grouped: [skin(AK)] });

    const vistos: string[] = [];
    await service.sincronizar((arquivo) => vistos.push(arquivo));

    expect(vistos).toContain('skins_not_grouped');
    expect(vistos).toContain('stickers');
    expect(vistos).toHaveLength(9);
  });
});
