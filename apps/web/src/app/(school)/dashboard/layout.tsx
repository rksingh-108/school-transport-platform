'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bus as BusIcon, ChevronsLeft, ChevronsRight, LogOut, Menu, X } from 'lucide-react';
import { RequireAuth } from '@/components/require-auth';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { getStaffUnreadCount } from '@/lib/api/notifications';
import { IconButton } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Drawer } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { DashboardHeader } from '@/components/dashboard-header';
import { cn } from '@/lib/cn';
import { NAV_GROUPS, isNavItemActive, type NavGroup } from './nav-config';

const COLLAPSE_KEY = 'dashboard-sidebar-collapsed';

function Brand({ collapsed, schoolName }: { collapsed: boolean; schoolName: string }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-sm) bg-[image:var(--gradient-brand)] text-white shadow-(--shadow-sm)">
        <BusIcon className="h-[18px] w-[18px]" />
      </span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-(--color-text)">{schoolName}</p>
          <p className="text-xs text-(--color-text-faint)">Transport Platform</p>
        </div>
      )}
    </div>
  );
}

function NavLinks({
  groups,
  pathname,
  collapsed,
  unreadCount,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  unreadCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && !collapsed && (
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-(--color-text-faint)">{group.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-(--radius-sm) px-3 py-2 text-sm font-medium transition-all duration-150',
                    active
                      ? 'bg-(--color-brand-bg) text-(--color-brand-text)'
                      : 'text-(--color-text-muted) hover:translate-x-0.5 hover:bg-(--color-surface-sunken) hover:text-(--color-text)',
                  )}
                >
                  {active && (
                    <span className="absolute -left-3 top-1/2 h-[18px] w-0.5 -translate-y-1/2 rounded-full bg-(--color-brand)" />
                  )}
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-transform duration-150',
                      !active && 'group-hover:scale-110',
                    )}
                  />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && item.href === '/dashboard/notifications' && unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-(--color-danger-solid) px-1 text-xs font-medium text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { principal, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on navigation — adjusted during render (React's
  // recommended alternative to a setState-in-effect) rather than an effect.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  const canSeeAlerts = principal?.type === 'STAFF' && principal.permissions.includes('notifications.read');
  const { data: unread } = useAsync(() => (canSeeAlerts ? getStaffUnreadCount() : Promise.resolve({ count: 0 })), [canSeeAlerts]);
  const unreadCount = unread?.count ?? 0;

  if (!principal || principal.type !== 'STAFF') return null;
  const permissions = principal.permissions;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  async function onLogout() {
    await logout();
    router.replace('/login/staff');
  }

  const roleLabel = principal.roles[0]?.replaceAll('_', ' ') ?? '';

  return (
    <div className="flex min-h-screen bg-(--color-surface-sunken)">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-(--color-border) px-4 py-4">
          <Brand collapsed={collapsed} schoolName={principal.school.name} />
        </div>
        <NavLinks groups={visibleGroups} pathname={pathname} collapsed={collapsed} unreadCount={unreadCount} />
        <div className="border-t border-(--color-border) p-3">
          <div className={cn('flex items-center gap-2.5 rounded-(--radius-sm) px-1 py-1.5', collapsed && 'justify-center')}>
            <Avatar name={principal.fullName} size="sm" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--color-text)">{principal.fullName}</p>
                <p className="truncate text-xs text-(--color-text-faint)">{roleLabel}</p>
              </div>
            )}
            <IconButton icon={LogOut} label="Sign out" size="sm" onClick={onLogout} />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-(--radius-sm) px-3 py-1.5 text-xs font-medium text-(--color-text-faint) hover:bg-(--color-surface-sunken) hover:text-(--color-text-muted)"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : (
              <>
                <ChevronsLeft className="h-4 w-4" /> Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-surface)/90 px-4 py-3 backdrop-blur-md lg:hidden">
          <Brand collapsed={false} schoolName={principal.school.name} />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <IconButton icon={Menu} label="Open menu" onClick={() => setMobileOpen(true)} />
          </div>
        </header>

        {/* Desktop top navigation — page context, alerts, theme, account */}
        <div className="hidden lg:block">
          <DashboardHeader />
        </div>

        <main key={pathname} className="mx-auto w-full max-w-[1400px] flex-1 animate-fade-up p-4 sm:p-6">
          {children}
        </main>
      </div>

      {/* Mobile drawer */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)}>
        <div className="flex items-center justify-between gap-2 border-b border-(--color-border) px-4 py-4">
          <Brand collapsed={false} schoolName={principal.school.name} />
          <IconButton icon={X} label="Close menu" onClick={() => setMobileOpen(false)} />
        </div>
        <NavLinks
          groups={visibleGroups}
          pathname={pathname}
          collapsed={false}
          unreadCount={unreadCount}
          onNavigate={() => setMobileOpen(false)}
        />
        <div className="border-t border-(--color-border) p-3">
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <Avatar name={principal.fullName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--color-text)">{principal.fullName}</p>
              <p className="truncate text-xs text-(--color-text-faint)">{roleLabel}</p>
            </div>
            <IconButton icon={LogOut} label="Sign out" size="sm" onClick={onLogout} />
          </div>
        </div>
      </Drawer>
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
