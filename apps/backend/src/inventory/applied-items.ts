export type AppliedKind = 'STICKER' | 'PATCH' | 'CHARM';

/** Sticker, patch ou chaveiro aplicado a um item. */
export interface AppliedItem {
  kind: AppliedKind;
  name: string;
  imageUrl: string | null;
  /** Slot, na ordem em que a Steam devolve. Começa em 0. */
  position: number;
}

interface DescriptionBlock {
  name?: string;
  value?: string;
}

/**
 * Extrai o que está aplicado a um item.
 *
 * A Steam não entrega isso como dado estruturado: vem como um bloco de
 * HTML dentro de `descriptions`, com uma <img> por aplicação. Exemplo real:
 *
 *   <div id="sticker_info" ...><center>
 *     <img ... src="https://.../titan.png" title="Sticker: Titan | Katowice 2014">
 *     <br>Sticker: Hello AK-47 (Gold), Titan | Katowice 2014
 *   </center></div>
 *
 * Lemos as tags <img> em vez da linha de texto do final por dois motivos:
 * elas trazem a imagem junto, e o texto corrido separa os nomes por
 * vírgula — o que quebraria em qualquer sticker cujo nome contenha uma.
 *
 * Isto é parsing de HTML com expressão regular, o que normalmente seria
 * má ideia. Aqui é aceitável porque o HTML é gerado pela Steam num
 * formato fixo, e a alternativa seria carregar um parser inteiro para ler
 * uma tag. Se a Valve mudar o formato, os testes quebram — de propósito.
 */
export function extrairAplicados(
  blocos: DescriptionBlock[] | undefined,
): AppliedItem[] {
  if (!blocos?.length) {
    return [];
  }

  const aplicados: AppliedItem[] = [];

  for (const bloco of blocos) {
    if (!bloco.name || !bloco.value) {
      continue;
    }

    if (!BLOCOS_DE_APLICACAO.has(bloco.name)) {
      continue;
    }

    for (const img of bloco.value.matchAll(IMG_TAG)) {
      const tag = img[0];
      const src = ATRIBUTO_SRC.exec(tag)?.[1] ?? null;
      const title = ATRIBUTO_TITLE.exec(tag)?.[1];

      if (!title) {
        continue;
      }

      // O title vem como "Sticker: Nome", "Patch: Nome" ou "Charm: Nome".
      // O prefixo é a fonte do tipo — mais confiável que o nome do bloco,
      // que a Valve já mudou no passado (chaveiro vive em keychain_info
      // mas se identifica como "Charm").
      const separador = title.indexOf(':');

      if (separador === -1) {
        continue;
      }

      const prefixo = title.slice(0, separador).trim();
      const kind = PREFIXO_PARA_KIND[prefixo];

      if (!kind) {
        continue;
      }

      aplicados.push({
        kind,
        name: decodificarEntidades(title.slice(separador + 1).trim()),
        imageUrl: src,
        position: aplicados.filter((a) => a.kind === kind).length,
      });
    }
  }

  return aplicados;
}

const BLOCOS_DE_APLICACAO = new Set([
  'sticker_info',
  'keychain_info',
  'patch_info',
]);

const PREFIXO_PARA_KIND: Record<string, AppliedKind> = {
  Sticker: 'STICKER',
  Patch: 'PATCH',
  Charm: 'CHARM',
};

const IMG_TAG = /<img\b[^>]*>/g;

// Lidos separadamente da tag para não depender da ordem dos atributos.
const ATRIBUTO_SRC = /\bsrc="([^"]*)"/;
const ATRIBUTO_TITLE = /\btitle="([^"]*)"/;

/** Nome com "&" chega como "&amp;" por vir de dentro de HTML. */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}
