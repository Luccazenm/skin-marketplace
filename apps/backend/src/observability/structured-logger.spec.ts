import { StructuredLogger } from './structured-logger';
import { runWithContext } from './request-context';

describe('StructuredLogger', () => {
  let written: string[];
  let stdoutMock: jest.SpyInstance;
  let logger: StructuredLogger;

  const lastLine = () =>
    JSON.parse(written[written.length - 1]) as Record<string, unknown>;

  beforeEach(() => {
    written = [];
    stdoutMock = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });

    logger = new StructuredLogger(true);
  });

  afterEach(() => {
    stdoutMock.mockRestore();
  });

  it('emits one JSON line per event', () => {
    logger.log('test message', 'MyService');

    expect(written).toHaveLength(1);
    expect(written[0].endsWith('\n')).toBe(true);

    const line = lastLine();
    expect(line.level).toBe('info');
    expect(line.msg).toBe('test message');
    expect(line.ctx).toBe('MyService');
    expect(line.ts).toBeDefined();
  });

  it('records the level of each method', () => {
    logger.warn('a', 'X');
    expect(lastLine().level).toBe('warn');

    logger.error('b', 'trace here', 'X');
    expect(lastLine().level).toBe('error');
    expect(lastLine().trace).toBe('trace here');

    logger.debug('c', 'X');
    expect(lastLine().level).toBe('debug');
  });

  describe('request context', () => {
    // The reason for all of this: without the requestId, the logs of one
    // failure sit scattered among every other concurrent request.
    it('includes requestId and request data', () => {
      runWithContext(
        {
          requestId: 'req-123',
          userId: 'user-456',
          ip: '203.0.113.5',
          method: 'POST',
          path: '/api/deposits',
        },
        () => logger.log('deposit queued', 'DepositsService'),
      );

      const line = lastLine();
      expect(line.requestId).toBe('req-123');
      expect(line.userId).toBe('user-456');
      expect(line.ip).toBe('203.0.113.5');
      expect(line.method).toBe('POST');
      expect(line.path).toBe('/api/deposits');
    });

    // The context survives await: a log deep in the chain comes out with
    // the same id, without anyone passing it as a parameter.
    it('survives await', async () => {
      await runWithContext({ requestId: 'req-async' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger.log('after the await', 'X');
      });

      expect(lastLine().requestId).toBe('req-async');
    });

    it('works outside a request, with no context', () => {
      logger.log('startup routine', 'Bootstrap');

      const line = lastLine();
      expect(line.msg).toBe('startup routine');
      expect(line.requestId).toBeUndefined();
    });
  });

  describe('masking', () => {
    // Safety net: the right thing is not to pass credentials along, but
    // dumping a whole object into an error log is a common accident.
    it('hides fields that look like secrets', () => {
      logger.log(
        {
          user: 'mazzo',
          password: 'real-password',
          jwtSecret: 'abc123',
          steam_api_key: 'key',
          authorization: 'Bearer xyz',
          sessionToken: 'tok',
        },
        'X',
      );

      const msg = JSON.parse(String(lastLine().msg)) as Record<string, unknown>;

      expect(msg.user).toBe('mazzo');
      expect(msg.password).toBe('[hidden]');
      expect(msg.jwtSecret).toBe('[hidden]');
      expect(msg.steam_api_key).toBe('[hidden]');
      expect(msg.authorization).toBe('[hidden]');
      expect(msg.sessionToken).toBe('[hidden]');
    });

    it('hides inside a nested object', () => {
      logger.log({ req: { headers: { cookie: 'session=abc' } } }, 'X');

      const msg = JSON.parse(String(lastLine().msg)) as {
        req: { headers: { cookie: string } };
      };

      expect(msg.req.headers.cookie).toBe('[hidden]');
    });

    it('hides inside a list', () => {
      logger.log({ accounts: [{ name: 'bot1', password: 'x' }] }, 'X');

      const msg = JSON.parse(String(lastLine().msg)) as {
        accounts: { name: string; password: string }[];
      };

      expect(msg.accounts[0].name).toBe('bot1');
      expect(msg.accounts[0].password).toBe('[hidden]');
    });

    it('does not blow up on a circular reference', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      expect(() => logger.log(circular, 'X')).not.toThrow();
      expect(lastLine().msg).toBeDefined();
    });
  });

  it('extracts the message from an Error', () => {
    logger.error(new Error('something broke'), undefined, 'X');

    expect(lastLine().msg).toBe('something broke');
  });

  describe('development mode', () => {
    // In dev, readability beats structure — and JSON in the terminal
    // would get in the way more than it helps.
    it('writes readable text, not JSON', () => {
      const dev = new StructuredLogger(false);

      dev.log('dev message', 'MyService');

      const output = written.join('');
      expect(output).toContain('dev message');
      expect(() => {
        JSON.parse(output);
      }).toThrow();
    });

    // A short prefix is enough to tell concurrent requests apart in the
    // terminal; the full id would only hurt readability.
    it('shows the start of the requestId as a prefix', () => {
      const dev = new StructuredLogger(false);

      runWithContext(
        { requestId: 'abcdef12-3456-7890-abcd-ef1234567890' },
        () => dev.log('with context', 'X'),
      );

      expect(written.join('')).toContain('[abcdef12]');
    });
  });
});
