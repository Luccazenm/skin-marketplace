import {
  Body,
  Controller,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from '../inventory/inventory.service';
import { PricesQueryDto } from './dto/prices-query.dto';
import { SuggestQueryDto } from './dto/suggest-query.dto';
import { instantSellOffer, type NoOfferReason } from './instant-sell';
import { PriceService } from './price.service';
import { suggestedPrice, type AppliedInput } from './suggested-price';

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
  /**
   * What we would pay to buy it outright, or why we would not.
   *
   * Computed here rather than by the screen: this is the platform
   * spending its own money, and a discount table living in a browser is
   * one a browser can argue with.
   */
  buyout: BuyoutResponse;
}

type BuyoutResponse =
  | {
      /** USD, as a string — this is money we pay, not a quote we read. */
      amount: string;
      /** Taken off the highest bid. 0.15 = 15%. */
      discount: number;
    }
  | { amount: null; reason: NoOfferReason };

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
  constructor(
    private readonly prices: PriceService,
    private readonly inventory: InventoryService,
  ) {}

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
        buyout: buyoutOf(p.bid, p.spread),
      };
    }

    return { prices };
  }

  @Post('suggest')
  @ApiOperation({
    summary: 'A suggested asking price for one of your own items',
    description:
      'base + stickers at their transfer rate + charm in full, with the ' +
      'sticker part capped at twice the skin. The parts come back with ' +
      'the total because the screen shows them: a seller who put four ' +
      'stickers on a rifle needs to see how little of that transfers, ' +
      'and the number alone does not say it. Never a market price — the ' +
      'seller sets the figure.',
  })
  async suggest(
    @CurrentUser() user: User,
    @Body() dto: SuggestQueryDto,
  ): Promise<SuggestionResponse> {
    // From the inventory, not from the body. The stickers and their
    // scrape decide the number, and taking them from the request would
    // let anyone ask what a rifle with four Katowice holos is worth and
    // then point at the answer.
    const inventory = await this.inventory.getInventory(user.steamId);

    if (inventory.status !== 'ok') {
      throw new NotFoundException(
        'We could not read your inventory just now. Try again in a moment.',
      );
    }

    const item = inventory.items.find((i) => i.assetId === dto.assetId);

    if (!item) {
      throw new NotFoundException(
        'That item is not in your inventory. It may have been traded away.',
      );
    }

    const names = [
      item.marketHashName,
      ...item.applied.map((a) => a.marketHashName),
    ];

    const prices = await this.prices.pricesFor(names);
    const centsOf = (name: string) => {
      const price = prices.get(name);
      return price ? Math.round(price.ask * 100) : null;
    };

    const applied: AppliedInput[] = item.applied.map((a) => ({
      kind: a.kind,
      marketHashName: a.marketHashName,
      priceCents: centsOf(a.marketHashName),
      wear: a.wear,
    }));

    const suggestion = suggestedPrice(centsOf(item.marketHashName), applied);

    if (!suggestion) {
      return { suggested: null, reason: 'no_base_price' };
    }

    return {
      suggested: fromCents(suggestion.totalCents),
      base: fromCents(suggestion.baseCents),
      stickers: fromCents(suggestion.stickerCents),
      charms: fromCents(suggestion.charmCents),
      stickerCapped: suggestion.stickerCapped,
      applied: suggestion.applied.map((a) => ({
        marketHashName: a.marketHashName,
        kind: a.kind,
        own: a.priceCents === null ? null : fromCents(a.priceCents),
        adds: fromCents(a.addsCents),
      })),
    };
  }
}

/**
 * The suggestion as the screens receive it.
 *
 * Money as strings with two decimals, all the way out: the moment a
 * price becomes a JSON number it is a float.
 */
type SuggestionResponse =
  | {
      suggested: string;
      /** The skin on its own. */
      base: string;
      /** What the stickers add, after the cap. */
      stickers: string;
      /** What the charms add, always in full. */
      charms: string;
      /** The stickers were worth more than twice the skin. */
      stickerCapped: boolean;
      applied: {
        marketHashName: string;
        kind: string;
        /** What the piece sells for by itself. */
        own: string | null;
        /** What it adds to this weapon. */
        adds: string;
      }[];
    }
  | { suggested: null; reason: 'no_base_price' };

/** 6160 -> "61.60". Two decimals always, so the parts line up. */
function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** The offer as the screens receive it: an amount, or a reason there is none. */
function buyoutOf(bid: number | null, spread: number | null): BuyoutResponse {
  const offer = instantSellOffer(bid, spread);

  return offer.ok
    ? { amount: offer.amount, discount: offer.discount }
    : { amount: null, reason: offer.reason };
}
