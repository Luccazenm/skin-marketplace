import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { executarComContexto } from './request-context';

/** Cabeçalho usado por proxies e balanceadores para propagar o id. */
const HEADER = 'x-request-id';

/** Formato aceito: evita que um cliente injete texto arbitrário no log. */
const ID_VALIDO = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Abre o contexto da requisição e devolve o id no cabeçalho da resposta.
 *
 * Reaproveita o `x-request-id` que já venha do proxy — assim o mesmo id
 * liga o log do proxy ao nosso, e o usuário pode informá-lo ao reclamar de
 * um erro. Um valor vindo de fora só é aceito se tiver formato inofensivo:
 * caso contrário alguém poderia injetar quebras de linha e forjar entradas
 * no log.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const recebido = req.headers[HEADER];
  const informado = Array.isArray(recebido) ? recebido[0] : recebido;

  const requestId =
    informado && ID_VALIDO.test(informado) ? informado : randomUUID();

  // Devolvido para o cliente: é o número de protocolo do atendimento.
  res.setHeader(HEADER, requestId);

  executarComContexto(
    {
      requestId,
      ip: req.ip,
      method: req.method,
      path: req.path,
    },
    () => next(),
  );
}
