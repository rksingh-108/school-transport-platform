/**
 * The access token lives in memory only — never localStorage/sessionStorage
 * — per docs/adr/0004-auth-strategy.md ("access token held in memory
 * client-side"). It's lost on a full page reload by design; AuthProvider
 * recovers a session on mount by calling /auth/refresh, which works off the
 * httpOnly refresh cookie the browser already holds.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
