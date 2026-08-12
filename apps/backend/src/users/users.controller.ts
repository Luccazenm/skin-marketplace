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
    summary: 'Define a trade URL do usuário',
    description:
      'Sem ela o bot não consegue enviar oferta de troca. O servidor ' +
      'confere que a URL pertence à conta autenticada.',
  })
  @ApiResponse({
    status: 400,
    description: 'Trade URL inválida ou de outra conta',
  })
  async setTradeUrl(
    @CurrentUser() user: User,
    @Body() dto: UpdateTradeUrlDto,
    @Req() req: Request,
  ): Promise<{ tradeUrl: string | null }> {
    const atualizado = await this.users.updateTradeUrl(
      user,
      dto.tradeUrl,
      auditContext(req),
    );

    return { tradeUrl: atualizado.tradeUrl };
  }
}
