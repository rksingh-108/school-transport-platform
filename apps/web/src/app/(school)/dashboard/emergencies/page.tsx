'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Siren } from 'lucide-react';
import { listEmergencies, triggerEmergency } from '@/lib/api/emergencies';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge, type Tone } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/ui/severity';
import { Select as SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { EmergencyDto } from '@school-transport/shared-types';

const STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'] as const;

/** ACTIVE/ACKNOWLEDGED are urgent (red/amber) here — distinct from the generic shared StatusBadge's ACTIVE=good-state meaning used for School/Bus statuses. */
function EmergencyStatusBadge({ status }: { status: string }) {
  const tone: Tone = status === 'ACTIVE' ? 'danger' : status === 'ACKNOWLEDGED' ? 'warning' : status === 'RESOLVED' ? 'success' : 'neutral';
  return <Badge tone={tone} dot>{status}</Badge>;
}

export default function EmergenciesPage() {
  const router = useRouter();
  const { principal } = useAuth();
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();
  const [confirmTrigger, setConfirmTrigger] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const { data: page, error, loading, reload } = useAsync(
    () => listEmergencies({ limit: 20, cursor: pagination.cursor ?? undefined, status: status || undefined }),
    [status, pagination.cursor],
  );

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

  const columns: DataTableColumn<EmergencyDto>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (e) => (
        <Link href={`/dashboard/emergencies/${e.id}`} className="hover:opacity-80">
          <EmergencyStatusBadge status={e.status} />
        </Link>
      ),
    },
    { key: 'severity', header: 'Severity', render: (e) => <SeverityBadge severity={e.severity} /> },
    { key: 'initiatedBy', header: 'Initiated by', render: (e) => e.initiatedByName },
    { key: 'reason', header: 'Reason', render: (e) => e.reason ?? '—' },
    { key: 'started', header: 'Started', render: (e) => new Date(e.startedAt).toLocaleString() },
  ];

  return (
    <div>
      <PageHeader
        title="Emergencies"
        actions={canTrigger && <Button variant="danger" onClick={() => setConfirmTrigger(true)}>Trigger emergency</Button>}
      />

      {activeCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-(--radius-lg) border border-(--color-danger-border) bg-(--color-danger-bg) p-4 text-(--color-danger-text)">
          <Siren className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            {activeCount} active emergenc{activeCount === 1 ? 'y' : 'ies'} — response in progress.
          </p>
        </div>
      )}

      <div className="mb-4 flex gap-3">
        <SelectField value={status} onChange={(e) => { setStatus(e.target.value); pagination.reset(); }} className="max-w-[180px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </SelectField>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load emergencies.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No emergencies found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && (
        <DataTable
          columns={columns}
          rows={items}
          getRowKey={(e) => e.id}
          rowClassName={(e) => (e.status === 'ACTIVE' ? 'bg-(--color-danger-bg)/40' : undefined)}
        />
      )}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
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
        {triggerError && <p className="text-sm text-(--color-danger-text)">{triggerError}</p>}
      </ConfirmDialog>
    </div>
  );
}
