import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  auditContext,
} from '../audit/audit.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard';
import { SessionRevocationService } from './session-revocation.service';
import { SteamOpenIdService } from './steam-openid.service';
import { capabilitiesFor } from './steam-restrictions';
import { TokenService } from './token.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly steamOpenId: SteamOpenIdService,
    private readonly authService: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly revocation: SessionRevocationService,
    private readonly audit: AuditService,
  ) {}

  @Get('steam')
  @ApiOperation({
    summary: 'Starts the Steam login',
    description:
      "Redirects the user to Steam's login screen. Open this route in " +
      'the browser, not through fetch — it is a 302 redirect.',
  })
  @ApiResponse({ status: 302, description: 'Redirects to Steam' })
  redirectToSteam(@Res() res: Response): void {
    res.redirect(this.steamOpenId.buildLoginUrl());
  }

  /**
   * The address we pass as return_to. The caller is the user's browser,
   * redirected by Steam — never the frontend directly.
   *
   * The query is typed as a Record rather than a DTO on purpose: the
   * fields arrive named "openid.xxx" and have to be passed on untouched
   * for verification. A DTO with a whitelist would discard exactly what
   * Steam signed.
   */
  @Get('steam/return')
  @ApiExcludeEndpoint()
  async handleSteamReturn(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = auditContext(req);
    const steamId = await this.steamOpenId.verifyReturn(query);

    if (!steamId) {
      // With no steamId there is nobody to attribute this to, but the
      // record matters: repetition here is an attempt to forge a Steam
      // return.
      await this.audit.record({
        actorType: AuditActorType.ANONYMOUS,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        metadata: { reason: 'invalid_openid' },
        context,
      });

      throw new UnauthorizedException('The Steam login could not be validated');
    }

    const user = await this.authService.loginWithSteam(steamId, context);

    const token = this.tokens.sign({ sub: user.id, steamId: user.steamId });

    // The token goes in an httpOnly cookie, not in the URL. A token in
    // the query string ends up in the browser history, in proxy logs and
    // in the Referer header sent to third parties — three places a valid
    // session has no business being.
    res.cookie(TokenService.COOKIE_NAME, token, this.tokens.cookieOptions());

    res.redirect(this.config.getOrThrow<string>('FRONTEND_URL'));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Data about the authenticated user' })
  @ApiResponse({ status: 401, description: 'No valid session' })
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      steamId: user.steamId,
      username: user.username,
      avatarUrl: user.avatarUrl,
      balance: user.balance.toString(),
      displayCurrency: user.displayCurrency,

      // The frontend needs this to disable buttons and explain why,
      // instead of letting the user try and fail without understanding.
      capabilities: capabilitiesFor(user),
      steamBanCheckedAt: user.steamBanCheckedAt,

      // Without a trade URL the bot cannot send any offer, so the screen
      // has to ask for it before letting the user attempt a deposit.
      tradeUrl: user.tradeUrl,
      hasTradeUrl: user.tradeUrl !== null,

      // ---- The account screen ----
      //
      // Not needed to render the header, which is why they were not here
      // before. `createdAt` is ours — when the account was first seen —
      // while `steamCreatedAt` is Valve's, and the two are worth telling
      // apart on screen.
      createdAt: user.createdAt,
      profileUrl: user.profileUrl,
      steamCreatedAt: user.steamCreatedAt,

      // Only ever here because the person typed it: Steam gives no
      // address. Unverified means nothing is sent to it.
      email: user.email,
      emailVerified: user.emailVerified,

      consent: {
        marketingEmail: user.consentMarketingEmail,
        marketingEmailAt: user.consentMarketingEmailAt,
        analytics: user.consentAnalytics,
        analyticsAt: user.consentAnalyticsAt,
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ends this session',
    description:
      'Clears the cookie and invalidates this token. Other devices stay ' +
      'signed in.',
  })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    const { jti, exp } = req.tokenPayload;

    // Clearing the cookie is enough for someone using the browser
    // normally, but not for a token that has already been copied.
    await this.revocation.revokeToken(jti, exp);

    res.clearCookie(TokenService.COOKIE_NAME, this.tokens.cookieOptions());

    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: req.user.id,
      action: AUDIT_ACTIONS.LOGOUT,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: req.user.id,
      metadata: { jti },
      context: auditContext(req),
    });

    return { ok: true };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ends the session on every device',
    description:
      'Invalidates every token issued so far. Use it when an account is ' +
      'suspected of being compromised — there is no need to know how ' +
      'many sessions exist or where.',
  })
  async logoutAll(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    await this.revocation.revokeAllForUser(user.id);

    res.clearCookie(TokenService.COOKIE_NAME, this.tokens.cookieOptions());

    // This usually follows a suspected break-in: recording the moment
    // helps separate what the person did from what the intruder did.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGOUT_ALL,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      context: auditContext(req),
    });

    return { ok: true };
  }
}
