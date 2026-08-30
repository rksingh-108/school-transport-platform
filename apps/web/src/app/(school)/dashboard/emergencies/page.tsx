'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { listEmergencies, triggerEmergency } from '@/lib/api/emergencies';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select as SelectField } from '@/components/ui/field';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'] as const;

/** ACTIVE/ACKNOWLEDGED are urgent (red/amber) here — distinct from the generic shared StatusBadge's ACTIVE=good-state meaning used for School/Bus statuses. */
function EmergencyStatusBadge({ status }: { status: string }) {
  const tone = status === 'ACTIVE' ? 'danger' : status === 'ACKNOWLEDGED' ? 'warning' : status === 'RESOLVED' ? 'success' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

export default function EmergenciesPage() {
  const router = useRouter();
  const { principal } = useAuth();
  const [status, setStatus] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [confirmTrigger, setConfirmTrigger] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const { data: page, error, loading, reload } = useAsync(
    () => listEmergencies({ limit: 20, cursor: pageCursor ?? undefined, status: status || undefined }),
    [status, pageCursor],
  );

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

  async function onTrigger() {
    setTriggerError(null);
    setTriggering(true);
    try {
      const created = await triggerEmergency({});
      router.push(`/dashboard/emergencies/${created.id}`);
    } catch (err) {
      setTriggerError(err instanceof ApiError ? err.message : 'Unable to trigger an emergency.');
    } finally {
      setTriggering(false);
    }
  }

  const items = page?.data ?? [];
  const activeCount = items.filter((e) => e.status === 'ACTIVE').length;
  const canTrigger = principal?.type === 'STAFF' && principal.permissions.includes('emergency.create');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Emergencies</h1>
          <p className="text-sm text-zinc-500">
            {activeCount > 0 ? (
              <span className="font-semibold text-red-600 dark:text-red-400">{activeCount} active emergenc{activeCount === 1 ? 'y' : 'ies'}</span>
            ) : (
              'No active emergencies right now.'
            )}
          </p>
        </div>
        {canTrigger && <Button variant="danger" onClick={() => setConfirmTrigger(true)}>Trigger emergency</Button>}
      </div>

      <div className="mb-4 flex gap-3">
        <SelectField value={status} onChange={(e) => { setStatus(e.target.value); resetToFirstPage(); }} className="max-w-[160px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </SelectField>
      </div>

      {loading && <LoadingState label="Loading emergencies…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load emergencies.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No emergencies found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Initiated by</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${e.status === 'ACTIVE' ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/emergencies/${e.id}`} className="hover:underline">
                        <EmergencyStatusBadge status={e.status} />
                      </Link>
                    </td>
                    <td className="px-4 py-2">{e.severity}</td>
                    <td className="px-4 py-2 text-zinc-500">{e.initiatedByName}</td>
                    <td className="px-4 py-2 text-zinc-500">{e.reason ?? '—'}</td>
                    <td className="px-4 py-2 text-zinc-500">{new Date(e.startedAt).toLocaleString()}</td>
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

      <ConfirmDialog
        open={confirmTrigger}
        title="Trigger an emergency?"
        description="This immediately creates an active emergency and notifies operational staff. Use only for a real emergency."
        confirmLabel="Trigger emergency"
        danger
        loading={triggering}
        onConfirm={onTrigger}
        onCancel={() => setConfirmTrigger(false)}
      >
        {triggerError && <p className="text-sm text-red-600 dark:text-red-400">{triggerError}</p>}
      </ConfirmDialog>
    </div>
  );
}
