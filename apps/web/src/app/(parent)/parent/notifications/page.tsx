'use client';

import { useState } from 'react';
import type { NotificationDto } from '@school-transport/shared-types';
import { getMyNotifications, markAllMyNotificationsRead, markMyNotificationRead } from '@/lib/api/notifications';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

function formatRelative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ParentNotificationsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => getMyNotifications({ limit: 50 }), []);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const current = items ?? data?.data ?? null;

  async function onMarkRead(id: string) {
    try {
      const updated = await markMyNotificationRead(id);
      setItems((prev) => (prev ?? data?.data ?? []).map((n) => (n.id === id ? updated : n)));
    } catch (err) {
      toast.error('Could not mark as read', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function onMarkAllRead() {
    setMarkingAll(true);
    try {
      await markAllMyNotificationsRead();
      const now = new Date().toISOString();
      setItems((prev) => (prev ?? data?.data ?? []).map((n) => ({ ...n, readAt: n.readAt ?? now })));
    } catch (err) {
      toast.error('Could not mark all as read', err instanceof ApiError ? err.message : undefined);
    } finally {
      setMarkingAll(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !current) {
    return <ErrorState message={error instanceof ApiError ? error.message : 'Unable to load notifications.'} onRetry={reload} />;
  }

  const hasUnread = current.some((n) => !n.readAt);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-(--color-text)">Notifications</h1>
        {hasUnread && (
          <Button variant="secondary" size="sm" onClick={onMarkAllRead} loading={markingAll}>
            Mark all read
          </Button>
        )}
      </div>

      {current.length === 0 && <EmptyState title="No notifications yet" />}
      {current.length > 0 && (
        <div className="space-y-2">
          {current.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.readAt && onMarkRead(n.id)}
              className={cn(
                'block w-full rounded-(--radius-lg) border p-4 text-left shadow-(--shadow-xs) transition-colors',
                n.readAt ? 'border-(--color-border) bg-(--color-surface)' : 'border-(--color-brand-border) bg-(--color-brand-bg)',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-(--color-text)">{n.title}</p>
                {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-(--color-danger-solid)" />}
              </div>
              <p className="mt-1 text-sm text-(--color-text-muted)">{n.body}</p>
              <p className="mt-1.5 text-xs text-(--color-text-faint)">{formatRelative(n.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
