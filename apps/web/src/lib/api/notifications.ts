import type { CursorPage, NotificationDto, UnreadCountDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export interface NotificationListParams {
  limit?: number;
  cursor?: string;
}

// Parent's own inbox.
export async function getMyNotifications(params: NotificationListParams = {}): Promise<CursorPage<NotificationDto>> {
  return apiFetch(`/parent/notifications${toQuery(params)}`);
}
export async function getMyUnreadCount(): Promise<UnreadCountDto> {
  return apiFetch('/parent/notifications/unread-count');
}
export async function markMyNotificationRead(id: string): Promise<NotificationDto> {
  return apiFetch(`/parent/notifications/${id}/read`, { method: 'POST' });
}
export async function markAllMyNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch('/parent/notifications/read-all', { method: 'POST' });
}

// Staff's own operational alert inbox.
export async function getStaffNotifications(params: NotificationListParams = {}): Promise<CursorPage<NotificationDto>> {
  return apiFetch(`/notifications${toQuery(params)}`);
}
export async function getStaffUnreadCount(): Promise<UnreadCountDto> {
  return apiFetch('/notifications/unread-count');
}
export async function markStaffNotificationRead(id: string): Promise<NotificationDto> {
  return apiFetch(`/notifications/${id}/read`, { method: 'POST' });
}
export async function markAllStaffNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch('/notifications/read-all', { method: 'POST' });
}
