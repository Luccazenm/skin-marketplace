import {
  Controller,
  Get,
  Post,
  Query,
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
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
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
    @Res() res: Response,
  ): Promise<void> {
    const steamId = await this.steamOpenId.verifyReturn(query);

    if (!steamId) {
      throw new UnauthorizedException('Login pela Steam não pôde ser validado');
    }

    const user = await this.authService.loginWithSteam(steamId);

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
    summary: 'Encerra a sessão',
    description:
      'Apaga o cookie. O token em si continua válido até expirar — ' +
      'JWT não é revogável.',
  })
  logout(@Res({ passthrough: true }) res: Response): { ok: boolean } {
    res.clearCookie(TokenService.COOKIE_NAME, this.tokens.cookieOptions());
    return { ok: true };
  }
}
