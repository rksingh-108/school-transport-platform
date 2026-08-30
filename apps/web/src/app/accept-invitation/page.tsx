'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInvitation } from '@/lib/api/auth';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<'STAFF' | 'PARENT' | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('This invitation link is missing its token. Please use the link from your invitation exactly as sent.');
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must be at least 10 characters and contain a letter and a number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await acceptInvitation(token, password);
      setDone(result.principalType);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to accept this invitation. It may be expired or already used.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    const loginPath = done === 'STAFF' ? '/login/staff' : '/login/parent';
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Account activated</h1>
        <p className="mb-6 text-sm text-zinc-500">Your password has been set. You can now sign in.</p>
        <Button className="w-full" onClick={() => router.replace(loginPath)}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Set your password</h1>
      <p className="mb-6 text-sm text-zinc-500">Finish setting up your account to activate it.</p>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField label="New password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-zinc-500">At least 10 characters, with a letter and a number.</p>
        </FormField>
        <FormField label="Confirm password" htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Activate account
        </Button>
      </form>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
        <AcceptInvitationForm />
      </Suspense>
    </div>
  );
}
