import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PricesQueryDto } from './dto/prices-query.dto';
import { PriceService } from './price.service';

/** One item's worth, as the screens receive it. */
interface PriceResponse {
  /** Which market answered — BUFF163 unless it did not carry the item. */
  market: string;
  /** Lowest listing on the market that answered, in USD. */
  ask: number;
  /** Highest buy order, or null where nobody is bidding. */
  bid: number | null;
  /** `(ask - bid) / bid` — the liquidity signal, null without a bid. */
  spread: number | null;
  askVolume: number | null;
  quotedAt: string;
}

/**
 * Prices, asked for by name.
 *
 * **POST rather than GET**, because a Steam inventory is a few hundred
 * names and they contain `|`, `™` and brackets. That is a request body,
 * not a query string.
 *
 * **Separate from the inventory read** on purpose. The items appear as
 * soon as Steam answers and the prices fill in behind them; folding the
 * two together would hold a whole screen back for a number that is
 * decoration until the moment somebody prices something.
 *
 * Signed-in only. The prices are not personal data, but each miss costs
 * a call against a quota we pay for, and an open endpoint is an invitation
 * to spend it.
 */
@ApiTags('pricing')
@Controller('prices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PricingController {
  constructor(private readonly prices: PriceService) {}

  @Post()
  @ApiOperation({
    summary: 'Current prices for a list of items',
    description:
      'Names with no price are absent from the response rather than ' +
      'present with a zero — a zero would reach a screen and read as a ' +
      'free skin. An empty object means the price source is unavailable ' +
      'or knows none of them, and the screens already draw that.',
  })
  async get(
    @Body() dto: PricesQueryDto,
  ): Promise<{ prices: Record<string, PriceResponse> }> {
    const found = await this.prices.pricesFor(dto.items);
    const prices: Record<string, PriceResponse> = {};

    for (const [name, p] of found) {
      prices[name] = {
        market: p.market,
        ask: p.ask,
        bid: p.bid,
        spread: p.spread,
        askVolume: p.askVolume,
        quotedAt: p.quotedAt.toISOString(),
      };
    }

    return { prices };
  }
}
