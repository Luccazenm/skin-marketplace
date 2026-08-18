import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceHistoryService } from './price-history.service';

/**
 * Pricing.
 *
 * No provider adapter yet: the choice between cs2.sh and SteamWebAPI is
 * waiting on answers about commercial terms and refresh frequency — see
 * docs/emails-e-fornecedores.md. What exists here holds for either one,
 * and the history series starts accumulating the day the first adapter
 * lands.
 */
@Module({
  imports: [PrismaModule],
  providers: [PriceHistoryService],
  exports: [PriceHistoryService],
})
export class PricingModule {}
