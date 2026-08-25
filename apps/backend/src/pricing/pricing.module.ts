import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { Cs2ShProvider } from './cs2sh.provider';
import { PriceHistoryService } from './price-history.service';

/**
 * Pricing.
 *
 * cs2.sh landed on 2026-08-25, on the Developer plan. It carries bid and
 * ask across BUFF, Youpin, CSFloat, Skinport, Steam and C5Game — and the
 * bid is the part that matters, since the instant-sell offer is anchored
 * on it rather than on any listing price.
 *
 * The provider is registered but nothing is stored yet: the endpoint
 * returns all 40,000 items in one 50MB read, so what to keep and how
 * often is its own decision rather than a detail of fetching.
 */
@Module({
  imports: [PrismaModule],
  providers: [PriceHistoryService, Cs2ShProvider],
  exports: [PriceHistoryService, Cs2ShProvider],
})
export class PricingModule {}
