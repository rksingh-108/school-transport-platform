'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createBus } from '@/lib/api/buses';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';

export default function NewBusPage() {
  const router = useRouter();
  const [fleetNumber, setFleetNumber] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [capacity, setCapacity] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [manufactureYear, setManufactureYear] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const bus = await createBus({
        fleetNumber: fleetNumber || undefined,
        registrationNumber,
        capacity: Number(capacity),
        make: make || undefined,
        model: model || undefined,
        manufactureYear: manufactureYear ? Number(manufactureYear) : undefined,
        notes: notes || undefined,
      });
      router.replace(`/dashboard/buses/${bus.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create bus.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="New bus" breadcrumbs={[{ label: 'Buses', href: '/dashboard/buses' }, { label: 'New' }]} />
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Fleet number" htmlFor="fleetNumber">
                <Input id="fleetNumber" value={fleetNumber} onChange={(e) => setFleetNumber(e.target.value)} />
              </FormField>
              <FormField label="Registration number" htmlFor="registrationNumber">
                <Input id="registrationNumber" required value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Capacity" htmlFor="capacity">
              <Input id="capacity" type="number" min={1} max={200} required value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Make" htmlFor="make">
                <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} />
              </FormField>
              <FormField label="Model" htmlFor="model">
                <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} />
              </FormField>
              <FormField label="Year" htmlFor="manufactureYear">
                <Input id="manufactureYear" type="number" value={manufactureYear} onChange={(e) => setManufactureYear(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Notes" htmlFor="notes">
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
            {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}
            <div className="flex gap-2 border-t border-(--color-border) pt-4">
              <Button type="submit" loading={loading}>
                Create bus
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
