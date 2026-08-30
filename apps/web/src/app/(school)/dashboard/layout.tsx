'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', permission: null },
  { href: '/dashboard/students', label: 'Students', permission: 'students.read' },
  { href: '/dashboard/staff', label: 'Staff', permission: 'users.read' },
  { href: '/dashboard/parents', label: 'Parents', permission: 'parents.read' },
] as const;

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { principal, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (!principal || principal.type !== 'STAFF') return null;
  const permissions = principal.permissions;

  async function onLogout() {
    await logout();
    router.replace('/login/staff');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{principal.school.name}</p>
          <p className="text-xs text-zinc-500">{principal.fullName}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.filter((item) => !item.permission || permissions.includes(item.permission)).map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <Button variant="secondary" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth audience="STAFF">
      <DashboardShell>{children}</DashboardShell>
    </RequireAuth>
  );
}
