import { getAccessToken, setAccessToken } from './token-store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Set on the /auth/refresh call itself to avoid an infinite retry loop. */
  skipAuthRetry?: boolean;
}

async function rawFetch(path: string, options: RequestOptions): Promise<Response> {
  const token = getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    // Always sent — this is how the httpOnly refresh cookie reaches the API;
    // the access token is layered on top via the header when we have one.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * A staff and a parent refresh cookie can both be present at once (same
 * browser, both roles used without logging out in between) — the server
 * needs to know which one this page actually wants. There's no client-side
 * session state to ask, only the URL, so we infer it from the route.
 */
function audienceHintFromLocation(): 'STAFF' | 'PARENT' | null {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname;
  if (path.startsWith('/parent') || path.startsWith('/login/parent')) return 'PARENT';
  if (path.startsWith('/dashboard') || path.startsWith('/login/staff')) return 'STAFF';
  return null;
}

/** Deduplicated — concurrent 401s from several requests trigger exactly one refresh call. */
async function trySilentRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const hint = audienceHintFromLocation();
      const path = hint ? `/auth/refresh?audience=${hint}` : '/auth/refresh';
      const res = await rawFetch(path, { method: 'POST', skipAuthRetry: true });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * A 401 triggers exactly one silent-refresh-and-retry — if that also fails,
 * the error propagates and the caller (typically AuthProvider) is
 * responsible for treating it as "session ended" and redirecting to login.
 * This client never redirects on its own — it has no notion of which login
 * page (staff or parent) is appropriate.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, options);

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await trySilentRefresh();
    if (refreshed) {
      res = await rawFetch(path, options);
    }
  }

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Something went wrong.', err?.details);
  }

  return data as T;
}
