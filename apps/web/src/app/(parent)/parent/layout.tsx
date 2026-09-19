'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bus as BusIcon, Home, Bell, LogOut } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useParentSocket } from '@/lib/realtime/parent-socket';
import { getMyUnreadCount } from '@/lib/api/notifications';
import { IconButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/parent', label: 'Home', icon: Home },
  { href: '/parent/notifications', label: 'Alerts', icon: Bell },
] as const;

function ParentShell({ children }: { children: React.ReactNode }) {
  const { principal, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { data: unread } = useAsync(() => getMyUnreadCount(), [pathname]);
  const [liveUnreadDelta, setLiveUnreadDelta] = useState(0);
  const onNotification = useCallback(() => setLiveUnreadDelta((prev) => prev + 1), []);
  useParentSocket(useCallback(() => {}, []), onNotification);

  // Reset the live delta on navigation, adjusted during render rather than
  // in an effect — `unread` is refetched for the new pathname at the same time.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setLiveUnreadDelta(0);
  }
  const unreadCount = (unread?.count ?? 0) + liveUnreadDelta;

  if (!principal || principal.type !== 'PARENT') return null;

  async function onLogout() {
    await logout();
    router.replace('/login/parent');
  }

  return (
    <div className="flex min-h-screen flex-col bg-(--color-surface-sunken)">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-(--color-border) bg-(--color-surface)/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-(--radius-sm) bg-[image:var(--gradient-brand)] text-white shadow-(--shadow-sm)">
            <BusIcon className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-(--color-text)">{principal.school.name}</p>
            <p className="text-xs text-(--color-text-faint)">{principal.fullName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <IconButton icon={LogOut} label="Sign out" onClick={onLogout} />
        </div>
      </header>

      <main key={pathname} className="mx-auto w-full max-w-lg flex-1 animate-fade-up px-4 py-6">
        {children}
      </main>

      <nav className="sticky bottom-0 z-20 border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-lg">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors duration-150',
                  active ? 'text-(--color-brand-text)' : 'text-(--color-text-faint) hover:text-(--color-text-muted)',
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform duration-150', active && 'scale-110')} />
                {tab.label}
                {tab.href === '/parent/notifications' && unreadCount > 0 && (
                  <span className="absolute right-1/3 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-danger-solid) px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth audience="PARENT">
      <ParentShell>{children}</ParentShell>
    </RequireAuth>
  );
}
