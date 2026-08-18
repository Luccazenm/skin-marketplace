import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SteamEconomyBan } from '@prisma/client';

export interface SteamBanStatus {
  economyBan: SteamEconomyBan;
  vacBanned: boolean;
}

/**
 * Queries the restrictions Steam has imposed on an account.
 *
 * This is NOT our own moderation. A user banned by Steam is still a
 * customer and still owns what is in custody — they only lose part of
 * the operations, and each kind of ban takes away something different.
 *
 * CAUTION: today this is only called at login, so User.steamEconomyBan
 * can be stale for anyone banned after signing in. The trade worker has
 * to query it again before attempting a delivery, otherwise it retries
 * forever against a blocked account. See apps/bot-service/README.md.
 */
@Injectable()
export class SteamBanService {
  private static readonly ENDPOINT =
    'https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/';

  private readonly logger = new Logger(SteamBanService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Returns the status, or null when it could not be determined.
   *
   * null is not the same as "no ban". When we cannot check, the caller
   * must preserve the last known value instead of assuming anything:
   * assuming NONE would allow operations that are going to fail, and
   * assuming BANNED would punish a legitimate user over a Steam outage.
   */
  async fetchBanStatus(steamId: string): Promise<SteamBanStatus | null> {
    const apiKey = this.config.get<string>('STEAM_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'STEAM_API_KEY is not configured — ban status will not be checked',
      );
      return null;
    }

    try {
      const url = new URL(SteamBanService.ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('steamids', steamId);

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(
          `Steam API answered ${req.status} while checking bans`,
        );
        return null;
      }

      const body = (await req.json()) as {
        players?: Array<{
          EconomyBan?: string;
          VACBanned?: boolean;
        }>;
      };

      const player = body.players?.[0];

      if (!player) {
        return null;
      }

      return {
        economyBan: this.parseEconomyBan(player.EconomyBan),
        vacBanned: player.VACBanned === true,
      };
    } catch (error) {
      this.logger.warn(`Failed to check bans on Steam: ${String(error)}`);
      return null;
    }
  }

  /**
   * Steam sends "none", "probation" or "banned" as text.
   * An unknown value is treated as a restriction: if Steam invents a new
   * state, holding the operation is safer than allowing it blindly.
   */
  private parseEconomyBan(value: string | undefined): SteamEconomyBan {
    switch (value?.toLowerCase()) {
      case 'none':
        return SteamEconomyBan.NONE;
      case 'probation':
        return SteamEconomyBan.PROBATION;
      case 'banned':
        return SteamEconomyBan.BANNED;
      default:
        this.logger.warn(`Unknown EconomyBan from Steam: ${String(value)}`);
        return SteamEconomyBan.PROBATION;
    }
  }
}
