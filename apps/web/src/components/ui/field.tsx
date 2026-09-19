import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const controlClasses =
  'w-full rounded-(--radius-sm) border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) shadow-(--shadow-xs) transition-colors placeholder:text-(--color-text-faint) focus:border-(--color-brand) focus:outline-none focus:ring-2 focus:ring-(--color-brand-border) disabled:cursor-not-allowed disabled:bg-(--color-surface-sunken) disabled:text-(--color-text-faint)';

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-(--color-text)', className)} {...rest} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClasses, className)} {...rest} />;
}

export function Textarea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(controlClasses, 'resize-y', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(controlClasses, 'appearance-none bg-no-repeat pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-sm text-(--color-danger-text)">{children}</p>;
}

export function FieldHint({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-sm text-(--color-text-muted)">{children}</p>;
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <FieldError>{error}</FieldError> : <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand) disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-(--color-brand)' : 'bg-(--color-neutral-border)',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-(--shadow-sm) transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
