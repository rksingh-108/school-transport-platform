'use client';

import { useAuth } from '@/lib/auth-context';

export default function DashboardOverviewPage() {
  const { principal } = useAuth();
  if (!principal || principal.type !== 'STAFF') return null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Welcome, {principal.fullName}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {principal.school.name} · {principal.roles.join(', ')}
      </p>
    </div>
  );
}
