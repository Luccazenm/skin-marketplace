import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Identifier for this request. Appears in every log line it produces. */
  requestId: string;
  /** Filled in by the guard, after authenticating. */
  userId?: string;
  ip?: string;
  method?: string;
  path?: string;
}

/**
 * Context of the request in flight, reachable from any depth.
 *
 * It exists so that a log written deep inside a service carries the
 * request identifier without every method having to take it as a
 * parameter. Without it, the logs of one failure end up scattered among
 * those of every other request happening at the same time.
 *
 * AsyncLocalStorage survives await and callbacks, so the context travels
 * the entire chain of asynchronous calls.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Adds data to the context already open.
 *
 * Used by the guard: when a request arrives we do not know who it is, and
 * the userId only appears after authentication. Without this, logs before
 * the guard would have no owner — which is correct — and the ones after
 * it gain one.
 */
export function enrichContext(data: Partial<RequestContext>): void {
  const current = storage.getStore();

  if (current) {
    Object.assign(current, data);
  }
}
