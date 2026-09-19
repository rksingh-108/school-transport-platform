import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Omit this column from the stacked mobile-card view (e.g. a redundant id column). */
  hideOnCard?: boolean;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Optional trailing actions column/slot, rendered per row. */
  renderActions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | undefined;
}

/**
 * A real `<table>` on md+ screens; collapses to stacked label/value cards
 * below that so no list page ever needs horizontal scroll on a phone.
 */
export function DataTable<T>({ columns, rows, getRowKey, renderActions, rowClassName }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) shadow-(--shadow-xs)">
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-border) bg-(--color-surface-sunken) text-left text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
              {columns.map((col) => (
                <th key={col.key} className={cn('px-4 py-3', col.className)}>
                  {col.header}
                </th>
              ))}
              {renderActions && <th className="px-4 py-3" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className={cn(
                  'border-b border-(--color-border) transition-colors duration-100 last:border-0 hover:bg-(--color-surface-sunken)',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 align-middle', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
                {renderActions && <td className="px-4 py-3 text-right">{renderActions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-(--color-border) md:hidden">
        {rows.map((row) => (
          <div key={getRowKey(row)} className={cn('flex flex-col gap-2 p-4', rowClassName?.(row))}>
            {columns
              .filter((col) => !col.hideOnCard)
              .map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-(--color-text-faint)">{col.header}</span>
                  <span className="min-w-0 text-right text-(--color-text)">{col.render(row)}</span>
                </div>
              ))}
            {renderActions && <div className="mt-1 flex justify-end">{renderActions(row)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
