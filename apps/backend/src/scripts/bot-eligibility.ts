import { SteamEconomyBan } from '@prisma/client';
import type { SteamAccountState } from '../auth/steam-account-state.service';
import type { SteamBanStatus } from '../auth/steam-ban.service';

export interface BotBlocker {
  /** Goes to the audit log — stable text, unaffected by wording changes. */
  reason: string;
  /** Short summary, for listing. */
  label: string;
  /** What the operator has to do. */
  howToFix: string;
}

/**
 * Why a Steam account cannot operate as a Trade Bot.
 *
 * A pure rule, no framework and no network, because it decides where
 * users' skins go. Both commands consume this list: `bot:check` shows
 * every pending issue at once, `bot:add` stops at the first. If each had
 * its own criteria they would disagree — and the disagreement would only
 * surface with an item already in custody.
 *
 * `null` in either input means "could not be determined", which is not a
 * blocker: the caller decides what to do with the uncertainty. Treating a
 * Steam outage as a rejection would prevent registering on a bad day;
 * treating it as approval would be worse.
 */
export function blockersToOperate(
  ban: SteamBanStatus | null,
  state: SteamAccountState | null,
): BotBlocker[] {
  const blockers: BotBlocker[] = [];

  // A limited account is not a ban, and the Web API does not report this
  // state. A freshly created account passes every other barrier and still
  // cannot trade.
  if (state?.isLimited) {
    blockers.push({
      reason: 'limited_account',
      label: 'limited account',
      howToFix:
        'Add funds to the wallet with a real payment method (the ' +
        'equivalent of US$ 5). Spending balance that was already there ' +
        'does not count.',
    });
  }

  if (ban && ban.economyBan !== SteamEconomyBan.NONE) {
    blockers.push({
      reason: 'economy_restriction',
      label: `economy restriction (${ban.economyBan})`,
      howToFix:
        'Steam has blocked trading on this account. There is nothing we ' +
        'can do on our side — use another account.',
    });
  }

  if (ban?.vacBanned) {
    blockers.push({
      reason: 'vac_ban',
      label: 'VAC ban',
      howToFix:
        'If the VAC ban is from CS2, the inventory is permanently locked ' +
        'and the account will never be able to send items. Use another ' +
        'account.',
    });
  }

  return blockers;
}

/**
 * A private profile does not prevent registering, but it blinds every
 * check afterwards: nobody — not us, not the user — can see what is in
 * custody.
 */
export function profileIsPublic(state: SteamAccountState | null): boolean {
  return state?.privacyState === 'public';
}
