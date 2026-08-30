'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { DriverDto } from '@school-transport/shared-types';
import { activateDriver, deactivateDriver, getDriver, updateDriver } from '@/lib/api/drivers';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: driver, error, loading, reload } = useAsync(() => getDriver(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !driver) return <ErrorState message={errorMessage(error, 'Driver not found.')} onRetry={reload} />;

  return <DriverEditForm key={driver.id} driver={driver} />;
}

function DriverEditForm({ driver }: { driver: DriverDto }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('drivers.manage');

  const [current, setCurrent] = useState(driver);
  const [licenseNumber, setLicenseNumber] = useState(driver.licenseNumber);
  const [licenseExpiry, setLicenseExpiry] = useState(driver.licenseExpiry ?? '');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateDriver(current.id, { licenseNumber, licenseExpiry: licenseExpiry || undefined });
      setCurrent(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    setActionError(null);
    setBusy(true);
    try {
      const updated = current.status === 'ACTIVE' ? await deactivateDriver(current.id) : await activateDriver(current.id);
      setCurrent(updated);
      setConfirmToggle(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{current.fullName}</h1>
          <p className="text-sm text-zinc-500">{current.email}</p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      <div className="space-y-4">
        <FormField label="License number" htmlFor="licenseNumber">
          <Input id="licenseNumber" value={licenseNumber} disabled={!canManage} onChange={(e) => setLicenseNumber(e.target.value)} />
        </FormField>
        <FormField label="License expiry" htmlFor="licenseExpiry">
          <Input
            id="licenseExpiry"
            type="date"
            value={licenseExpiry}
            disabled={!canManage}
            onChange={(e) => setLicenseExpiry(e.target.value)}
          />
        </FormField>
        {canManage && (
          <Button onClick={onSave} loading={saving}>
            Save changes
          </Button>
        )}
      </div>

      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      <div className="flex justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button variant="secondary" onClick={() => router.back()}>
          Back
        </Button>
        {canManage && (
          <Button variant={current.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setConfirmToggle(true)}>
            {current.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmToggle}
        title={current.status === 'ACTIVE' ? 'Deactivate this driver?' : 'Activate this driver?'}
        description={
          current.status === 'ACTIVE'
            ? 'This is a transport-operational status only — it does not affect their staff login.'
            : 'They will be marked as an active driver again.'
        }
        confirmLabel={current.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        danger={current.status === 'ACTIVE'}
        loading={busy}
        onConfirm={onToggleStatus}
        onCancel={() => setConfirmToggle(false)}
      />
    </div>
  );
}
