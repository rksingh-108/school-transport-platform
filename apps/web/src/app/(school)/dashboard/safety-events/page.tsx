'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSafetyEvent, listSafetyEvents, SAFETY_EVENT_TYPES, SEVERITIES, SYSTEM_SAFETY_EVENT_TYPES } from '@/lib/api/safety-events';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

const STATUSES = ['NEW', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED'] as const;

export default function SafetyEventsPage() {
  const router = useRouter();
  const { principal } = useAuth();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<(typeof SAFETY_EVENT_TYPES)[number]>('MANUAL_ALERT');
  const [newSeverity, setNewSeverity] = useState<(typeof SEVERITIES)[number]>('LOW');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: page, error, loading, reload } = useAsync(
    () => listSafetyEvents({ limit: 20, cursor: pageCursor ?? undefined, status: status || undefined, severity: severity || undefined, type: type || undefined }),
    [status, severity, type, pageCursor],
  );

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createSafetyEvent({ type: newType, severity: newSeverity, description: newDescription || undefined });
      router.push(`/dashboard/safety-events/${created.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to report this event.');
    } finally {
      setCreating(false);
    }
  }

  const canCreate =
    principal?.type === 'STAFF' && (principal.permissions.includes('safety_events.create') || principal.permissions.includes('safety_events.manage'));

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
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Safety Events</h1>
          <p className="text-sm text-zinc-500">Human-reported safety observations. Not every event is an incident.</p>
        </div>
        {canCreate && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'Report event'}</Button>}
      </div>

      {showCreate && canCreate && (
        <form onSubmit={onCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <FormField label="Type" htmlFor="newType">
            <Select id="newType" value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>
              {SAFETY_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Severity" htmlFor="newSeverity">
            <Select id="newSeverity" value={newSeverity} onChange={(e) => setNewSeverity(e.target.value as typeof newSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Description (optional)" htmlFor="newDescription">
            <Input id="newDescription" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} maxLength={2000} />
          </FormField>
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" loading={creating}>Submit</Button>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          </div>
        </form>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); resetToFirstPage(); }} className="max-w-[160px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => { setSeverity(e.target.value); resetToFirstPage(); }} className="max-w-[160px]">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => { setType(e.target.value); resetToFirstPage(); }} className="max-w-[200px]">
          <option value="">All types</option>
          {[...SAFETY_EVENT_TYPES, ...SYSTEM_SAFETY_EVENT_TYPES].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
      </div>

      {loading && <LoadingState label="Loading safety events…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load safety events.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No safety events found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Reported by</th>
                  <th className="px-4 py-2">Occurred</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/safety-events/${e.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                        {e.type.replace(/_/g, ' ')}
                      </Link>
                    </td>
                    <td className="px-4 py-2"><StatusBadge status={e.severity} /></td>
                    <td className="px-4 py-2"><StatusBadge status={e.status} /></td>
                    <td className="px-4 py-2 text-zinc-500">{e.createdByName}</td>
                    <td className="px-4 py-2 text-zinc-500">{new Date(e.occurredAt).toLocaleString()}</td>
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
