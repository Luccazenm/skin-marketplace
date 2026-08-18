import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
  type AuditContext,
} from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SteamBanService } from './steam-ban.service';
import { SteamProfileService } from './steam-profile.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly steamProfile: SteamProfileService,
    private readonly steamBan: SteamBanService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Takes a steamId ALREADY VALIDATED by the OpenID and returns the
   * matching user, creating it on the first login.
   *
   * Never call this with a steamId that did not go through
   * SteamOpenIdService.
   */
  async loginWithSteam(steamId: string, context?: AuditContext): Promise<User> {
    const now = new Date();

    // Barriers that run BEFORE any write.
    //
    // The order matters: an attempt to log into a protected account must
    // not modify that account before being refused. Doing the upsert
    // first let whoever tried to get in overwrite the target account's
    // name and avatar.
    const existing = await this.prisma.user.findUnique({
      where: { steamId },
      select: { id: true, isPlatform: true, isBanned: true },
    });

    // The system account is untouchable: no write, and no useful answer.
    if (existing?.isPlatform) {
      this.logger.error(
        `Attempt to log into the platform account via steamId ${steamId}`,
      );

      await this.audit.record({
        actorType: AuditActorType.ANONYMOUS,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: existing.id,
        metadata: { reason: 'platform_account', steamId },
        context,
      });

      throw new ForbiddenException('Account unavailable');
    }

    // A banned account still records the attempt — only the timestamp,
    // nothing coming from outside. Knowing that a suspended user tried to
    // get in is useful information.
    if (existing?.isBanned) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { lastLoginAt: now },
      });

      this.logger.warn(`Login refused for banned account: ${steamId}`);

      await this.audit.record({
        actorType: AuditActorType.USER,
        actorId: existing.id,
        action: AUDIT_ACTIONS.LOGIN,
        outcome: AuditOutcome.DENIED,
        targetType: 'User',
        targetId: existing.id,
        metadata: { reason: 'suspended_account', steamId },
        context,
      });

      throw new ForbiddenException('This account is suspended');
    }

    const [profile, ban] = await Promise.all([
      this.steamProfile.fetchProfile(steamId),
      this.steamBan.fetchBanStatus(steamId),
    ]);

    // We only write the ban status when we managed to determine it. When
    // Steam does not answer, we keep the last known value — overwriting
    // it with a guess would allow or block operations by mistake.
    const banData = ban
      ? {
          steamEconomyBan: ban.economyBan,
          steamVacBanned: ban.vacBanned,
          steamBanCheckedAt: now,
        }
      : {};

    const user = await this.prisma.user.upsert({
      where: { steamId },

      // First login: create the account.
      create: {
        steamId,
        // With no profile available the steamId serves as a name until
        // the next sync. It is ugly, but it beats refusing the sign-up.
        username: profile?.username ?? steamId,
        avatarUrl: profile?.avatarUrl,
        profileUrl: profile?.profileUrl,
        steamCreatedAt: profile?.steamCreatedAt,
        lastLoginAt: now,
        ...banData,
      },

      // Subsequent logins: only what Steam owns.
      // balance, isBanned, tradeUrl, email and isPlatform do NOT belong
      // here — they are our own state, and overwriting them with Steam
      // data would wipe balance and bans on every login.
      update: {
        ...(profile
          ? {
              username: profile.username,
              avatarUrl: profile.avatarUrl,
              profileUrl: profile.profileUrl,
              steamCreatedAt: profile.steamCreatedAt,
            }
          : {}),
        lastLoginAt: now,
        ...banData,
      },
    });

    await this.audit.record({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'User',
      targetId: user.id,
      // firstLogin tells a brand-new account from a returning one —
      // useful when someone claims they never used the site.
      metadata: {
        steamId,
        firstLogin: existing === null,
        steamEconomyBan: user.steamEconomyBan,
      },
      context,
    });

    return user;
  }
}
