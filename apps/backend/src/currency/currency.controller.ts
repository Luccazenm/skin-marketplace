import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyService } from './currency.service';

/**
 * The exchange rates the screens format prices with.
 *
 * Public and unauthenticated, like `/api/config`: a visitor reading
 * prices has not signed in, and there is nothing here about a person.
 *
 * **Display only.** See `CurrencyService` — the ledger is USD and no
 * number served here decides what anybody is charged.
 */
@ApiTags('currency')
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get('rates')
  @ApiOperation({ summary: 'Exchange rates against USD, for display' })
  rates() {
    return this.currency.rates();
  }
}
