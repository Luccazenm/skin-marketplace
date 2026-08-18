/**
 * Saiu do package.json quando o banco de teste isolado entrou: são dois
 * caminhos de arquivo e o motivo de cada um, que num JSON viram uma linha
 * ilegível.
 */
module.exports = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',

  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',

  /** Cria o banco de teste e aplica as migrations, uma vez. */
  globalSetup: '<rootDir>/../test/jest-global-setup.ts',

  /**
   * Redireciona DATABASE_URL e REDIS_URL antes de qualquer módulo do Nest
   * carregar. Roda por worker, e é onde está a barreira que recusa banco
   * cujo nome não termine em `_test`.
   */
  setupFiles: ['<rootDir>/../test/jest-setup-env.ts'],

  /**
   * Ainda em série. O banco separado tirou o risco de estragar dado real,
   * mas os workers continuam compartilhando o MESMO banco de teste entre
   * si — paralelizar exige um banco por worker. Ver STATE.md.
   */
  maxWorkers: 1,
};
