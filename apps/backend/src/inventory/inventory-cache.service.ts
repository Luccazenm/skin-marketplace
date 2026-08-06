import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { InventoryItem } from './steam-inventory.service';

interface EntradaCache {
  items: InventoryItem[];
  /** Momento em que veio da Steam. */
  fetchedAt: number;
}

export interface CacheHit {
  items: InventoryItem[];
  fetchedAt: Date;
  /** true = passou da validade, está sendo servido por falta de opção. */
  stale: boolean;
}

/**
 * Cache do inventário, com duas idades.
 *
 * Existe porque o endpoint de inventário da Steam é limitado por IP — o do
 * nosso servidor. Sem cache, cada F5 de cada usuário vira uma chamada, e
 * poucas dessas bastam para a Steam bloquear todo mundo por horas.
 *
 * Guardamos uma entrada só, com TTL longo, e decidimos pela idade:
 *
 *   idade < FRESCO   -> serve direto, nem toca na Steam
 *   idade > FRESCO   -> tenta revalidar; se não puder, serve velho mesmo
 *   sem entrada      -> precisa chamar a Steam ou falhar
 *
 * Servir dado velho é melhor que recusar: um inventário de dez minutos
 * atrás é praticamente igual ao de agora, e a alternativa é uma tela
 * vazia com mensagem de erro.
 */
@Injectable()
export class InventoryCacheService {
  /** Abaixo disso, o dado é considerado atual. */
  private static readonly FRESCO_SEGUNDOS = 120;

  /** Quanto tempo o dado continua guardado para servir como reserva. */
  private static readonly RETENCAO_SEGUNDOS = 60 * 60;

  /**
   * Intervalo mínimo entre duas chamadas ao endpoint de inventário, para o
   * servidor inteiro. A comunidade convergiu para 4s como limite seguro;
   * abaixo disso o bloqueio por IP vem rápido.
   */
  private static readonly INTERVALO_MINIMO_MS = 4000;

  private readonly logger = new Logger(InventoryCacheService.name);

  constructor(private readonly redis: RedisService) {}

  async get(steamId: string): Promise<CacheHit | null> {
    const cru = await this.redis.get(this.chave(steamId));

    if (!cru) {
      return null;
    }

    let entrada: EntradaCache;

    try {
      entrada = JSON.parse(cru) as EntradaCache;
    } catch {
      // Formato antigo ou corrompido: tratar como ausência de cache.
      return null;
    }

    const idadeSegundos = (Date.now() - entrada.fetchedAt) / 1000;

    return {
      items: entrada.items,
      fetchedAt: new Date(entrada.fetchedAt),
      stale: idadeSegundos > InventoryCacheService.FRESCO_SEGUNDOS,
    };
  }

  async set(steamId: string, items: InventoryItem[]): Promise<void> {
    const entrada: EntradaCache = { items, fetchedAt: Date.now() };

    await this.redis.set(
      this.chave(steamId),
      JSON.stringify(entrada),
      'EX',
      InventoryCacheService.RETENCAO_SEGUNDOS,
    );
  }

  /**
   * Tenta reservar o direito de chamar a Steam agora.
   *
   * É um limite GLOBAL, não por usuário: quem manda é o IP do servidor, e
   * ele é um só. Se dois usuários pedirem ao mesmo tempo, só um passa —
   * o outro será servido pelo cache, mesmo velho.
   *
   * Implementado com SET NX: a chave só é criada se não existir, e expira
   * sozinha. Vale entre múltiplas instâncias da API, já que o estado vive
   * no Redis e não na memória do processo.
   */
  async tentarReservarChamada(): Promise<boolean> {
    const resultado = await this.redis.set(
      'steam:inventory:slot',
      Date.now().toString(),
      'PX',
      InventoryCacheService.INTERVALO_MINIMO_MS,
      'NX',
    );

    return resultado === 'OK';
  }

  /**
   * Depois de um 429, para de tentar por alguns minutos — para o servidor
   * inteiro, já que o bloqueio da Steam é do nosso IP. Insistir durante o
   * castigo renova o prazo, então a única saída é esperar.
   */
  async marcarBloqueioSteam(): Promise<void> {
    await this.redis.set('steam:inventory:bloqueado', '1', 'EX', 300);
    this.logger.error('Inventário bloqueado por 5 minutos após 429 da Steam');
  }

  async estaBloqueado(): Promise<boolean> {
    return (await this.redis.exists('steam:inventory:bloqueado')) === 1;
  }

  private chave(steamId: string): string {
    return `inventory:${steamId}`;
  }
}
