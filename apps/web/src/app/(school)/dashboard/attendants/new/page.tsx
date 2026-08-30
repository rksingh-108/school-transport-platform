'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StaffDto } from '@school-transport/shared-types';
import { listStaff } from '@/lib/api/staff';
import { createAttendant } from '@/lib/api/attendants';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

export default function NewAttendantPage() {
  const router = useRouter();
  const [staffQuery, setStaffQuery] = useState('');
  const [staffResults, setStaffResults] = useState<StaffDto[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffDto | null>(null);
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
      setError('Select a staff member to assign as attendant.');
      return;
    }
    setLoading(true);
    try {
      const attendant = await createAttendant({ userId: selectedStaff.id });
      router.replace(`/dashboard/attendants/${attendant.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to assign attendant.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Assign attendant</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Attaches an attendant profile to an existing staff member. To onboard someone new, invite them as staff first.
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
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Assign attendant
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
