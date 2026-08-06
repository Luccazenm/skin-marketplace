import { Injectable, Logger } from '@nestjs/common';
import { InventoryCacheService } from './inventory-cache.service';
import {
  SteamInventoryService,
  type InventoryItem,
} from './steam-inventory.service';

export type InventoryResponse =
  | {
      status: 'ok';
      items: InventoryItem[];
      fetchedAt: Date;
      /** Dado servido do cache, sem consultar a Steam agora. */
      cached: boolean;
      /** Passou da validade — a Steam não pôde ser consultada. */
      stale: boolean;
    }
  | { status: 'private' }
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Decide QUANDO vale a pena falar com a Steam.
 *
 * A regra de ouro: dado velho é melhor que erro. Um inventário de dez
 * minutos atrás é praticamente igual ao atual, enquanto uma tela vazia com
 * "tente novamente" não serve para nada — e ainda leva o usuário a
 * recarregar, o que agrava exatamente o problema que estamos evitando.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly steam: SteamInventoryService,
    private readonly cache: InventoryCacheService,
  ) {}

  async getInventory(steamId: string): Promise<InventoryResponse> {
    const emCache = await this.cache.get(steamId);

    // 1. Dado atual: nem toca na Steam.
    if (emCache && !emCache.stale) {
      return {
        status: 'ok',
        items: emCache.items,
        fetchedAt: emCache.fetchedAt,
        cached: true,
        stale: false,
      };
    }

    // 2. Estamos de castigo depois de um 429. Insistir agora só renova o
    //    bloqueio, então servimos o que tivermos.
    if (await this.cache.estaBloqueado()) {
      return emCache ? this.servirVelho(emCache) : { status: 'rate_limited' };
    }

    // 3. Só uma chamada à Steam por vez, para o servidor inteiro.
    if (!(await this.cache.tentarReservarChamada())) {
      return emCache ? this.servirVelho(emCache) : { status: 'rate_limited' };
    }

    const resultado = await this.steam.fetchInventory(steamId);

    if (resultado.status === 'ok') {
      await this.cache.set(steamId, resultado.items);

      return {
        status: 'ok',
        items: resultado.items,
        fetchedAt: new Date(),
        cached: false,
        stale: false,
      };
    }

    if (resultado.status === 'rate_limited') {
      await this.cache.marcarBloqueioSteam();
      return emCache ? this.servirVelho(emCache) : { status: 'rate_limited' };
    }

    // Inventário privado NÃO cai para o cache: se a pessoa acabou de
    // fechar o perfil, servir o conteúdo antigo mostraria itens que ela
    // decidiu esconder.
    if (resultado.status === 'private') {
      return { status: 'private' };
    }

    // Falha passageira da Steam: o cache velho ainda é útil.
    return emCache
      ? this.servirVelho(emCache)
      : { status: 'error', message: resultado.message };
  }

  private servirVelho(hit: {
    items: InventoryItem[];
    fetchedAt: Date;
  }): InventoryResponse {
    this.logger.warn(
      `Servindo inventário de ${hit.fetchedAt.toISOString()} — Steam indisponível ou limitada`,
    );

    return {
      status: 'ok',
      items: hit.items,
      fetchedAt: hit.fetchedAt,
      cached: true,
      stale: true,
    };
  }
}
