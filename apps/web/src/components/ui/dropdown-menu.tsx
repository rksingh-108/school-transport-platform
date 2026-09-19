'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './button';

export interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export function DropdownMenu({ items, label = 'Actions' }: { items: DropdownMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <IconButton icon={MoreHorizontal} label={label} size="sm" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-(--radius-md) border border-(--color-border) bg-(--color-surface-raised) py-1 shadow-(--shadow-md)"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                item.danger ? 'text-(--color-danger-text) hover:bg-(--color-danger-bg)' : 'text-(--color-text) hover:bg-(--color-surface-sunken)',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
