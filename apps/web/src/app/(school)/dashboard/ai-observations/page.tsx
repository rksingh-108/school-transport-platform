'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { AI_DETECTION_TYPES, AI_OBSERVATION_STATUSES, getAiProviderStatus, listAiObservations } from '@/lib/api/ai-observations';
import { useAsync } from '@/lib/use-async';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { AIObservationDto } from '@school-transport/shared-types';

export default function AiObservationsPage() {
  const [detectionType, setDetectionType] = useState('');
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listAiObservations({ limit: 20, cursor: pagination.cursor ?? undefined, detectionType: detectionType || undefined, status: status || undefined }),
    [detectionType, status, pagination.cursor],
  );
  const { data: providerStatus } = useAsync(() => getAiProviderStatus(), []);

  const items = page?.data ?? [];

  const columns: DataTableColumn<AIObservationDto>[] = [
    {
      key: 'detection',
      header: 'Detection',
      render: (o) => (
        <Link href={`/dashboard/ai-observations/${o.id}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text)">
          {o.detectionType.replace(/_/g, ' ')}
        </Link>
      ),
    },
    {
      key: 'confidence',
      header: 'Confidence',
      render: (o) => <span className="text-(--color-text-muted)">{(o.confidence * 100).toFixed(0)}%</span>,
    },
    { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
    { key: 'model', header: 'Model', render: (o) => `${o.modelName} ${o.modelVersion}` },
    { key: 'occurred', header: 'Occurred', render: (o) => new Date(o.occurredAt).toLocaleString() },
  ];

  return (
    <div>
      <PageHeader
        title="AI Observations"
        description="Candidate detections reported by edge devices — not a confirmed safety event, and no facial or identity data."
        actions={
          providerStatus && (
            <span className="flex items-center gap-2 text-xs text-(--color-text-faint)">
              Inference provider <StatusBadge status={providerStatus.status === 'AI_READY' ? 'ACTIVE' : 'INACTIVE'} />
            </span>
          )
        }
      />

      <p className="mb-4 flex items-center gap-1.5 text-xs text-(--color-text-faint)">
        <Info className="h-3.5 w-3.5" />
        Confidence is the model&apos;s detection confidence — not a probability of harm or guilt.
      </p>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={detectionType} onChange={(e) => { setDetectionType(e.target.value); pagination.reset(); }} className="max-w-[220px]">
          <option value="">All detection types</option>
          {AI_DETECTION_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); pagination.reset(); }} className="max-w-[180px]">
          <option value="">All statuses</option>
          {AI_OBSERVATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load AI observations.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && <EmptyState title="No AI observations found" description="Try adjusting your filters." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(o) => o.id} />}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
