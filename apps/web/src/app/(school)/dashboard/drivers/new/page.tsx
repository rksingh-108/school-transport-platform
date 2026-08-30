'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StaffDto } from '@school-transport/shared-types';
import { listStaff } from '@/lib/api/staff';
import { createDriver } from '@/lib/api/drivers';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

export default function NewDriverPage() {
  const router = useRouter();
  const [staffQuery, setStaffQuery] = useState('');
  const [staffResults, setStaffResults] = useState<StaffDto[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffDto | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!staffQuery.trim()) return;
    let ignore = false;
    const handle = setTimeout(() => {
      listStaff({ search: staffQuery, limit: 5 }).then(
        (page) => {
          if (!ignore) setStaffResults(page.data);
        },
        () => {
          if (!ignore) setStaffResults([]);
        },
      );
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [staffQuery]);

  function onQueryChange(value: string) {
    setStaffQuery(value);
    setSelectedStaff(null);
    if (!value.trim()) setStaffResults([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedStaff) {
      setError('Select a staff member to assign as driver.');
      return;
    }
    setLoading(true);
    try {
      const driver = await createDriver({
        userId: selectedStaff.id,
        licenseNumber,
        licenseExpiry: licenseExpiry || undefined,
      });
      router.replace(`/dashboard/drivers/${driver.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to assign driver.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Assign driver</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Attaches a driver profile to an existing staff member. To onboard someone new, invite them as staff first.
      </p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="relative">
          <FormField label="Staff member" htmlFor="staffSearch">
            <Input
              id="staffSearch"
              placeholder="Search by name or email"
              value={selectedStaff ? selectedStaff.fullName : staffQuery}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </FormField>
          {!selectedStaff && staffResults.length > 0 && (
            <div className="mt-1 rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              {staffResults.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedStaff(s);
                    setStaffResults([]);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {s.fullName} · {s.email}
                </button>
              ))}
            </div>
          )}
        </div>
        <FormField label="License number" htmlFor="licenseNumber">
          <Input id="licenseNumber" required value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
        </FormField>
        <FormField label="License expiry" htmlFor="licenseExpiry">
          <Input id="licenseExpiry" type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Assign driver
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
