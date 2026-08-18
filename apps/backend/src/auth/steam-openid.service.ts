import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Steam authenticates over OpenID 2.0 — an old protocol, but the only one
 * it offers. There is no OAuth for Steam login.
 *
 * The flow has two legs:
 *   1. We send the user to Steam with the parameters below (this file)
 *   2. Steam sends the user back to us with a signature, which MUST be
 *      validated with Steam itself (leg 2)
 *
 * Leg 2 is where the security lives. Trusting the returned parameters
 * without validating them lets anyone impersonate any account — that is
 * exactly the known flaw in several Steam login libraries.
 */
@Injectable()
export class SteamOpenIdService {
  private static readonly STEAM_OPENID_ENDPOINT =
    'https://steamcommunity.com/openid/login';

  /**
   * The claimed_id Steam returns always has this shape:
   *   https://steamcommunity.com/openid/id/76561198000000000
   * Anchored at both ends on purpose: without that, a URL such as
   * "https://fakesite.com/?x=https://steamcommunity.com/openid/id/123"
   * would pass the check.
   */
  private static readonly CLAIMED_ID_PATTERN =
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

  private readonly logger = new Logger(SteamOpenIdService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * URL the user must be sent to when they click "Sign in with Steam".
   */
  buildLoginUrl(): string {
    const apiUrl = this.config.getOrThrow<string>('API_URL');

    const params = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',

      // Where Steam sends the user back after login
      'openid.return_to': `${apiUrl}/api/auth/steam/return`,

      // Domain Steam shows on the login screen ("sign in to X?")
      'openid.realm': apiUrl,

      // "identifier_select" = we do not know who the user is yet;
      // Steam itself decides which account is signing in.
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });

    return `${SteamOpenIdService.STEAM_OPENID_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Validates Steam's return and yields the 64-bit steamId.
   *
   * This function is the critical point of the entire login. The
   * parameters arrive in the query string, that is, under the control of
   * whoever makes the request — anyone can craft a URL claiming to own
   * any account. The only thing separating a legitimate login from a
   * forgery is the call back to Steam made here: we return the parameters
   * exactly as they came, with the mode switched to check_authentication,
   * and only accept the login if Steam answers is_valid:true.
   *
   * Returns null for anything that is not a valid login.
   */
  async verifyReturn(query: Record<string, unknown>): Promise<string | null> {
    // Steam sends mode=cancel when the user backs out of the login screen
    if (query['openid.mode'] !== 'id_res') {
      return null;
    }

    const claimedId = query['openid.claimed_id'];

    if (typeof claimedId !== 'string') {
      return null;
    }

    // Before spending a network call, we check the format. This also
    // stops a claimed_id pointing at another provider from being
    // accepted.
    const match = SteamOpenIdService.CLAIMED_ID_PATTERN.exec(claimedId);

    if (!match) {
      return null;
    }

    const steamId = match[1];

    const valid = await this.checkAuthentication(query);

    return valid ? steamId : null;
  }

  /**
   * Sends the parameters back to Steam and asks whether the signature is
   * theirs.
   */
  private async checkAuthentication(
    query: Record<string, unknown>,
  ): Promise<boolean> {
    const body = new URLSearchParams();

    // Every openid.* field must go back exactly as it arrived — they are
    // part of what was signed. Only the mode changes.
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('openid.') && typeof value === 'string') {
        body.set(key, value);
      }
    }

    body.set('openid.mode', 'check_authentication');

    let response: string;

    try {
      const req = await fetch(SteamOpenIdService.STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!req.ok) {
        this.logger.warn(`Steam answered ${req.status} during verification`);
        return false;
      }

      response = await req.text();
    } catch (error) {
      // Steam down or timed out: we refuse the login. Never let anyone
      // through on a network failure — that would be an open door during
      // instability.
      this.logger.error(`Failed to verify Steam login: ${String(error)}`);
      return false;
    }

    // The response is plain text, one "key:value" per line
    return response.split('\n').some((line) => line.trim() === 'is_valid:true');
  }
}
