import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Badge, Select, type BadgeTone, type SelectOption } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { QUOTE_STATUS_LABEL, type QuoteStatus } from '@/features/pricing/types';

/** Money in SAR — mono numerals, aligned, currency suffix. */
export function Money({
  v,
  className = '',
  strong,
}: {
  v: number;
  className?: string;
  strong?: boolean;
}) {
  return (
    <span
      className={`num whitespace-nowrap ${strong ? 'font-bold' : ''} ${v < 0 ? 'text-red-600' : ''} ${className}`}
    >
      {sar(v)} <span className="text-[0.8em] font-normal text-purple">ر.س</span>
    </span>
  );
}

export const QUOTE_TONE: Record<QuoteStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'navy',
  accepted: 'success',
  rejected: 'danger',
  expired: 'gold',
};
export const QuoteBadge = ({ status }: { status: QuoteStatus }) => (
  <Badge tone={QUOTE_TONE[status]}>{QUOTE_STATUS_LABEL[status]}</Badge>
);

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-purple"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-navy-100 bg-white py-2.5 pl-3 pr-9 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/15"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="w-full sm:w-44">
      <Select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={options}
      />
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

/**
 * Tab + filter state in the URL (?tab=…&q=…) so returning to the page — or
 * sharing the link — restores the same view.
 */
export function useUrlState(key: string, fallback: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (v: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (!v || v === fallback) n.delete(key);
          else n.set(key, v);
          return n;
        },
        { replace: true },
      ),
    [key, fallback, setParams],
  );
  return [value, set];
}

export const today = (): string => new Date().toISOString().slice(0, 10);

export function SectionTitle({
  title,
  desc,
  actions,
}: {
  title: string;
  desc?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-navy">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-purple">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
