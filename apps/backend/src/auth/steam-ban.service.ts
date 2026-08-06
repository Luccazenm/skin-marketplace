import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SteamEconomyBan } from '@prisma/client';

export interface SteamBanStatus {
  economyBan: SteamEconomyBan;
  vacBanned: boolean;
}

/**
 * Consulta as restrições que a Steam impôs a uma conta.
 *
 * Isto NÃO é moderação nossa. Um usuário banido pela Steam continua sendo
 * cliente e continua dono do que está em custódia — ele só perde parte das
 * operações, e cada tipo de ban tira uma coisa diferente.
 */
@Injectable()
export class SteamBanService {
  private static readonly ENDPOINT =
    'https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/';

  private readonly logger = new Logger(SteamBanService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Retorna o status ou null se não foi possível apurar.
   *
   * null é diferente de "sem ban". Quando não conseguimos verificar, quem
   * chama deve preservar o último valor conhecido em vez de assumir algo:
   * assumir NONE liberaria operações que vão falhar, e assumir BANNED
   * puniria um usuário legítimo por uma instabilidade da Steam.
   */
  async fetchBanStatus(steamId: string): Promise<SteamBanStatus | null> {
    const apiKey = this.config.get<string>('STEAM_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'STEAM_API_KEY não configurada — status de ban não será verificado',
      );
      return null;
    }

    try {
      const url = new URL(SteamBanService.ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('steamids', steamId);

      const req = await fetch(url, { signal: AbortSignal.timeout(10_000) });

      if (!req.ok) {
        this.logger.warn(`Steam API respondeu ${req.status} ao checar bans`);
        return null;
      }

      const corpo = (await req.json()) as {
        players?: Array<{
          EconomyBan?: string;
          VACBanned?: boolean;
        }>;
      };

      const player = corpo.players?.[0];

      if (!player) {
        return null;
      }

      return {
        economyBan: this.parseEconomyBan(player.EconomyBan),
        vacBanned: player.VACBanned === true,
      };
    } catch (erro) {
      this.logger.warn(`Falha ao checar bans na Steam: ${String(erro)}`);
      return null;
    }
  }

  /**
   * A Steam manda "none", "probation" ou "banned" em texto.
   * Valor desconhecido é tratado como restrição: se a Steam inventar um
   * estado novo, é mais seguro segurar a operação do que liberar às cegas.
   */
  private parseEconomyBan(valor: string | undefined): SteamEconomyBan {
    switch (valor?.toLowerCase()) {
      case 'none':
        return SteamEconomyBan.NONE;
      case 'probation':
        return SteamEconomyBan.PROBATION;
      case 'banned':
        return SteamEconomyBan.BANNED;
      default:
        this.logger.warn(`EconomyBan desconhecido da Steam: ${String(valor)}`);
        return SteamEconomyBan.PROBATION;
    }
  }
}
