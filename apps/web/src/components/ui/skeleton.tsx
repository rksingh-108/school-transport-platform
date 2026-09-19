import { cn } from '@/lib/cn';

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('animate-skeleton rounded-(--radius-sm) bg-(--color-neutral-bg)', className)} style={style} />;
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface)">
      <div className="flex gap-4 border-b border-(--color-border) px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-(--color-border) px-4 py-4 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 flex-1" style={c === 0 ? { maxWidth: '10rem' } : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-5">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="space-y-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-7 w-1/3" />
    </div>
  );
}
