import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceHistoryService } from './price-history.service';

/**
 * Preço.
 *
 * Nenhum adaptador de fornecedor ainda: a escolha entre cs2.sh e
 * SteamWebAPI está esperando resposta sobre termos comerciais e
 * frequência de atualização — ver docs/emails-e-fornecedores.md. O que
 * existe aqui vale para qualquer um dos dois, e a série histórica começa
 * a acumular no dia em que o primeiro adaptador entrar.
 */
@Module({
  imports: [PrismaModule],
  providers: [PriceHistoryService],
  exports: [PriceHistoryService],
})
export class PricingModule {}
