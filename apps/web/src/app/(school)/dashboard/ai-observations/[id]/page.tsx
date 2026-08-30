'use client';

import { useRouter, useParams } from 'next/navigation';
import { getAiObservation } from '@/lib/api/ai-observations';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/states';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function AiObservationDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data: observation, error, loading, reload } = useAsync(() => getAiObservation(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !observation) return <ErrorState message={errorMessage(error, 'AI observation not found.')} onRetry={reload} />;

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

      <p className="text-xs text-zinc-500">
        This is a candidate detection only — not a confirmed safety event, and never linked to a specific child&apos;s identity.
      </p>

      <Button variant="secondary" onClick={() => router.back()}>Back</Button>
    </div>
  );
}
