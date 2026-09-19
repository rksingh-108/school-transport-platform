'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  CheckCheck,
  ChevronDown,
  LogOut,
  Satellite,
  UserCheck,
  UserX,
  WifiOff,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import { getStaffNotifications, getStaffUnreadCount, markAllStaffNotificationsRead } from '@/lib/api/notifications';
import { useAsync } from '@/lib/use-async';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from '@/components/ui/avatar';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/cn';
import { NAV_GROUPS, isNavItemActive } from '@/app/(school)/dashboard/nav-config';

/** Current section label for the header, e.g. "Operations / Live Tracking". */
function SectionContext({ pathname }: { pathname: string }) {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isNavItemActive(pathname, item.href)) {
        return (
          <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
            {group.label && <span className="hidden truncate text-(--color-text-faint) sm:inline">{group.label} /</span>}
            <span className="truncate font-medium text-(--color-text)">{item.label}</span>
          </span>
        );
      }
    }
  }
  return null;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const NOTIFICATION_ICON: Record<string, { icon: typeof Bell; className: string }> = {
  CHILD_BOARDED: { icon: UserCheck, className: 'text-(--color-success-text) bg-(--color-success-bg)' },
  CHILD_DROPPED_OFF: { icon: UserCheck, className: 'text-(--color-success-text) bg-(--color-success-bg)' },
  TRIP_CANCELLED: { icon: XCircle, className: 'text-(--color-danger-text) bg-(--color-danger-bg)' },
  TRIP_NO_SHOW: { icon: UserX, className: 'text-(--color-danger-text) bg-(--color-danger-bg)' },
  GPS_STALE: { icon: WifiOff, className: 'text-(--color-warning-text) bg-(--color-warning-bg)' },
  GPS_OFFLINE: { icon: Satellite, className: 'text-(--color-danger-text) bg-(--color-danger-bg)' },
};

function NotificationMenu({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: page, reload } = useAsync(
    () => (open ? getStaffNotifications({ limit: 6 }) : Promise.resolve(null)),
    [open],
  );
  const { reload: reloadCount } = useAsync(() => getStaffUnreadCount(), []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function onMarkAllRead() {
    try {
      await markAllStaffNotificationsRead();
      reload();
      reloadCount();
    } catch {
      // Non-fatal: badge refreshes on next poll/navigation.
    }
  }

  const items = page?.data ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-(--radius-sm) text-(--color-text-muted) transition-colors hover:bg-(--color-surface-sunken) hover:text-(--color-text) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand)"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-danger-solid) px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-raised) shadow-(--shadow-lg)">
          <div className="flex items-center justify-between gap-2 border-b border-(--color-border) px-4 py-3">
            <p className="text-sm font-semibold text-(--color-text)">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="flex items-center gap-1 text-xs font-medium text-(--color-brand-text) hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-(--color-text-faint)">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-(--color-border)">
                {items.map((n) => {
                  const cfg = NOTIFICATION_ICON[n.eventType] ?? { icon: Bell, className: 'text-(--color-info-text) bg-(--color-info-bg)' };
                  const Icon = cfg.icon;
                  return (
                    <li key={n.id} className={cn('flex gap-3 px-4 py-3', !n.readAt && 'bg-(--color-brand-bg)/40')}>
                      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-sm)', cfg.className)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-(--color-text)">{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-(--color-text-muted)">{n.body}</p>
                        <p className="mt-1 text-[11px] text-(--color-text-faint)">{relativeTime(n.createdAt)}</p>
                      </div>
                      {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-(--color-brand)" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-(--color-border) px-4 py-2.5 text-center text-sm font-medium text-(--color-brand-text) hover:bg-(--color-surface-sunken)"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { principal, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!principal || principal.type !== 'STAFF') return null;
  const roleLabel = principal.roles[0]?.replaceAll('_', ' ') ?? '';

  async function onLogout() {
    await logout();
    router.replace('/login/staff');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-(--radius-sm) px-1.5 py-1 transition-colors hover:bg-(--color-surface-sunken) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand)"
      >
        <Avatar name={principal.fullName} size="sm" />
        <span className="hidden min-w-0 text-left md:block">
          <span className="block max-w-[140px] truncate text-sm font-medium text-(--color-text)">{principal.fullName}</span>
          <span className="block max-w-[140px] truncate text-xs text-(--color-text-faint)">{roleLabel}</span>
        </span>
        <ChevronDown className={cn('hidden h-3.5 w-3.5 text-(--color-text-faint) transition-transform md:block', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-raised) py-1 shadow-(--shadow-lg)">
          <div className="border-b border-(--color-border) px-4 py-3">
            <p className="truncate text-sm font-semibold text-(--color-text)">{principal.fullName}</p>
            <p className="truncate text-xs text-(--color-text-muted)">{principal.school.name}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-(--color-brand-text)">
              <ShieldCheck className="h-3.5 w-3.5" /> {roleLabel}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-(--color-danger-text) transition-colors hover:bg-(--color-danger-bg)"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardHeader() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Poll the unread count so new alerts surface in the header without a reload.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { count } = await getStaffUnreadCount();
        if (!cancelled) setUnread(count);
      } catch {
        // ignore transient failures — retry on next tick
      }
    }
    poll();
    const interval = window.setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-surface)/85 px-4 backdrop-blur-md sm:px-6">
      <div className="min-w-0">
        <SectionContext pathname={pathname} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <NotificationMenu unreadCount={unread} />
        <div className="mx-1 h-6 w-px bg-(--color-border)" />
        <UserMenu />
      </div>
    </header>
  );
}