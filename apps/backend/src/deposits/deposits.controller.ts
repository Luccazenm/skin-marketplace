import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
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
import { DepositsService } from './deposits.service';
import { CreateDepositDto } from './dto/create-deposit.dto';

@ApiTags('deposits')
@Controller('deposits')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Post()
  @ApiOperation({
    summary: 'Solicita o depósito de itens',
    description:
      'Registra a intenção e enfileira a oferta de troca. O envio é feito ' +
      'pelo serviço de bots — esta rota não conversa com a Steam para ' +
      'criar a oferta.',
  })
  @ApiResponse({ status: 201, description: 'Depósito enfileirado' })
  @ApiResponse({
    status: 400,
    description: 'Sem trade URL, item indisponível ou fora do inventário',
  })
  @ApiResponse({ status: 409, description: 'Item já está em outra troca' })
  @ApiResponse({ status: 503, description: 'Sem Trade Bot disponível' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateDepositDto,
    @Req() req: Request,
  ) {
    const oferta = await this.deposits.requestDeposit(
      user,
      dto.assetIds,
      auditContext(req),
    );

    return {
      id: oferta.id,
      status: oferta.status,
      itemCount: oferta.requestedAssetIds.length,
      createdAt: oferta.createdAt,
    };
  }
}
