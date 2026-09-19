'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AttendantDto } from '@school-transport/shared-types';
import { ArrowLeft } from 'lucide-react';
import { activateAttendant, deactivateAttendant, getAttendant } from '@/lib/api/attendants';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
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

export default function AttendantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: attendant, error, loading, reload } = useAsync(() => getAttendant(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !attendant) return <ErrorState message={errorMessage(error, 'Attendant not found.')} onRetry={reload} />;

  return <AttendantView key={attendant.id} attendant={attendant} />;
}

function AttendantView({ attendant }: { attendant: AttendantDto }) {
  const router = useRouter();
  const toast = useToast();
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
      toast.success(current.status === 'ACTIVE' ? 'Attendant deactivated' : 'Attendant activated');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Attendants', href: '/dashboard/attendants' }, { label: current.fullName }]}
        title={current.fullName}
        description={current.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={current.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={current.fullName} size="lg" />
            <div>
              <p className="text-sm font-medium text-(--color-text)">{current.fullName}</p>
              <p className="text-xs text-(--color-text-faint)">{current.email}</p>
            </div>
          </div>
          {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}
          {canManage && (
            <div className="flex justify-end border-t border-(--color-border) pt-4">
              <Button variant={current.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setConfirmToggle(true)}>
                {current.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

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
