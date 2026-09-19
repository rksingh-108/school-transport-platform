'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { DriverDto } from '@school-transport/shared-types';
import { ArrowLeft } from 'lucide-react';
import { activateDriver, deactivateDriver, getDriver, updateDriver } from '@/lib/api/drivers';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
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
  const toast = useToast();
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
      toast.success('Driver saved');
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
      toast.success(current.status === 'ACTIVE' ? 'Driver deactivated' : 'Driver activated');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Drivers', href: '/dashboard/drivers' }, { label: current.fullName }]}
        title={current.fullName}
        description={current.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={current.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      <div className="flex items-center gap-3">
        <Avatar name={current.fullName} size="lg" />
        <div>
          <p className="text-sm font-medium text-(--color-text)">{current.fullName}</p>
          <p className="text-xs text-(--color-text-faint)">{current.email}</p>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-4">
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
          {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border) pt-4">
            {canManage && (
              <Button onClick={onSave} loading={saving}>
                Save changes
              </Button>
            )}
            {canManage && (
              <Button variant={current.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setConfirmToggle(true)}>
                {current.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

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
