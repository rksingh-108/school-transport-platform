'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createBus } from '@/lib/api/buses';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

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
      <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-50">New bus</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-3 gap-4">
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
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={loading}>
            Create bus
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
