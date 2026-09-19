'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { listStudents } from '@/lib/api/students';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useDebounce } from '@/lib/use-debounce';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { CursorPagination } from '@/components/ui/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { StudentDto } from '@school-transport/shared-types';

export default function StudentsPage() {
  const { principal } = useAuth();
  const canCreate = principal?.type === 'STAFF' && principal.permissions.includes('students.create');

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput);
  const [status, setStatus] = useState('');
  const pagination = useCursorPagination();

  const { data: page, error, loading, reload } = useAsync(
    () => listStudents({ limit: 20, cursor: pagination.cursor ?? undefined, search: search || undefined, status: status || undefined }),
    [search, status, pagination.cursor],
  );

  const items = page?.data ?? [];

  const columns: DataTableColumn<StudentDto>[] = [
    { key: 'admission', header: 'Admission #', render: (s) => s.admissionNumber },
    {
      key: 'name',
      header: 'Name',
      render: (s) => (
        <Link href={`/dashboard/students/${s.id}`} className="font-medium text-(--color-text) hover:text-(--color-brand-text) hover:underline">
          {s.fullName}
        </Link>
      ),
    },
    { key: 'grade', header: 'Grade', render: (s) => s.grade ?? '—' },
    { key: 'section', header: 'Section', render: (s) => s.section ?? '—' },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Students"
        description="Enrollment records and transport eligibility."
        actions={
          canCreate && (
            <Link href="/dashboard/students/new">
              <Button icon={Plus}>New student</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          placeholder="Search by name or admission number"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            pagination.reset();
          }}
          className="sm:max-w-[180px]"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="GRADUATED">Graduated</option>
        </Select>
      </div>

      {loading && <TableSkeleton columns={5} />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load students.'} onRetry={reload} />
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState title="No students found" description="Try adjusting your search or filters." />
      )}
      {!loading && !error && items.length > 0 && (
        <DataTable columns={columns} rows={items} getRowKey={(s) => s.id} />
      )}
      {!loading && !error && items.length > 0 && (
        <CursorPagination hasPrev={pagination.hasPrev} hasNext={!!page?.nextCursor} onPrev={pagination.prev} onNext={() => pagination.next(page?.nextCursor)} />
      )}
    </div>
  );
}
