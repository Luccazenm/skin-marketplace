import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  type AuditContext,
} from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_ERROR_MESSAGE, validateEmail } from './email';
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

  /**
   * Sets or clears the marketing address.
   *
   * Passing an empty string removes it — which is the only way someone
   * can withdraw an address they gave us, so it is a supported input
   * rather than a validation error.
   *
   * Saving an address always resets `emailVerified`. Even re-typing the
   * same one: verification is a claim about a specific address at a
   * specific time, and an unverified address is one we never send to.
   */
  async updateEmail(
    user: User,
    input: string,
    context?: AuditContext,
  ): Promise<User> {
    const clearing = input.trim().length === 0;
    const result = clearing ? null : validateEmail(input);

    if (result && !result.ok) {
      await this.audit.record({
        actorType: AuditActorType.USER,
        actorId: user.id,
        action: AUDIT_ACTIONS.EMAIL_UPDATED,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: user.id,
        metadata: { error: result.error },
        context,
      });

      throw new BadRequestException(EMAIL_ERROR_MESSAGE[result.error]);
    }

    const email = result ? result.email : null;
    const previous = user.email;

    let updated: User;

    try {
      updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { email, emailVerified: false },
      });
    } catch (error) {
      // The column is unique. Someone else already having the address is
      // the ordinary case, not a fault — and the message must not say
      // whether that address has an account here, because that would
      // turn this field into a way to test whether a person is a user.
      if (isUniqueViolation(error)) {
        await this.audit.record({
          actorType: AuditActorType.USER,
          actorId: user.id,
          action: AUDIT_ACTIONS.EMAIL_UPDATED,
          outcome: AuditOutcome.DENIED,
          targetType: 'User',
          targetId: user.id,
          metadata: { error: 'already_in_use' },
          context,
        });

        throw new ConflictException(
          'That address cannot be used here. Try another one.',
        );
      }

      throw error;
    }

    // The addresses themselves go in the record. An address is how
    // marketing reaches someone, and "I never gave you that" is answered
    // by showing when it arrived and what it replaced.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.EMAIL_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      metadata: { from: previous, to: email },
      context,
    });

    this.logger.log(
      `Email ${email ? 'updated' : 'removed'} for user ${user.id}`,
    );

    return updated;
  }

  /**
   * Records what the user agreed to, and when.
   *
   * Each flag carries its own timestamp rather than one shared date: they
   * are given and withdrawn independently, and "when did they agree to
   * this particular thing" is the question that gets asked.
   *
   * Only the flags present in the input are touched, so a screen that
   * shows one switch cannot silently reset the other.
   */
  async updateConsent(
    user: User,
    input: { marketingEmail?: boolean; analytics?: boolean },
    context?: AuditContext,
  ): Promise<User> {
    const now = new Date();
    const data: Prisma.UserUpdateInput = {};

    if (input.marketingEmail !== undefined) {
      data.consentMarketingEmail = input.marketingEmail;
      data.consentMarketingEmailAt = now;
    }

    if (input.analytics !== undefined) {
      data.consentAnalytics = input.analytics;
      data.consentAnalyticsAt = now;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No consent setting was provided.');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });

    // Before and after, like every other account change. Consent is the
    // one place where the whole point is being able to prove what was
    // agreed and when — an undated "they opted in" is worth nothing.
    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.CONSENT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      metadata: {
        from: {
          marketingEmail: user.consentMarketingEmail,
          analytics: user.consentAnalytics,
        },
        to: {
          marketingEmail: updated.consentMarketingEmail,
          analytics: updated.consentAnalytics,
        },
      },
      context,
    });

    this.logger.log(`Consent updated for user ${user.id}`);

    return updated;
  }
}

/** Prisma's code for a unique constraint being violated. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
