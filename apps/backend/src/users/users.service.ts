import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MENSAGEM_ERRO, validarTradeUrl } from './trade-url';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Salva a trade URL, conferindo que ela é da conta de quem está pedindo.
   *
   * O steamId vem do usuário autenticado, nunca do corpo da requisição —
   * é isso que impede alguém de cadastrar a URL de terceiros.
   */
  async updateTradeUrl(user: User, entrada: string): Promise<User> {
    const resultado = validarTradeUrl(entrada, user.steamId);

    if (!resultado.ok) {
      if (resultado.erro === 'partner_de_outra_conta') {
        // Pode ser engano ao copiar, mas também é o formato de uma
        // tentativa de desviar entregas. Registramos para dar para
        // investigar se virar padrão.
        this.logger.warn(
          `Trade URL de outra conta recusada para o usuário ${user.id}`,
        );
      }

      throw new BadRequestException(MENSAGEM_ERRO[resultado.erro]);
    }

    return this.prisma.user.update({
      where: { id: user.id },
      // Guarda a versão normalizada, não a que o usuário colou.
      data: { tradeUrl: resultado.url },
    });
  }
}
