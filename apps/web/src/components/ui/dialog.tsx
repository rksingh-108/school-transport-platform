'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Rendered below children, right-aligned — typically action buttons. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  labelledBy?: string;
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** A real modal — portaled, focus-trapped, Escape/backdrop-to-close. Never `window.confirm()`. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'sm', labelledBy }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = labelledBy ?? 'dialog-title';

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-overlay-in bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'relative w-full animate-toast-in rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-6 shadow-(--shadow-lg)',
          sizeClasses[size],
        )}
      >
        {title && (
          <div className="mb-1 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-base font-semibold text-(--color-text)">
              {title}
            </h2>
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1 -mt-1" />
          </div>
        )}
        {description && <p className="text-sm text-(--color-text-muted)">{description}</p>}
        <div className={title || description ? 'mt-4' : undefined}>{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Slide-over panel from the left edge — used for the mobile nav drawer. */
export function Drawer({ open, onClose, children, widthClassName = 'max-w-[280px]' }: { open: boolean; onClose: () => void; children: ReactNode; widthClassName?: string }) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 animate-overlay-in bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex h-full w-full animate-drawer-in flex-col bg-(--color-surface-raised) shadow-(--shadow-lg)',
          widthClassName,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
