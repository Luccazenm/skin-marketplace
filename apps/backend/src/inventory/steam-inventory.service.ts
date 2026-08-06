import { Injectable, Logger } from '@nestjs/common';
import { ItemCategory } from '@prisma/client';
import { extrairAplicados, type AppliedItem } from './applied-items';
import {
  categoriaDe,
  motivoBloqueio,
  nuncaNegociavel,
  temPadraoUnico,
  type MotivoBloqueio,
} from './item-category';

/** Um item do inventário, já com asset e descrição combinados. */
export interface InventoryItem {
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  iconUrl: string | null;
  /** Categoria derivada da tag Type — não do nome do item. */
  category: ItemCategory;
  /** Negociável agora, segundo a Steam. */
  tradable: boolean;
  marketable: boolean;
  /** Pode ser depositado aqui: negociável e não bloqueado para sempre. */
  depositable: boolean;
  /**
   * Por que não pode ser depositado. 'permanente' para medalhas e afins,
   * 'trade_lock' para item que só está esperando os 7 dias da Valve.
   */
  blockReason: MotivoBloqueio | null;
  /** Tem float e paint seed próprios (arma, faca, luva). */
  hasUniquePattern: boolean;
  /**
   * Stickers, patches e chaveiros aplicados.
   *
   * Diferencia exemplares tanto quanto o float — e às vezes mais: uma AK
   * com quatro Katowice 2014 vale ordens de grandeza acima do preço da
   * skin limpa. Também é o que torna um agente com patches distinto de um
   * agente comum, apesar de agente não ter float.
   */
  applied: AppliedItem[];
  /** Rótulos traduzidos, só para exibição. */
  rarity: string | null;
  exterior: string | null;
  typeLabel: string | null;
  /**
   * Link de inspeção com os placeholders já resolvidos.
   * É por aqui que float e paint seed são obtidos mais tarde — eles NÃO
   * vêm no inventário.
   */
  inspectLink: string | null;
}

export type InventoryResult =
  | { status: 'ok'; items: InventoryItem[] }
  /** Inventário privado ou perfil restrito. */
  | { status: 'private' }
  /** Estouro do limite por IP. Ver comentário na classe. */
  | { status: 'rate_limited' }
  | { status: 'error'; message: string };

/**
 * Lê o inventário de CS2 de um usuário.
 *
 * ATENÇÃO — limite por IP:
 * Este endpoint é público e não usa API key. A Steam limita por endereço
 * IP, e o IP aqui é o do NOSSO servidor: um usuário insistindo em
 * recarregar pode fazer a Steam bloquear todos os outros por horas.
 *
 * Este serviço faz a chamada crua e nada mais. Cache e controle de
 * frequência entram na camada acima — chamar isto direto em um handler de
 * requisição é pedir para tomar 429.
 */
@Injectable()
export class SteamInventoryService {
  /** 730 = CS2. Contexto 2 é onde ficam os itens negociáveis. */
  private static readonly APP_ID = 730;
  private static readonly CONTEXT_ID = 2;

  /**
   * A comunidade convergiu para 2000 como teto seguro; acima disso o
   * bloqueio vem mais rápido. Inventário maior exige paginação.
   */
  private static readonly COUNT = 2000;

  private readonly logger = new Logger(SteamInventoryService.name);

