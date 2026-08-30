'use client';

import { useState } from 'react';
import type { NotificationDto } from '@school-transport/shared-types';
import { getStaffNotifications, markAllStaffNotificationsRead, markStaffNotificationRead } from '@/lib/api/notifications';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

function formatRelative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Staff operational alerts (Phase 1 Step 9) — in-app + REST poll only, no
 * realtime push (an accepted MVP scope cut; see
 * docs/adr/0016-notifications-and-alerts.md). Refreshing the page picks up
 * new alerts.
 */
export default function StaffNotificationsPage() {
  const { data, error, loading, reload } = useAsync(() => getStaffNotifications({ limit: 50 }), []);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const current = items ?? data?.data ?? null;

  async function onMarkRead(id: string) {
    const updated = await markStaffNotificationRead(id);
    setItems((prev) => (prev ?? data?.data ?? []).map((n) => (n.id === id ? updated : n)));
  }

  async function onMarkAllRead() {
    setMarkingAll(true);
    try {
      await markAllStaffNotificationsRead();
      const now = new Date().toISOString();
      setItems((prev) => (prev ?? data?.data ?? []).map((n) => ({ ...n, readAt: n.readAt ?? now })));
    } finally {
      setMarkingAll(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !current) {
    return <ErrorState message={error instanceof ApiError ? error.message : 'Unable to load alerts.'} onRetry={reload} />;
  }

  const hasUnread = current.some((n) => !n.readAt);

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Alerts</h1>
        {hasUnread && (
          <Button variant="secondary" onClick={onMarkAllRead} loading={markingAll}>
            Mark all read
          </Button>
        )}
      </div>

      {current.length === 0 && <EmptyState title="No alerts" description="Operational alerts (cancelled trips, GPS issues) will appear here." />}
      {current.length > 0 && (
        <div className="space-y-2">
          {current.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.readAt && onMarkRead(n.id)}
              className={`block w-full rounded-lg border px-4 py-3 text-left ${
                n.readAt ? 'border-zinc-200 dark:border-zinc-800' : 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{n.title}</p>
                {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" />}
              </div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{n.body}</p>
              <p className="mt-1 text-xs text-zinc-400">{formatRelative(n.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
