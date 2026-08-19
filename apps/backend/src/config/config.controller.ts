import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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
    return {
      /** The commission, as a percentage: 5 means 5%. */
      platformFeePercent: this.config.getOrThrow<number>(
        'PLATFORM_FEE_PERCENT',
      ),
    };
  }
}
