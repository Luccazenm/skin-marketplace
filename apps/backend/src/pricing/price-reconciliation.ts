import { PriceMarket } from '@prisma/client';

/** Uma leitura de preço, já normalizada pelo adaptador da fonte. */
export interface Cotacao {
  market: PriceMarket;
  /** USD. */
  price: number;
  /** Quando a fonte apurou — não quando nós gravamos. */
  quotedAt: Date;
  volume24h?: number | null;
}

export type MotivoSemPreco = 'sem_cotacao' | 'todas_velhas' | 'fontes_divergem';

export type PrecoRecomendado =
  | {
      ok: true;
      /** USD. */
      price: number;
      /** De onde saiu o número exibido. */
      market: PriceMarket;
      quotedAt: Date;
      /** As demais, para exibir ao lado — nunca somadas na média. */
      referencias: Cotacao[];
    }
  | { ok: false; motivo: MotivoSemPreco; referencias: Cotacao[] };

/**
 * Ordem de preferência do preço de referência.
 *
 * BUFF163 primeiro porque é o mercado mais líquido do CS2 e o que o
 * resto do mercado usa como âncora. Steam por último: o preço de lá é
 * inflado, porque o saldo não é sacável — serve como último recurso, não
 * como referência.
 */
const PREFERENCIA: PriceMarket[] = [
  PriceMarket.BUFF163,
  PriceMarket.YOUPIN,
  PriceMarket.C5GAME,
  PriceMarket.CSFLOAT,
  PriceMarket.SKINPORT,
  PriceMarket.DMARKET,
  PriceMarket.WAXPEER,
  PriceMarket.BITSKINS,
  PriceMarket.STEAM,
];

export interface OpcoesReconciliacao {
  /** Cotação mais velha que isto não é exibida. */
  idadeMaximaMs?: number;
  /** Divergência acima disto (0,4 = 40%) faz recusar. */
  divergenciaMaxima?: number;
  agora?: Date;
}

/**
 * Escolhe o preço a exibir a partir de várias fontes.
 *
 * Três decisões, todas com o mesmo viés: **não exibir preço é melhor que
 * exibir preço errado.** Quem vê "US$ 340" fecha negócio com base nisso;
 * quem vê "preço indisponível" pergunta.
 *
 * 1. **Não faz média.** Mercados têm liquidez muito diferente, e a média
 *    entre eles produz um número que não existe em lugar nenhum. Escolhe
 *    um mercado e mostra os outros ao lado.
 * 2. **Descarta cotação velha.** Preço de ontem numa tela de venda é
 *    reclamação com razão.
 * 3. **Recusa quando as fontes discordam demais.** Divergência grande é
 *    dado furado, item sem liquidez ou erro do fornecedor — nunca uma
 *    oportunidade.
 */
export function precoRecomendado(
  cotacoes: Cotacao[],
  opcoes: OpcoesReconciliacao = {},
): PrecoRecomendado {
  const {
    idadeMaximaMs = 60 * 60 * 1000,
    divergenciaMaxima = 0.4,
    agora = new Date(),
  } = opcoes;

  if (cotacoes.length === 0) {
    return { ok: false, motivo: 'sem_cotacao', referencias: [] };
  }

  const frescas = cotacoes.filter(
    (c) =>
      c.price > 0 && agora.getTime() - c.quotedAt.getTime() <= idadeMaximaMs,
  );

  if (frescas.length === 0) {
    return { ok: false, motivo: 'todas_velhas', referencias: cotacoes };
  }

  // Uma fonte só: não há com o que comparar. Vale exibir — a alternativa
  // seria nunca mostrar preço de item que só existe num mercado.
  if (frescas.length > 1 && divergem(frescas, divergenciaMaxima)) {
    return { ok: false, motivo: 'fontes_divergem', referencias: frescas };
  }

  const escolhida = maisPreferida(frescas);

  return {
    ok: true,
    price: escolhida.price,
    market: escolhida.market,
    quotedAt: escolhida.quotedAt,
    referencias: frescas.filter((c) => c.market !== escolhida.market),
  };
}

/**
 * Compara o menor com o maior, não com a média: duas fontes coerentes e
 * uma absurda ainda é motivo para não exibir, e a média as acomodaria.
 */
function divergem(cotacoes: Cotacao[], limite: number): boolean {
  const precos = cotacoes.map((c) => c.price);
  const menor = Math.min(...precos);
  const maior = Math.max(...precos);

  return (maior - menor) / menor > limite;
}

function maisPreferida(cotacoes: Cotacao[]): Cotacao {
  for (const market of PREFERENCIA) {
    const achada = cotacoes.find((c) => c.market === market);

    if (achada) {
      return achada;
    }
  }

  // Mercado que ainda não entrou na lista de preferência. Melhor exibir
  // com o mais recente do que não exibir por causa de um enum novo.
  return [...cotacoes].sort(
    (a, b) => b.quotedAt.getTime() - a.quotedAt.getTime(),
  )[0];
}
