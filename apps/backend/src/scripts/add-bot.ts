import { NestFactory } from '@nestjs/core';
import { BotStatus } from '@prisma/client';
import { AppModule } from '../app.module';
import {
  AUDIT_ACTIONS,
  AuditActorType,
  AuditOutcome,
  AuditService,
} from '../audit/audit.service';
import { SteamAccountStateService } from '../auth/steam-account-state.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { blockersToOperate, profileIsPublic } from './bot-eligibility';

/**
 * Registers a Trade Bot in the system.
 *
 *   pnpm build && pnpm bot:add -- --steam-id=765... --ref=bot/01 [--ready=2026-08-20]
 *
 * Deliberately not an HTTP route: it is an operator action, performed a
 * handful of times, and an admin endpoint would be exposed surface for no
 * reason.
 *
 * Before storing, it confirms with Steam that the account exists and is
 * not restricted from trading. Registering a bot that already cannot
 * trade would only delay the discovery until the moment it was picked to
 * receive a deposit.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const steamId = args['steam-id'];
  const credentialRef = args['ref'];
  const readyAt = args['ready'];
  const maxItems = args['max-items'];

  if (!steamId || !credentialRef) {
    console.error(
      'Usage: pnpm bot:add -- --steam-id=<steamID64> --ref=<vault key> ' +
        '[--ready=YYYY-MM-DD] [--max-items=900]\n\n' +
        '  --ready  the date the authenticator completes 7 days. Until\n' +
        '           then trades carry a hold and the bot must stay out of\n' +
        '           rotation.',
    );
    process.exit(1);
  }

  if (!/^\d{17}$/.test(steamId)) {
    console.error(`Invalid steamID64: ${steamId} (expected 17 digits)`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const prisma = app.get(PrismaService);
    const audit = app.get(AuditService);

    /**
     * Records the refusal before exiting.
     *
     * A refused attempt is an operational signal: repetition here means a
     * bought account, an account repurposed from something else, or
     * someone trying to point deposits at an account that is not ours.
     * Without recording it, the pattern would exist only in the memory of
     * whoever ran the command.
     */
    const refuse = async (
      reason: string,
      message: string,
      extra = {},
    ): Promise<never> => {
      console.error(message);

      await audit.record({
        actorType: AuditActorType.SYSTEM,
        action: AUDIT_ACTIONS.BOT_REGISTRATION_DENIED,
        outcome: AuditOutcome.DENIED,
        targetType: 'Bot',
        metadata: { steamId, credentialRef, reason, ...extra },
      });

      await app.close();
      process.exit(1);
    };

    const existing = await prisma.bot.findFirst({
      where: { OR: [{ steamId }, { credentialRef }] },
    });

    if (existing) {
      const conflict =
        existing.steamId === steamId
          ? `steamId ${steamId}`
          : `credentialRef ${credentialRef}`;

      await refuse(
        'duplicate',
        `A Trade Bot with ${conflict} already exists (id ${existing.id})`,
        { conflictsWith: existing.id },
      );
    }

    // Does the account actually exist? A single wrong digit in the
    // steamId would pass the format check and only surface when the bot
    // failed to operate.
    const profile = await app.get(SteamProfileService).fetchProfile(steamId);

    if (!profile) {
      await refuse(
        'unreadable_profile',
        'Could not read the profile on Steam. Check the steamID64 and the ' +
          'STEAM_API_KEY before registering.',
      );
      // `refuse` ends the process; the return is only so TypeScript sees
      // that `profile` is not null from here down.
      return;
    }

    const [ban, state] = await Promise.all([
      app.get(SteamBanService).fetchBanStatus(steamId),
      app.get(SteamAccountStateService).fetchAccountState(steamId),
    ]);

    // The same rule bot:check uses to inform. See bot-eligibility.ts.
    const blockers = blockersToOperate(ban, state);

    if (blockers.length > 0) {
      const [first] = blockers;

      await refuse(
        first.reason,
        `This account cannot operate as a Trade Bot: ${blockers
          .map((b) => b.label)
          .join(', ')}.\n\n${first.howToFix}\n\n` +
          `Check at: https://steamcommunity.com/profiles/${steamId}/?xml=1`,
        { blockers: blockers.map((b) => b.reason) },
      );
    }

    // Uncertainty does not block registration, but the operator needs to
    // know they registered without confirmation.
    if (!ban) {
      console.warn(
        'Warning: could not verify bans (STEAM_API_KEY missing or Steam ' +
          'unavailable). Registering anyway.',
      );
    }

    if (!state) {
      console.warn(
        'Warning: could not check whether the account is limited. ' +
          'Registering anyway — verify before putting it in rotation.',
      );
    }

    if (state && !profileIsPublic(state)) {
      console.warn(
        `Warning: profile is "${state.privacyState ?? 'unknown'}". With a ` +
          'closed inventory, nobody can check what is in custody — neither ' +
          'us nor the user.',
      );
    }

    const tradeHoldUntil = readyAt ? new Date(`${readyAt}T00:00:00Z`) : null;

    if (readyAt && Number.isNaN(tradeHoldUntil!.getTime())) {
      console.error(`Invalid date in --ready: ${readyAt}`);
      process.exit(1);
    }

    const bot = await prisma.bot.create({
      data: {
        steamId,
        username: profile.username,
        displayName: profile.username,
        credentialRef,
        // Born out of rotation: it only joins once the bot service can
        // authenticate with the credentials from the vault.
        status: BotStatus.OFFLINE,
        tradeHoldUntil,
        ...(maxItems ? { maxItems: Number(maxItems) } : {}),
      },
    });

    // Registering a bot defines where users' skins go. Recorded as
    // SYSTEM: it was an operator with server access, not someone
    // authenticated through the site.
    await audit.record({
      actorType: AuditActorType.SYSTEM,
      action: AUDIT_ACTIONS.BOT_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      targetType: 'Bot',
      targetId: bot.id,
      metadata: {
        steamId: bot.steamId,
        credentialRef: bot.credentialRef,
        profile: profile.username,
        maxItems: bot.maxItems,
        tradeHoldUntil: readyAt ?? null,
      },
    });

    console.log(`Trade Bot registered`);
    console.log(`  id            ${bot.id}`);
    console.log(`  steamId       ${bot.steamId}`);
    console.log(`  profile       ${profile.username}`);
    console.log(`  credentialRef ${bot.credentialRef}`);
    console.log(`  capacity      ${bot.maxItems} items`);
    console.log(`  status        ${bot.status}`);

    if (tradeHoldUntil) {
      const days = Math.ceil(
        (tradeHoldUntil.getTime() - Date.now()) / 86_400_000,
      );
      console.log(
        `  released on   ${readyAt}` +
          (days > 0 ? ` (${days} day(s) to go)` : ' (already released)'),
      );
    } else {
      console.log(
        `  released on   not provided — pass --ready if the authenticator ` +
          `has not completed 7 days yet`,
      );
    }
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) {
      out[m[1]] = m[2];
    }
  }

  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
