'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import type { AIObservationDto } from '@school-transport/shared-types';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { dismissAiObservation, getAiObservation, promoteAiObservation, reviewAiObservation } from '@/lib/api/ai-observations';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function AiObservationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => getAiObservation(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'AI observation not found.')} onRetry={reload} />;

  return <AiObservationDetail key={data.id} initial={data} />;
}

function AiObservationDetail({ initial }: { initial: AIObservationDto }) {
  const router = useRouter();
  const toast = useToast();
  const { principal } = useAuth();
  const canReview = principal?.type === 'STAFF' && principal.permissions.includes('ai_events.review');

  const [observation, setObservation] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [promoteSeverity, setPromoteSeverity] = useState<(typeof SEVERITIES)[number] | ''>('');
  const [confirmAction, setConfirmAction] = useState<'dismiss' | 'promote' | null>(null);

  const isPending = observation.status === 'CANDIDATE' || observation.status === 'REVIEWED';

  async function run(action: () => Promise<AIObservationDto>, successMessage: string) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setObservation(updated);
      setConfirmAction(null);
      toast.success(successMessage);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'AI Observations', href: '/dashboard/ai-observations' }, { label: observation.detectionType.replace(/_/g, ' ') }]}
        title={observation.detectionType.replace(/_/g, ' ')}
        description={`Occurred ${new Date(observation.occurredAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={observation.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-xs text-(--color-text-faint)">
            <div className="col-span-2">
              <dt className="font-medium text-(--color-text-muted)">Confidence</dt>
              <dd className="text-(--color-text)">{(observation.confidence * 100).toFixed(0)}% — model confidence in the detection itself, not a probability of harm</dd>
            </div>
            <div><dt className="font-medium text-(--color-text-muted)">Bus</dt><dd>{observation.busId}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Trip</dt><dd>{observation.tripId ?? '—'}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Camera</dt><dd>{observation.cameraId}</dd></div>
            <div><dt className="font-medium text-(--color-text-muted)">Model</dt><dd>{observation.modelName} {observation.modelVersion}</dd></div>
            <div className="col-span-2"><dt className="font-medium text-(--color-text-muted)">Received</dt><dd>{new Date(observation.receivedAt).toLocaleString()}</dd></div>
          </dl>
        </CardBody>
      </Card>

      <div className="rounded-(--radius-md) bg-(--color-surface-sunken) p-3 text-xs text-(--color-text-muted)">
        <p>Evidence: {observation.evidenceReference ?? 'No evidence attached.'}</p>
        {observation.metadata && Object.keys(observation.metadata).length > 0 && (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(observation.metadata, null, 2)}</pre>
        )}
      </div>

      {observation.reviewedByName && (
        <div className="rounded-(--radius-md) bg-(--color-surface-sunken) p-3 text-xs text-(--color-text-muted)">
          <p>Reviewed by {observation.reviewedByName} at {observation.reviewedAt ? new Date(observation.reviewedAt).toLocaleString() : '—'}</p>
          {observation.reviewNote && <p className="mt-1">Note: {observation.reviewNote}</p>}
        </div>
      )}

      {observation.safetyEventId && (
        <Card>
          <CardBody className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-(--color-text)">
              <ShieldAlert className="h-4 w-4 text-(--color-text-faint)" /> AI-originated safety event
            </p>
            <Link href={`/dashboard/safety-events/${observation.safetyEventId}`} className="text-xs text-(--color-brand-text) hover:underline">
              View the resulting safety event →
            </Link>
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-(--color-text-faint)">
        This is a candidate detection only — never linked to a specific child&apos;s identity, and never a confirmed safety event unless a staff member explicitly promotes it below.
      </p>

      {canReview && isPending && (
        <Card>
          <CardHeader title="Review" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {observation.status === 'CANDIDATE' && (
                <Button variant="secondary" loading={busy} onClick={() => run(() => reviewAiObservation(observation.id), 'Marked reviewed')}>
                  Mark reviewed
                </Button>
              )}
              <Button variant="secondary" onClick={() => setConfirmAction('dismiss')}>Dismiss detection</Button>
              <Button variant="primary" onClick={() => setConfirmAction('promote')}>Promote to safety event</Button>
            </div>
            {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmAction === 'dismiss'}
        title="Dismiss this detection?"
        description="Marks it as reviewed and not requiring further action. This is terminal — no safety event will ever be created from it."
        confirmLabel="Dismiss"
        loading={busy}
        onConfirm={() => run(() => dismissAiObservation(observation.id, reviewNote || undefined), 'Detection dismissed')}
        onCancel={() => setConfirmAction(null)}
      >
        <Input placeholder="Optional note" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmAction === 'promote'}
        title="Promote to a safety event?"
        description="Creates a real safety event from this AI detection for staff to triage. This cannot be undone, and this observation cannot be promoted again."
        confirmLabel="Promote"
        loading={busy}
        onConfirm={() => run(() => promoteAiObservation(observation.id, { reviewNote: reviewNote || undefined, severity: promoteSeverity || undefined }), 'Promoted to safety event')}
        onCancel={() => setConfirmAction(null)}
      >
        <div className="space-y-3">
          <Select value={promoteSeverity} onChange={(e) => setPromoteSeverity(e.target.value as typeof promoteSeverity)}>
            <option value="">Use policy default severity</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Input placeholder="Optional note" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  );
}
