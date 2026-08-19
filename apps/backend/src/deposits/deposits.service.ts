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
import {
  NOTIFICATION_KINDS,
  NotificationsService,
} from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** One item the seller wants to deposit, with the price to open at. */
export interface DepositRequestItem {
  assetId: string;
  /** USD, as a string: it goes to Postgres' Decimal untouched. */
  price: string;
}

/** States in which an offer can still go through. */
const OPEN_OFFERS = [
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
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Records the refusal. The throw stays with the caller, in plain sight —
   * and it lets TypeScript narrow the types after the check.
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
   * Records the intent to deposit and queues the trade offer.
   *
   * It sends nothing: sending is the bot service's job. What lives here
   * are the rules that hold regardless of who executes the trade.
   */
  async requestDeposit(
    user: User,
    requested: DepositRequestItem[],
    context?: AuditContext,
  ): Promise<TradeOffer> {
    if (requested.length === 0) {
      throw new BadRequestException('Select at least one item.');
    }

    const assetIds = requested.map((i) => i.assetId);
    const unique = [...new Set(assetIds)];

    if (unique.length !== assetIds.length) {
      await this.recordRefusal(user, 'duplicate_items', assetIds, context);
      throw new BadRequestException('The selection contains repeated items.');
    }

    if (!user.tradeUrl) {
      await this.recordRefusal(user, 'no_trade_url', unique, context);
      throw new BadRequestException(
        'Register your trade URL before depositing — without it we cannot ' +
          'send the trade offer.',
      );
    }

    const capabilities = capabilitiesFor(user);

    if (!capabilities.canDeposit) {
      await this.recordRefusal(
        user,
        'restricted_steam_account',
        unique,
        context,
      );
      throw new BadRequestException(
        capabilities.blockedReason ??
          'Your Steam account cannot deposit items right now.',
      );
    }

    await this.refuseIfAlreadyQueued(user, unique, context);

    const items = await this.checkAgainstInventory(user, unique, context);

    const bot = await this.pickBot(user, unique, context);

    const priceByAssetId = new Map(requested.map((i) => [i.assetId, i.price]));

    // The offer and the prices are written together. A deposit whose
    // prices did not land would leave the worker with items to receive
    // and nothing to list them at, and it would only be discovered days
    // later when the user accepted the trade.
    const offer = await this.prisma.tradeOffer.create({
      data: {
        intendedListings: {
          create: requested.map((i) => ({
            assetId: i.assetId,
            price: i.price,
          })),
        },
        type: TradeOfferType.DEPOSIT,
        reason: TradeOfferReason.DEPOSIT_INTAKE,
        // CREATED, not SCHEDULED: a deposit does not wait for a trade
        // lock. The items are with the user, free — what is missing is
        // the bot sending the offer.
        status: TradeOfferStatus.CREATED,
        userId: user.id,
        botId: bot.id,
        // A copy of the trade URL at request time: the user's own can
        // change before the worker processes the queue.
        tradeUrl: user.tradeUrl,
        requestedAssetIds: unique,
      },
    });

    // We store the item names, not just the assetId: the assetId changes
    // with every trade, and six months from now "AK-47 | Redline" is what
    // lets someone recognise what a complaint is about.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.DEPOSIT_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'TradeOffer',
      targetId: offer.id,
      metadata: {
        botId: bot.id,
        botSteamId: bot.steamId,
        tradeUrl: user.tradeUrl,
        // The price goes in the trail too: it is what the seller asked
        // for, and "I listed it at X" needs an answer months later.
        items: items.map((i) => ({
          assetId: i.assetId,
          name: i.marketHashName,
          price: priceByAssetId.get(i.assetId),
        })),
      },
      context,
    });

    // The event and its values, not a sentence: the wording lives in the
    // frontend so it can follow the language picker.
    await this.notifications.notify({
      userId: user.id,
      kind: NOTIFICATION_KINDS.DEPOSIT_QUEUED,
      params: { itemCount: items.length },
      targetType: 'TradeOffer',
      targetId: offer.id,
    });

    this.logger.log(
      `Deposit queued: ${items.length} item(s), user ${user.id}, bot ${bot.id}`,
    );

    return offer;
  }

  /**
   * Stops the same item from being queued twice — a double click, a
   * duplicated tab, or a resubmitted form.
   */
  private async refuseIfAlreadyQueued(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ): Promise<void> {
    const open = await this.prisma.tradeOffer.findFirst({
      where: {
        status: { in: OPEN_OFFERS },
        requestedAssetIds: { hasSome: assetIds },
      },
    });

    if (open) {
      await this.recordRefusal(
        user,
        'item_already_in_trade',
        assetIds,
        context,
      );
      throw new ConflictException(
        'There is already a trade in progress with at least one of these ' +
          'items. Check your pending offers on Steam.',
      );
    }
  }

  /**
   * Confirms the items really are in the user's inventory and can be
   * deposited.
   *
   * Without this, someone could submit another person's assetIds and we
   * would build an offer asking for items the user does not have — which
   * would fail on Steam, but only after taking up a bot and a queue slot.
   */
  private async checkAgainstInventory(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ) {
    // Read Steam now rather than accept the cached copy. The freshness
    // window is an hour, tuned for a screen that is only being looked at;
    // this is the check that decides whether a Trade Bot goes and asks
    // for these items, and an hour is long enough for them to have been
    // traded away in between. The rate limit still applies — if no route
    // is free this falls back to the cache, which is no worse than the
    // behaviour it replaces. Deposits are rare next to page loads, so the
    // extra calls cost nothing against the capacity the window buys.
    const inventory = await this.inventory.getInventory(user.steamId, true);

    if (inventory.status === 'private') {
      await this.recordRefusal(user, 'private_inventory', assetIds, context);
      throw new BadRequestException(
        'Your Steam inventory is private. Make it public so we can check ' +
          'the items.',
      );
    }

    if (inventory.status !== 'ok') {
      await this.recordRefusal(
        user,
        `steam_unavailable:${inventory.status}`,
        assetIds,
        context,
      );
      throw new ServiceUnavailableException(
        'We could not read your Steam inventory right now. Please try ' +
          'again in a few minutes.',
      );
    }

    const byAssetId = new Map(inventory.items.map((i) => [i.assetId, i]));

    const missing = assetIds.filter((id) => !byAssetId.has(id));

    if (missing.length > 0) {
      // Worth watching for repetition: asking for an item that is not in
      // the inventory can be a stale page, but also someone else's
      // assetId.
      await this.recordRefusal(user, 'item_not_in_inventory', missing, context);
      throw new BadRequestException(
        `${missing.length} item(s) were not found in your inventory. ` +
          'Refresh the page and try again.',
      );
    }

    const blocked = assetIds
      .map((id) => byAssetId.get(id)!)
      .filter((item) => !item.depositable);

    if (blocked.length > 0) {
      await this.recordRefusal(
        user,
        'item_not_depositable',
        blocked.map((i) => i.assetId),
        context,
      );
      throw new BadRequestException(
        `These cannot be deposited: ${blocked
          .map((i) => i.marketHashName)
          .join(', ')}.`,
      );
    }

    return assetIds.map((id) => byAssetId.get(id)!);
  }

  /**
   * Picks which bot receives.
   *
   * Criteria: in rotation, no pending trade hold, and with room. Among the
   * eligible ones, take the emptiest — spreading reduces the loss if a bot
   * gets banned, since its inventory is locked forever.
   */
  private async pickBot(
    user: User,
    assetIds: string[],
    context?: AuditContext,
  ) {
    const quantity = assetIds.length;

    const candidates = await this.prisma.bot.findMany({
      where: {
        status: BotStatus.ONLINE,
        OR: [{ tradeHoldUntil: null }, { tradeHoldUntil: { lte: new Date() } }],
      },
      include: { _count: { select: { items: true } } },
    });

    const withRoom = candidates
      .filter((b) => b._count.items + quantity <= b.maxItems)
      .sort((a, b) => a._count.items - b._count.items);

    if (withRoom.length === 0) {
      this.logger.error(`No bot available to receive ${quantity} item(s)`);

      // A refusal that is not the user's fault. Recorded because
      // repetition here means an undersized fleet or bots out of rotation.
      await this.recordRefusal(user, 'no_bot_available', assetIds, context);
      throw new ServiceUnavailableException(
        'No Trade Bot is available to receive the items right now. Please ' +
          'try again in a few minutes.',
      );
    }

    return withRoom[0];
  }
}
