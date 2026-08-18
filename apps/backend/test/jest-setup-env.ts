import { config } from 'dotenv';
import {
  requireTestDatabase,
  testRedisUrl,
  testUrl,
} from '../src/test-utils/test-database';

/**
 * Points each jest worker at the test database, before any Nest module
 * loads.
 *
 * `ConfigModule` reads `process.env`, and dotenv does not overwrite what
 * is already set — so getting there first is enough, which is what this
 * file does.
 */
config();

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. The tests derive the test database from it.',
  );
}

process.env.DATABASE_URL = testUrl(url);

if (process.env.REDIS_URL) {
  process.env.REDIS_URL = testRedisUrl(process.env.REDIS_URL);
}

/**
 * A fixed key, always — including over a real one present in `.env`.
 *
 * The tests that touch Steam mock `fetch`, so the value is never really
 * used; what matters is that it **exists**, because the services return
 * `null` without a key. Before this, the suite passed for whoever had a
 * key and broke for whoever did not, with eight failures saying only
 * "Cannot read properties of null" — which points at nothing.
 *
 * Overwriting rather than filling in keeps the result identical on every
 * machine, which is the point.
 */
process.env.STEAM_API_KEY = 'test-key-never-actually-used';

// Last barrier, now with the final value: if anything above fails, this
// is where the suite stops instead of erasing real data.
requireTestDatabase(process.env.DATABASE_URL);
