import { Body, Controller, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { auditContext } from '../audit/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateTradeUrlDto } from './dto/update-trade-url.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Put('trade-url')
  @ApiOperation({
    summary: "Sets the user's trade URL",
    description:
      'Without it the bot cannot send a trade offer. The server checks ' +
      'that the URL belongs to the authenticated account.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid trade URL, or one from another account',
  })
  async setTradeUrl(
    @CurrentUser() user: User,
    @Body() dto: UpdateTradeUrlDto,
    @Req() req: Request,
  ): Promise<{ tradeUrl: string | null }> {
    const updated = await this.users.updateTradeUrl(
      user,
      dto.tradeUrl,
      auditContext(req),
    );

    return { tradeUrl: updated.tradeUrl };
  }
}
