import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SteamOpenIdService } from './steam-openid.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly steamOpenId: SteamOpenIdService) {}

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
}
