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

  // Endereço público desta API. A Steam usa como "realm": é o domínio que
  // aparece para o usuário na tela de login dela.
  API_URL: z.url().default('http://localhost:3000'),

  // Para onde mandamos o usuário depois do login concluído.
  FRONTEND_URL: z.url().default('http://localhost:5173'),

  // Opcional de propósito: serve só para enriquecer o perfil (nome, avatar).
  // O login funciona sem ela — quem autentica é o OpenID, não esta chave.
  STEAM_API_KEY: z.string().min(1).optional(),

  // Assina os tokens de sessão. Sem default de propósito: um segredo padrão
  // que vaza para produção deixa qualquer um forjar sessão de qualquer conta.
  // Gerar com: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  JWT_SECRET: z.string().min(32, 'precisa de pelo menos 32 caracteres'),

  // Em segundos. Vale para o token e para o cookie — uma fonte só, senão
  // o cookie some antes do token expirar (ou o contrário).
  JWT_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),

  // Cookie de sessão em HTTPS apenas. Falso só faz sentido em dev local.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const detalhes = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      )
      .join('\n');

    throw new Error(
      `Variáveis de ambiente inválidas:\n${detalhes}\n\n` +
        'Confira apps/backend/.env contra apps/backend/.env.example.',
    );
  }

  return result.data;
}
