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
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select, Switch } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { AiSafetyPolicyDto } from '@school-transport/shared-types';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function AiSafetyPoliciesPage() {
  const toast = useToast();
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
      toast.success('Policy created');
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
    } catch (err) {
      toast.error('Unable to update policy', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const items = policies ?? [];

  const columns: DataTableColumn<AiSafetyPolicyDto>[] = [
    { key: 'type', header: 'Detection type', render: (p) => <span className="font-medium text-(--color-text)">{p.detectionType.replace(/_/g, ' ')}</span> },
    { key: 'confidence', header: 'Min. confidence', render: (p) => `${(p.minimumConfidence * 100).toFixed(0)}%` },
    { key: 'severity', header: 'Default severity', render: (p) => <StatusBadge status={p.defaultSeverity} /> },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (p) =>
        canManage ? (
          <Switch checked={p.enabled} onChange={() => onToggle(p.id, p.enabled)} disabled={busyId === p.id} label={`${p.enabled ? 'Disable' : 'Enable'} policy`} />
        ) : (
          <StatusBadge status={p.enabled ? 'ACTIVE' : 'INACTIVE'} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="AI Safety Policies"
        description="Per-detection-type promotion rules — whether a detection can become a safety event, at what confidence, and its default severity. A detection type with no policy here falls back to a conservative system default."
        actions={canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New policy'}</Button>}
      />

      {showCreate && canManage && (
        <Card className="mb-6">
          <CardBody>
            <form onSubmit={onCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" loading={creating}>Create</Button>
                {createError && <p className="text-sm text-(--color-danger-text)">{createError}</p>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {loading && <TableSkeleton columns={4} />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load policies.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No custom policies configured" description="Every detection type is using the conservative system default." />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(p) => p.id} />}
    </div>
  );
}
