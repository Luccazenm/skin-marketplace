import { z } from 'zod';

/**
 * The environment variable contract.
 *
 * It runs at boot: if a variable is missing or malformed, the process
 * dies here with a clear message instead of breaking at runtime on the
 * first request that needs the database.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  // Accepts one origin, or several separated by commas
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // This API's public address. Steam uses it as the "realm": it is the
  // domain shown to the user on Steam's own login screen.
  API_URL: z.url().default('http://localhost:3000'),

  // Where we send the user once the login is complete.
  FRONTEND_URL: z.url().default('http://localhost:5173'),

  // Optional on purpose: it only enriches the profile (name, avatar).
  // Login works without it — the OpenID authenticates, not this key.
  STEAM_API_KEY: z.string().min(1).optional(),

  // Signs the session tokens. No default on purpose: a default secret
  // that leaks into production lets anyone forge a session for any
  // account.
  // Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_SECRET: z.string().min(32, 'needs at least 32 characters'),

  // In seconds. It governs both the token and the cookie — a single
  // source, otherwise the cookie disappears before the token expires (or
  // the other way round).
  JWT_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  /**
   * The platform's commission, as a percentage of the sale price.
   *
   * It lives here rather than in the frontend because it is a business
   * value that decides what a seller is paid. A copy in the browser
   * would keep quoting the old number the day it changes, and the
   * screen would be lying about money.
   *
   * A percentage rather than a fraction: "5" is what anyone discussing
   * it says out loud, and "0.05" invites the reader to wonder whether
   * they are looking at 5% or 0.05%.
   */
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(5),

  // Session cookie over HTTPS only. False only makes sense in local
  // development.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Invalid environment variables:\n${details}\n\n` +
        'Check apps/backend/.env against apps/backend/.env.example.',
    );
  }

  return result.data;
}
