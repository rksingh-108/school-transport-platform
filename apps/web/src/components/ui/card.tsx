import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, hoverable, children }: { className?: string; hoverable?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-xs) transition-shadow duration-200',
        hoverable && 'hover:shadow-(--shadow-md)',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-(--color-border) px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-(--color-text)">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-(--color-text-muted)">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}
