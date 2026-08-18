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

/**
 * Chave fixa, sempre — inclusive por cima de uma real que exista no
 * `.env`.
 *
 * Os testes que tocam a Steam mockam o `fetch`, então o valor nunca é
 * usado de verdade; o que importa é ele **existir**, porque os serviços
 * devolvem `null` sem chave. Antes disso, a suíte passava para quem
 * tinha chave e quebrava para quem não tinha, com oito falhas dizendo
 * apenas "Cannot read properties of null" — que não aponta a causa.
 *
 * Sobrescrever em vez de completar mantém o resultado igual em toda
 * máquina, que é o ponto.
 */
process.env.STEAM_API_KEY = 'chave-de-teste-nunca-usada-de-verdade';

// Última barreira, já com o valor final: se algo acima falhar, é aqui
// que a suíte para em vez de apagar dado real.
exigirBancoDeTeste(process.env.DATABASE_URL);
