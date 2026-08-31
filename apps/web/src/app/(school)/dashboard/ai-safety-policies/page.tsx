'use client';

import { useState } from 'react';
import {
  AI_SAFETY_POLICY_DETECTION_TYPES,
  createAiSafetyPolicy,
  disableAiSafetyPolicy,
  enableAiSafetyPolicy,
  listAiSafetyPolicies,
} from '@/lib/api/ai-safety-policies';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function AiSafetyPoliciesPage() {
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('ai_safety_policies.manage');

  const { data: policies, error, loading, reload } = useAsync(() => listAiSafetyPolicies(), []);

  const [showCreate, setShowCreate] = useState(false);
  const [detectionType, setDetectionType] = useState<(typeof AI_SAFETY_POLICY_DETECTION_TYPES)[number]>('FALL_DETECTED');
  const [minimumConfidence, setMinimumConfidence] = useState('0.85');
  const [defaultSeverity, setDefaultSeverity] = useState<(typeof SEVERITIES)[number]>('HIGH');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createAiSafetyPolicy({ detectionType, minimumConfidence: Number(minimumConfidence), defaultSeverity });
      setShowCreate(false);
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to create this policy.');
    } finally {
      setCreating(false);
    }
  }

  async function onToggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      if (enabled) await disableAiSafetyPolicy(id);
      else await enableAiSafetyPolicy(id);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const items = policies ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">AI Safety Policies</h1>
          <p className="text-sm text-zinc-500">
            Per-detection-type promotion rules — whether a detection can become a safety event, at what confidence, and its default severity. A detection type with no policy here falls back to a conservative system default.
          </p>
        </div>
        {canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New policy'}</Button>}
      </div>

      {showCreate && canManage && (
        <form onSubmit={onCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <FormField label="Detection type" htmlFor="detectionType">
            <Select id="detectionType" value={detectionType} onChange={(e) => setDetectionType(e.target.value as typeof detectionType)}>
              {AI_SAFETY_POLICY_DETECTION_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Minimum confidence (0.5–1.0)" htmlFor="minimumConfidence">
            <Input id="minimumConfidence" type="number" step="0.01" min={0.5} max={1} required value={minimumConfidence} onChange={(e) => setMinimumConfidence(e.target.value)} />
          </FormField>
          <FormField label="Default severity" htmlFor="defaultSeverity">
            <Select id="defaultSeverity" value={defaultSeverity} onChange={(e) => setDefaultSeverity(e.target.value as typeof defaultSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </FormField>
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" loading={creating}>Create</Button>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          </div>
        </form>
      )}

      {loading && <LoadingState label="Loading policies…" />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load policies.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No custom policies configured" description="Every detection type is using the conservative system default." />}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Detection type</th>
                <th className="px-4 py-2">Min. confidence</th>
                <th className="px-4 py-2">Default severity</th>
                <th className="px-4 py-2">Status</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{p.detectionType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-zinc-500">{(p.minimumConfidence * 100).toFixed(0)}%</td>
                  <td className="px-4 py-2"><StatusBadge status={p.defaultSeverity} /></td>
                  <td className="px-4 py-2"><StatusBadge status={p.enabled ? 'ACTIVE' : 'INACTIVE'} /></td>
                  {canManage && (
                    <td className="px-4 py-2">
                      <Button variant="secondary" disabled={busyId === p.id} onClick={() => onToggle(p.id, p.enabled)}>
                        {p.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
