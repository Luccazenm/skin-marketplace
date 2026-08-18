import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { Client } from 'pg';
import {
  databaseName,
  mask,
  requireTestDatabase,
  testUrl,
} from '../src/test-utils/test-database';

/**
 * Prepares the test database once, before the whole suite.
 *
 * Creates the database if it does not exist and applies the migrations.
 * That way the tests run against the same schema as production —
 * including the CHECK constraints and the audit immutability trigger,
 * which are hand-written in the migrations and would not exist under a
 * `db push`.
 */
export default async function globalSetup(): Promise<void> {
  config();

  const original = process.env.DATABASE_URL;

  if (!original) {
    throw new Error('DATABASE_URL is not set.');
  }

  const url = testUrl(original);
  requireTestDatabase(url);

  await createIfMissing(original, databaseName(url));

  const env = { ...process.env, DATABASE_URL: url };

  // `deploy` and not `dev`: `dev` is interactive and may offer to drop
  // data.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  // The platform account comes from the seed, not from the migrations.
  // Without it, every test checking "nobody signs into the system
  // account" fails for lack of an account rather than a broken rule —
  // which hides what the test is meant to prove.
  //
  // The seed is idempotent, so running it per suite accumulates nothing.
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    env,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  console.log(`\nTest database ready: ${mask(url)}`);
}

/**
 * `CREATE DATABASE` takes no "if not exists" with a parameter, and does
 * not run inside a transaction — hence the query first.
 *
 * The connection is made to the development database because you must be
 * connected to *some* database to create another. Nothing is written to
 * it.
 */
async function createIfMissing(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });

  await client.connect();

  try {
    const exists = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );

    if (exists.rowCount === 0) {
      // An identifier takes no parameter; the double quotes prevent
      // interpretation, and the name comes from our own .env, not from
      // external input.
      await client.query(`CREATE DATABASE "${name}"`);
      console.log(`\nTest database created: ${name}`);
    }
  } finally {
    await client.end();
  }
}
