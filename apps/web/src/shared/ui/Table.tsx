import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Skeleton } from '@/shared/ui/Skeleton';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Defaults to String(row[key]). */
  cell?: (row: T) => ReactNode;
  className?: string;
  /** Makes the column sortable (click the header). */
  sortValue?: (row: T) => string | number;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
}

/** Data table that handles all four states: loading / error / empty / success. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  isLoading = false,
  isError = false,
  onRetry,
  emptyTitle = 'لا توجد بيانات',
}: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  if (isLoading) {
    return (
      <div className="space-y-2 rounded-2xl bg-white p-4 shadow-card" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} />;
  }

  const sortCol = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const view =
    sort && sortCol?.sortValue
      ? [...rows].sort((a, b) => {
          const x = sortCol.sortValue?.(a) ?? '';
          const y = sortCol.sortValue?.(b) ?? '';
          return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
        })
      : rows;
  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-card">
      <table className="w-full text-right text-sm">
        <thead>
          <tr className="border-b border-navy-100 text-xs text-purple">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-4 py-3 font-semibold ${c.className ?? ''}`}
              >
                {c.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className="inline-flex items-center gap-1 hover:text-navy"
                    aria-label={`فرز حسب ${c.header}`}
                  >
                    {c.header}
                    {sort?.key === c.key ? (
                      sort.dir === 1 ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="opacity-40" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-navy-50 last:border-0 hover:bg-navy-50/40"
            >
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 ${c.className ?? ''}`}>
                  {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
