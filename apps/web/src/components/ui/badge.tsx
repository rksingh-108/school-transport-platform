import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-(--color-neutral-bg) text-(--color-neutral-text) ring-(--color-neutral-border)',
  success: 'bg-(--color-success-bg) text-(--color-success-text) ring-(--color-success-border)',
  warning: 'bg-(--color-warning-bg) text-(--color-warning-text) ring-(--color-warning-border)',
  danger: 'bg-(--color-danger-bg) text-(--color-danger-text) ring-(--color-danger-border)',
  info: 'bg-(--color-info-bg) text-(--color-info-text) ring-(--color-info-border)',
  brand: 'bg-(--color-brand-bg) text-(--color-brand-text) ring-(--color-brand-border)',
};

const dotClasses: Record<Tone, string> = {
  neutral: 'bg-(--color-neutral-solid)',
  success: 'bg-(--color-success-solid)',
  warning: 'bg-(--color-warning-solid)',
  danger: 'bg-(--color-danger-solid)',
  info: 'bg-(--color-info-solid)',
  brand: 'bg-(--color-brand)',
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success',
  TRIAL: 'success',
  INVITED: 'warning',
  SUSPENDED: 'danger',
  DISABLED: 'danger',
  INACTIVE: 'neutral',
  GRADUATED: 'neutral',
  MAINTENANCE: 'warning',
  FAULTY: 'danger',
  RETIRED: 'neutral',
  ARCHIVED: 'neutral',
  SCHEDULED: 'neutral',
  READY: 'warning',
  IN_PROGRESS: 'success',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
  LIVE: 'success',
  STALE: 'warning',
  UNKNOWN: 'neutral',
  ONLINE: 'success',
  OFFLINE: 'danger',
  FAULT: 'danger',
  EXPECTED: 'neutral',
  BOARDED: 'success',
  ABSENT: 'danger',
  DROPPED_OFF: 'success',
  // Safety events (Phase 2 Step 12). Emergency.status intentionally does
  // NOT reuse this map for its own ACTIVE/ACKNOWLEDGED values — see the
  // dedicated tone helper on the emergencies pages, since "ACTIVE" here
  // means "urgent, unresolved," not the generic ACTIVE=good-state meaning
  // this map already uses for School/Bus statuses above.
  NEW: 'warning',
  ACKNOWLEDGED: 'neutral',
  DISMISSED: 'neutral',
  ESCALATED: 'danger',
  RESOLVED: 'success',
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'warning',
  CRITICAL: 'danger',
};

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotClasses[tone])} />}
      {children}
    </span>
  );
}

/** Maps a known status string (account/school/student status) to a sensible tone automatically. */
export function StatusBadge({ status, dot }: { status: string; dot?: boolean }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot={dot}>
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export { STATUS_TONE };
export type { Tone };
