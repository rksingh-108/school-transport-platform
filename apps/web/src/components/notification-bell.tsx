import Link from 'next/link';

/** Shared by both the parent and staff dashboards — purely presentational; each caller supplies its own unread count and destination. */
export function NotificationBell({ href, unreadCount }: { href: string; unreadCount: number }) {
  return (
    <Link href={href} className="relative inline-flex items-center rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      Notifications
      {unreadCount > 0 && (
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
