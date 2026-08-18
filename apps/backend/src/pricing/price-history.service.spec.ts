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
import type { RawQuote } from './price-provider';

/**
 * The history series is the only defence against "the site showed me a
 * different price" — and the only thing in this project that cannot be
 * recovered later: history is not built backwards.
 */
describe('PriceHistoryService', () => {
  let service: PriceHistoryService;
  let prisma: PrismaService;
  let template: SkinTemplate;

  const NAME = 'AK-47 | Price Test (Field-Tested)';
  const WHEN = new Date('2026-08-17T10:00:00Z');

  const quote = (over: Partial<RawQuote> = {}): RawQuote => ({
    marketHashName: NAME,
    market: PriceMarket.BUFF163,
    price: 100.5,
    quotedAt: WHEN,
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
    await cleanup();

    template = await prisma.skinTemplate.create({
      data: {
        marketHashName: NAME,
        category: ItemCategory.RIFLE,
        weapon: 'AK-47',
        skinName: 'Price Test',
        rarity: 'Classified',
        // Required by the constraint: a painted item needs a float range,
        // otherwise there is no way to say whether a unit's float is good.
        minFloat: 0.15,
        maxFloat: 0.38,
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function cleanup() {
    const t = await prisma.skinTemplate.findUnique({
      where: { marketHashName: NAME },
    });

    if (t) {
      await prisma.priceSnapshot.deleteMany({
        where: { skinTemplateId: t.id },
      });
      await prisma.skinTemplate.delete({ where: { id: t.id } });
    }
  }

  describe('record', () => {
    it('stores the quote with the instant measured by the source', async () => {
      const r = await service.record(PriceSource.CS2SH, [quote()]);

      expect(r).toEqual({ stored: 1, repeated: 0, withoutTemplate: 0 });

      const s = await prisma.priceSnapshot.findFirst({
        where: { skinTemplateId: template.id },
      });

      expect(Number(s!.price)).toBe(100.5);
      expect(s!.market).toBe(PriceMarket.BUFF163);
      // quotedAt is the source's; capturedAt is ours. They are not the
      // same thing: a provider serving stale data must be distinguishable.
      expect(s!.quotedAt).toEqual(WHEN);
      expect(s!.capturedAt.getTime()).toBeGreaterThan(WHEN.getTime());
    });

    it('keeps bid, ask and volume when the source reports them', async () => {
      await service.record(PriceSource.CS2SH, [
        quote({ bid: 95, ask: 105, volume24h: 42 }),
      ]);

      const s = await prisma.priceSnapshot.findFirst({
        where: { skinTemplateId: template.id },
      });

      expect(Number(s!.bid)).toBe(95);
      expect(Number(s!.ask)).toBe(105);
      expect(s!.volume24h).toBe(42);
    });

    // The job can die midway and be run again. Aborting the whole capture
    // over one repeated row would be worse than ignoring it.
    it('does not duplicate when run again', async () => {
      await service.record(PriceSource.CS2SH, [quote()]);
      const r = await service.record(PriceSource.CS2SH, [quote()]);

      expect(r).toEqual({ stored: 0, repeated: 1, withoutTemplate: 0 });
      await expect(
        prisma.priceSnapshot.count({ where: { skinTemplateId: template.id } }),
      ).resolves.toBe(1);
    });

    it('treats the same source and market at different instants as two rows', async () => {
      await service.record(PriceSource.CS2SH, [quote()]);
      await service.record(PriceSource.CS2SH, [
        quote({ quotedAt: new Date(WHEN.getTime() + 3_600_000) }),
      ]);

      await expect(
        prisma.priceSnapshot.count({ where: { skinTemplateId: template.id } }),
      ).resolves.toBe(2);
    });

    // The provider knows the whole game; we only know what has shown up
    // here.
    it('counts, without failing, an item that is not in the catalog', async () => {
      const r = await service.record(PriceSource.CS2SH, [
        quote(),
        quote({ marketHashName: 'Skin We Do Not Have (FN)' }),
      ]);

      expect(r).toEqual({ stored: 1, repeated: 0, withoutTemplate: 1 });
    });

    it('does nothing with an empty batch', async () => {
      await expect(service.record(PriceSource.CS2SH, [])).resolves.toEqual({
        stored: 0,
        repeated: 0,
        withoutTemplate: 0,
      });
    });
  });

  describe('currentPrice', () => {
    it('uses the most recent reading of each market', async () => {
      await service.record(PriceSource.CS2SH, [
        quote({ price: 90, quotedAt: new Date(Date.now() - 7_200_000) }),
        quote({ price: 100, quotedAt: new Date(Date.now() - 60_000) }),
      ]);

      const r = await service.currentPrice(template.id);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.price).toBe(100);
    });

    it('refuses when only a stale reading exists', async () => {
      await service.record(PriceSource.CS2SH, [
        quote({ quotedAt: new Date(Date.now() - 86_400_000) }),
      ]);

      const r = await service.currentPrice(template.id);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('all_stale');
    });

    it('refuses when there is no quote at all', async () => {
      const r = await service.currentPrice(template.id);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('no_quote');
    });

    it('prefers BUFF and returns the others as references', async () => {
      const now = new Date(Date.now() - 60_000);

      await service.record(PriceSource.CS2SH, [
        quote({ market: PriceMarket.SKINPORT, price: 120, quotedAt: now }),
        quote({ market: PriceMarket.BUFF163, price: 100, quotedAt: now }),
      ]);

      const r = await service.currentPrice(template.id);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.BUFF163);
      expect(r.references).toHaveLength(1);
    });
  });

  describe('series', () => {
    it('returns in chronological order, filtered by market and period', async () => {
      const base = Date.now() - 5 * 86_400_000;

      await service.record(PriceSource.CS2SH, [
        quote({ price: 10, quotedAt: new Date(base) }),
        quote({ price: 20, quotedAt: new Date(base + 86_400_000) }),
        quote({
          market: PriceMarket.SKINPORT,
          price: 99,
          quotedAt: new Date(base),
        }),
      ]);

      const series = await service.series(
        template.id,
        PriceMarket.BUFF163,
        new Date(base - 1000),
      );

      expect(series.map((s) => Number(s.price))).toEqual([10, 20]);
    });
  });
});
