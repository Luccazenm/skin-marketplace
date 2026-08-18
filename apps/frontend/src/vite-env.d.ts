/**
 * Environment variables the frontend reads, declared rather than pulled
 * in wholesale from `vite/client`.
 *
 * Declaring them means a typo in the name is a typecheck error instead
 * of an `undefined` that only shows up in the browser.
 *
 * Only `VITE_`-prefixed variables reach the bundle — Vite refuses to
 * expose the rest, which is what keeps a secret from being shipped to
 * the browser by accident.
 */
interface ImportMetaEnv {
  /** Where the API lives. Defaults to http://localhost:3000 in development. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
