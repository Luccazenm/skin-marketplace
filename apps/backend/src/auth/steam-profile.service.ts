import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SteamProfile {
  username: string;
  avatarUrl: string | null;
  profileUrl: string | null;
  steamCreatedAt: Date | null;
}

/**
 * Busca dados públicos do perfil na Web API da Steam.
 *
 * Isto é ENRIQUECIMENTO, não autenticação. Quem prova a identidade é o
 * OpenID da parte 2; aqui só pegamos nome e avatar para exibir. Por isso
 * toda falha é tratada como "sem perfil" em vez de erro: ficar sem avatar
 * é um problema cosmético, não motivo para impedir alguém de entrar.
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
        'STEAM_API_KEY não configurada — perfil não será preenchido',
      );
      return null;
    }

    try {
      const url = new URL(SteamProfileService.ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('steamids', steamId);

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(`Steam API respondeu ${req.status} ao buscar perfil`);
        return null;
      }

      const corpo = (await req.json()) as {
        response?: {
          players?: Array<{
            personaname?: string;
            avatarfull?: string;
            profileurl?: string;
            timecreated?: number;
          }>;
        };
      };

      const player = corpo.response?.players?.[0];

      if (!player) {
        return null;
      }

      return {
        // personaname pode vir vazio em conta recém-criada
        username: player.personaname?.trim() || steamId,
        avatarUrl: player.avatarfull ?? null,
        profileUrl: player.profileurl ?? null,
        // timecreated vem em segundos; Date espera milissegundos
        steamCreatedAt: player.timecreated
          ? new Date(player.timecreated * 1000)
          : null,
      };
    } catch (erro) {
      this.logger.warn(`Falha ao buscar perfil na Steam: ${String(erro)}`);
      return null;
    }
  }
}
