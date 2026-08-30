'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AI_DETECTION_TYPES, AI_OBSERVATION_STATUSES, getAiProviderStatus, listAiObservations } from '@/lib/api/ai-observations';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

export default function AiObservationsPage() {
  const [detectionType, setDetectionType] = useState('');
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: page, error, loading, reload } = useAsync(
    () => listAiObservations({ limit: 20, cursor: pageCursor ?? undefined, detectionType: detectionType || undefined, status: status || undefined }),
    [detectionType, status, pageCursor],
  );
  const { data: providerStatus } = useAsync(() => getAiProviderStatus(), []);

  function resetToFirstPage() {
    setPageCursor(null);
    setCursorStack([]);
  }
  function nextPage() {
    if (!page?.nextCursor) return;
    setCursorStack((s) => [...s, pageCursor ?? '']);
    setPageCursor(page.nextCursor);
  }
  function prevPage() {
    setCursorStack((s) => {
      const copy = [...s];
      const prev = copy.pop();
      setPageCursor(prev || null);
      return copy;
    });
  }

  const items = page?.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Observations</h1>
          <p className="text-sm text-zinc-500">
            Candidate detections reported by edge devices — not a confirmed safety event, and no facial or identity data.
          </p>
        </div>
        {providerStatus && (
          <span className="text-xs text-zinc-500">
            Inference provider: <StatusBadge status={providerStatus.status === 'AI_READY' ? 'ACTIVE' : 'INACTIVE'} /> {providerStatus.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={detectionType} onChange={(e) => { setDetectionType(e.target.value); resetToFirstPage(); }} className="max-w-[200px]">
          <option value="">All detection types</option>
          {AI_DETECTION_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); resetToFirstPage(); }} className="max-w-[160px]">
          <option value="">All statuses</option>
          {AI_OBSERVATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState label="Loading AI observations…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load AI observations.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No AI observations found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Detection</th>
                  <th className="px-4 py-2">Confidence</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Model</th>
                  <th className="px-4 py-2">Occurred</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/ai-observations/${o.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {o.detectionType.replace(/_/g, ' ')}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-zinc-500">{(o.confidence * 100).toFixed(0)}%</td>
                    <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-2 text-zinc-500">{o.modelName} {o.modelVersion}</td>
                    <td className="px-4 py-2 text-zinc-500">{new Date(o.occurredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" disabled={cursorStack.length === 0} onClick={prevPage}>Previous</Button>
            <Button variant="secondary" disabled={!page?.nextCursor} onClick={nextPage}>Next</Button>
          </div>
        </>
      )}
    </div>
  );
}
