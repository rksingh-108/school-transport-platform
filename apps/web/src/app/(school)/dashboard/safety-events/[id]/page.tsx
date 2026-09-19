'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { SafetyEventDto } from '@school-transport/shared-types';
import { ArrowLeft, ScanEye } from 'lucide-react';
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
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { SeverityBadge, SeverityMeter } from '@/components/ui/severity';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';

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
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('safety_events.manage');

  const [event, setEvent] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [confirmAction, setConfirmAction] = useState<'dismiss' | 'escalate' | 'resolve' | null>(null);

  async function run(action: () => Promise<SafetyEventDto>, successMessage: string) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setEvent(updated);
      setConfirmAction(null);
      toast.success(successMessage);
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
      <PageHeader
        breadcrumbs={[{ label: 'Safety Events', href: '/dashboard/safety-events' }, { label: event.type.replace(/_/g, ' ') }]}
        title={event.type.replace(/_/g, ' ')}
        description={`Reported by ${event.createdByName} · ${new Date(event.occurredAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={event.severity} />
            <StatusBadge status={event.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <SeverityMeter severity={event.severity} />
          <p className="text-sm text-(--color-text)">{event.description || 'No description provided.'}</p>
          <p className="text-sm text-(--color-text)">{event.description || 'No description provided.'}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs text-(--color-text-faint)">
            <div><dt className="font-medium text-(--color-text-muted)">Source</dt><dd>{event.source.replace(/_/g, ' ')}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Bus</dt><dd>{event.busId ?? '—'}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Trip</dt><dd>{event.tripId ?? '—'}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Camera</dt><dd>{event.cameraId ?? '—'}</dd></div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Timeline" />
        <CardBody className="pt-0">
          <ol className="space-y-0">
            <TimelineRow time={event.occurredAt} label="Occurred" detail={`${event.source.replace(/_/g, ' ')} · ${event.createdByName}`} tone="danger" last={!event.reviewedByName && !event.emergencyId && event.createdAt === event.detectedAt} />
            <TimelineRow time={event.detectedAt} label="Detected by system" detail="First seen by the reporting source" last={!event.reviewedByName && !event.emergencyId} />
            {event.reviewedByName && event.reviewedAt && (
              <TimelineRow time={event.reviewedAt} label="Reviewed" detail={event.reviewedByName} tone="brand" last={!event.emergencyId} />
            )}
            {event.emergencyId && (
              <TimelineRow
                time={event.updatedAt}
                label="Escalated to emergency"
                detail={
                  <Link href={`/dashboard/emergencies/${event.emergencyId}`} className="text-(--color-brand-text) hover:underline">
                    View emergency →
                  </Link>
                }
                tone="danger"
                last
              />
            )}
          </ol>
        </CardBody>
      </Card>

      {event.sourceAiObservationId && (
        <Card>
          <CardBody className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-(--color-text)">
              <ScanEye className="h-4 w-4 text-(--color-text-faint)" /> AI-originated safety event
            </p>
            <p className="text-xs text-(--color-text-muted)">A staff member reviewed an AI detection and chose to promote it here.</p>
            <Link href={`/dashboard/ai-observations/${event.sourceAiObservationId}`} className="text-xs text-(--color-brand-text) hover:underline">
              View the source AI observation →
            </Link>
          </CardBody>
        </Card>
      )}

      {event.reviewedByName && (
        <div className="rounded-(--radius-md) bg-(--color-surface-sunken) p-3 text-xs text-(--color-text-muted)">
          <p>Reviewed by {event.reviewedByName} at {event.reviewedAt ? new Date(event.reviewedAt).toLocaleString() : '—'}</p>
          {event.resolutionNote && <p className="mt-1">Note: {event.resolutionNote}</p>}
        </div>
      )}

      {canManage && isOpen && (
        <Card>
          <CardHeader title="Actions" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {event.status === 'NEW' && (
                <Button variant="secondary" loading={busy} onClick={() => run(() => acknowledgeSafetyEvent(event.id), 'Event acknowledged')}>
                  Acknowledge
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirmAction('dismiss')}>Dismiss</Button>
              <Button variant="danger" onClick={() => setConfirmAction('escalate')}>Escalate to emergency</Button>
              <Button variant="secondary" onClick={() => setConfirmAction('resolve')}>Resolve</Button>
            </div>
            {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmAction === 'dismiss'}
        title="Dismiss this event?"
        description="Marks this event as reviewed and not requiring further action. This is terminal."
        confirmLabel="Dismiss"
        loading={busy}
        onConfirm={() => run(() => dismissSafetyEvent(event.id, resolutionNote || undefined), 'Event dismissed')}
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
        onConfirm={() => run(() => escalateSafetyEvent(event.id), 'Escalated to emergency')}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'resolve'}
        title="Resolve this event?"
        description="Marks this event as handled without escalation. This is terminal."
        confirmLabel="Resolve"
        loading={busy}
        onConfirm={() => run(() => resolveSafetyEvent(event.id, resolutionNote || undefined), 'Event resolved')}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

function TimelineRow({
  time,
  label,
  detail,
  tone = 'neutral',
  last,
}: {
  time: string;
  label: string;
  detail: React.ReactNode;
  tone?: 'neutral' | 'brand' | 'danger' | 'success';
  last?: boolean;
}) {
  const dotClass =
    tone === 'danger'
      ? 'bg-(--color-danger-solid)'
      : tone === 'brand'
        ? 'bg-(--color-brand)'
        : tone === 'success'
          ? 'bg-(--color-success-solid)'
          : 'bg-(--color-neutral-solid)';
  return (
    <li className="relative flex items-start gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-(--color-border-strong)" />}
      <span className={cn('relative z-10 mt-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-(--color-surface-raised)', dotClass)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-(--color-text)">{label}</p>
          <p className="shrink-0 text-xs text-(--color-text-faint)">{new Date(time).toLocaleString()}</p>
        </div>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">{detail}</p>
      </div>
    </li>
  );
}
