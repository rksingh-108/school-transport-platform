'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '@school-transport/shared-types';
import { getMe, logout as apiLogout } from './api/auth';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  principal: MeResponse | null;
  /** Re-checks the session (e.g. right after a successful login call). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Wraps the whole app (root layout). On mount it calls GET /auth/me — if
 * there's no access token in memory yet (a fresh page load), that request
 * 401s, and apiFetch's built-in retry-after-silent-refresh
 * (apps/web/src/lib/api-client.ts) transparently tries the httpOnly refresh
 * cookie before giving up. This is the entire "resume my session on reload"
 * mechanism — no separate bootstrap code needed here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [principal, setPrincipal] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setPrincipal(me);
      setStatus('authenticated');
    } catch {
      setPrincipal(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    // Deliberately calls getMe() directly via .then() rather than the
    // `refresh` callback — react-hooks/set-state-in-effect flags any
    // setState call reachable from the effect's own closure via
    // async/await, even after an `await`, but treats a `.then()` callback
    // as the expected "subscribe to an external callback" shape.
    let ignore = false;
    getMe().then(
      (me) => {
        if (ignore) return;
        setPrincipal(me);
        setStatus('authenticated');
      },
      () => {
        if (ignore) return;
        setPrincipal(null);
        setStatus('unauthenticated');
      },
    );
    return () => {
      ignore = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setPrincipal(null);
    setStatus('unauthenticated');
  }, []);

  return <AuthContext.Provider value={{ status, principal, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>.');
  return ctx;
}
