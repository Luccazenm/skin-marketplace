import { z } from 'zod';

/**
 * Contrato das variáveis de ambiente.
 *
 * Roda no boot: se faltar variável ou o formato estiver errado, o processo
 * morre aqui com uma mensagem clara em vez de quebrar em runtime na primeira
 * requisição que precisar do banco.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  // Aceita uma origem ou várias separadas por vírgula
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const detalhes = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Variáveis de ambiente inválidas:\n${detalhes}\n\n` +
        'Confira apps/backend/.env contra apps/backend/.env.example.',
    );
  }

  return result.data;
}
