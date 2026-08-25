import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  centsToUsd,
  MINIMUM_FEE_CENTS,
  minimumListingCents,
} from '../pricing/commission';

/**
 * The values the frontend needs in order to describe how the platform
 * works, rather than assert it on its own.
 *
 * Public and unauthenticated: none of it is about a person, and a
 * visitor deciding whether to sell here needs to see the commission
 * before signing in.
 *
 * The rule this exists for: anything that decides what someone is paid
 * comes from here. A copy in the browser keeps quoting the old number
 * the day it changes, and the screen ends up lying about money.
 */
@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Public platform settings' })
  get() {
    const platformFeePercent = this.config.getOrThrow<number>(
      'PLATFORM_FEE_PERCENT',
    );

    return {
      /** The commission, as a percentage: 5 means 5%. */
      platformFeePercent,

      /**
       * The lowest price an item may be listed at, in USD.
       *
       * Derived from the commission rather than fixed, so the screen
       * cannot start refusing a price the backend accepts, or offering
       * one it does not. A string like every other price.
       */
      minimumListingPrice: centsToUsd(minimumListingCents(platformFeePercent)),

      /** The smallest commission we charge on a sale, in USD. */
      minimumFee: centsToUsd(MINIMUM_FEE_CENTS),
    };
  }
}
