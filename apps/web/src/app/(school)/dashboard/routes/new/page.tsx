'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createRoute } from '@/lib/api/routes';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

export default function NewRoutePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<'HOME_TO_SCHOOL' | 'SCHOOL_TO_HOME'>('HOME_TO_SCHOOL');
  const [shift, setShift] = useState<'MORNING_PICKUP' | 'AFTERNOON_DROP' | 'CUSTOM'>('MORNING_PICKUP');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const route = await createRoute({
        code: code || undefined,
        name,
        direction,
        shift,
        description: description || undefined,
      });
      router.replace(`/dashboard/routes/${route.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create route.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="New route" breadcrumbs={[{ label: 'Routes', href: '/dashboard/routes' }, { label: 'New' }]} />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Code" htmlFor="code">
                <Input id="code" placeholder="R-01" value={code} onChange={(e) => setCode(e.target.value)} />
              </FormField>
              <FormField label="Name" htmlFor="name">
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Direction" htmlFor="direction">
              <Select id="direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
                <option value="HOME_TO_SCHOOL">Home → School</option>
                <option value="SCHOOL_TO_HOME">School → Home</option>
              </Select>
            </FormField>
            <FormField label="Shift" htmlFor="shift">
              <Select id="shift" value={shift} onChange={(e) => setShift(e.target.value as typeof shift)}>
                <option value="MORNING_PICKUP">Morning pickup</option>
                <option value="AFTERNOON_DROP">Afternoon drop</option>
                <option value="CUSTOM">Custom</option>
              </Select>
            </FormField>
            <FormField label="Description" htmlFor="description">
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
            {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}
            <div className="flex gap-2 border-t border-(--color-border) pt-4">
              <Button type="submit" loading={loading}>
                Create route
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
