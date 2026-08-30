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
