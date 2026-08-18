/**
 * Test environment addresses, derived from the development ones.
 *
 * Deriving instead of keeping a `.env.test` is deliberate: a second
 * configuration file would be one more thing to fall out of sync, and
 * nobody notices it did until the tests run against the wrong place.
 */

const SUFFIX = '_test';

/**
 * Swaps the database name for `<name>_test`, preserving user, password,
 * host, port and parameters.
 */
export function testUrl(url: string): string {
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, '');

  if (!name) {
    throw new Error(`DATABASE_URL without a database name: ${mask(url)}`);
  }

  u.pathname = `/${name.endsWith(SUFFIX) ? name : name + SUFFIX}`;

  return u.toString();
}

/**
 * Redis on a separate numbered database.
 *
 * The global Steam rate limiter lives in Redis, and it is shared state
 * like any other: a test that burns the quota would make the next one
 * take a 429 without having called anything.
 */
export function testRedisUrl(url: string): string {
  const u = new URL(url);
  u.pathname = '/1';

  return u.toString();
}

/** Database name, for messages and for creating the database. */
export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/**
 * The barrier: refuses to run against anything but the test database.
 *
 * Without this, pointing the tests at the wrong address would erase real
 * data — and the worst case is not losing the catalog, it is the cleanup
 * turning off audit immutability on a database that matters.
 *
 * The check is on the name suffix, not on the host: a production database
 * can sit on localhost behind an SSH tunnel, and "it is local, so it is
 * fine" is exactly the reasoning that destroys data.
 */
export function requireTestDatabase(url: string): void {
  const name = databaseName(url);

  if (!name.endsWith(SUFFIX)) {
    throw new Error(
      `The tests refuse to run against "${name}": the database name must ` +
        `end in "${SUFFIX}".\n` +
        `The suite truncates whole tables — running against the wrong ` +
        `database erases real data.`,
    );
  }
}

/** Hides the password when logging or throwing with the URL. */
export function mask(url: string): string {
  try {
    const u = new URL(url);

    if (u.password) {
      u.password = '***';
    }

    return u.toString();
  } catch {
    return '(invalid url)';
  }
}
