import { SteamEconomyBan } from '@prisma/client';

/** What the account can do, given its state on Steam. */
export interface UserCapabilities {
  /** Hand skins over to our bot. Requires SENDING. */
  canDeposit: boolean;
  /** Receive skins from our bot (purchase delivery or return). Requires RECEIVING. */
  canWithdraw: boolean;
  /** Sell through the site what is already in custody. Steam is not involved. */
  canSell: boolean;
  /** Explanation to show the user when something is blocked. */
  blockedReason: string | null;
  /** Warnings that do not block, but the user needs to know. */
  warnings: string[];
}

type BanState = Pick<
  { steamEconomyBan: SteamEconomyBan; steamVacBanned: boolean },
  'steamEconomyBan' | 'steamVacBanned'
>;

/**
 * Steam restriction rules.
 *
 * The non-obvious point: selling through the site is NEVER blocked by a
 * Steam ban. The item is already in our bot, and the sale is a change of
 * owner in our database — Steam takes no part. For someone who has been
 * banned, that is the only liquidity left, and taking it away would turn
 * Valve's punishment into confiscation by us.
 */
export function capabilitiesFor(user: BanState): UserCapabilities {
  const warnings: string[] = [];

  // An economy ban cuts the account out of Steam's economy in both
  // directions.
  if (user.steamEconomyBan === SteamEconomyBan.BANNED) {
    return {
      canDeposit: false,
      canWithdraw: false,
      canSell: true,
      blockedReason:
        'Your Steam account is barred from trading items, so you cannot ' +
        'deposit or receive skins. The skins already in custody can still ' +
        'be sold here as usual.',
      warnings,
    };
  }

  if (user.steamEconomyBan === SteamEconomyBan.PROBATION) {
    return {
      canDeposit: false,
      canWithdraw: false,
      canSell: true,
      blockedReason:
        'Your Steam account is under a trading restriction period. ' +
        'Deposits and withdrawals are unavailable until Steam lifts it. ' +
        'Selling the skins in custody keeps working.',
      warnings,
    };
  }

  // A VAC ban does not block on its own: Steam's API does not say which
  // game the ban is from, and a VAC in another game does not affect CS2
  // items. Blocking here would punish a legitimate user over imprecise
  // data — so we warn and let the actual trade attempt deliver the
  // verdict.
  if (user.steamVacBanned) {
    warnings.push(
      'Your Steam account has a VAC ban on record. If it is from CS2, ' +
        'depositing skins will not work — receiving still does.',
    );
  }

  return {
    canDeposit: true,
    canWithdraw: true,
    canSell: true,
    blockedReason: null,
    warnings,
  };
}
