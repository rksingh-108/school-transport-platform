type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
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

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}

/** Maps a known status string (account/school/student status) to a sensible tone automatically. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>;
}
