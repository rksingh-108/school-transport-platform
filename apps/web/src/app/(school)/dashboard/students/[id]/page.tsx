'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { StudentDto } from '@school-transport/shared-types';
import { archiveStudent, getStudent, updateStudent } from '@/lib/api/students';
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

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: student, error, loading, reload } = useAsync(() => getStudent(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !student) return <ErrorState message={errorMessage(error, 'Student not found.')} onRetry={reload} />;

  return <StudentEditForm key={student.id} student={student} onArchived={reload} />;
}

function StudentEditForm({ student, onArchived }: { student: StudentDto; onArchived: () => void }) {
  const router = useRouter();
  const { principal } = useAuth();
  const canUpdate = principal?.type === 'STAFF' && principal.permissions.includes('students.update');
  const canArchive = principal?.type === 'STAFF' && principal.permissions.includes('students.delete');

  const [current, setCurrent] = useState(student);
  const [fullName, setFullName] = useState(student.fullName);
  const [grade, setGrade] = useState(student.grade ?? '');
  const [section, setSection] = useState(student.section ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function onSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await updateStudent(student.id, { fullName, grade: grade || undefined, section: section || undefined });
      setCurrent(updated);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onArchive() {
    setArchiving(true);
    try {
      const updated = await archiveStudent(student.id);
      setCurrent(updated);
      setConfirmArchive(false);
      onArchived();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to archive student.');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="max-w-lg">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{current.fullName}</h1>
          <p className="text-sm text-zinc-500">Admission #{current.admissionNumber}</p>
        </div>
        <StatusBadge status={current.status} />
      </div>

      <div className="space-y-4">
        <FormField label="Full name" htmlFor="fullName">
          <Input id="fullName" value={fullName} disabled={!canUpdate} onChange={(e) => setFullName(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Grade" htmlFor="grade">
            <Input id="grade" value={grade} disabled={!canUpdate} onChange={(e) => setGrade(e.target.value)} />
          </FormField>
          <FormField label="Section" htmlFor="section">
            <Input id="section" value={section} disabled={!canUpdate} onChange={(e) => setSection(e.target.value)} />
          </FormField>
        </div>
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
        <div className="flex justify-between">
          <div className="flex gap-2">
            {canUpdate && (
              <Button onClick={onSave} loading={saving}>
                Save changes
              </Button>
            )}
            <Button variant="secondary" onClick={() => router.back()}>
              Back
            </Button>
          </div>
          {canArchive && current.status === 'ACTIVE' && (
            <Button variant="danger" onClick={() => setConfirmArchive(true)}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this student?"
        description="The student will be marked inactive and hidden from active rosters. This does not delete their records."
        confirmLabel="Archive"
        danger
        loading={archiving}
        onConfirm={onArchive}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}
