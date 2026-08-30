'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF_ROLE_KEYS } from '@school-transport/shared-schemas';
import type { RoleKey } from '@school-transport/shared-types';
import { inviteStaff } from '@/lib/api/staff';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

export default function InviteStaffPage() {
  const router = useRouter();
  const { principal } = useAuth();
  const isSuperAdmin = principal?.type === 'STAFF' && principal.roles.includes('SUPER_ADMIN');
  // Only a SUPER_ADMIN can grant SUPER_ADMIN (docs/security.md) — hide the
  // option for everyone else rather than let them hit a guaranteed 400.
  const assignableRoles = STAFF_ROLE_KEYS.filter((role) => role !== 'SUPER_ADMIN' || isSuperAdmin);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleKeys, setRoleKeys] = useState<RoleKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleRole(role: RoleKey) {
    setRoleKeys((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (roleKeys.length === 0) {
      setError('Select at least one role.');
      return;
    }
    setLoading(true);
    try {
      const staff = await inviteStaff({ email, fullName, roleKeys });
      router.replace(`/dashboard/staff/${staff.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send invitation.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Invite staff</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField label="Full name" htmlFor="fullName">
          <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <FormField label="Email" htmlFor="email">
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <div>
          <p className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Roles</p>
          <div className="space-y-1.5">
            {assignableRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={roleKeys.includes(role as RoleKey)} onChange={() => toggleRole(role as RoleKey)} />
                {role}
              </label>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Send invitation
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