  async fetchInventory(steamId: string): Promise<InventoryResult> {
    const url =
      `https://steamcommunity.com/inventory/${steamId}` +
      `/${SteamInventoryService.APP_ID}/${SteamInventoryService.CONTEXT_ID}` +
      `?l=english&count=${SteamInventoryService.COUNT}`;

    let resposta: Response;

    try {
      resposta = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (erro) {
      this.logger.warn(`Falha de rede ao ler inventário: ${String(erro)}`);
      return { status: 'error', message: 'Steam não respondeu a tempo' };
    }

    if (resposta.status === 429) {
      // Não é erro do usuário: é o nosso IP que estourou a cota.
      this.logger.error(
        'Steam retornou 429 — limite de inventário por IP atingido',
      );
      return { status: 'rate_limited' };
    }

    // Perfil ou inventário privado devolve 403. A Steam também usa 401
    // quando o perfil está restrito de outras formas.
    if (resposta.status === 403 || resposta.status === 401) {
      return { status: 'private' };
    }

    if (!resposta.ok) {
      this.logger.warn(`Steam respondeu ${resposta.status} no inventário`);
      return {
        status: 'error',
        message: `Steam respondeu ${resposta.status}`,
      };
    }

    const corpo = (await resposta.json()) as SteamInventoryResponse | null;

    // Inventário vazio devolve success sem os arrays — não é erro.
    if (!corpo?.assets || !corpo.descriptions) {
      return { status: 'ok', items: [] };
    }

    return {
      status: 'ok',
      items: this.combinar(corpo.assets, corpo.descriptions, steamId),
    };
  }

  /**
   * A Steam devolve duas listas separadas: `assets` são as instâncias que a
   * pessoa possui, `descriptions` são os metadados compartilhados. Vários
   * assets apontam para a mesma description — é assim que 50 caixas iguais
   * não repetem 50 vezes nome, imagem e tags.
   *
   * A ligação é feita por classid + instanceid.
   */
  private combinar(
    assets: SteamAsset[],
    descriptions: SteamDescription[],
    steamId: string,
  ): InventoryItem[] {
    const porChave = new Map<string, SteamDescription>();

    for (const d of descriptions) {
      porChave.set(`${d.classid}_${d.instanceid ?? '0'}`, d);
    }

    const itens: InventoryItem[] = [];

    for (const asset of assets) {
      const desc = porChave.get(`${asset.classid}_${asset.instanceid ?? '0'}`);

      // Sem descrição não há como identificar a skin; ignorar é melhor do
      // que devolver um item pela metade.
      if (!desc) {
        continue;
      }

      const tipoInterno = this.tagInterna(desc, 'Type');
      const category = categoriaDe(tipoInterno);
      const tradable = desc.tradable === 1;

      if (category === ItemCategory.OTHER && tipoInterno) {
        // Tipo novo da Valve ou algo que passou despercebido. Logamos para
        // aparecer no mapeamento em vez de sumir silenciosamente.
        this.logger.warn(`Tipo de item não mapeado: ${tipoInterno}`);
      }

      itens.push({
        assetId: asset.assetid,
        classId: asset.classid,
        instanceId: asset.instanceid ?? '0',
        marketHashName: desc.market_hash_name,
        iconUrl: desc.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${desc.icon_url}`
          : null,
        category,
        tradable,
        marketable: desc.marketable === 1,
        depositable: tradable && !nuncaNegociavel(category),
        blockReason: motivoBloqueio(category, tradable),
        hasUniquePattern: temPadraoUnico(category),
        applied: extrairAplicados(desc.descriptions),
        rarity: this.tagExibicao(desc, 'Rarity'),
        exterior: this.tagExibicao(desc, 'Exterior'),
        typeLabel: this.tagExibicao(desc, 'Type'),
        inspectLink: this.inspectLink(desc, steamId, asset.assetid),
      });
    }

    return itens;
  }

  /**
   * Valor NÃO traduzido da tag — é o que serve para lógica.
   * `localized_tag_name` muda com o idioma da requisição; `internal_name`
   * não. Usar o traduzido faria a classificação quebrar em silêncio se o
   * parâmetro `l=english` mudasse.
   */
  private tagInterna(desc: SteamDescription, categoria: string): string | null {
    return (
      desc.tags?.find((t) => t.category === categoria)?.internal_name ?? null
    );
  }

  /** Valor traduzido — só para exibição. */
  private tagExibicao(
    desc: SteamDescription,
    categoria: string,
  ): string | null {
    return (
      desc.tags?.find((t) => t.category === categoria)?.localized_tag_name ??
      null
    );
  }

  /**
   * O link vem com placeholders que a Steam espera que o cliente troque:
   *   ...+csgo_econ_action_preview S%owner_steamid%A%assetid%D123456
   */
  private inspectLink(
    desc: SteamDescription,
    steamId: string,
    assetId: string,
  ): string | null {
    const link = desc.actions?.find((a) =>
      a.link?.includes('csgo_econ_action_preview'),
    )?.link;

    if (!link) {
      return null;
    }

    return link
      .replace('%owner_steamid%', steamId)
      .replace('%assetid%', assetId);
  }
}

// ---- Formato cru devolvido pela Steam ----

interface SteamInventoryResponse {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  total_inventory_count?: number;
}

interface SteamAsset {
  assetid: string;
  classid: string;
  instanceid?: string;
  amount: string;
}

interface SteamDescription {
  classid: string;
  instanceid?: string;
  market_hash_name: string;
  icon_url?: string;
  tradable?: number;
  marketable?: number;
  tags?: Array<{
    category: string;
    /** Estável, não traduzido — ex: "CSGO_Type_Rifle". Use para lógica. */
    internal_name?: string;
    /** Traduzido — ex: "Rifle". Use apenas para exibir. */
    localized_tag_name?: string;
  }>;
  /**
   * Blocos de texto e HTML. É aqui que vêm os stickers, patches e
   * chaveiros aplicados, embutidos em HTML — ver applied-items.ts.
   */
  descriptions?: Array<{ name?: string; value?: string; type?: string }>;
  actions?: Array<{ link?: string; name?: string }>;
}
