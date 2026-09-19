import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-[image:var(--gradient-brand)] text-white shadow-(--shadow-sm) hover:shadow-(--shadow-glow) hover:brightness-105 disabled:opacity-50 disabled:shadow-(--shadow-xs) disabled:hover:brightness-100',
  secondary:
    'bg-(--color-surface) text-(--color-text) border border-(--color-border-strong) shadow-(--shadow-xs) hover:bg-(--color-surface-sunken) hover:border-(--color-text-faint) disabled:opacity-50',
  danger: 'bg-(--color-danger-solid) text-white shadow-(--shadow-xs) hover:brightness-95 disabled:opacity-50',
  ghost: 'text-(--color-text-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-text) disabled:opacity-50',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-(--radius-sm) font-medium transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand) active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4 text-current" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  loading,
  disabled,
  icon: Icon,
  label,
  className,
  ...rest
}: Omit<ButtonProps, 'children'> & { icon: LucideIcon; label: string }) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-(--radius-sm) transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand) active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        dim,
        variantClasses[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4 text-current" /> : <Icon className="h-4 w-4" />}
    </button>
  );
}
