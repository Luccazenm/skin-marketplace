import type { PriceMarket, PriceSource } from '@prisma/client';

/** Uma leitura de preço, já normalizada. */
export interface CotacaoBruta {
  marketHashName: string;
  market: PriceMarket;
  /** USD. Conversão é responsabilidade do adaptador. */
  price: number;
  bid?: number | null;
  ask?: number | null;
  volume24h?: number | null;
  /** Quando a FONTE apurou, não quando recebemos. */
  quotedAt: Date;
}

/**
 * O que um fornecedor de preço precisa saber fazer.
 *
 * Existe para que a escolha de fornecedor não vaze para o resto do
 * sistema. Nenhuma tela, nenhum job e nenhuma regra de negócio conhece
 * cs2.sh ou SteamWebAPI: conhecem `CotacaoBruta`. Trocar de fornecedor,
 * ou usar dois ao mesmo tempo, é acrescentar um arquivo.
 *
 * Isso não é abstração por gosto — é o que permite:
 * - juntar fontes, que exige um formato comum onde comparar;
 * - trocar quem cobrou caro demais sem reescrever a vitrine;
 * - testar tudo o que depende de preço sem rede.
 */
export interface PriceProvider {
  readonly source: PriceSource;

  /**
   * Preços dos itens pedidos.
   *
   * Recebe lote porque todo fornecedor cobra e limita por requisição:
   * pedir um a um estoura a cota e é ordens de grandeza mais lento.
   *
   * Item sem cotação é **omitido**, não devolvido com preço zero — zero
   * atravessaria o sistema e viraria "skin de graça" em alguma tela.
   */
  buscarPrecos(marketHashNames: string[]): Promise<CotacaoBruta[]>;
}

/** Token de injeção. Vários provedores podem ser registrados. */
export const PRICE_PROVIDERS = Symbol('PRICE_PROVIDERS');
