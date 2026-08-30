'use client';

import { useState } from 'react';
import { listGeofences } from '@/lib/api/geofences';
import { createSafetyRule, disableSafetyRule, enableSafetyRule, listSafetyRules, SAFETY_RULE_TYPES } from '@/lib/api/safety-rules';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/states';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export default function SafetyRulesPage() {
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
    } finally {
      setBusyId(null);
    }
  }

  const items = page?.data ?? [];
  const geofences = geofencePage?.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Safety Rules</h1>
          <p className="text-sm text-zinc-500">Deterministic, GPS-derived operational monitoring — no AI, no computer vision.</p>
        </div>
        {canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New rule'}</Button>}
      </div>

      {showCreate && canManage && (
        <form onSubmit={onCreate} className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
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
          <div className="col-span-2 flex items-center gap-3">
            <Button type="submit" loading={creating}>Create</Button>
            {createError && <p className="text-sm text-red-600 dark:text-red-400">{createError}</p>}
          </div>
        </form>
      )}

      {loading && <LoadingState label="Loading safety rules…" />}
      {!loading && !!error && <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load safety rules.'} onRetry={reload} />}
      {!loading && !error && items.length === 0 && <EmptyState title="No safety rules configured" />}
      {!loading && !error && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Threshold</th>
                <th className="px-4 py-2">Cooldown</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Status</th>
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-100">{r.type.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.severity} /></td>
                  <td className="px-4 py-2 text-zinc-500">
                    {r.thresholdMeters ? `${r.thresholdMeters}m` : ''}
                    {r.thresholdMeters && r.thresholdSpeedKmh ? ' / ' : ''}
                    {r.thresholdSpeedKmh ? `${r.thresholdSpeedKmh} km/h` : ''}
                    {!r.thresholdMeters && !r.thresholdSpeedKmh ? '—' : ''}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{r.cooldownSeconds}s</td>
                  <td className="px-4 py-2 text-zinc-500">{r.busId ? 'This bus' : r.routeId ? 'This route' : 'School-wide'}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} /></td>
                  {canManage && (
                    <td className="px-4 py-2">
                      <Button variant="secondary" disabled={busyId === r.id} onClick={() => onToggle(r.id, r.enabled)}>
                        {r.enabled ? 'Disable' : 'Enable'}
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
