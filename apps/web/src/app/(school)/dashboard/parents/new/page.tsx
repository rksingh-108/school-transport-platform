'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createParent } from '@/lib/api/parents';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

export default function NewParentPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const parent = await createParent({ phone, fullName, email: email || undefined });
      router.replace(`/dashboard/parents/${parent.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create parent.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title="New parent"
        description="An invitation to set a password will be sent automatically."
        breadcrumbs={[{ label: 'Parents', href: '/dashboard/parents' }, { label: 'New' }]}
      />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormField label="Full name" htmlFor="fullName">
              <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </FormField>
            <FormField label="Phone number" htmlFor="phone">
              <Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label="Email (optional)" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}
            <div className="flex gap-2 border-t border-(--color-border) pt-4">
              <Button type="submit" loading={loading}>
                Create parent
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
