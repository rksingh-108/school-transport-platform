import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-(--color-neutral-bg) text-(--color-neutral-text)',
  success: 'bg-(--color-success-bg) text-(--color-success-text)',
  warning: 'bg-(--color-warning-bg) text-(--color-warning-text)',
  danger: 'bg-(--color-danger-bg) text-(--color-danger-text)',
  info: 'bg-(--color-info-bg) text-(--color-info-text)',
  brand: 'bg-(--color-brand-bg) text-(--color-brand-text)',
};

const accentClasses: Record<Tone, string> = {
  neutral: 'bg-(--color-neutral-solid)',
  success: 'bg-(--color-success-solid)',
  warning: 'bg-(--color-warning-solid)',
  danger: 'bg-(--color-danger-solid)',
  info: 'bg-(--color-info-solid)',
  brand: 'bg-(--color-brand)',
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: Tone;
  sublabel?: string;
  href?: string;
}

export function StatCard({ label, value, icon: Icon, tone = 'neutral', sublabel, href }: StatCardProps) {
  const content = (
    <div className="group relative flex items-start justify-between gap-3 overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 shadow-(--shadow-xs) transition-all duration-200 hover:-translate-y-0.5 hover:shadow-(--shadow-md)">
      <span className={cn('absolute inset-x-0 top-0 h-0.5', accentClasses[tone])} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-(--color-text)">{value}</p>
        {sublabel && <p className="mt-1 text-xs text-(--color-text-faint)">{sublabel}</p>}
      </div>
      {Icon && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-md) transition-transform duration-200 group-hover:scale-105',
            toneClasses[tone],
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
