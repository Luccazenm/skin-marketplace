import { Injectable, Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditOutcome,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** Network context, for investigating a suspicious pattern. */
export interface AuditContext {
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  /** Convention "domain.action" — see AUDIT_ACTIONS. */
  action: string;
  outcome: AuditOutcome;
  targetType?: string;
  targetId?: string;
  /** On a change, store before and after. */
  metadata?: Prisma.InputJsonValue;
  context?: AuditContext;
}

/**
 * Writes the audit trail.
 *
 * It exists to answer "is this person telling the truth?" months after an
 * item or an amount goes missing. That is why it records both what
 * succeeded and what was refused: a run of refusals is a scam pattern
 * that only shows up if the attempts are stored.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records without bringing the operation down.
   *
   * A failure to audit cannot stop someone from signing in. For
   * operations that move money, use recordInTransaction: there the record
   * really does have to fall with the rest if something goes wrong.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.write(this.prisma, entry);
    } catch (error) {
      // A lost record is bad, but bringing the operation down over it
      // would be worse. It goes to the application log so it does not
      // vanish silently.
      this.logger.error(
        `Failed to write the audit record for ${entry.action}: ${String(error)}`,
      );
    }
  }

  /**
   * Records inside a transaction that is already open.
   *
   * Use it when the record must exist if and only if the operation does —
   * a balance movement, a change of item ownership. Here the failure
   * propagates on purpose: a money operation with no trail is worse than
   * an operation that never happened.
   */
  async recordInTransaction(
    tx: Prisma.TransactionClient,
    entry: AuditEntry,
  ): Promise<void> {
    await this.write(tx, entry);
  }

  private async write(
    client: Prisma.TransactionClient | PrismaClient,
    entry: AuditEntry,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        outcome: entry.outcome,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata,
        ip: entry.context?.ip ?? null,
        userAgent: entry.context?.userAgent?.slice(0, 500) ?? null,
      },
    });
  }
}

/**
 * Extracts the network context from the request.
 *
 * `req.ip` honours Express's trust proxy setting: behind a reverse proxy
 * it has to be configured, otherwise everyone shows up as the proxy's IP
 * — and the network audit is worth nothing.
 */
export function auditContext(req: Request): AuditContext {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Known actions. Constants rather than loose strings so that a query for
 * "every trade URL change" does not depend on someone having typed the
 * same string twice.
 */
export const AUDIT_ACTIONS = {
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
  TRADE_URL_UPDATED: 'user.trade_url.updated',
  EMAIL_UPDATED: 'user.email.updated',
  CONSENT_UPDATED: 'user.consent.updated',
  DEPOSIT_REQUESTED: 'deposit.requested',
  BOT_REGISTERED: 'bot.registered',
  BOT_REGISTRATION_DENIED: 'bot.registration_denied',
} as const;

export { AuditActorType, AuditOutcome };
