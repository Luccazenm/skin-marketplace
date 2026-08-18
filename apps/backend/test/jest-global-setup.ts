import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { Client } from 'pg';
import {
  exigirBancoDeTeste,
  mascarar,
  nomeDoBanco,
  urlDeTeste,
} from '../src/test-utils/test-database';

/**
 * Prepara o banco de teste uma vez, antes da suíte inteira.
 *
 * Cria o banco se não existir e aplica as migrations. Assim o teste roda
 * contra o mesmo schema de produção — inclusive as CHECK constraints e o
 * trigger de imutabilidade da auditoria, que são escritos à mão nas
 * migrations e não existiriam num `db push`.
 */
export default async function globalSetup(): Promise<void> {
  config();

  const original = process.env.DATABASE_URL;

  if (!original) {
    throw new Error('DATABASE_URL não definida.');
  }

  const urlTeste = urlDeTeste(original);
  exigirBancoDeTeste(urlTeste);

  await criarSeNaoExistir(original, nomeDoBanco(urlTeste));

  const ambiente = { ...process.env, DATABASE_URL: urlTeste };

  // `deploy` e não `dev`: `dev` é interativo e pode propor apagar dados.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: ambiente,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  // A conta da plataforma vem do seed, não das migrations. Sem ela, todo
  // teste que verifica "ninguém entra na conta de sistema" falha por
  // falta de conta, e não por regra quebrada — o que esconde o que o
  // teste deveria provar.
  //
  // O seed é idempotente, então rodar a cada suíte não acumula nada.
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
    env: ambiente,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  console.log(`\nBanco de teste pronto: ${mascarar(urlTeste)}`);
}

/**
 * `CREATE DATABASE` não aceita "se não existir" com parâmetro, e não roda
 * dentro de transação — daí a consulta antes.
 *
 * A conexão é feita no banco de desenvolvimento porque é preciso estar
 * conectado a *algum* banco para criar outro. Nada é escrito nele.
 */
async function criarSeNaoExistir(
  urlAdmin: string,
  nome: string,
): Promise<void> {
  const client = new Client({ connectionString: urlAdmin });

  await client.connect();

  try {
    const existe = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [nome],
    );

    if (existe.rowCount === 0) {
      // Identificador não aceita parâmetro; as aspas duplas evitam
      // interpretação, e o nome vem do nosso .env, não de entrada externa.
      await client.query(`CREATE DATABASE "${nome}"`);
      console.log(`\nBanco de teste criado: ${nome}`);
    }
  } finally {
    await client.end();
  }
}
