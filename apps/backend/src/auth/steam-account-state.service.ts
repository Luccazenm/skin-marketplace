import { Injectable, Logger } from '@nestjs/common';

export interface SteamAccountState {
  /**
   * An account that has not yet spent US$ 5 on Steam. It cannot trade,
   * so it is no use as a Trade Bot.
   */
  isLimited: boolean;
  /** "public", "friendsonly", "private" — empty when Steam omits it. */
  privacyState: string | null;
  /** "None" when there is no trade restriction. */
  tradeBanState: string | null;
}

/**
 * Reads account state from the public community profile.
 *
 * It lives apart from SteamBanService because the information comes from
 * somewhere else: the Web API (GetPlayerBans) **does not report a
 * limited account**, and a limited account is not a ban — it is an
 * account that has not yet spent the US$ 5. Without this check,
 * registering a freshly created Trade Bot would pass every barrier and
 * we would only find out when it got picked to receive a deposit.
 *
 * The `?xml=1` endpoint is the public profile itself, no API key.
 */
@Injectable()
export class SteamAccountStateService {
  private readonly logger = new Logger(SteamAccountStateService.name);

  /**
   * Returns the state, or null when it could not be determined.
   *
   * As in SteamBanService, null is not the same as "everything is fine":
   * the caller decides what to do with the uncertainty, instead of
   * receiving a guess dressed up as an answer.
   */
  async fetchAccountState(steamId: string): Promise<SteamAccountState | null> {
    try {
      const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(
          `Steam answered ${req.status} while reading profile ${steamId}`,
        );
        return null;
      }

      const xml = await req.text();

      const limited = this.extract(xml, 'isLimitedAccount');

      // A non-existent profile returns an error page, and a private
      // profile can omit the field. Without it there is no answer to
      // give.
      if (limited === null) {
        this.logger.warn(
          `Profile ${steamId} did not carry isLimitedAccount — it may not ` +
            `exist or may be private`,
        );
        return null;
      }

      return {
        isLimited: limited === '1',
        privacyState: this.extract(xml, 'privacyState'),
        tradeBanState: this.extract(xml, 'tradeBanState'),
      };
    } catch (error) {
      this.logger.warn(`Failed to read the Steam profile: ${String(error)}`);
      return null;
    }
  }

  /**
   * Reads one simple tag out of the XML.
   *
   * No XML library on purpose: these are three fixed-format fields, and
   * the alternative would be a whole dependency for that. The content
   * can arrive wrapped in CDATA, which Steam uses on free-text fields.
   */
  private extract(xml: string, tag: string): string | null {
    const m = new RegExp(
      `<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`,
      's',
    ).exec(xml);

    return m ? m[1].trim() : null;
  }
}
