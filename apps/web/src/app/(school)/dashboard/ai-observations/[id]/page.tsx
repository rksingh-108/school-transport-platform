'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import type { AIObservationDto } from '@school-transport/shared-types';
import { dismissAiObservation, getAiObservation, promoteAiObservation, reviewAiObservation } from '@/lib/api/ai-observations';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
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
  const { principal } = useAuth();
  const canReview = principal?.type === 'STAFF' && principal.permissions.includes('ai_events.review');

  const [observation, setObservation] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [promoteSeverity, setPromoteSeverity] = useState<(typeof SEVERITIES)[number] | ''>('');
  const [confirmAction, setConfirmAction] = useState<'dismiss' | 'promote' | null>(null);

  const isPending = observation.status === 'CANDIDATE' || observation.status === 'REVIEWED';

  async function run(action: () => Promise<AIObservationDto>) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await action();
      setObservation(updated);
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to complete this action.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{observation.detectionType.replace(/_/g, ' ')}</h1>
          <p className="text-sm text-zinc-500">Occurred {new Date(observation.occurredAt).toLocaleString()}</p>
        </div>
        <StatusBadge status={observation.status} />
      </div>

      <div className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
          <div><dt className="font-medium">Confidence</dt><dd>{(observation.confidence * 100).toFixed(0)}% — model confidence in the detection itself, not a probability of harm</dd></div>
          <div><dt className="font-medium">Bus</dt><dd>{observation.busId}</dd></div>
          <div><dt className="font-medium">Trip</dt><dd>{observation.tripId ?? '—'}</dd></div>
          <div><dt className="font-medium">Camera</dt><dd>{observation.cameraId}</dd></div>
          <div><dt className="font-medium">Model</dt><dd>{observation.modelName} {observation.modelVersion}</dd></div>
          <div><dt className="font-medium">Received</dt><dd>{new Date(observation.receivedAt).toLocaleString()}</dd></div>
        </dl>
      </div>

      <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <p>Evidence: {observation.evidenceReference ?? 'No evidence attached.'}</p>
        {observation.metadata && Object.keys(observation.metadata).length > 0 && (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(observation.metadata, null, 2)}</pre>
        )}
      </div>

      {observation.reviewedByName && (
        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p>Reviewed by {observation.reviewedByName} at {observation.reviewedAt ? new Date(observation.reviewedAt).toLocaleString() : '—'}</p>
          {observation.reviewNote && <p className="mt-1">Note: {observation.reviewNote}</p>}
        </div>
      )}

      {observation.safetyEventId && (
        <div className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">AI-originated safety event</p>
          <Link href={`/dashboard/safety-events/${observation.safetyEventId}`} className="text-zinc-600 hover:underline dark:text-zinc-400">
            View the resulting safety event →
          </Link>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        This is a candidate detection only — never linked to a specific child&apos;s identity, and never a confirmed safety event unless a staff member explicitly promotes it below.
      </p>

      {canReview && isPending && (
        <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Review</h2>
          <div className="flex flex-wrap gap-2">
            {observation.status === 'CANDIDATE' && (
              <Button variant="secondary" loading={busy} onClick={() => run(() => reviewAiObservation(observation.id))}>
                Mark reviewed
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmAction('dismiss')}>Dismiss detection</Button>
            <Button variant="primary" onClick={() => setConfirmAction('promote')}>Promote to safety event</Button>
          </div>
          {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        </div>
      )}

      <Button variant="secondary" onClick={() => router.back()}>Back</Button>

      <ConfirmDialog
        open={confirmAction === 'dismiss'}
        title="Dismiss this detection?"
        description="Marks it as reviewed and not requiring further action. This is terminal — no safety event will ever be created from it."
        confirmLabel="Dismiss"
        loading={busy}
        onConfirm={() => run(() => dismissAiObservation(observation.id, reviewNote || undefined))}
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
        onConfirm={() => run(() => promoteAiObservation(observation.id, { reviewNote: reviewNote || undefined, severity: promoteSeverity || undefined }))}
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
