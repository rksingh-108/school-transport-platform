import type { ReactNode } from 'react';

/** CSS-only hover/focus tooltip — no positioning library, good enough for short static labels. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-(--radius-sm) bg-(--color-text) px-2 py-1 text-xs text-(--color-surface) opacity-0 shadow-(--shadow-sm) transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
