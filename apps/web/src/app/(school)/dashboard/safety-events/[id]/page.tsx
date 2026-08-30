'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { SafetyEventDto } from '@school-transport/shared-types';
import {
  acknowledgeSafetyEvent,
  dismissSafetyEvent,
  escalateSafetyEvent,
  getSafetyEvent,
  resolveSafetyEvent,
} from '@/lib/api/safety-events';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function SafetyEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => getSafetyEvent(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Safety event not found.')} onRetry={reload} />;

  return <SafetyEventDetail key={data.id} initial={data} />;
}

function SafetyEventDetail({ initial }: { initial: SafetyEventDto }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('safety_events.manage');

  const [event, setEvent] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'dismiss' | 'escalate' | 'resolve' | null>(null);

  async function run(action: () => Promise<SafetyEventDto>) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setEvent(updated);
      setConfirmAction(null);
      if (updated.emergencyId) router.push(`/dashboard/emergencies/${updated.emergencyId}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  }

  const isOpen = event.status === 'NEW' || event.status === 'ACKNOWLEDGED';

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{event.type.replace(/_/g, ' ')}</h1>
          <p className="text-sm text-zinc-500">Reported by {event.createdByName} · {new Date(event.occurredAt).toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          <StatusBadge status={event.severity} />
          <StatusBadge status={event.status} />
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{event.description || 'No description provided.'}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
          <div><dt className="font-medium">Source</dt><dd>{event.source.replace(/_/g, ' ')}</dd></div>
          <div><dt className="font-medium">Bus</dt><dd>{event.busId ?? '—'}</dd></div>
          <div><dt className="font-medium">Trip</dt><dd>{event.tripId ?? '—'}</dd></div>
          <div><dt className="font-medium">Camera</dt><dd>{event.cameraId ?? '—'}</dd></div>
        </dl>
      </div>

      {event.reviewedByName && (
        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p>Reviewed by {event.reviewedByName} at {event.reviewedAt ? new Date(event.reviewedAt).toLocaleString() : '—'}</p>
          {event.resolutionNote && <p className="mt-1">Note: {event.resolutionNote}</p>}
        </div>
      )}

      {canManage && isOpen && (
        <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>
          <div className="flex flex-wrap gap-2">
            {event.status === 'NEW' && (
              <Button variant="secondary" loading={busy} onClick={() => run(() => acknowledgeSafetyEvent(event.id))}>
                Acknowledge
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmAction('dismiss')}>Dismiss</Button>
            <Button variant="danger" onClick={() => setConfirmAction('escalate')}>Escalate to emergency</Button>
            <Button variant="secondary" onClick={() => setConfirmAction('resolve')}>Resolve</Button>
          </div>
          {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        </div>
      )}

      <Button variant="secondary" onClick={() => router.back()}>Back</Button>

      <ConfirmDialog
        open={confirmAction === 'dismiss'}
        title="Dismiss this event?"
        description="Marks this event as reviewed and not requiring further action. This is terminal."
        confirmLabel="Dismiss"
        loading={busy}
        onConfirm={() => run(() => dismissSafetyEvent(event.id, resolutionNote || undefined))}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAction === 'escalate'}
        title="Escalate to an emergency?"
        description="Creates an active emergency from this event and immediately notifies operational staff. This cannot be undone."
        confirmLabel="Escalate"
        danger
        loading={busy}
        onConfirm={() => run(() => escalateSafetyEvent(event.id))}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'resolve'}
        title="Resolve this event?"
        description="Marks this event as handled without escalation. This is terminal."
        confirmLabel="Resolve"
        loading={busy}
        onConfirm={() => run(() => resolveSafetyEvent(event.id, resolutionNote || undefined))}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
