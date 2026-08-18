import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser, type CurrentUser } from './api';

export interface Session {
  user: CurrentUser | null;
  /** True until the first answer arrives, whichever way it goes. */
  loading: boolean;
  /**
   * Set when the API could not be reached — which is not the same as
   * being logged out. The screen has to tell those apart: one says "sign
   * in", the other says "we cannot reach the server".
   */
  error: string | null;
  /** Re-reads the session, e.g. after a deposit changes the balance. */
  refresh: () => Promise<void>;
}

/**
 * Who is logged in, according to the backend.
 *
 * There is no local copy of the balance or of what the account may do:
 * both come from `/api/auth/me` on every load. Caching them in the
 * browser would mean a screen that keeps offering an action Steam has
 * already blocked, or showing money that is no longer there.
 */
export function useSession(): Session {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUser(await getCurrentUser());
      setError(null);
    } catch (cause) {
      // Never invent a logged-in state out of a failure: leave the user
      // null and say what happened.
      setUser(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { user, loading, error, refresh: load };
}
