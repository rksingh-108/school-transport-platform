'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { EmergencyDto } from '@school-transport/shared-types';
import { ArrowLeft, Siren } from 'lucide-react';
import { acknowledgeEmergency, addEmergencyAction, cancelEmergency, EMERGENCY_ACTION_TYPES, getEmergency, resolveEmergency } from '@/lib/api/emergencies';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { SeverityBadge, SeverityMeter } from '@/components/ui/severity';
import { FormField, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

function EmergencyStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === 'ACTIVE' ? 'danger' : status === 'ACKNOWLEDGED' ? 'warning' : status === 'RESOLVED' ? 'success' : 'neutral';
  return <Badge tone={tone} dot>{status}</Badge>;
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
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('emergency.manage');

  const [emergency, setEmergency] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'resolve' | 'cancel' | null>(null);
  const [newActionType, setNewActionType] = useState<(typeof EMERGENCY_ACTION_TYPES)[number]>('ACKNOWLEDGED');
  const [newActionNote, setNewActionNote] = useState('');

  async function run(action: () => Promise<EmergencyDto>, successMessage?: string) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setEmergency(updated);
      setConfirmAction(null);
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  }

  const isOpen = emergency.status === 'ACTIVE' || emergency.status === 'ACKNOWLEDGED';

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Emergencies', href: '/dashboard/emergencies' }, { label: 'Emergency' }]}
        title="Emergency"
        description={`Initiated by ${emergency.initiatedByName} · ${new Date(emergency.startedAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={emergency.severity} />
            <EmergencyStatusBadge status={emergency.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      {emergency.status === 'ACTIVE' && (
        <div className="flex items-center gap-3 rounded-(--radius-lg) border border-(--color-danger-border) bg-(--color-danger-bg) p-4 text-(--color-danger-text)">
          <Siren className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">This emergency is active — response is in progress.</p>
        </div>
      )}

      <Card>
        <CardBody className="space-y-3">
          <SeverityMeter severity={emergency.severity} />
          <p className="text-sm text-(--color-text)">{emergency.reason || 'No reason provided.'}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs text-(--color-text-faint)">
            <div><dt className="font-medium text-(--color-text-muted)">Bus</dt><dd>{emergency.busId ?? '—'}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Trip</dt><dd>{emergency.tripId ?? '—'}</dd></div>
          </dl>
          {emergency.sourceSafetyEventId && (
            <p className="text-xs text-(--color-text-muted)">
              Escalated from safety event —{' '}
              <Link href={`/dashboard/safety-events/${emergency.sourceSafetyEventId}`} className="text-(--color-brand-text) hover:underline">
                view original report
              </Link>
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Response timeline" description="Lifecycle events and response actions, in order." />
        <CardBody className="pt-0">
          <EmergencyTimeline emergency={emergency} />
        </CardBody>
      </Card>

      {emergency.resolutionNote && (
        <div className="rounded-(--radius-md) bg-(--color-surface-sunken) p-3 text-xs text-(--color-text-muted)">
          <p>Resolved by {emergency.resolvedByName} at {emergency.resolvedAt ? new Date(emergency.resolvedAt).toLocaleString() : '—'}</p>
          <p className="mt-1">{emergency.resolutionNote}</p>
        </div>
      )}

      {canManage && isOpen && (
        <Card>
          <CardHeader title="Actions" />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {emergency.status === 'ACTIVE' && (
                <Button variant="secondary" loading={busy} onClick={() => run(() => acknowledgeEmergency(emergency.id), 'Emergency acknowledged')}>
                  Acknowledge
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirmAction('resolve')}>Resolve</Button>
              <Button variant="danger" onClick={() => setConfirmAction('cancel')}>Cancel (false alarm)</Button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => addEmergencyAction(emergency.id, newActionType, newActionNote || undefined), 'Response action logged');
                setNewActionNote('');
              }}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
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
            {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmAction === 'resolve'}
        title="Resolve this emergency?"
        description="Marks this emergency as handled. If it was escalated from a safety event, that event is also marked resolved."
        confirmLabel="Resolve"
        loading={busy}
        onConfirm={() => run(() => resolveEmergency(emergency.id, resolutionNote || undefined), 'Emergency resolved')}
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
        onConfirm={() => run(() => cancelEmergency(emergency.id, resolutionNote || undefined), 'Emergency cancelled')}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

interface TimelineEntry {
  id: string;
  time: string;
  label: string;
  detail?: React.ReactNode;
  note?: string | null;
  tone: 'neutral' | 'brand' | 'danger' | 'success';
}

function EmergencyTimeline({ emergency }: { emergency: EmergencyDto }) {
  const entries: TimelineEntry[] = [
    {
      id: 'started',
      time: emergency.startedAt,
      label: 'Emergency started',
      detail: `Initiated by ${emergency.initiatedByName}`,
      tone: 'danger',
    },
  ];

  if (emergency.acknowledgedAt) {
    entries.push({
      id: 'acknowledged',
      time: emergency.acknowledgedAt,
      label: 'Acknowledged',
      detail: 'Response team notified',
      tone: 'brand',
    });
  }

  emergency.actions.forEach((a) => {
    entries.push({
      id: a.id,
      time: a.createdAt,
      label: a.actionType.replace(/_/g, ' '),
      detail: `By ${a.actorName}`,
      note: a.note,
      tone: 'neutral',
    });
  });

  if (emergency.resolvedAt) {
    entries.push({
      id: 'resolved',
      time: emergency.resolvedAt,
      label: 'Resolved',
      detail: `By ${emergency.resolvedByName ?? '—'}`,
      note: emergency.resolutionNote,
      tone: 'success',
    });
  }

  entries.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return (
    <ol className="space-y-0">
      {entries.map((entry, i) => {
        const dotClass =
          entry.tone === 'danger'
            ? 'bg-(--color-danger-solid)'
            : entry.tone === 'brand'
              ? 'bg-(--color-brand)'
              : entry.tone === 'success'
                ? 'bg-(--color-success-solid)'
                : 'bg-(--color-neutral-solid)';
        const last = i === entries.length - 1;
        return (
          <li key={entry.id} className="relative flex items-start gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-(--color-border-strong)" />}
            <span className={cn('relative z-10 mt-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-(--color-surface-raised)', dotClass)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-(--color-text)">{entry.label}</p>
                <p className="shrink-0 text-xs text-(--color-text-faint)">{new Date(entry.time).toLocaleString()}</p>
              </div>
              {entry.detail && <p className="mt-0.5 text-xs text-(--color-text-muted)">{entry.detail}</p>}
              {entry.note && <p className="mt-1 rounded-(--radius-sm) bg-(--color-surface-sunken) px-2.5 py-1.5 text-xs text-(--color-text-muted)">{entry.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
