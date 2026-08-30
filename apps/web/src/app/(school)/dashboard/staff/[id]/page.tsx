'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { StaffDto, RoleKey } from '@school-transport/shared-types';
import { STAFF_ROLE_KEYS } from '@school-transport/shared-schemas';
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
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
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
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to update status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{current.fullName}</h1>
          <p className="text-sm text-zinc-500">{current.email}</p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      {current.status === 'INVITED' && canInvite && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="mb-2 text-amber-800 dark:text-amber-300">This invitation has not been accepted yet.</p>
          <Button variant="secondary" onClick={onResend} loading={busy} disabled={resendDone}>
            {resendDone ? 'Invitation resent' : 'Resend invitation'}
          </Button>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Profile</h2>
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
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Roles</h2>
        <div className="space-y-1.5">
          {assignableRoles.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                disabled={!canManageRoles}
                checked={roleKeys.includes(role as RoleKey)}
                onChange={() => toggleRole(role as RoleKey)}
              />
              {role}
            </label>
          ))}
        </div>
        {canManageRoles && (
          <Button onClick={onSaveRoles} loading={saving}>
            Save roles
          </Button>
        )}
      </div>

      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      <div className="flex justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button variant="secondary" onClick={() => router.back()}>
          Back
        </Button>
        {canUpdate && current.status !== 'INVITED' && current.status !== 'DISABLED' && (
          <Button variant={current.status === 'SUSPENDED' ? 'primary' : 'danger'} onClick={() => setConfirmSuspend(true)}>
            {current.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          </Button>
        )}
      </div>

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
