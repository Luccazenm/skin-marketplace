import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SteamProfile {
  username: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  steamCreatedAt: Date | null;
}

/**
 * Fetches public profile data from Steam's Web API.
 *
 * This is ENRICHMENT, not authentication. Identity is proven by the
 * OpenID in leg 2; here we only pick up a name and an avatar to display.
 * That is why every failure is treated as "no profile" rather than an
 * error: going without an avatar is cosmetic, not a reason to keep
 * someone out.
 */
@Injectable()
export class SteamProfileService {
  private static readonly ENDPOINT =
    'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/';

  private readonly logger = new Logger(SteamProfileService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchProfile(steamId: string): Promise<SteamProfile | null> {
    const apiKey = this.config.get<string>('STEAM_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'STEAM_API_KEY is not configured — the profile will not be filled in',
      );
      return null;
    }

    try {
      const url = new URL(SteamProfileService.ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('steamids', steamId);

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(
          `Steam API answered ${req.status} while fetching the profile`,
        );
        return null;
      }

      const body = (await req.json()) as {
        response?: {
          players?: Array<{
            personaname?: string;
            avatarfull?: string;
            profileurl?: string;
            timecreated?: number;
          }>;
        };
      };

      const player = body.response?.players?.[0];

      if (!player) {
        return null;
      }

      return {
        // personaname can come back empty on a freshly created account
        username: player.personaname?.trim() || steamId,
        avatarUrl: player.avatarfull ?? null,
        profileUrl: player.profileurl ?? null,
        // timecreated comes in seconds; Date expects milliseconds
        steamCreatedAt: player.timecreated
          ? new Date(player.timecreated * 1000)
          : null,
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch the Steam profile: ${String(error)}`);
      return null;
    }
  }
}
