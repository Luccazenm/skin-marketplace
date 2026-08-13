import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Identificador desta requisição. Aparece em todo log dela. */
  requestId: string;
  /** Preenchido pelo guard, depois de autenticar. */
  userId?: string;
  ip?: string;
  method?: string;
  path?: string;
}

/**
 * Contexto da requisição em curso, acessível de qualquer profundidade.
 *
 * Existe para que um log escrito lá no fundo de um serviço saia com o
 * identificador da requisição sem que todo método precise receber isso
 * como parâmetro. Sem ele, os logs de uma falha ficam espalhados no meio
 * dos de todas as outras requisições que aconteciam ao mesmo tempo.
 *
 * AsyncLocalStorage sobrevive a await e callback, então o contexto
 * atravessa a cadeia inteira de chamadas assíncronas.
 */
const armazenamento = new AsyncLocalStorage<RequestContext>();

export function executarComContexto<T>(
  contexto: RequestContext,
  fn: () => T,
): T {
  return armazenamento.run(contexto, fn);
}

export function contextoAtual(): RequestContext | undefined {
  return armazenamento.getStore();
}

/**
 * Acrescenta dados ao contexto já aberto.
 *
 * Usado pelo guard: quando a requisição chega não se sabe quem é, e o
 * userId só aparece depois da autenticação. Sem isto, os logs anteriores
 * ao guard ficariam sem dono — o que é correto, e os posteriores passam a
 * ter.
 */
export function enriquecerContexto(dados: Partial<RequestContext>): void {
  const atual = armazenamento.getStore();

  if (atual) {
    Object.assign(atual, dados);
  }
}
