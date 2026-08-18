/**
 * A trade URL looks like this:
 *   https://steamcommunity.com/tradeoffer/new/?partner=872481203&token=Ab3xY9zQ
 *
 * `partner` is the owner's accountId (steamID3). `token` is what
 * authorizes an outsider to send a trade offer.
 */

/** Valve's constant separating a steamID64 from an accountId. */
const STEAM_ID64_BASE = 76561197960265728n;

export type TradeUrlError =
  | 'invalid_format'
  | 'invalid_domain'
  | 'missing_partner'
  | 'missing_token'
  | 'partner_from_another_account';

export type TradeUrlResult =
  | { ok: true; url: string; partner: string; token: string }
  | { ok: false; error: TradeUrlError };

/**
 * Converts a steamID64 into an accountId — the number that appears as
 * `partner`.
 *
 * Uses BigInt because a steamID64 has 17 digits and exceeds
 * Number.MAX_SAFE_INTEGER; done with a plain number, the arithmetic would
 * lose precision in the final digits, which are exactly the ones telling
 * one account from another.
 */
export function accountIdOf(steamId64: string): string | null {
  if (!/^\d{17}$/.test(steamId64)) {
    return null;
  }

  return (BigInt(steamId64) - STEAM_ID64_BASE).toString();
}

/**
 * Validates the trade URL and confirms it belongs to whoever is sending
 * it.
 *
 * Checking the `partner` is the critical point: without it, someone
 * pasting another person's URL — by mistake or on purpose — would make
 * the bot deliver the skins to the wrong account. Item delivery is
 * irreversible.
 */
export function validateTradeUrl(
  input: string,
  ownerSteamId: string,
): TradeUrlResult {
  const text = input.trim();

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'invalid_format' };
  }

  // The official domain only. A lookalike link pointing at another host
  // would have the user hand over their token somewhere else.
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'steamcommunity.com'
  ) {
    return { ok: false, error: 'invalid_domain' };
  }

  if (!url.pathname.startsWith('/tradeoffer/new')) {
    return { ok: false, error: 'invalid_format' };
  }

  const partner = url.searchParams.get('partner');
  const token = url.searchParams.get('token');

  if (!partner || !/^\d+$/.test(partner)) {
    return { ok: false, error: 'missing_partner' };
  }

  if (!token || !/^[A-Za-z0-9_-]{7,12}$/.test(token)) {
    return { ok: false, error: 'missing_token' };
  }

  if (partner !== accountIdOf(ownerSteamId)) {
    return { ok: false, error: 'partner_from_another_account' };
  }

  // We store a normalized URL, built by us: it drops extra parameters and
  // anything stuck to the end while copying.
  return {
    ok: true,
    url: `https://steamcommunity.com/tradeoffer/new/?partner=${partner}&token=${token}`,
    partner,
    token,
  };
}

export const ERROR_MESSAGE: Record<TradeUrlError, string> = {
  invalid_format:
    'This link does not look like a Steam trade URL. It must start with ' +
    'https://steamcommunity.com/tradeoffer/new/',
  invalid_domain:
    'This link is not from steamcommunity.com. Copy the trade URL ' +
    'directly from your Steam account privacy settings.',
  missing_partner: 'The link is incomplete: the "partner" part is missing.',
  missing_token:
    'The link is incomplete or the token has expired. Generate a new one ' +
    'in Inventory > Trade Offers > Who can send me Trade Offers.',
  partner_from_another_account:
    'This trade URL belongs to a different Steam account. Use the URL of ' +
    'the same account you signed in with.',
};
