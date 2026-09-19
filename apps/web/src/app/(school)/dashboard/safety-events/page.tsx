'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createSafetyEvent, listSafetyEvents, SAFETY_EVENT_TYPES, SEVERITIES, SYSTEM_SAFETY_EVENT_TYPES } from '@/lib/api/safety-events';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/ui/severity';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { SafetyEventDto } from '@school-transport/shared-types';

const STATUSES = ['NEW', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED', 'RESOLVED'] as const;

export default function SafetyEventsPage() {
  const router = useRouter();
  const { principal } = useAuth();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [type, setType] = useState('');
  const pagination = useCursorPagination();

  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<(typeof SAFETY_EVENT_TYPES)[number]>('MANUAL_ALERT');
  const [newSeverity, setNewSeverity] = useState<(typeof SEVERITIES)[number]>('LOW');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: page, error, loading, reload } = useAsync(
    () => listSafetyEvents({ limit: 20, cursor: pagination.cursor ?? undefined, status: status || undefined, severity: severity || undefined, type: type || undefined }),
    [status, severity, type, pagination.cursor],
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

  const items = page?.data ?? [];

  const columns: DataTableColumn<SafetyEventDto>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (e) => (
        <Link href={`/dashboard/safety-events/${e.id}`} className="flex items-center gap-1.5 font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {e.severity === 'CRITICAL' && <AlertTriangle className="h-4 w-4 shrink-0 text-(--color-danger-solid)" />}
          {e.type.replace(/_/g, ' ')}
        </Link>
      ),
    },
    { key: 'severity', header: 'Severity', render: (e) => <SeverityBadge severity={e.severity} /> },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
    { key: 'reportedBy', header: 'Reported by', render: (e) => e.createdByName },
    { key: 'occurred', header: 'Occurred', render: (e) => new Date(e.occurredAt).toLocaleString() },
  ];

  return (
    <div>
      <PageHeader
        title="Safety Events"
        description="Human-reported safety observations. Not every event is an incident."
        actions={
          canCreate && (
            <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'Report event'}</Button>
          )
        }
      />

      {showCreate && canCreate && (
        <Card className="mb-6">
          <CardBody>
            <form onSubmit={onCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" loading={creating}>Submit</Button>
                {createError && <p className="text-sm text-(--color-danger-text)">{createError}</p>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); pagination.reset(); }} className="max-w-[180px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={severity} onChange={(e) => { setSeverity(e.target.value); pagination.reset(); }} className="max-w-[180px]">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => { setType(e.target.value); pagination.reset(); }} className="max-w-[220px]">
          <option value="">All types</option>
          {[...SAFETY_EVENT_TYPES, ...SYSTEM_SAFETY_EVENT_TYPES].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load safety events.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No safety events found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && (
        <DataTable
          columns={columns}
          rows={items}
          getRowKey={(e) => e.id}
          rowClassName={(e) => (e.severity === 'CRITICAL' ? 'bg-(--color-danger-bg)/40' : undefined)}
        />
      )}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
