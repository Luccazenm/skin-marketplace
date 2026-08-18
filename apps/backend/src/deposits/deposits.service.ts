import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BotStatus,
  TradeOfferReason,
  TradeOfferStatus,
  TradeOfferType,
  type TradeOffer,
  type User,
} from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  type AuditContext,
} from '../audit/audit.service';
import { capabilitiesFor } from '../auth/steam-restrictions';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

/** Situações em que a oferta ainda pode se concretizar. */
const OFERTAS_EM_ABERTO = [
  TradeOfferStatus.SCHEDULED,
  TradeOfferStatus.CREATED,
  TradeOfferStatus.PENDING_CONFIRMATION,
  TradeOfferStatus.SENT,
];

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra a recusa. O throw fica no chamador, visível — além de deixar
   * o TypeScript estreitar os tipos depois da checagem.
   */
  private async recordRefusal(
    user: User,
    reason: string,
    assetIds: string[],
    context?: AuditContext,
  ): Promise<void> {
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
      outcome: AuditOutcome.DENIED,
      targetType: 'User',
      targetId: user.id,
      metadata: { reason, assetIds },
      context,
    });
  }

  /**
   * Registra a intenção de depositar e enfileira a oferta de troca.
   *
   * Não envia nada: quem envia é o serviço de bots. Aqui ficam as regras
   * que valem independentemente de quem executa a troca.
   */
  async requestDeposit(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ): Promise<TradeOffer> {
    if (assetIds.length === 0) {
      throw new BadRequestException('Selecione ao menos um item.');
    }

    const unicos = [...new Set(assetIds)];

    if (unicos.length !== assetIds.length) {
      await this.recordRefusal(user, 'itens_repetidos', assetIds, context);
      throw new BadRequestException('Há itens repetidos na seleção.');
    }

    if (!user.tradeUrl) {
      await this.recordRefusal(user, 'sem_trade_url', unicos, context);
      throw new BadRequestException(
        'Cadastre sua trade URL antes de depositar — sem ela não é ' +
          'possível enviar a oferta de troca.',
      );
    }

    const capacidades = capabilitiesFor(user);

    if (!capacidades.canDeposit) {
      await this.recordRefusal(user, 'conta_steam_restrita', unicos, context);
      throw new BadRequestException(
        capacidades.blockedReason ??
          'Sua conta Steam não pode depositar itens no momento.',
      );
    }

    await this.recusarSeJaEnfileirado(user, unicos, context);

    const itens = await this.conferirNoInventario(user, unicos, context);

    const bot = await this.escolherBot(user, unicos, context);

    const oferta = await this.prisma.tradeOffer.create({
      data: {
        type: TradeOfferType.DEPOSIT,
        reason: TradeOfferReason.DEPOSIT_INTAKE,
        // CREATED, não SCHEDULED: o depósito não espera trade lock. Os
        // itens estão com o usuário, livres — o que falta é o bot enviar.
        status: TradeOfferStatus.CREATED,
        userId: user.id,
        botId: bot.id,
        // Cópia da trade URL no momento do pedido: a do usuário pode
        // mudar antes de o worker processar a fila.
        tradeUrl: user.tradeUrl,
        requestedAssetIds: unicos,
      },
    });

    // Guardamos o nome dos itens, não só o assetId: o assetId muda a cada
    // troca, e daqui a seis meses "AK-47 | Redline" é o que permite
    // reconhecer do que se está falando numa reclamação.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'TradeOffer',
      targetId: oferta.id,
      metadata: {
        botId: bot.id,
        botSteamId: bot.steamId,
        tradeUrl: user.tradeUrl,
        items: itens.map((i) => ({
          assetId: i.assetId,
          name: i.marketHashName,
        })),
      },
      context,
    });

    this.logger.log(
      `Depósito enfileirado: ${itens.length} item(ns), usuário ${user.id}, bot ${bot.id}`,
    );

    return oferta;
  }

  /**
   * Impede enfileirar o mesmo item duas vezes — clique duplo, aba aberta em
   * duplicidade, ou reenvio do formulário.
   */
  private async recusarSeJaEnfileirado(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ): Promise<void> {
    const emAberto = await this.prisma.tradeOffer.findFirst({
      where: {
        status: { in: OFERTAS_EM_ABERTO },
        requestedAssetIds: { hasSome: assetIds },
      },
    });

    if (emAberto) {
      await this.recordRefusal(user, 'item_ja_em_troca', assetIds, context);
      throw new ConflictException(
        'Já existe uma troca em andamento com pelo menos um destes itens. ' +
          'Confira suas ofertas pendentes na Steam.',
      );
    }
  }

  /**
   * Confirma que os itens estão mesmo no inventário do usuário e podem ser
   * depositados.
   *
   * Sem isto, alguém poderia enviar assetIds de outra pessoa e nós
   * montaríamos uma oferta pedindo itens que o usuário não tem — o que
   * falharia na Steam, mas depois de ocupar bot e fila.
   */
  private async conferirNoInventario(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ) {
    const inventario = await this.inventory.getInventory(user.steamId);

    if (inventario.status === 'private') {
      await this.recordRefusal(user, 'inventario_privado', assetIds, context);
      throw new BadRequestException(
        'Seu inventário da Steam está privado. Deixe-o público para ' +
          'podermos conferir os itens.',
      );
    }

    if (inventario.status !== 'ok') {
      await this.recordRefusal(
        user,
        `steam_indisponivel:${inventario.status}`,
        assetIds,
        context,
      );
      throw new ServiceUnavailableException(
        'Não foi possível consultar seu inventário na Steam agora. ' +
          'Tente novamente em alguns minutos.',
      );
    }

    const porAssetId = new Map(inventario.items.map((i) => [i.assetId, i]));

    const ausentes = assetIds.filter((id) => !porAssetId.has(id));

    if (ausentes.length > 0) {
      // Vale observar recorrência: pedir item que não está no inventário
      // pode ser página desatualizada, mas também assetId de terceiros.
      await this.recordRefusal(
        user,
        'item_fora_do_inventario',
        ausentes,
        context,
      );
      throw new BadRequestException(
        `${ausentes.length} item(ns) não foram encontrados no seu ` +
          'inventário. Atualize a página e tente de novo.',
      );
    }

    const bloqueados = assetIds
      .map((id) => porAssetId.get(id)!)
      .filter((item) => !item.depositable);

    if (bloqueados.length > 0) {
      await this.recordRefusal(
        user,
        'item_nao_depositavel',
        bloqueados.map((i) => i.assetId),
        context,
      );
      throw new BadRequestException(
        `Não é possível depositar: ${bloqueados
          .map((i) => i.marketHashName)
          .join(', ')}.`,
      );
    }

    return assetIds.map((id) => porAssetId.get(id)!);
  }

  /**
   * Escolhe qual bot recebe.
   *
   * Critérios: em rotação, sem trade hold pendente e com espaço. Entre os
   * elegíveis, pega o mais vazio — espalhar reduz o prejuízo se um bot for
   * banido, já que o inventário dele fica travado para sempre.
   */
  private async escolherBot(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ) {
    const quantidade = assetIds.length;

    const candidatos = await this.prisma.bot.findMany({
      where: {
        status: BotStatus.ONLINE,
        OR: [{ tradeHoldUntil: null }, { tradeHoldUntil: { lte: new Date() } }],
      },
      include: { _count: { select: { items: true } } },
    });

    const comEspaco = candidatos
      .filter((b) => b._count.items + quantidade <= b.maxItems)
      .sort((a, b) => a._count.items - b._count.items);

    if (comEspaco.length === 0) {
      this.logger.error(
        `Nenhum bot disponível para receber ${quantidade} item(ns)`,
      );

      // Recusa que não é culpa do usuário. Registrada porque recorrência
      // aqui significa frota subdimensionada ou bots fora de rotação.
      await this.recordRefusal(user, 'sem_bot_disponivel', assetIds, context);
      throw new ServiceUnavailableException(
        'Nenhum Trade Bot disponível para receber os itens no momento. ' +
          'Tente novamente em alguns minutos.',
      );
    }

    return comEspaco[0];
  }
}
