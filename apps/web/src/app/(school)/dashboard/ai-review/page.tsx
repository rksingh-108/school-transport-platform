'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AI_DETECTION_TYPES, dismissAiObservation, listAiObservations, promoteAiObservation, reviewAiObservation } from '@/lib/api/ai-observations';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

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
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to promote this detection to a safety event — it may not be enabled for promotion, or its confidence may be below the configured minimum.');
    } finally {
      setBusyId(null);
    }
  }

  const items = page?.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Review Queue</h1>
          <p className="text-sm text-zinc-500">
            Candidate detections awaiting human review. AI never creates a safety event on its own — every promotion here is an explicit staff decision.
          </p>
        </div>
        <Link href="/dashboard/ai-safety-policies" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Manage promotion policies
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={detectionType} onChange={(e) => setDetectionType(e.target.value)} className="max-w-[200px]">
          <option value="">All detection types</option>
          {AI_DETECTION_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
          ))}
        </Select>
      </div>

      {actionError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {loading && <LoadingState label="Loading the review queue…" />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load the review queue.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="Nothing pending review" description="All candidate detections have been reviewed." />}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Detection</th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2">Bus</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Age</th>
                {canReview && <th className="px-4 py-2">Actions</th>}
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
                  <td className="px-4 py-2 text-zinc-500">{o.busId}</td>
                  <td className="px-4 py-2 text-zinc-500">{o.modelName} {o.modelVersion}</td>
                  <td className="px-4 py-2 text-zinc-500">{ageLabel(o.occurredAt)}</td>
                  {canReview && (
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" disabled={busyId === o.id} onClick={() => onMarkReviewed(o.id)}>
                          Mark reviewed
                        </Button>
                        <Button variant="secondary" disabled={busyId === o.id} onClick={() => setConfirmDismissId(o.id)}>
                          Dismiss detection
                        </Button>
                        <Button variant="primary" disabled={busyId === o.id} onClick={() => setConfirmPromoteId(o.id)}>
                          Promote to safety event
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <label className="block text-sm text-zinc-600 dark:text-zinc-400">
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
          <label className="block text-sm text-zinc-600 dark:text-zinc-400">
            Severity override (optional — otherwise uses this school&apos;s configured default)
            <Select className="mt-1" value={promoteSeverity} onChange={(e) => setPromoteSeverity(e.target.value as typeof promoteSeverity)}>
              <option value="">Use policy default</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </label>
          <label className="block text-sm text-zinc-600 dark:text-zinc-400">
            Note (optional)
            <Input className="mt-1" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="What did you observe in the footage?" />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}
