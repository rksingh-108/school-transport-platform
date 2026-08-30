import type { AuthTokenResponse, MeResponse } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';
import { setAccessToken } from '../token-store';

type LoginResult = (AuthTokenResponse & { status: 'OK' }) | { status: 'MFA_REQUIRED' };

export async function staffLogin(email: string, password: string): Promise<LoginResult> {
  const result = await apiFetch<LoginResult>('/auth/staff/login', {
    method: 'POST',
    body: { email, password },
  });
  if (result.status === 'OK') setAccessToken(result.accessToken);
  return result;
}

export async function parentLogin(phone: string, password: string): Promise<LoginResult> {
  const result = await apiFetch<LoginResult>('/auth/parent/login', {
    method: 'POST',
    body: { phone, password },
  });
  if (result.status === 'OK') setAccessToken(result.accessToken);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}

export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me');
}

export async function acceptInvitation(token: string, password: string): Promise<{ principalType: 'STAFF' | 'PARENT' }> {
  return apiFetch('/invitations/accept', { method: 'POST', body: { token, password } });
}
