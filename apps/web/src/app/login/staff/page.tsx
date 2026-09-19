'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { staffLogin } from '@/lib/api/auth';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/field';
import { AuthSplitLayout } from '@/components/auth-split-layout';

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
    <AuthSplitLayout>
      <h1 className="mb-1 text-xl font-semibold text-(--color-text)">Staff sign in</h1>
      <p className="mb-6 text-sm text-(--color-text-muted)">Sign in with your school staff account.</p>
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
        {error && (
          <p className="flex items-start gap-2 rounded-(--radius-sm) border border-(--color-danger-border) bg-(--color-danger-bg) p-3 text-sm text-(--color-danger-text)">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-(--color-text-muted)">
        Parent?{' '}
        <Link href="/login/parent" className="font-medium text-(--color-brand-text) hover:underline">
          Sign in here
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
