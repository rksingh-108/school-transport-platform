'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ParentDto, ParentStudentLinkDto, StudentDto } from '@school-transport/shared-types';
import { ArrowLeft } from 'lucide-react';
import { getParent, linkStudentToParent, listParentChildren, unlinkParentStudent, updateParent, verifyParentStudentLink } from '@/lib/api/parents';
import { listStudents } from '@/lib/api/students';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button, IconButton } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function errorMessage(error: unknown, notFoundMessage: string): string {
  if (error instanceof ApiError) return error.status === 404 ? notFoundMessage : error.message;
  return 'Something went wrong.';
}

async function loadParentAndLinks(id: string) {
  const [parent, links] = await Promise.all([getParent(id), listParentChildren(id)]);
  return { parent, links };
}

export default function ParentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => loadParentAndLinks(id), [id]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={errorMessage(error, 'Parent not found.')} onRetry={reload} />;

  return <ParentEditForm key={data.parent.id} parent={data.parent} initialLinks={data.links} />;
}

function ParentEditForm({ parent, initialLinks }: { parent: ParentDto; initialLinks: ParentStudentLinkDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const { principal } = useAuth();
  const canUpdate = principal?.type === 'STAFF' && principal.permissions.includes('parents.update');
  const canManageLinks = principal?.type === 'STAFF' && principal.permissions.includes('parents.manage_relationships');

  const [current, setCurrent] = useState(parent);
  const [fullName, setFullName] = useState(parent.fullName);
  const [email, setEmail] = useState(parent.email ?? '');
  const [links, setLinks] = useState(initialLinks);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentDto[]>([]);
  const [linking, setLinking] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<ParentStudentLinkDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!studentQuery.trim()) return;
    let ignore = false;
    const handle = setTimeout(() => {
      listStudents({ search: studentQuery, limit: 5 }).then(
        (page) => {
          if (!ignore) setStudentResults(page.data);
        },
        () => {
          if (!ignore) setStudentResults([]);
        },
      );
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [studentQuery]);

  function onQueryChange(value: string) {
    setStudentQuery(value);
    if (!value.trim()) setStudentResults([]);
  }

  async function onSaveProfile() {
    setActionError(null);
    setSaving(true);
    try {
      const updated = await updateParent(current.id, { fullName, email: email || undefined });
      setCurrent(updated);
      toast.success('Profile saved');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function onLink(student: StudentDto) {
    setActionError(null);
    setLinking(true);
    try {
      const link = await linkStudentToParent(current.id, { studentId: student.id });
      setLinks((prev) => [link, ...prev]);
      setStudentQuery('');
      setStudentResults([]);
      toast.success('Student linked');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to link student.');
    } finally {
      setLinking(false);
    }
  }

  async function onVerify(linkId: string) {
    setActionError(null);
    setBusy(true);
    try {
      const updated = await verifyParentStudentLink(linkId);
      setLinks((prev) => prev.map((l) => (l.id === linkId ? updated : l)));
      toast.success('Link verified');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to verify link.');
    } finally {
      setBusy(false);
    }
  }

  async function onUnlink() {
    if (!unlinkTarget) return;
    setActionError(null);
    setBusy(true);
    try {
      await unlinkParentStudent(unlinkTarget.id);
      setLinks((prev) => prev.filter((l) => l.id !== unlinkTarget.id));
      setUnlinkTarget(null);
      toast.success('Student unlinked');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to unlink student.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Parents', href: '/dashboard/parents' }, { label: current.fullName }]}
        title={current.fullName}
        description={current.phone}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={current.status} />
            <IconButton icon={ArrowLeft} label="Back" variant="secondary" onClick={() => router.back()} />
          </div>
        }
      />

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
        <CardHeader title="Linked children" />
        <CardBody className="space-y-3">
          {links.length === 0 && <EmptyState title="No linked children yet" />}
          {links.map((link) => (
            <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-md) border border-(--color-border) px-3 py-2">
              <div>
                <p className="text-sm font-medium text-(--color-text)">{link.studentFullName}</p>
                <p className="text-xs text-(--color-text-faint)">{link.relationship}</p>
              </div>
              <div className="flex items-center gap-2">
                {link.verified ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="warning" dot>Unverified</Badge>}
                {canManageLinks && !link.verified && (
                  <Button variant="secondary" size="sm" onClick={() => onVerify(link.id)} disabled={busy}>
                    Verify
                  </Button>
                )}
                {canManageLinks && (
                  <Button variant="danger" size="sm" onClick={() => setUnlinkTarget(link)} disabled={busy}>
                    Unlink
                  </Button>
                )}
              </div>
            </div>
          ))}

          {canManageLinks && (
            <div className="relative pt-2">
              <FormField label="Link a student" htmlFor="studentSearch">
                <Input
                  id="studentSearch"
                  placeholder="Search by name or admission number"
                  value={studentQuery}
                  onChange={(e) => onQueryChange(e.target.value)}
                />
              </FormField>
              {studentResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-raised) shadow-(--shadow-md)">
                  {studentResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={linking}
                      onClick={() => onLink(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-sunken)"
                    >
                      {s.fullName} · #{s.admissionNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {actionError && <p className="text-sm text-(--color-danger-text)">{actionError}</p>}

      <ConfirmDialog
        open={!!unlinkTarget}
        title="Unlink this student?"
        description={`This removes ${unlinkTarget?.studentFullName ?? 'the student'} from this parent's linked children.`}
        confirmLabel="Unlink"
        danger
        loading={busy}
        onConfirm={onUnlink}
        onCancel={() => setUnlinkTarget(null)}
      />
    </div>
  );
}
