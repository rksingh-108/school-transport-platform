import { cn } from '@/lib/cn';

const PALETTE = [
  'bg-(--color-brand-bg) text-(--color-brand-text)',
  'bg-(--color-success-bg) text-(--color-success-text)',
  'bg-(--color-warning-bg) text-(--color-warning-text)',
  'bg-(--color-info-bg) text-(--color-info-text)',
  'bg-(--color-danger-bg) text-(--color-danger-text)',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const sizeClasses = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base' };

/** No DTO in this app carries a photo field, so identity is always shown as deterministic-color initials. */
export function Avatar({ name, size = 'md', className }: { name: string; size?: keyof typeof sizeClasses; className?: string }) {
  const tone = PALETTE[hashString(name) % PALETTE.length];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', sizeClasses[size], tone, className)}
    >
      {initials(name)}
    </span>
  );
}
