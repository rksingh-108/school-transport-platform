import type { CursorPage, StaffDto, RoleKey } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface StaffListParams {
  limit?: number;
  cursor?: string;
  search?: string;
  status?: string;
}

export async function listStaff(params: StaffListParams = {}): Promise<CursorPage<StaffDto>> {
  return apiFetch(`/users${toQuery(params)}`);
}

export async function getStaff(id: string): Promise<StaffDto> {
  return apiFetch(`/users/${id}`);
}

export async function inviteStaff(input: { email: string; fullName: string; roleKeys: RoleKey[] }): Promise<StaffDto> {
  return apiFetch('/users/invite', { method: 'POST', body: input });
}

export async function resendInvitation(id: string): Promise<void> {
  await apiFetch(`/users/${id}/resend-invitation`, { method: 'POST' });
}

export async function updateStaff(id: string, input: { fullName?: string; email?: string }): Promise<StaffDto> {
  return apiFetch(`/users/${id}`, { method: 'PATCH', body: input });
}

export async function assignStaffRoles(id: string, roleKeys: RoleKey[]): Promise<StaffDto> {
  return apiFetch(`/users/${id}/roles`, { method: 'POST', body: { roleKeys } });
}

export async function suspendStaff(id: string): Promise<StaffDto> {
  return apiFetch(`/users/${id}/suspend`, { method: 'POST' });
}

export async function activateStaff(id: string): Promise<StaffDto> {
  return apiFetch(`/users/${id}/activate`, { method: 'POST' });
}
