import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ItemCategory,
  PriceMarket,
  PriceSource,
  type SkinTemplate,
} from '@prisma/client';
import { validateEnv } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { PriceHistoryService } from './price-history.service';
import type { CotacaoBruta } from './price-provider';

/**
 * A série histórica é a única defesa contra "o site me mostrou outro
 * preço" — e é a única coisa deste projeto que não dá para recuperar
 * depois: histórico não se constrói para trás.
 */
describe('PriceHistoryService', () => {
  let service: PriceHistoryService;
  let prisma: PrismaService;
  let template: SkinTemplate;

  const NOME = 'AK-47 | Teste Preço (Field-Tested)';
  const QUANDO = new Date('2026-08-17T10:00:00Z');

  const cotacao = (over: Partial<CotacaoBruta> = {}): CotacaoBruta => ({
    marketHashName: NOME,
    market: PriceMarket.BUFF163,
    price: 100.5,
    quotedAt: QUANDO,
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      ],
      providers: [PriceHistoryService, PrismaService],
    }).compile();

    service = moduleRef.get(PriceHistoryService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await limpar();

    template = await prisma.skinTemplate.create({
      data: {
        marketHashName: NOME,
        category: ItemCategory.RIFLE,
        weapon: 'AK-47',
        skinName: 'Teste Preço',
        rarity: 'Classified',
        // Exigidos pela constraint: item pintado precisa de faixa de
        // float, senão não dá para dizer se o float do exemplar é bom.
        minFloat: 0.15,
        maxFloat: 0.38,
      },
    });
  });

  afterAll(async () => {
    await limpar();
    await prisma.$disconnect();
  });

  async function limpar() {
    const t = await prisma.skinTemplate.findUnique({
      where: { marketHashName: NOME },
    });

    if (t) {
      await prisma.priceSnapshot.deleteMany({
        where: { skinTemplateId: t.id },
      });
      await prisma.skinTemplate.delete({ where: { id: t.id } });
    }
  }

  describe('registrar', () => {
    it('grava a cotação com o instante apurado pela fonte', async () => {
      const r = await service.registrar(PriceSource.CS2SH, [cotacao()]);

      expect(r).toEqual({ gravadas: 1, repetidas: 0, semTemplate: 0 });

      const s = await prisma.priceSnapshot.findFirst({
        where: { skinTemplateId: template.id },
      });

      expect(Number(s!.price)).toBe(100.5);
      expect(s!.market).toBe(PriceMarket.BUFF163);
      // quotedAt é da fonte; capturedAt é nosso. Não são a mesma coisa:
      // fornecedor que serve dado velho precisa ser distinguível.
      expect(s!.quotedAt).toEqual(QUANDO);
      expect(s!.capturedAt.getTime()).toBeGreaterThan(QUANDO.getTime());
    });

    it('guarda bid, ask e volume quando a fonte informa', async () => {
      await service.registrar(PriceSource.CS2SH, [
        cotacao({ bid: 95, ask: 105, volume24h: 42 }),
      ]);

      const s = await prisma.priceSnapshot.findFirst({
        where: { skinTemplateId: template.id },
      });

      expect(Number(s!.bid)).toBe(95);
      expect(Number(s!.ask)).toBe(105);
      expect(s!.volume24h).toBe(42);
    });

    // O job pode morrer no meio e ser rodado de novo. Abortar a captura
    // inteira por uma linha repetida seria pior que ignorá-la.
    it('não duplica ao rodar de novo', async () => {
      await service.registrar(PriceSource.CS2SH, [cotacao()]);
      const r = await service.registrar(PriceSource.CS2SH, [cotacao()]);

      expect(r).toEqual({ gravadas: 0, repetidas: 1, semTemplate: 0 });
      await expect(
        prisma.priceSnapshot.count({ where: { skinTemplateId: template.id } }),
      ).resolves.toBe(1);
    });

    it('mesma fonte e mercado em instantes diferentes são duas linhas', async () => {
      await service.registrar(PriceSource.CS2SH, [cotacao()]);
      await service.registrar(PriceSource.CS2SH, [
        cotacao({ quotedAt: new Date(QUANDO.getTime() + 3_600_000) }),
      ]);

      await expect(
        prisma.priceSnapshot.count({ where: { skinTemplateId: template.id } }),
      ).resolves.toBe(2);
    });

    // O fornecedor conhece o jogo inteiro; nós só o que já apareceu aqui.
    it('conta, sem falhar, item que não está no catálogo', async () => {
      const r = await service.registrar(PriceSource.CS2SH, [
        cotacao(),
        cotacao({ marketHashName: 'Skin Que Não Temos (FN)' }),
      ]);

      expect(r).toEqual({ gravadas: 1, repetidas: 0, semTemplate: 1 });
    });

    it('não faz nada com lote vazio', async () => {
      await expect(service.registrar(PriceSource.CS2SH, [])).resolves.toEqual({
        gravadas: 0,
        repetidas: 0,
        semTemplate: 0,
      });
    });
  });

  describe('precoAtual', () => {
    it('usa a leitura mais recente de cada mercado', async () => {
      await service.registrar(PriceSource.CS2SH, [
        cotacao({ price: 90, quotedAt: new Date(Date.now() - 7_200_000) }),
        cotacao({ price: 100, quotedAt: new Date(Date.now() - 60_000) }),
      ]);

      const r = await service.precoAtual(template.id);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.price).toBe(100);
    });

    it('recusa quando só há leitura velha', async () => {
      await service.registrar(PriceSource.CS2SH, [
        cotacao({ quotedAt: new Date(Date.now() - 86_400_000) }),
      ]);

      const r = await service.precoAtual(template.id);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('todas_velhas');
    });

    it('recusa quando não há cotação nenhuma', async () => {
      const r = await service.precoAtual(template.id);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('sem_cotacao');
    });

    it('prefere BUFF e devolve os outros como referência', async () => {
      const agora = new Date(Date.now() - 60_000);

      await service.registrar(PriceSource.CS2SH, [
        cotacao({ market: PriceMarket.SKINPORT, price: 120, quotedAt: agora }),
        cotacao({ market: PriceMarket.BUFF163, price: 100, quotedAt: agora }),
      ]);

      const r = await service.precoAtual(template.id);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.BUFF163);
      expect(r.referencias).toHaveLength(1);
    });
  });

  describe('serie', () => {
    it('devolve em ordem cronológica, filtrando por mercado e período', async () => {
      const base = Date.now() - 5 * 86_400_000;

      await service.registrar(PriceSource.CS2SH, [
        cotacao({ price: 10, quotedAt: new Date(base) }),
        cotacao({ price: 20, quotedAt: new Date(base + 86_400_000) }),
        cotacao({
          market: PriceMarket.SKINPORT,
          price: 99,
          quotedAt: new Date(base),
        }),
      ]);

      const serie = await service.serie(
        template.id,
        PriceMarket.BUFF163,
        new Date(base - 1000),
      );

      expect(serie.map((s) => Number(s.price))).toEqual([10, 20]);
    });
  });
});
