'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useHasMounted } from '@/lib/use-has-mounted';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneConfig: Record<ToastTone, { icon: typeof CheckCircle2; classes: string; iconClasses: string }> = {
  success: {
    icon: CheckCircle2,
    classes: 'border-(--color-success-border) bg-(--color-success-bg)',
    iconClasses: 'text-(--color-success-text)',
  },
  error: {
    icon: AlertCircle,
    classes: 'border-(--color-danger-border) bg-(--color-danger-bg)',
    iconClasses: 'text-(--color-danger-text)',
  },
  info: {
    icon: Info,
    classes: 'border-(--color-info-border) bg-(--color-info-bg)',
    iconClasses: 'text-(--color-info-text)',
  },
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useHasMounted();
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { ...toast, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
            {toasts.map((toast) => {
              const config = toneConfig[toast.tone];
              const Icon = config.icon;
              return (
                <div
                  key={toast.id}
                  role="status"
                  className={cn(
                    'pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-(--radius-md) border p-4 shadow-(--shadow-lg)',
                    config.classes,
                  )}
                >
                  <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', config.iconClasses)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-(--color-text)">{toast.title}</p>
                    {toast.description && <p className="mt-0.5 text-sm text-(--color-text-muted)">{toast.description}</p>}
                  </div>
                  <button
                    aria-label="Dismiss"
                    onClick={() => dismiss(toast.id)}
                    className="shrink-0 text-(--color-text-faint) hover:text-(--color-text)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return {
    success: (title: string, description?: string) => ctx.show({ tone: 'success', title, description }),
    error: (title: string, description?: string) => ctx.show({ tone: 'error', title, description }),
    info: (title: string, description?: string) => ctx.show({ tone: 'info', title, description }),
  };
}
