/**
 * Moved out of package.json when the isolated test database arrived:
 * these are two file paths plus the reason for each, which in JSON turn
 * into one unreadable line.
 */
module.exports = {
  rootDir: 'src',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',

  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',

  /** Creates the test database and applies the migrations, once. */
  globalSetup: '<rootDir>/../test/jest-global-setup.ts',

  /**
   * Redirects DATABASE_URL and REDIS_URL before any Nest module loads.
   * It runs per worker, and it is where the barrier lives that refuses a
   * database whose name does not end in `_test`.
   */
  setupFiles: ['<rootDir>/../test/jest-setup-env.ts'],

  /**
   * Still in series. The separate database removed the risk of damaging
   * real data, but the workers still share the SAME test database among
   * themselves — parallelising requires one database per worker. See
   * STATE.md.
   */
  maxWorkers: 1,
};
