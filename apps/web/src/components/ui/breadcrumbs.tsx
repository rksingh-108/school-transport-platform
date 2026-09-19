import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-sm text-(--color-text-muted)">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-(--color-text-faint)" />}
          {item.href ? (
            <Link href={item.href} className="hover:text-(--color-text) hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-(--color-text)">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
