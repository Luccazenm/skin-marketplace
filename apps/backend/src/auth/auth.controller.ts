import {
  Controller,
  Get,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { SteamOpenIdService } from './steam-openid.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly steamOpenId: SteamOpenIdService,
    private readonly authService: AuthService,
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
  ): Promise<{ id: string; steamId: string; username: string }> {
    const steamId = await this.steamOpenId.verifyReturn(query);

    if (!steamId) {
      throw new UnauthorizedException('Login pela Steam não pôde ser validado');
    }

    const user = await this.authService.loginWithSteam(steamId);

    // Parte 4: emitir o JWT e redirecionar para o FRONTEND_URL.
    return { id: user.id, steamId: user.steamId, username: user.username };
  }
}
