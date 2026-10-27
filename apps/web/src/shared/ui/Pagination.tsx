import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Page slice helper + controls. Page is 1-based. */
export function paginate<T>(rows: T[], page: number, size: number): T[] {
  return rows.slice((page - 1) * size, page * size);
}

export function Pagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <nav
      className="mt-3 flex items-center justify-between gap-2 text-xs text-purple"
      aria-label="ترقيم الصفحات"
    >
      <span>
        <span className="num">
          {from}–{to}
        </span>{' '}
        من <span className="num">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="الصفحة السابقة"
          className="rounded-lg border border-navy-100 p-1.5 disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
        <span className="num px-2">
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="الصفحة التالية"
          className="rounded-lg border border-navy-100 p-1.5 disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    </nav>
  );
}
