import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PriceMarket, type PriceSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CotacaoBruta } from './price-provider';
import { precoRecomendado, type Cotacao } from './price-reconciliation';

export interface ResultadoCaptura {
  gravadas: number;
  /** Já existiam: rodar o job duas vezes não duplica a série. */
  repetidas: number;
  /** Sem `SkinTemplate` correspondente no nosso catálogo. */
  semTemplate: number;
}

/**
 * Grava e lê a série histórica de preços.
 *
 * A série é **append-only**: nunca editar linha existente. Cada snapshot
 * é o registro de que, naquele instante, aquela fonte dizia aquele preço.
 * Reescrever apagaria a prova do que foi mostrado ao usuário — que é
 * metade do motivo de esta tabela existir. A outra metade é o gráfico,
 * que ninguém consegue construir para trás.
 */
@Injectable()
export class PriceHistoryService {
  private readonly logger = new Logger(PriceHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um lote de cotações.
   *
   * Ignora repetição em vez de falhar: o job pode rodar de novo depois de
   * uma queda no meio, e a alternativa seria abortar a captura inteira
   * por causa de uma linha que já existia.
   */
  async registrar(
    source: PriceSource,
    cotacoes: CotacaoBruta[],
  ): Promise<ResultadoCaptura> {
    if (cotacoes.length === 0) {
      return { gravadas: 0, repetidas: 0, semTemplate: 0 };
    }

    const nomes = [...new Set(cotacoes.map((c) => c.marketHashName))];

    const templates = await this.prisma.skinTemplate.findMany({
      where: { marketHashName: { in: nomes } },
      select: { id: true, marketHashName: true },
    });

    const idPorNome = new Map(templates.map((t) => [t.marketHashName, t.id]));

    let gravadas = 0;
    let repetidas = 0;
    let semTemplate = 0;

    for (const c of cotacoes) {
      const skinTemplateId = idPorNome.get(c.marketHashName);

      // Item que ainda não está no catálogo. Não é erro: o fornecedor
      // conhece o jogo inteiro e nós só o que já apareceu por aqui.
      if (!skinTemplateId) {
        semTemplate++;
        continue;
      }

      try {
        await this.prisma.priceSnapshot.create({
          data: {
            skinTemplateId,
            source,
            market: c.market,
            price: new Prisma.Decimal(c.price),
            bid: c.bid != null ? new Prisma.Decimal(c.bid) : null,
            ask: c.ask != null ? new Prisma.Decimal(c.ask) : null,
            volume24h: c.volume24h ?? null,
            quotedAt: c.quotedAt,
          },
        });
        gravadas++;
      } catch (erro) {
        if (
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === 'P2002'
        ) {
          repetidas++;
          continue;
        }

        throw erro;
      }
    }

    this.logger.log(
      `Captura de ${source}: ${gravadas} gravadas, ${repetidas} repetidas, ` +
        `${semTemplate} sem template`,
    );

    return { gravadas, repetidas, semTemplate };
  }

  /**
   * Preço a exibir para um item, a partir da última leitura de cada
   * mercado.
   *
   * Lê do nosso banco, nunca do fornecedor. Chamar a API externa aqui
   * significaria estourar a cota na primeira dúzia de visitantes, somar
   * centenas de milissegundos a cada página, e derrubar a vitrine junto
   * com o fornecedor no dia em que ele cair.
   */
  async precoAtual(
    skinTemplateId: string,
    opcoes: { idadeMaximaMs?: number } = {},
  ) {
    const recentes = await this.prisma.priceSnapshot.findMany({
      where: { skinTemplateId },
      orderBy: { quotedAt: 'desc' },
      // Cobre com folga uma leitura por mercado; o filtro por mercado
      // acontece abaixo, já em memória.
      take: 50,
    });

    const porMercado = new Map<PriceMarket, Cotacao>();

    for (const s of recentes) {
      if (porMercado.has(s.market)) {
        continue;
      }

      porMercado.set(s.market, {
        market: s.market,
        price: Number(s.price),
        quotedAt: s.quotedAt,
        volume24h: s.volume24h,
      });
    }

    return precoRecomendado([...porMercado.values()], opcoes);
  }

  /** Série de um mercado, para o gráfico. */
  async serie(skinTemplateId: string, market: PriceMarket, desde: Date) {
    return this.prisma.priceSnapshot.findMany({
      where: { skinTemplateId, market, quotedAt: { gte: desde } },
      orderBy: { quotedAt: 'asc' },
      select: { price: true, volume24h: true, quotedAt: true },
    });
  }
}
