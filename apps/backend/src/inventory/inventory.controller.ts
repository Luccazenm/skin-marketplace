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
    summary: 'Inventário de CS2 do usuário autenticado',
    description:
      'Lido ao vivo da Steam. Não persiste nada: float e paint seed não ' +
      'vêm no inventário, então o Item só é criado quando a skin entra em ' +
      'custódia.',
  })
  @ApiResponse({ status: 403, description: 'Inventário privado' })
  @ApiResponse({ status: 429, description: 'Limite da Steam atingido' })
  @ApiResponse({ status: 502, description: 'Steam indisponível' })
  async myInventory(
    @CurrentUser() user: User,
    @Query() query: InventoryQueryDto,
  ) {
    const resultado = await this.inventory.getInventory(user.steamId);

    switch (resultado.status) {
      case 'ok': {
        const bloqueados = resultado.items.filter((i) => !i.depositable).length;

        const items = query.depositable
          ? resultado.items.filter((i) => i.depositable)
          : resultado.items;

        return {
          count: items.length,
          // total e blocked vêm sempre, mesmo com o filtro ligado: sem
          // isso a tela não teria como avisar que existem itens ocultos, e
          // quem procura uma skin que sabe que tem acharia que sumiu.
          total: resultado.items.length,
          blocked: bloqueados,
          items,
          // O frontend usa isto para avisar que o dado pode estar
          // desatualizado, em vez de mostrar como se fosse ao vivo.
          fetchedAt: resultado.fetchedAt,
          cached: resultado.cached,
          stale: resultado.stale,
        };
      }

      case 'private':
        // Acionável: a pessoa consegue resolver sozinha nas configurações.
        throw new ForbiddenException(
          'Seu inventário da Steam está privado. Em Perfil > Privacidade, ' +
            'defina "Inventário" como público para continuar.',
        );

      case 'rate_limited':
        // A culpa não é de quem pediu — é o nosso IP que estourou a cota.
        // Devolvemos 429 para o cliente não insistir e piorar.
        throw new HttpException(
          'Muitas consultas à Steam neste momento. Tente novamente em ' +
            'alguns minutos.',
          HttpStatus.TOO_MANY_REQUESTS,
        );

      case 'error':
        throw new BadGatewayException(
          `Não foi possível ler seu inventário: ${resultado.message}`,
        );
    }
  }
}
