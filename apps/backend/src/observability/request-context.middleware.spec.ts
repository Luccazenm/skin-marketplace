import type { NextFunction, Request, Response } from 'express';
import { currentContext, enrichContext } from './request-context';
import { requestContextMiddleware } from './request-context.middleware';

describe('requestContextMiddleware', () => {
  const request = (headers: Record<string, string> = {}): Request =>
    ({
      headers,
      ip: '203.0.113.9',
      method: 'GET',
      path: '/api/inventory',
    }) as unknown as Request;

  const response = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      res: {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      } as unknown as Response,
    };
  };

  it('opens the context with the request data', () => {
    const { res } = response();
    let seen: ReturnType<typeof currentContext>;

    requestContextMiddleware(request(), res, (() => {
      seen = currentContext();
    }) as NextFunction);

    expect(seen!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen!.ip).toBe('203.0.113.9');
    expect(seen!.method).toBe('GET');
    expect(seen!.path).toBe('/api/inventory');
  });

  // Returned to the client: it becomes the ticket number the user can
  // quote when reporting an error.
  it('returns the id in the response header', () => {
    const { headers, res } = response();

    requestContextMiddleware(request(), res, (() => {}) as NextFunction);

    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  // Same id at the proxy and here: that is what lets you follow one
  // request across the layers.
  it('reuses the id sent by the proxy', () => {
    const { headers, res } = response();
    let seen: ReturnType<typeof currentContext>;

    requestContextMiddleware(
      request({ 'x-request-id': 'proxy-abc-123' }),
      res,
      (() => {
        seen = currentContext();
      }) as NextFunction,
    );

    expect(seen!.requestId).toBe('proxy-abc-123');
    expect(headers['x-request-id']).toBe('proxy-abc-123');
  });

  describe('id from outside with an invalid shape', () => {
    // Without validating, someone would inject a line break and forge
    // entries in the log — ruining the very investigation it supports.
    it.each([
      ['with a line break', 'abc\n{"level":"info","msg":"forged"}'],
      ['too short', 'abc'],
      ['with a space', 'fake id'],
      ['too long', 'x'.repeat(200)],
    ])('generates a new one when the id comes %s', (_case, value) => {
      const { res } = response();
      let seen: ReturnType<typeof currentContext>;

      requestContextMiddleware(request({ 'x-request-id': value }), res, (() => {
        seen = currentContext();
      }) as NextFunction);

      expect(seen!.requestId).not.toBe(value);
      expect(seen!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('gives different ids to different requests', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 3; i++) {
      const { res } = response();
      requestContextMiddleware(request(), res, (() => {
        ids.add(currentContext()!.requestId);
      }) as NextFunction);
    }

    expect(ids.size).toBe(3);
  });

  describe('enrichContext', () => {
    // The guard uses this: when the request arrives we do not know who it
    // is, and the userId only exists after authenticating.
    it('adds the userId to the open context', () => {
      const { res } = response();
      let seen: ReturnType<typeof currentContext>;

      requestContextMiddleware(request(), res, (() => {
        enrichContext({ userId: 'user-789' });
        seen = currentContext();
      }) as NextFunction);

      expect(seen!.userId).toBe('user-789');
      // Does not erase what was already there
      expect(seen!.ip).toBe('203.0.113.9');
    });

    it('does not blow up outside a request', () => {
      expect(() => enrichContext({ userId: 'x' })).not.toThrow();
    });
  });
});
