import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  type AuditContext,
} from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MENSAGEM_ERRO, validarTradeUrl } from './trade-url';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Salva a trade URL, conferindo que ela é da conta de quem está pedindo.
   *
   * O steamId vem do usuário autenticado, nunca do body da requisição —
   * é isso que impede alguém de cadastrar a URL de terceiros.
   */
  async updateTradeUrl(
    user: User,
    entrada: string,
    context?: AuditContext,
  ): Promise<User> {
    const resultado = validarTradeUrl(entrada, user.steamId);

    if (!resultado.ok) {
      if (resultado.erro === 'partner_de_outra_conta') {
        this.logger.warn(
          `Trade URL de outra conta recusada para o usuário ${user.id}`,
        );
      }

      // Recusa também vira registro: uma sequência de tentativas com URL
      // de terceiros é padrão de golpe, e só aparece se ficar gravada.
      await this.audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: user.id,
        metadata: { erro: resultado.erro, tentativa: entrada.slice(0, 200) },
        context,
      });

      throw new BadRequestException(MENSAGEM_ERRO[resultado.erro]);
    }

    const anterior = user.tradeUrl;

    const atualizado = await this.prisma.user.update({
      where: { id: user.id },
      // Guarda a versão normalizada, não a que o usuário colou.
      data: { tradeUrl: resultado.url },
    });

    // O antes e depois é o que fecha o caso quando alguém troca a trade
    // URL e depois alega não ter recebido o item: dá para cruzar o horário
    // da troca com o da entrega.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      metadata: { de: anterior, para: resultado.url },
      context,
    });

    this.logger.log(`Trade URL atualizada para o usuário ${user.id}`);

    return atualizado;
  }
}
