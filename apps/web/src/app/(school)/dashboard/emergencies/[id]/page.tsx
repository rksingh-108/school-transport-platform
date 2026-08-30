'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { EmergencyDto } from '@school-transport/shared-types';
import { acknowledgeEmergency, addEmergencyAction, cancelEmergency, EMERGENCY_ACTION_TYPES, getEmergency, resolveEmergency } from '@/lib/api/emergencies';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormField, Input, Select } from '@/components/ui/field';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

function EmergencyStatusBadge({ status }: { status: string }) {
  const tone = status === 'ACTIVE' ? 'danger' : status === 'ACKNOWLEDGED' ? 'warning' : status === 'RESOLVED' ? 'success' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

export default function EmergencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => getEmergency(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Emergency not found.')} onRetry={reload} />;

  return <EmergencyDetail key={data.id} initial={data} />;
}

function EmergencyDetail({ initial }: { initial: EmergencyDto }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('emergency.manage');

  const [emergency, setEmergency] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'resolve' | 'cancel' | null>(null);
  const [newActionType, setNewActionType] = useState<(typeof EMERGENCY_ACTION_TYPES)[number]>('ACKNOWLEDGED');
  const [newActionNote, setNewActionNote] = useState('');

  async function run(action: () => Promise<EmergencyDto>) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setEmergency(updated);
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  }

  const isOpen = emergency.status === 'ACTIVE' || emergency.status === 'ACKNOWLEDGED';

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Emergency</h1>
          <p className="text-sm text-zinc-500">Initiated by {emergency.initiatedByName} · {new Date(emergency.startedAt).toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          <Badge tone={emergency.severity === 'CRITICAL' ? 'danger' : 'warning'}>{emergency.severity}</Badge>
          <EmergencyStatusBadge status={emergency.status} />
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{emergency.reason || 'No reason provided.'}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
          <div><dt className="font-medium">Bus</dt><dd>{emergency.busId ?? '—'}</dd></div>
          <div><dt className="font-medium">Trip</dt><dd>{emergency.tripId ?? '—'}</dd></div>
        </dl>
        {emergency.sourceSafetyEventId && (
          <p className="text-xs text-zinc-500">
            Escalated from safety event —{' '}
            <a href={`/dashboard/safety-events/${emergency.sourceSafetyEventId}`} className="hover:underline">
              view original report
            </a>
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Response history</h2>
        {emergency.actions.length === 0 && <p className="text-sm text-zinc-500">No response actions recorded yet.</p>}
        {emergency.actions.map((a) => (
          <div key={a.id} className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">{a.actionType.replace(/_/g, ' ')}</p>
            <p>{a.actorName} · {new Date(a.createdAt).toLocaleString()}</p>
            {a.note && <p className="mt-1">{a.note}</p>}
          </div>
        ))}
      </div>

      {emergency.resolutionNote && (
        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p>Resolved by {emergency.resolvedByName} at {emergency.resolvedAt ? new Date(emergency.resolvedAt).toLocaleString() : '—'}</p>
          <p className="mt-1">{emergency.resolutionNote}</p>
        </div>
      )}

      {canManage && isOpen && (
        <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>
          <div className="flex flex-wrap gap-2">
            {emergency.status === 'ACTIVE' && (
              <Button variant="secondary" loading={busy} onClick={() => run(() => acknowledgeEmergency(emergency.id))}>
                Acknowledge
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmAction('resolve')}>Resolve</Button>
            <Button variant="danger" onClick={() => setConfirmAction('cancel')}>Cancel (false alarm)</Button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addEmergencyAction(emergency.id, newActionType, newActionNote || undefined));
              setNewActionNote('');
            }}
            className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
          >
            <FormField label="Log a response action" htmlFor="newActionType">
              <Select id="newActionType" value={newActionType} onChange={(e) => setNewActionType(e.target.value as typeof newActionType)}>
                {EMERGENCY_ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Note (optional)" htmlFor="newActionNote">
              <Input id="newActionNote" value={newActionNote} onChange={(e) => setNewActionNote(e.target.value)} />
            </FormField>
            <Button type="submit" loading={busy}>Add</Button>
          </form>
          {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        </div>
      )}

      <Button variant="secondary" onClick={() => router.back()}>Back</Button>

      <ConfirmDialog
        open={confirmAction === 'resolve'}
        title="Resolve this emergency?"
        description="Marks this emergency as handled. If it was escalated from a safety event, that event is also marked resolved."
        confirmLabel="Resolve"
        loading={busy}
        onConfirm={() => run(() => resolveEmergency(emergency.id, resolutionNote || undefined))}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional resolution note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="Cancel this emergency as a false alarm?"
        description="Marks this emergency as cancelled — use only when it did not represent a real emergency. This cannot be undone."
        confirmLabel="Cancel emergency"
        danger
        loading={busy}
        onConfirm={() => run(() => cancelEmergency(emergency.id, resolutionNote || undefined))}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
