import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CurrencyController } from './currency.controller';
import { CurrencyService } from './currency.service';

/**
 * Exchange rates for display.
 *
 * Separate from `PricingModule` on purpose. That one answers what an
 * item is worth and feeds rules that move money; this one only decides
 * which symbol and which multiple a price is drawn with. Keeping them
 * apart is what stops a rate from finding its way into a payout.
 */
@Module({
  imports: [RedisModule],
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
