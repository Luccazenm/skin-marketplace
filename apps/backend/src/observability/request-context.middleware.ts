import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext } from './request-context';

/** Header used by proxies and load balancers to propagate the id. */
const HEADER = 'x-request-id';

/** Accepted shape: stops a client from injecting arbitrary text into logs. */
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Opens the request context and returns the id in the response header.
 *
 * Reuses the `x-request-id` already coming from the proxy — that way the
 * same id ties the proxy's log to ours, and the user can quote it when
 * reporting an error. A value from outside is only accepted if its shape
 * is harmless: otherwise someone could inject line breaks and forge
 * entries in the log.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const received = req.headers[HEADER];
  const provided = Array.isArray(received) ? received[0] : received;

  const requestId =
    provided && VALID_ID.test(provided) ? provided : randomUUID();

  // Returned to the client: it is the ticket number for support.
  res.setHeader(HEADER, requestId);

  runWithContext(
    {
      requestId,
      ip: req.ip,
      method: req.method,
      path: req.path,
    },
    () => next(),
  );
}
