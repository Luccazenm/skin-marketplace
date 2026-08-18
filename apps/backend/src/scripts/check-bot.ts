import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SteamAccountStateService } from '../auth/steam-account-state.service';
import { SteamBanService } from '../auth/steam-ban.service';
import { SteamProfileService } from '../auth/steam-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { blockersToOperate, profileIsPublic } from './bot-eligibility';

/**
 * Checks a Steam account before registering it as a Trade Bot.
 *
 *   pnpm build && pnpm bot:check -- --steam-id=765...
 *
 * Read-only: it writes nothing to the database and records no audit
 * entry. It exists to answer "can I register this account?" with no side
 * effects — in particular, to verify the steamID64 before storing it. A
 * single wrong digit passes the format check and would only surface days
 * later, when the Trade Bot failed to operate.
 *
 * The same checks run inside bot:add. Here they inform; there they block.
 */
async function main() {
  const steamId = /^--steam-id=(.*)$/.exec(
    process.argv.slice(2).join(' '),
  )?.[1];

  if (!steamId) {
    console.error('Usage: pnpm bot:check -- --steam-id=<steamID64>');
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
    const [profile, ban, state, alreadyRegistered] = await Promise.all([
      app.get(SteamProfileService).fetchProfile(steamId),
      app.get(SteamBanService).fetchBanStatus(steamId),
      app.get(SteamAccountStateService).fetchAccountState(steamId),
      app.get(PrismaService).bot.findUnique({ where: { steamId } }),
    ]);

    if (!profile) {
      console.log('✗ Profile not found on Steam');
      console.log('  Check the steamID64 and the STEAM_API_KEY.');
      process.exit(1);
    }

    console.log(`Profile   ${profile.username}`);
    console.log(`steamId   ${steamId}`);
    console.log(
      `Created   ${profile.steamCreatedAt?.toISOString().slice(0, 10) ?? '(hidden)'}`,
    );
    console.log('');

    // The same rule bot:add uses to block. See bot-eligibility.ts.
    const blockers = blockersToOperate(ban, state);
    const blocked = (reason: string) =>
      blockers.some((b) => b.reason === reason);

    // The operator needs to see every pending issue at once, not just the
    // first — otherwise they fix one, run again, and find the next.
    line('Not limited', state ? !blocked('limited_account') : null);
    line(
      'No economy restriction',
      ban ? !blocked('economy_restriction') : null,
      ban && blocked('economy_restriction') ? ban.economyBan : undefined,
    );
    line('No VAC ban', ban ? !blocked('vac_ban') : null);

    // Does not block registration, but blinds every check afterwards.
    line(
      'Public profile',
      state ? profileIsPublic(state) : null,
      state && !profileIsPublic(state)
        ? (state.privacyState ?? 'unknown')
        : undefined,
    );

    console.log('');

    if (alreadyRegistered) {
      console.log(
        `Already registered as a Trade Bot (id ${alreadyRegistered.id})`,
      );
      console.log(`  status ${alreadyRegistered.status}`);
      console.log(`  ref    ${alreadyRegistered.credentialRef}`);
    } else if (blockers.length > 0) {
      console.log(
        `CANNOT be registered: ${blockers.map((b) => b.label).join(', ')}`,
      );

      for (const b of blockers) {
        console.log(`  ${b.howToFix}`);
      }

      process.exitCode = 1;
    } else {
      console.log('Can be registered.');
      console.log(
        `  pnpm bot:add -- --steam-id=${steamId} --ref=<vault key> ` +
          `--ready=YYYY-MM-DD`,
      );
    }
  } finally {
    await app.close();
  }
}

/** null = could not be determined, which differs from failed. */
function line(label: string, ok: boolean | null, detail?: string) {
  const mark = ok === null ? '?' : ok ? '✓' : '✗';
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
