'use client';

import { useState } from 'react';
import { listGeofences } from '@/lib/api/geofences';
import { createSafetyRule, disableSafetyRule, enableSafetyRule, listSafetyRules, SAFETY_RULE_TYPES } from '@/lib/api/safety-rules';
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
import type { SafetyRuleDto } from '@school-transport/shared-types';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function SafetyRulesPage() {
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('safety_rules.manage');

  const { data: page, error, loading, reload } = useAsync(() => listSafetyRules({ limit: 50 }), []);
  const { data: geofencePage } = useAsync(() => listGeofences({ limit: 100, status: 'ACTIVE' }), []);

  const [showCreate, setShowCreate] = useState(false);
  const [type, setType] = useState<(typeof SAFETY_RULE_TYPES)[number]>('SPEED');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('MEDIUM');
  const [geofenceId, setGeofenceId] = useState('');
  const [thresholdMeters, setThresholdMeters] = useState('150');
  const [thresholdSpeedKmh, setThresholdSpeedKmh] = useState('60');
  const [minConsecutivePoints, setMinConsecutivePoints] = useState('3');
  const [cooldownSeconds, setCooldownSeconds] = useState('300');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createSafetyRule({
        type,
        severity,
        geofenceId: type === 'GEOFENCE' ? geofenceId : undefined,
        thresholdMeters: type === 'ROUTE_DEVIATION' || type === 'STOP' ? Number(thresholdMeters) : undefined,
        thresholdSpeedKmh: type === 'SPEED' || type === 'STOP' ? Number(thresholdSpeedKmh) : undefined,
        minConsecutivePoints: Number(minConsecutivePoints),
        cooldownSeconds: Number(cooldownSeconds),
      });
      setShowCreate(false);
      toast.success('Safety rule created');
      reload();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Unable to create rule.');
    } finally {
      setCreating(false);
    }
  }

  async function onToggle(id: string, enabled: boolean) {
    setBusyId(id);
    try {
      if (enabled) await disableSafetyRule(id);
      else await enableSafetyRule(id);
      reload();
    } catch (err) {
      toast.error('Unable to update rule', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const items = page?.data ?? [];
  const geofences = geofencePage?.data ?? [];

  const columns: DataTableColumn<SafetyRuleDto>[] = [
    { key: 'type', header: 'Type', render: (r) => <span className="font-medium text-(--color-text)">{r.type.replace(/_/g, ' ')}</span> },
    { key: 'severity', header: 'Severity', render: (r) => <StatusBadge status={r.severity} /> },
    {
      key: 'threshold',
      header: 'Threshold',
      render: (r) =>
        [r.thresholdMeters ? `${r.thresholdMeters}m` : null, r.thresholdSpeedKmh ? `${r.thresholdSpeedKmh} km/h` : null].filter(Boolean).join(' / ') || '—',
    },
    { key: 'cooldown', header: 'Cooldown', render: (r) => `${r.cooldownSeconds}s` },
    { key: 'scope', header: 'Scope', render: (r) => (r.busId ? 'This bus' : r.routeId ? 'This route' : 'School-wide') },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (r) =>
        canManage ? (
          <Switch checked={r.enabled} onChange={() => onToggle(r.id, r.enabled)} disabled={busyId === r.id} label={`${r.enabled ? 'Disable' : 'Enable'} rule`} />
        ) : (
          <StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Safety Rules"
        description="Deterministic, GPS-derived operational monitoring — no AI, no computer vision."
        actions={canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New rule'}</Button>}
      />

      {showCreate && canManage && (
        <Card className="mb-6">
          <CardBody>
            <form onSubmit={onCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Type" htmlFor="type">
                <Select id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  {SAFETY_RULE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Severity" htmlFor="severity">
                <Select id="severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </FormField>
              {type === 'GEOFENCE' && (
                <FormField label="Geofence" htmlFor="geofenceId">
                  <Select id="geofenceId" required value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)}>
                    <option value="">Select a geofence…</option>
                    {geofences.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </Select>
                </FormField>
              )}
              {(type === 'ROUTE_DEVIATION' || type === 'STOP') && (
                <FormField label={type === 'STOP' ? 'Min. distance from any stop (m)' : 'Max deviation from route (m)'} htmlFor="thresholdMeters">
                  <Input id="thresholdMeters" type="number" min={10} max={5000} required value={thresholdMeters} onChange={(e) => setThresholdMeters(e.target.value)} />
                </FormField>
              )}
              {(type === 'SPEED' || type === 'STOP') && (
                <FormField label={type === 'STOP' ? 'Max "stationary" speed (km/h)' : 'Max allowed speed (km/h)'} htmlFor="thresholdSpeedKmh">
                  <Input id="thresholdSpeedKmh" type="number" min={1} max={200} required value={thresholdSpeedKmh} onChange={(e) => setThresholdSpeedKmh(e.target.value)} />
                </FormField>
              )}
              <FormField label="Consecutive points to confirm" htmlFor="minConsecutivePoints">
                <Input id="minConsecutivePoints" type="number" min={1} max={20} value={minConsecutivePoints} onChange={(e) => setMinConsecutivePoints(e.target.value)} />
              </FormField>
              <FormField label="Cooldown (seconds)" htmlFor="cooldownSeconds">
                <Input id="cooldownSeconds" type="number" min={30} max={86400} value={cooldownSeconds} onChange={(e) => setCooldownSeconds(e.target.value)} />
              </FormField>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit" loading={creating}>Create</Button>
                {createError && <p className="text-sm text-(--color-danger-text)">{createError}</p>}
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {loading && <TableSkeleton columns={6} />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load safety rules.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No safety rules configured" />}
      {!loading && !error && items.length > 0 && <DataTable columns={columns} rows={items} getRowKey={(r) => r.id} />}
    </div>
  );
}
