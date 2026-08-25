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
import { UpdateConsentDto } from './dto/update-consent.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
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

  @Put('email')
  @ApiOperation({
    summary: 'Sets or removes the marketing address',
    description:
      'Steam never gives us an address, so this only exists because the ' +
      'person typed it. Saving resets verification, and an unverified ' +
      'address is never sent to. An empty string removes it.',
  })
  @ApiResponse({ status: 400, description: 'Not a usable address' })
  @ApiResponse({ status: 409, description: 'That address cannot be used here' })
  async setEmail(
    @CurrentUser() user: User,
    @Body() dto: UpdateEmailDto,
    @Req() req: Request,
  ): Promise<{ email: string | null; emailVerified: boolean }> {
    const updated = await this.users.updateEmail(
      user,
      dto.email,
      auditContext(req),
    );

    return { email: updated.email, emailVerified: updated.emailVerified };
  }

  @Put('consent')
  @ApiOperation({
    summary: 'Records what the user agreed to',
    description:
      'Only the fields sent are changed, so a screen showing one switch ' +
      'cannot reset the other. Every change is audited with the before ' +
      'and the after — proving what was agreed, and when, is the whole ' +
      'point.',
  })
  @ApiResponse({ status: 400, description: 'No consent setting was provided' })
  async setConsent(
    @CurrentUser() user: User,
    @Body() dto: UpdateConsentDto,
    @Req() req: Request,
  ): Promise<{ marketingEmail: boolean; analytics: boolean }> {
    const updated = await this.users.updateConsent(
      user,
      dto,
      auditContext(req),
    );

    return {
      marketingEmail: updated.consentMarketingEmail,
      analytics: updated.consentAnalytics,
    };
  }
}
