'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { StudentDto } from '@school-transport/shared-types';
import { ArrowLeft } from 'lucide-react';
import { archiveStudent, getStudent, updateStudent } from '@/lib/api/students';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
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
  const toast = useToast();
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
      toast.success('Student saved');
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
      toast.success('Student archived');
      onArchived();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Unable to archive student.');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        breadcrumbs={[{ label: 'Students', href: '/dashboard/students' }, { label: current.fullName }]}
        title={current.fullName}
        description={`Admission #${current.admissionNumber}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={current.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <FormField label="Full name" htmlFor="fullName">
            <Input id="fullName" value={fullName} disabled={!canUpdate} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Grade" htmlFor="grade">
              <Input id="grade" value={grade} disabled={!canUpdate} onChange={(e) => setGrade(e.target.value)} />
            </FormField>
            <FormField label="Section" htmlFor="section">
              <Input id="section" value={section} disabled={!canUpdate} onChange={(e) => setSection(e.target.value)} />
            </FormField>
          </div>
          {saveError && <p className="text-sm text-(--color-danger-text)">{saveError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border) pt-4">
            {canUpdate && (
              <Button onClick={onSave} loading={saving}>
                Save changes
              </Button>
            )}
            {canArchive && current.status === 'ACTIVE' && (
              <Button variant="danger" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

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
