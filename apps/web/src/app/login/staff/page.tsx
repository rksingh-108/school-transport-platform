'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { staffLogin } from '@/lib/api/auth';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';

export default function StaffLoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await staffLogin(email, password);
      if (result.status === 'MFA_REQUIRED') {
        setError('Multi-factor authentication is required for this account but is not yet supported here.');
        return;
      }
      await refresh();
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Staff sign in</h1>
        <p className="mb-6 text-sm text-zinc-500">Sign in with your school staff account.</p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-zinc-500">
          Parent?{' '}
          <a href="/login/parent" className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Sign in here
          </a>
        </p>
      </div>
    </div>
  );
}
