import { Injectable, Logger } from '@nestjs/common';
import { ItemCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapearItem,
  type EntradaCatalogo,
  type ItemBruto,
} from './catalog-mapping';

export interface ResultadoSync {
  lidos: number;
  criados: number;
  atualizados: number;
  /** Não negociável, sem nome de mercado, ou tipo que não guardamos. */
  descartados: number;
  falhas: number;
}

/**
 * Traz o catálogo de itens do CS2 para o nosso banco.
 *
 * Espelhamos em vez de consultar em tempo real por três motivos: a
 * vitrine precisa filtrar e ordenar, o que exige índice nosso; o preço se
 * pendura no nosso `SkinTemplate`, não num id de terceiro; e depender de
 * um repositório público a cada visita significaria vitrine fora do ar
 * quando ele estiver.
 *
 * Idempotente: rodar de novo atualiza o que mudou e não duplica nada.
 */
@Injectable()
export class CatalogSyncService {
  private static readonly BASE =
    'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';

  /**
   * `skins_not_grouped` é a lista com cada exterior como entrada própria
   * — "Redline (Field-Tested)" separado de "(Minimal Wear)". É o que
   * corresponde ao `market_hash_name` da Steam, e é assim que o mercado
   * cota. A versão agrupada juntaria preços que são diferentes.
   */
  private static readonly ARQUIVOS: Array<[string, ItemCategory | undefined]> =
    [
      // Sem categoria padrão: a arma sai do nome e do campo `weapon`.
      ['skins_not_grouped', undefined],
      ['stickers', ItemCategory.STICKER],
      ['crates', ItemCategory.CONTAINER],
      ['agents', ItemCategory.AGENT],
      ['keychains', ItemCategory.CHARM],
      ['patches', ItemCategory.PATCH],
      ['graffiti', ItemCategory.GRAFFITI],
      ['music_kits', ItemCategory.MUSIC_KIT],
      ['keys', ItemCategory.KEY],
    ];

  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sincronizar(
    aoProgredir?: (arquivo: string, r: ResultadoSync) => void,
  ): Promise<ResultadoSync> {
    const total: ResultadoSync = {
      lidos: 0,
      criados: 0,
      atualizados: 0,
      descartados: 0,
      falhas: 0,
    };

    for (const [arquivo, categoria] of CatalogSyncService.ARQUIVOS) {
      const itens = await this.baixar(arquivo);
      const r = await this.gravar(itens, categoria);

      total.lidos += r.lidos;
      total.criados += r.criados;
      total.atualizados += r.atualizados;
      total.descartados += r.descartados;
      total.falhas += r.falhas;

      aoProgredir?.(arquivo, r);
    }

    return total;
  }

  private async baixar(arquivo: string): Promise<ItemBruto[]> {
    const url = `${CatalogSyncService.BASE}/${arquivo}.json`;

    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    });

    if (!resposta.ok) {
      throw new Error(`${arquivo}.json respondeu ${resposta.status}`);
    }

    const corpo = (await resposta.json()) as
      ItemBruto[] | Record<string, ItemBruto>;

    // Alguns arquivos vêm como objeto indexado por id em vez de lista.
    return Array.isArray(corpo) ? corpo : Object.values(corpo);
  }

  private async gravar(
    itens: ItemBruto[],
    categoriaDoArquivo?: ItemCategory,
  ): Promise<ResultadoSync> {
    const r: ResultadoSync = {
      lidos: itens.length,
      criados: 0,
      atualizados: 0,
      descartados: 0,
      falhas: 0,
    };

    // O dataset repete o mesmo market_hash_name em arquivos diferentes;
    // deduplicar antes evita ida e volta ao banco à toa.
    const porNome = new Map<string, EntradaCatalogo>();

    for (const bruto of itens) {
      const entrada = mapearItem(bruto, categoriaDoArquivo);

      if (!entrada) {
        r.descartados++;
        continue;
      }

      porNome.set(entrada.marketHashName, entrada);
    }

    for (const entrada of porNome.values()) {
      try {
        const { marketHashName, ...campos } = entrada;

        // Upsert em vez de create: o dataset muda (imagem nova, raridade
        // corrigida) e rodar de novo tem que refletir isso sem duplicar.
        //
        // NÃO tocamos em referencePrice, buyoutEligible nem
        // buyoutDiscountPct: são decisões nossas, e uma sincronização de
        // catálogo não pode desfazer whitelist do fluxo rápido.
        const antes = await this.prisma.skinTemplate.findUnique({
          where: { marketHashName },
          select: { id: true },
        });

        await this.prisma.skinTemplate.upsert({
          where: { marketHashName },
          create: { marketHashName, ...campos },
          update: campos,
        });

        if (antes) {
          r.atualizados++;
        } else {
          r.criados++;
        }
      } catch (erro) {
        // Uma linha recusada não pode abortar 36 mil. Loga e segue: o
        // contador de falhas é o que denuncia mapeamento errado.
        r.falhas++;
        this.logger.warn(
          `Falha em "${entrada.marketHashName}" (${entrada.category}): ${String(erro)}`,
        );
      }
    }

    return r;
  }
}
