'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AttendantDto } from '@school-transport/shared-types';
import { activateAttendant, deactivateAttendant, getAttendant } from '@/lib/api/attendants';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function AttendantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: attendant, error, loading, reload } = useAsync(() => getAttendant(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !attendant) return <ErrorState message={errorMessage(error, 'Attendant not found.')} onRetry={reload} />;

  return <AttendantView key={attendant.id} attendant={attendant} />;
}

function AttendantView({ attendant }: { attendant: AttendantDto }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canManage = principal?.type === 'STAFF' && principal.permissions.includes('attendants.manage');

  const [current, setCurrent] = useState(attendant);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onToggleStatus() {
    setActionError(null);
    setBusy(true);
    try {
      const updated = current.status === 'ACTIVE' ? await deactivateAttendant(current.id) : await activateAttendant(current.id);
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
        title={current.status === 'ACTIVE' ? 'Deactivate this attendant?' : 'Activate this attendant?'}
        description={
          current.status === 'ACTIVE'
            ? 'This is a transport-operational status only — it does not affect their staff login.'
            : 'They will be marked as an active attendant again.'
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
