'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createStudent } from '@/lib/api/students';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

export default function NewStudentPage() {
  const router = useRouter();
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const student = await createStudent({
        admissionNumber,
        fullName,
        dateOfBirth: dateOfBirth || undefined,
        grade: grade || undefined,
        section: section || undefined,
      });
      router.replace(`/dashboard/students/${student.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create student.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="New student" breadcrumbs={[{ label: 'Students', href: '/dashboard/students' }, { label: 'New' }]} />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField label="Admission number" htmlFor="admissionNumber">
              <Input id="admissionNumber" required value={admissionNumber} onChange={(e) => setAdmissionNumber(e.target.value)} />
            </FormField>
            <FormField label="Full name" htmlFor="fullName">
              <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </FormField>
            <FormField label="Date of birth" htmlFor="dateOfBirth">
              <Input id="dateOfBirth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Grade" htmlFor="grade">
                <Input id="grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
              </FormField>
              <FormField label="Section" htmlFor="section">
                <Input id="section" value={section} onChange={(e) => setSection(e.target.value)} />
              </FormField>
            </div>
            {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}
            <div className="flex gap-2 border-t border-(--color-border) pt-4">
              <Button type="submit" loading={loading}>
                Create student
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
