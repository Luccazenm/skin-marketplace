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
import { ERROR_MESSAGE, validateTradeUrl } from './trade-url';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Saves the trade URL, checking that it belongs to the account asking.
   *
   * The steamId comes from the authenticated user, never from the request
   * body — that is what stops someone from registering a third party's
   * URL.
   */
  async updateTradeUrl(
    user: User,
    input: string,
    context?: AuditContext,
  ): Promise<User> {
    const result = validateTradeUrl(input, user.steamId);

    if (!result.ok) {
      if (result.error === 'partner_from_another_account') {
        this.logger.warn(
          `Trade URL from another account refused for user ${user.id}`,
        );
      }

      // A refusal becomes a record too: a run of attempts with someone
      // else's URL is a scam pattern, and it only shows up if stored.
      await this.audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: user.id,
        metadata: { error: result.error, attempt: input.slice(0, 200) },
        context,
      });

      throw new BadRequestException(ERROR_MESSAGE[result.error]);
    }

    const previous = user.tradeUrl;

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      // Stores the normalized version, not what the user pasted.
      data: { tradeUrl: result.url },
    });

    // The before and after is what closes the case when someone changes
    // their trade URL and later claims they never received the item: you
    // can line up the time of the change with the time of delivery.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.TRADE_URL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      metadata: { from: previous, to: result.url },
      context,
    });

    this.logger.log(`Trade URL updated for user ${user.id}`);

    return updated;
  }
}
