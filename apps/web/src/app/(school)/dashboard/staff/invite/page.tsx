'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF_ROLE_KEYS } from '@school-transport/shared-schemas';
import type { RoleKey } from '@school-transport/shared-types';
import { inviteStaff } from '@/lib/api/staff';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Label } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

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
      <PageHeader title="Invite staff" breadcrumbs={[{ label: 'Staff', href: '/dashboard/staff' }, { label: 'Invite' }]} />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField label="Full name" htmlFor="fullName">
              <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </FormField>
            <FormField label="Email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <div>
              <Label>Roles</Label>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {assignableRoles.map((role) => (
                  <label key={role} className="flex items-center gap-2 rounded-(--radius-sm) px-1 py-1 text-sm text-(--color-text-muted) hover:bg-(--color-surface-sunken)">
                    <input
                      type="checkbox"
                      checked={roleKeys.includes(role as RoleKey)}
                      onChange={() => toggleRole(role as RoleKey)}
                      className="h-4 w-4 rounded border-(--color-border-strong) text-(--color-brand) focus:ring-(--color-brand-border)"
                    />
                    {role.replaceAll('_', ' ')}
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}
            <div className="flex gap-2 border-t border-(--color-border) pt-4">
              <Button type="submit" loading={loading}>
                Send invitation
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
