import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PriceMarket, type PriceSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RawQuote } from './price-provider';
import { recommendedPrice, type Quote } from './price-reconciliation';

export interface CaptureResult {
  stored: number;
  /** Already existed: running the job twice does not duplicate the series. */
  repeated: number;
  /** Without a matching `SkinTemplate` in our catalog. */
  withoutTemplate: number;
}

/**
 * Stores and reads the price history series.
 *
 * The series is **append-only**: never edit an existing row. Each
 * snapshot records that, at that instant, that source said that price.
 * Rewriting would erase the proof of what the user was shown — which is
 * half the reason this table exists. The other half is the chart, which
 * nobody can build backwards.
 */
@Injectable()
export class PriceHistoryService {
  private readonly logger = new Logger(PriceHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores a batch of quotes.
   *
   * Ignores repeats instead of failing: the job may run again after a
   * crash midway, and the alternative would be aborting the whole capture
   * because of a row that already existed.
   */
  async record(
    source: PriceSource,
    quotes: RawQuote[],
  ): Promise<CaptureResult> {
    if (quotes.length === 0) {
      return { stored: 0, repeated: 0, withoutTemplate: 0 };
    }

    const names = [...new Set(quotes.map((q) => q.marketHashName))];

    const templates = await this.prisma.skinTemplate.findMany({
      where: { marketHashName: { in: names } },
      select: { id: true, marketHashName: true },
    });

    const idByName = new Map(templates.map((t) => [t.marketHashName, t.id]));

    let stored = 0;
    let repeated = 0;
    let withoutTemplate = 0;

    for (const q of quotes) {
      const skinTemplateId = idByName.get(q.marketHashName);

      // An item not yet in the catalog. Not an error: the provider knows
      // the whole game and we only know what has shown up here.
      if (!skinTemplateId) {
        withoutTemplate++;
        continue;
      }

      try {
        await this.prisma.priceSnapshot.create({
          data: {
            skinTemplateId,
            source,
            market: q.market,
            price: new Prisma.Decimal(q.price),
            bid: q.bid != null ? new Prisma.Decimal(q.bid) : null,
            ask: q.ask != null ? new Prisma.Decimal(q.ask) : null,
            volume24h: q.volume24h ?? null,
            quotedAt: q.quotedAt,
          },
        });
        stored++;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          repeated++;
          continue;
        }

        throw error;
      }
    }

    this.logger.log(
      `Capture from ${source}: ${stored} stored, ${repeated} repeated, ` +
        `${withoutTemplate} without template`,
    );

    return { stored, repeated, withoutTemplate };
  }

  /**
   * Price to display for an item, from the latest reading of each market.
   *
   * Reads from our database, never from the provider. Calling the
   * external API here would blow the quota on the first dozen visitors,
   * add hundreds of milliseconds to every page, and take the storefront
   * down together with the provider the day it falls over.
   */
  async currentPrice(
    skinTemplateId: string,
    options: { maxAgeMs?: number } = {},
  ) {
    const recent = await this.prisma.priceSnapshot.findMany({
      where: { skinTemplateId },
      orderBy: { quotedAt: 'desc' },
      // Comfortably covers one reading per market; the per-market filter
      // happens below, already in memory.
      take: 50,
    });

    const byMarket = new Map<PriceMarket, Quote>();

    for (const s of recent) {
      if (byMarket.has(s.market)) {
        continue;
      }

      byMarket.set(s.market, {
        market: s.market,
        price: Number(s.price),
        quotedAt: s.quotedAt,
        volume24h: s.volume24h,
      });
    }

    return recommendedPrice([...byMarket.values()], options);
  }

  /** One market's series, for the chart. */
  async series(skinTemplateId: string, market: PriceMarket, since: Date) {
    return this.prisma.priceSnapshot.findMany({
      where: { skinTemplateId, market, quotedAt: { gte: since } },
      orderBy: { quotedAt: 'asc' },
      select: { price: true, volume24h: true, quotedAt: true },
    });
  }
}
