import { Injectable, Logger } from '@nestjs/common';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The kinds of message the bell can carry.
 *
 * Strings by convention "domain.event", like AUDIT_ACTIONS, so a new
 * kind of message does not need a migration. Gathered here so the
 * frontend has one list to render against and a typo is a compile
 * error rather than a message that silently never appears.
 */
export const NOTIFICATION_KINDS = {
  /** The deposit was queued; the Trade Bot has yet to send the offer. */
  DEPOSIT_QUEUED: 'deposit.queued',
} as const;

export type NotificationKind =
  (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  /** The values the sentence needs — never a finished sentence. */
  params?: Prisma.InputJsonValue;
  targetType?: string;
  targetId?: string;
}

/**
 * Messages addressed to one person, gathered under the bell.
 *
 * Not to be confused with AuditService, which it sits beside. The audit
 * log is the proof: written for us, immutable, and it records refusals
 * and internal actors too. This is something a person reads and
 * dismisses. An event can produce both, one, or neither — a refused
 * deposit is audited and not notified; a bot delivering an item is
 * both.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a message. Never throws.
   *
   * A failure here must not take down the operation that caused it:
   * losing "your deposit was queued" is a nuisance, failing the deposit
   * because the notice could not be written is a real loss. Same
   * reasoning as AuditService.record, with one difference — the audit
   * trail is evidence and this is a courtesy, so this one is the safer
   * of the two to lose.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          params: input.params,
          targetType: input.targetType,
          targetId: input.targetId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record notification ${input.kind} for ${input.userId}: ${String(error)}`,
      );
    }
  }

  /** The newest first, capped — the bell is not an archive. */
  async list(userId: string, limit = 30): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** What the badge shows. */
  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Marks everything currently unread as read.
   *
   * Scoped to the user in the WHERE clause rather than by id list: it is
   * one statement, and it cannot be talked into touching someone else's
   * row.
   */
  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return count;
  }
}
