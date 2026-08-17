import { Injectable, Logger } from '@nestjs/common';
import { ItemCategory } from '@prisma/client';
import {
  comRaspagem,
  extrairAplicados,
  type AppliedItem,
} from './applied-items';
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
   * Desgaste real, de 0 a 1. `null` em item que não tem padrão próprio
   * (caixa, cápsula, agente) ou quando a Steam não mandou.
   *
   * Vem do próprio inventário, não do inspect link: a Valve passou a
   * entregar em `asset_properties`. É o que dispensa manter conta de
   * inspeção conectada ao jogo.
   */
  float: number | null;
  /** Semente do padrão. Define fase de Doppler, azul de Case Hardened. */
  paintSeed: number | null;
  /**
   * Link de inspeção com os placeholders já resolvidos, para abrir no
   * jogo. Não precisamos mais dele para obter float e padrão.
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
      items: this.combinar(
        corpo.assets,
        corpo.descriptions,
        corpo.asset_properties ?? [],
        steamId,
      ),
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
    propriedades: SteamAssetProperties[],
    steamId: string,
  ): InventoryItem[] {
    const porChave = new Map<string, SteamDescription>();

    for (const d of descriptions) {
      porChave.set(`${d.classid}_${d.instanceid ?? '0'}`, d);
    }

    // Estas vêm por assetid, não por classid: são do exemplar, não do
    // modelo. Dois itens da mesma skin têm floats diferentes.
    const porAsset = new Map<string, SteamAssetProperties>();

    for (const p of propriedades) {
      porAsset.set(p.assetid, p);
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

      const props = porAsset.get(asset.assetid);

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
        applied: comRaspagem(
          extrairAplicados(desc.descriptions),
          this.raspagens(props),
        ),
        rarity: this.tagExibicao(desc, 'Rarity'),
        exterior: this.tagExibicao(desc, 'Exterior'),
        typeLabel: this.tagExibicao(desc, 'Type'),
        float: this.propriedadeNumerica(props, PROP.FLOAT),
        paintSeed: this.propriedadeNumerica(props, PROP.PAINT_SEED),
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
   * Lê uma propriedade do exemplar.
   *
   * A Steam manda o número ora em `float_value`, ora em `int_value`, ora
   * como texto — e sempre como string. Valor que não vira número devolve
   * `null` em vez de `NaN`: `NaN` atravessaria o sistema em silêncio e
   * apareceria numa tela de preço.
   */
  private propriedadeNumerica(
    props: SteamAssetProperties | undefined,
    propertyId: number,
  ): number | null {
    const p = props?.asset_properties?.find((x) => x.propertyid === propertyId);

    if (!p) {
      return null;
    }

    const bruto = p.float_value ?? p.int_value ?? p.string_value;
    const n = Number(bruto);

    return bruto !== undefined && Number.isFinite(n) ? n : null;
  }

  /**
   * Raspagem de cada peça aplicada, na ordem em que a Steam devolve.
   * Confirmado contra inventário real: 0 é intacto.
   */
  private raspagens(props: SteamAssetProperties | undefined): number[] {
    const acessorios = props?.asset_accessories;

    if (!acessorios?.length) {
      return [];
    }

    return acessorios.map((a) => {
      const p = a.parent_relationship_properties?.find(
        (x) => x.propertyid === PROP.RASPAGEM,
      );
      const n = Number(p?.float_value);

      return Number.isFinite(n) ? n : 0;
    });
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

/**
 * Identificadores das propriedades por exemplar.
 *
 * São números mágicos da Valve, sem documentação — apurados contra
 * inventário real em 17/08/2026 e conferidos entre dois itens conhecidos.
 * Se a Valve renumerar, os testes quebram; é o comportamento desejado.
 */
const PROP = {
  PAINT_SEED: 1,
  FLOAT: 2,
  /** Inspect link auto-codificado. Guardado para uso futuro. */
  CERTIFICADO: 6,
  /** Raspagem, dentro de parent_relationship_properties do acessório. */
  RASPAGEM: 4,
} as const;

interface SteamInventoryResponse {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  /**
   * Dados do exemplar, por assetid: float, paint seed e as peças
   * aplicadas com a raspagem de cada uma.
   */
  asset_properties?: SteamAssetProperties[];
  total_inventory_count?: number;
}

interface SteamAssetProperties {
  assetid: string;
  asset_properties?: Array<{
    propertyid: number;
    float_value?: string;
    int_value?: string;
    string_value?: string;
    name?: string;
  }>;
  /** Stickers e patches aplicados, na ordem dos slots. */
  asset_accessories?: Array<{
    classid?: string;
    parent_relationship_properties?: Array<{
      propertyid: number;
      float_value?: string;
    }>;
  }>;
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
