import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Its own config rather than the app's.
 *
 * `vite.config.ts` carries the Figma asset resolver, the React and
 * Tailwind plugins and an `assetsInclude` list — none of which a unit
 * test needs, and loading them made vitest fail before collecting a
 * single test. What is under test here is arithmetic: money conversion,
 * parsing and rounding, in plain modules with no DOM.
 *
 * The `@` alias is duplicated because that is the one thing the source
 * genuinely relies on. If a test ever needs a component, this is where
 * an environment and the plugins would be added back.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
