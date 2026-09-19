'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({ items, defaultId }: { items: TabItem[]; defaultId?: string }) {
  const [active, setActive] = useState(defaultId ?? items[0]?.id);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + delta + items.length) % items.length;
    setActive(items[nextIndex].id);
    (document.getElementById(`tab-${items[nextIndex].id}`) as HTMLElement | null)?.focus();
  }

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-(--color-border)">
        {items.map((item, i) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={active === item.id}
            tabIndex={active === item.id ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => setActive(item.id)}
            className={cn(
              '-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-brand)',
              active === item.id
                ? 'border-(--color-brand) text-(--color-brand-text)'
                : 'border-transparent text-(--color-text-muted) hover:text-(--color-text)',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="pt-5">{items.find((item) => item.id === active)?.content}</div>
    </div>
  );
}
