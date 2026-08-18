import { config } from 'dotenv';
import {
  exigirBancoDeTeste,
  redisDeTeste,
  urlDeTeste,
} from '../src/test-utils/test-database';

/**
 * Aponta cada worker do jest para o banco de teste, antes de qualquer
 * módulo do Nest ser carregado.
 *
 * O `ConfigModule` lê `process.env`, e o dotenv não sobrescreve o que já
 * está definido — então basta chegar antes, que é o que este arquivo faz.
 */
config();

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL não definida. Os testes derivam o banco de teste dela.',
  );
}

process.env.DATABASE_URL = urlDeTeste(url);

if (process.env.REDIS_URL) {
  process.env.REDIS_URL = redisDeTeste(process.env.REDIS_URL);
}

// Última barreira, já com o valor final: se algo acima falhar, é aqui
// que a suíte para em vez de apagar dado real.
exigirBancoDeTeste(process.env.DATABASE_URL);
