import {
  BadGatewayException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({
    summary: "The authenticated user's CS2 inventory",
    description:
      'Read live from Steam. Nothing is persisted: the Item is only ' +
      'created once the skin enters custody.',
  })
  @ApiResponse({ status: 403, description: 'Private inventory' })
  @ApiResponse({ status: 429, description: 'Steam rate limit reached' })
  @ApiResponse({ status: 502, description: 'Steam unavailable' })
  async myInventory(
    @CurrentUser() user: User,
    @Query() query: InventoryQueryDto,
  ) {
    const result = await this.inventory.getInventory(user.steamId);

    switch (result.status) {
      case 'ok': {
        const blocked = result.items.filter((i) => !i.depositable).length;

        const items = query.depositable
          ? result.items.filter((i) => i.depositable)
          : result.items;

        return {
          count: items.length,
          // total and blocked always come through, even with the filter
          // on: without them the screen would have no way to warn that
          // items are hidden, and someone looking for a skin they know
          // they own would think it had vanished.
          total: result.items.length,
          blocked,
          items,
          // The frontend uses this to warn that the data may be out of
          // date, instead of presenting it as live.
          fetchedAt: result.fetchedAt,
          cached: result.cached,
          stale: result.stale,
        };
      }

      case 'private':
        // Actionable: the person can fix this themselves in the settings.
        throw new ForbiddenException(
          'Your Steam inventory is private. Under Profile > Privacy, set ' +
            '"Inventory" to public to continue.',
        );

      case 'rate_limited':
        // This is not the caller's fault — it is our IP that blew
        // through the quota. We return 429 so the client does not insist
        // and make it worse.
        throw new HttpException(
          'Too many queries to Steam right now. Please try again in a few ' +
            'minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );

      case 'error':
        throw new BadGatewayException(
          `We could not read your inventory: ${result.message}`,
        );
    }
  }
}
