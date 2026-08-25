import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { Cs2ShProvider } from './cs2sh.provider';
import { PriceHistoryService } from './price-history.service';
import { PriceService } from './price.service';
import { PricingController } from './pricing.controller';

/**
 * Pricing.
 *
 * cs2.sh landed on 2026-08-25, on the Developer plan. It carries bid and
 * ask across BUFF, Youpin, CSFloat, Skinport, Steam and C5Game — and the
 * bid is the part that matters, since the instant-sell offer is anchored
 * on it rather than on any listing price.
 *
 * Nothing syncs the whole catalogue, on purpose. The POST form takes a
 * hundred names at a time, so prices are fetched for the items actually
 * being looked at rather than for all 40,000 every few minutes — and
 * every reading that passes through is kept, because the history series
 * cannot be built backwards.
 */
@Module({
  // InventoryModule because the price suggestion reads the item from
  // the caller's own inventory rather than from the request body.
  imports: [AuthModule, InventoryModule, PrismaModule, RedisModule],
  controllers: [PricingController],
  providers: [PriceHistoryService, Cs2ShProvider, PriceService],
  exports: [PriceHistoryService, Cs2ShProvider, PriceService],
})
export class PricingModule {}
