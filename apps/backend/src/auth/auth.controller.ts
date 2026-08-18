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
    summary: 'Inicia o login via Steam',
    description:
      'Redireciona o usuário para a tela de login da Steam. ' +
      'Abrir esta rota no navegador, não via fetch — é um redirect 302.',
  })
  @ApiResponse({ status: 302, description: 'Redireciona para a Steam' })
  redirectToSteam(@Res() res: Response): void {
    res.redirect(this.steamOpenId.buildLoginUrl());
  }

  /**
   * Endereço que passamos como return_to. Quem chama é o navegador do
   * usuário, redirecionado pela Steam — nunca o frontend diretamente.
   *
   * A query vem tipada como Record e não como DTO de propósito: os campos
   * chegam com nome "openid.xxx" e precisam ser repassados intactos para a
   * verificação. Um DTO com whitelist descartaria justamente o que a Steam
   * assinou.
   */
  @Get('steam/return')
  @ApiExcludeEndpoint()
  async handleSteamReturn(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const contexto = auditContext(req);
    const steamId = await this.steamOpenId.verifyReturn(query);

    if (!steamId) {
      // Sem steamId não há a quem atribuir, mas o registro importa:
      // repetição aqui é tentativa de forjar retorno da Steam.
      await this.audit.record({
        actorType: AuditActorType.ANONYMOUS,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        metadata: { reason: 'openid_invalido' },
        context: contexto,
      });

      throw new UnauthorizedException('Login pela Steam não pôde ser validado');
    }

    const user = await this.authService.loginWithSteam(steamId, contexto);

    const token = this.tokens.sign({ sub: user.id, steamId: user.steamId });

    // O token vai por cookie httpOnly, não na URL. Token em query string
    // fica no histórico do navegador, em log de proxy e no cabeçalho
    // Referer enviado a terceiros — três lugares onde uma sessão válida
    // não deveria estar.
    res.cookie(TokenService.COOKIE_NAME, token, this.tokens.cookieOptions());

    res.redirect(this.config.getOrThrow<string>('FRONTEND_URL'));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados do usuário autenticado' })
  @ApiResponse({ status: 401, description: 'Sem sessão válida' })
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      steamId: user.steamId,
      username: user.username,
      avatarUrl: user.avatarUrl,
      balance: user.balance.toString(),
      displayCurrency: user.displayCurrency,

      // O frontend precisa disso para desabilitar botões e explicar o
      // motivo, em vez de deixar o usuário tentar e falhar sem entender.
      capabilities: capabilitiesFor(user),
      steamBanCheckedAt: user.steamBanCheckedAt,

      // Sem trade URL o bot não consegue enviar oferta nenhuma, então a
      // tela precisa pedi-la antes de deixar o usuário tentar depositar.
      tradeUrl: user.tradeUrl,
      hasTradeUrl: user.tradeUrl !== null,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Encerra esta sessão',
    description:
      'Apaga o cookie e invalida este token. Outros dispositivos ' +
      'continuam conectados.',
  })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    const { jti, exp } = req.tokenPayload;

    // Apagar o cookie basta para quem usa o navegador normalmente, mas
    // não para um token que já tenha sido copiado.
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
    summary: 'Encerra a sessão em todos os dispositivos',
    description:
      'Invalida todos os tokens emitidos até agora. Use quando houver ' +
      'suspeita de conta comprometida — não é preciso saber quantas ' +
      'sessões existem nem onde.',
  })
  async logoutAll(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    await this.revocation.revokeAllForUser(user.id);

    res.clearCookie(TokenService.COOKIE_NAME, this.tokens.cookieOptions());

    // Costuma vir depois de suspeita de invasão: registrar o momento
    // ajuda a separar o que a pessoa fez do que o invasor fez.
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
