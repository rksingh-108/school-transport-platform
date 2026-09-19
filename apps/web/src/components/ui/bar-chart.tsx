import { cn } from '@/lib/cn';

export interface BarChartRow {
  label: string;
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';
}

const toneClasses: Record<NonNullable<BarChartRow['tone']>, string> = {
  brand: 'bg-(--color-brand)',
  success: 'bg-(--color-success-solid)',
  warning: 'bg-(--color-warning-solid)',
  danger: 'bg-(--color-danger-solid)',
  neutral: 'bg-(--color-neutral-solid)',
  info: 'bg-(--color-info-solid)',
};

/** Lightweight CSS bar chart — no charting library, matches the app's "no fabricated visuals" constraint by rendering exactly the counts passed in. */
export function BarChart({ rows }: { rows: BarChartRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-(--color-text-muted)" title={row.label}>
            {row.label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-(--color-neutral-bg)">
            <div
              className={cn('h-full rounded-full', toneClasses[row.tone ?? 'brand'])}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-medium text-(--color-text)">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
