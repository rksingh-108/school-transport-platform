'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AI_DETECTION_TYPES, dismissAiObservation, listAiObservations, promoteAiObservation, reviewAiObservation } from '@/lib/api/ai-observations';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AIObservationDto } from '@school-transport/shared-types';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function ageLabel(occurredAt: string): string {
  const ms = Date.now() - new Date(occurredAt).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AiReviewPage() {
  const toast = useToast();
  const { principal } = useAuth();
  const canReview = principal?.type === 'STAFF' && principal.permissions.includes('ai_events.review');

  const [detectionType, setDetectionType] = useState('');
  const { data: page, error, loading, reload } = useAsync(
    () => listAiObservations({ limit: 50, status: 'CANDIDATE', detectionType: detectionType || undefined }),
    [detectionType],
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [confirmPromoteId, setConfirmPromoteId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [promoteSeverity, setPromoteSeverity] = useState<(typeof SEVERITIES)[number] | ''>('');

  async function onMarkReviewed(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await reviewAiObservation(id);
      toast.success('Marked reviewed');
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to mark this observation reviewed.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDismiss() {
    if (!confirmDismissId) return;
    setBusyId(confirmDismissId);
    setActionError(null);
    try {
      await dismissAiObservation(confirmDismissId, reviewNote || undefined);
      setConfirmDismissId(null);
      setReviewNote('');
      toast.success('Detection dismissed');
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to dismiss this detection.');
    } finally {
      setBusyId(null);
    }
  }

  async function onPromote() {
    if (!confirmPromoteId) return;
    setBusyId(confirmPromoteId);
    setActionError(null);
    try {
      await promoteAiObservation(confirmPromoteId, { reviewNote: reviewNote || undefined, severity: promoteSeverity || undefined });
      setConfirmPromoteId(null);
      setReviewNote('');
      setPromoteSeverity('');
      toast.success('Promoted to safety event');
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to promote this detection to a safety event — it may not be enabled for promotion, or its confidence may be below the configured minimum.');
    } finally {
      setBusyId(null);
    }
  }

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
    { key: 'confidence', header: 'Confidence', render: (o) => `${(o.confidence * 100).toFixed(0)}%` },
    { key: 'bus', header: 'Bus', render: (o) => o.busId },
    { key: 'model', header: 'Model', render: (o) => `${o.modelName} ${o.modelVersion}` },
    { key: 'age', header: 'Age', render: (o) => ageLabel(o.occurredAt) },
  ];

  return (
    <div>
      <PageHeader
        title="AI Review Queue"
        description="Candidate detections awaiting human review. AI never creates a safety event on its own — every promotion here is an explicit staff decision."
        actions={
          <Link href="/dashboard/ai-safety-policies" className="text-sm text-(--color-brand-text) hover:underline">
            Manage promotion policies
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={detectionType} onChange={(e) => setDetectionType(e.target.value)} className="max-w-[220px]">
          <option value="">All detection types</option>
          {AI_DETECTION_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
      </div>

      {actionError && <p className="mb-3 text-sm text-(--color-danger-text)">{actionError}</p>}

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load the review queue.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="Nothing pending review" description="All candidate detections have been reviewed." />}
      {!loading && !error && items.length > 0 && (
        <DataTable
          columns={columns}
          rows={items}
          getRowKey={(o) => o.id}
          renderActions={
            canReview
              ? (o) => (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" size="sm" disabled={busyId === o.id} onClick={() => onMarkReviewed(o.id)}>
                      Mark reviewed
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busyId === o.id} onClick={() => setConfirmDismissId(o.id)}>
                      Dismiss
                    </Button>
                    <Button variant="primary" size="sm" disabled={busyId === o.id} onClick={() => setConfirmPromoteId(o.id)}>
                      Promote
                    </Button>
                  </div>
                )
              : undefined
          }
        />
      )}

      <ConfirmDialog
        open={!!confirmDismissId}
        title="Dismiss this detection?"
        description="Marks it as reviewed and not requiring further action. This is terminal — no safety event will ever be created from it."
        confirmLabel="Dismiss"
        loading={busyId === confirmDismissId}
        onConfirm={onDismiss}
        onCancel={() => { setConfirmDismissId(null); setReviewNote(''); }}
      >
        <label className="block text-sm text-(--color-text-muted)">
          Note (optional)
          <Input className="mt-1" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Why is this not a real safety concern?" />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!confirmPromoteId}
        title="Promote to a safety event?"
        description="Creates a real safety event from this AI detection for staff to triage. This cannot be undone, and this observation cannot be promoted again."
        confirmLabel="Promote"
        loading={busyId === confirmPromoteId}
        onConfirm={onPromote}
        onCancel={() => { setConfirmPromoteId(null); setReviewNote(''); setPromoteSeverity(''); }}
      >
        <div className="space-y-3">
          <label className="block text-sm text-(--color-text-muted)">
            Severity override (optional — otherwise uses this school&apos;s configured default)
            <Select className="mt-1" value={promoteSeverity} onChange={(e) => setPromoteSeverity(e.target.value as typeof promoteSeverity)}>
              <option value="">Use policy default</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-(--color-text-muted)">
            Note (optional)
            <Input className="mt-1" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="What did you observe in the footage?" />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}
