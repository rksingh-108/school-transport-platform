import { AlertTriangle, Inbox } from 'lucide-react';
import { Spinner } from './spinner';
import { Button } from './button';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-(--color-text-muted)">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-(--radius-lg) border border-dashed border-(--color-border-strong) bg-(--color-surface-sunken) px-6 py-16 text-center">
      <Inbox className="h-8 w-8 text-(--color-text-faint)" />
      <p className="text-sm font-medium text-(--color-text)">{title}</p>
      {description && <p className="max-w-sm text-sm text-(--color-text-muted)">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-(--radius-lg) border border-(--color-danger-border) bg-(--color-danger-bg) px-6 py-12 text-center">
      <AlertTriangle className="h-6 w-6 text-(--color-danger-text)" />
      <p className="text-sm text-(--color-danger-text)">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
