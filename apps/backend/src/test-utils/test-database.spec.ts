import {
  databaseName,
  mask,
  requireTestDatabase,
  testRedisUrl,
  testUrl,
} from './test-database';

/**
 * A mistake here does not make a test fail — it makes the tests run
 * against the real database and erase real data. It is the cheapest file
 * to test and the most expensive to get wrong.
 */
describe('testUrl', () => {
  it('appends the suffix to the database name', () => {
    expect(
      testUrl('postgresql://postgres:pass@localhost:5432/skin_marketplace'),
    ).toBe('postgresql://postgres:pass@localhost:5432/skin_marketplace_test');
  });

  it('preserves user, password, host and port', () => {
    const u = new URL(
      testUrl('postgresql://someone:s3cr3t@db.internal:6543/shop'),
    );

    expect(u.username).toBe('someone');
    expect(u.password).toBe('s3cr3t');
    expect(u.hostname).toBe('db.internal');
    expect(u.port).toBe('6543');
  });

  it('preserves connection parameters', () => {
    expect(testUrl('postgresql://u:p@h:5432/shop?schema=public')).toContain(
      'schema=public',
    );
  });

  // Idempotent: calling twice does not produce "shop_test_test".
  it('does not duplicate the suffix', () => {
    const once = testUrl('postgresql://u:p@h:5432/shop');

    expect(testUrl(once)).toBe(once);
  });

  it('refuses a URL without a database name', () => {
    expect(() => testUrl('postgresql://u:p@h:5432')).toThrow(
      /without a database name/,
    );
  });

  // An error message is a classic place to leak a password into logs.
  it('does not expose the password when complaining', () => {
    expect(() => testUrl('postgresql://u:s3cr3t@h:5432')).toThrow(/\*\*\*/);
    expect(() => testUrl('postgresql://u:s3cr3t@h:5432')).not.toThrow(/s3cr3t/);
  });
});

describe('testRedisUrl', () => {
  // The global Steam rate limiter lives in Redis: a test that burns the
  // quota would make the next one take a 429 without having called
  // anything.
  it('points at another Redis database', () => {
    expect(testRedisUrl('redis://localhost:6379')).toBe(
      'redis://localhost:6379/1',
    );
  });

  it('swaps the database when there already was one', () => {
    expect(testRedisUrl('redis://localhost:6379/0')).toBe(
      'redis://localhost:6379/1',
    );
  });
});

describe('requireTestDatabase', () => {
  it('lets the test database through', () => {
    expect(() =>
      requireTestDatabase('postgresql://u:p@h:5432/skin_marketplace_test'),
    ).not.toThrow();
  });

  // The suite truncates whole tables and used to disable triggers;
  // running that against the development database already cost a polluted
  // catalog and the operator's real account.
  it('blocks the development database', () => {
    expect(() =>
      requireTestDatabase('postgresql://u:p@h:5432/skin_marketplace'),
    ).toThrow(/skin_marketplace/);
  });

  // "It is localhost, so it is fine" is exactly the reasoning that
  // destroys data: production can sit on localhost behind an SSH tunnel.
  it('blocks even on localhost', () => {
    expect(() =>
      requireTestDatabase('postgresql://u:p@localhost:5432/production'),
    ).toThrow();
  });

  it('is not fooled by the suffix appearing mid-name', () => {
    expect(() =>
      requireTestDatabase('postgresql://u:p@h:5432/skin_test_production'),
    ).toThrow();
  });
});

describe('databaseName', () => {
  it('extracts the name', () => {
    expect(databaseName('postgresql://u:p@h:5432/shop_test')).toBe('shop_test');
  });
});

describe('mask', () => {
  it('hides the password', () => {
    expect(mask('postgresql://u:s3cr3t@h:5432/shop')).not.toContain('s3cr3t');
  });

  it('does not blow up on an invalid url', () => {
    expect(mask('not a url at all')).toBe('(invalid url)');
  });
});
