'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { StaffDto, RoleKey } from '@school-transport/shared-types';
import { STAFF_ROLE_KEYS } from '@school-transport/shared-schemas';
import { ArrowLeft, Mail } from 'lucide-react';
import {
  activateStaff,
  assignStaffRoles,
  getStaff,
  resendInvitation,
  suspendStaff,
  updateStaff,
} from '@/lib/api/staff';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: staff, error, loading, reload } = useAsync(() => getStaff(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !staff) return <ErrorState message={errorMessage(error, 'Staff member not found.')} onRetry={reload} />;

  return <StaffEditForm key={staff.id} staff={staff} />;
}

function StaffEditForm({ staff }: { staff: StaffDto }) {
  const router = useRouter();
  const toast = useToast();
  const { principal } = useAuth();
  const canUpdate = principal?.type === 'STAFF' && principal.permissions.includes('users.update');
  const canManageRoles = principal?.type === 'STAFF' && principal.permissions.includes('users.manage_roles');
  const canInvite = principal?.type === 'STAFF' && principal.permissions.includes('users.create');
  const isSuperAdmin = principal?.type === 'STAFF' && principal.roles.includes('SUPER_ADMIN');
  // Only a SUPER_ADMIN can grant SUPER_ADMIN (docs/security.md) — hide the
  // option for everyone else rather than let them hit a guaranteed 400.
  const assignableRoles = STAFF_ROLE_KEYS.filter((role) => role !== 'SUPER_ADMIN' || isSuperAdmin);

  const [current, setCurrent] = useState(staff);
  const [fullName, setFullName] = useState(staff.fullName);
  const [email, setEmail] = useState(staff.email);
  const [roleKeys, setRoleKeys] = useState<RoleKey[]>(staff.roles);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resendDone, setResendDone] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState(false);

  function toggleRole(role: RoleKey) {
    setRoleKeys((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function onSaveProfile() {
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateStaff(current.id, { fullName, email });
      setCurrent(updated);
      toast.success('Profile saved');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onSaveRoles() {
    setActionError(null);
    setSaving(true);
    try {
      const updated = await assignStaffRoles(current.id, roleKeys);
      setCurrent(updated);
      setRoleKeys(updated.roles);
      toast.success('Roles updated');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update roles.');
    } finally {
      setSaving(false);
    }
  }

  async function onResend() {
    setActionError(null);
    setBusy(true);
    try {
      await resendInvitation(current.id);
      setResendDone(true);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to resend invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function onToggleSuspend() {
    setActionError(null);
    setBusy(true);
    try {
      const updated = current.status === 'SUSPENDED' ? await activateStaff(current.id) : await suspendStaff(current.id);
      setCurrent(updated);
      setConfirmSuspend(false);
      toast.success(current.status === 'SUSPENDED' ? 'Account reactivated' : 'Account suspended');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Staff', href: '/dashboard/staff' }, { label: current.fullName }]}
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
          <p className="flex items-center gap-1 text-xs text-(--color-text-faint)">
            <Mail className="h-3 w-3" /> {current.email}
          </p>
        </div>
      </div>

      {current.status === 'INVITED' && canInvite && (
        <div className="rounded-(--radius-md) border border-(--color-warning-border) bg-(--color-warning-bg) p-3 text-sm">
          <p className="mb-2 text-(--color-warning-text)">This invitation has not been accepted yet.</p>
          <Button variant="secondary" size="sm" onClick={onResend} loading={busy} disabled={resendDone}>
            {resendDone ? 'Invitation resent' : 'Resend invitation'}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader title="Profile" />
        <CardBody className="space-y-4">
          <FormField label="Full name" htmlFor="fullName">
            <Input id="fullName" value={fullName} disabled={!canUpdate} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} disabled={!canUpdate} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          {canUpdate && (
            <Button onClick={onSaveProfile} loading={saving}>
              Save profile
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Roles" />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {assignableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 rounded-(--radius-sm) px-1 py-1 text-sm text-(--color-text-muted) hover:bg-(--color-surface-sunken)">
                <input
                  type="checkbox"
                  disabled={!canManageRoles}
                  checked={roleKeys.includes(role as RoleKey)}
                  onChange={() => toggleRole(role as RoleKey)}
                  className="h-4 w-4 rounded border-(--color-border-strong) text-(--color-brand) focus:ring-(--color-brand-border)"
                />
                {role.replaceAll('_', ' ')}
              </label>
            ))}
          </div>
          {canManageRoles && (
            <Button onClick={onSaveRoles} loading={saving}>
              Save roles
            </Button>
          )}
        </CardBody>
      </Card>

      {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}

      {canUpdate && current.status !== 'INVITED' && current.status !== 'DISABLED' && (
        <div className="flex justify-end">
          <Button variant={current.status === 'SUSPENDED' ? 'primary' : 'danger'} onClick={() => setConfirmSuspend(true)}>
            {current.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmSuspend}
        title={current.status === 'SUSPENDED' ? 'Reactivate this account?' : 'Suspend this account?'}
        description={
          current.status === 'SUSPENDED'
            ? 'They will be able to sign in again.'
            : 'They will be immediately signed out and unable to sign in until reactivated.'
        }
        confirmLabel={current.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
        danger={current.status !== 'SUSPENDED'}
        loading={busy}
        onConfirm={onToggleSuspend}
        onCancel={() => setConfirmSuspend(false)}
      />
    </div>
  );
}
