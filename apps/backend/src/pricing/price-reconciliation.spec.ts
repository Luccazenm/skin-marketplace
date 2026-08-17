import { PriceMarket } from '@prisma/client';
import { precoRecomendado, type Cotacao } from './price-reconciliation';

/**
 * É esta função que decide o número que o usuário vê antes de vender uma
 * skin. Errar aqui não quebra o sistema — faz alguém aceitar menos do que
 * o item vale, que é pior, porque ninguém percebe.
 */
describe('precoRecomendado', () => {
  const AGORA = new Date('2026-08-17T12:00:00Z');

  const cotacao = (
    market: PriceMarket,
    price: number,
    minutosAtras = 0,
  ): Cotacao => ({
    market,
    price,
    quotedAt: new Date(AGORA.getTime() - minutosAtras * 60_000),
  });

  const resolver = (cotacoes: Cotacao[]) =>
    precoRecomendado(cotacoes, { agora: AGORA });

  describe('escolha do mercado', () => {
    // BUFF é o mercado mais líquido e a âncora que o resto usa.
    it('prefere BUFF163 quando disponível', () => {
      const r = resolver([
        cotacao(PriceMarket.SKINPORT, 120),
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.CSFLOAT, 110),
      ]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;

      expect(r.market).toBe(PriceMarket.BUFF163);
      expect(r.price).toBe(100);
    });

    // Steam infla porque o saldo de lá não é sacável — é último recurso,
    // nunca referência.
    it('só usa Steam quando não há mais nada', () => {
      const r = resolver([
        cotacao(PriceMarket.STEAM, 150),
        cotacao(PriceMarket.SKINPORT, 120),
      ]);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    it('aceita Steam sozinha, em vez de não mostrar nada', () => {
      const r = resolver([cotacao(PriceMarket.STEAM, 150)]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.STEAM);
    });

    // Média entre mercados de liquidez diferente produz um número que não
    // existe em lugar nenhum.
    it('não faz média: devolve o preço de um mercado real', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.SKINPORT, 130),
      ]);

      if (!r.ok) return;
      expect(r.price).toBe(100);
      expect(r.price).not.toBe(115);
    });

    it('devolve as outras como referência, sem misturar', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.SKINPORT, 130),
        cotacao(PriceMarket.CSFLOAT, 125),
      ]);

      if (!r.ok) return;
      expect(r.referencias.map((c) => c.market).sort()).toEqual(
        [PriceMarket.CSFLOAT, PriceMarket.SKINPORT].sort(),
      );
    });
  });

  describe('cotação velha', () => {
    it('descarta a que passou da idade máxima', () => {
      const r = precoRecomendado(
        [
          cotacao(PriceMarket.BUFF163, 100, 180),
          cotacao(PriceMarket.SKINPORT, 130, 5),
        ],
        { agora: AGORA, idadeMaximaMs: 60 * 60 * 1000 },
      );

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    // Preço de ontem numa tela de venda é reclamação com razão.
    it('recusa quando todas estão velhas', () => {
      const r = precoRecomendado(
        [
          cotacao(PriceMarket.BUFF163, 100, 300),
          cotacao(PriceMarket.SKINPORT, 130, 400),
        ],
        { agora: AGORA, idadeMaximaMs: 60 * 60 * 1000 },
      );

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('todas_velhas');
      // As velhas voltam como referência: servem para investigar depois.
      expect(r.referencias).toHaveLength(2);
    });
  });

  describe('divergência entre fontes', () => {
    // Divergência grande é dado furado, item sem liquidez ou erro do
    // fornecedor — nunca uma oportunidade.
    it('recusa quando as fontes discordam demais', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.SKINPORT, 300),
      ]);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('fontes_divergem');
    });

    it('aceita diferença dentro do limite', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.SKINPORT, 130),
      ]);

      expect(r.ok).toBe(true);
    });

    // Compara extremos, não média: duas coerentes e uma absurda ainda é
    // motivo para não exibir, e a média a acomodaria.
    it('pega a fonte absurda mesmo entre duas coerentes', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.CSFLOAT, 105),
        cotacao(PriceMarket.SKINPORT, 900),
      ]);

      expect(r.ok).toBe(false);
    });

    it('não recusa item que só existe num mercado', () => {
      const r = resolver([cotacao(PriceMarket.BUFF163, 100)]);

      expect(r.ok).toBe(true);
    });

    it('respeita o limite configurado', () => {
      const cotacoes = [
        cotacao(PriceMarket.BUFF163, 100),
        cotacao(PriceMarket.SKINPORT, 150),
      ];

      expect(
        precoRecomendado(cotacoes, { agora: AGORA, divergenciaMaxima: 0.6 }).ok,
      ).toBe(true);
      expect(
        precoRecomendado(cotacoes, { agora: AGORA, divergenciaMaxima: 0.1 }).ok,
      ).toBe(false);
    });
  });

  describe('entrada degenerada', () => {
    it('recusa sem cotação nenhuma', () => {
      const r = resolver([]);

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('sem_cotacao');
    });

    // Preço zero ou negativo é erro de fornecedor, não item de graça.
    it.each([0, -5])('ignora preço %p', (price) => {
      const r = resolver([cotacao(PriceMarket.BUFF163, price)]);

      expect(r.ok).toBe(false);
    });

    it('usa a cotação boa quando a outra veio zerada', () => {
      const r = resolver([
        cotacao(PriceMarket.BUFF163, 0),
        cotacao(PriceMarket.SKINPORT, 130),
      ]);

      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.SKINPORT);
    });

    it('não estoura com mercado fora da lista de preferência', () => {
      const r = resolver([cotacao(PriceMarket.NEXTSKINS, 100)]);

      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.market).toBe(PriceMarket.NEXTSKINS);
    });
  });
});
