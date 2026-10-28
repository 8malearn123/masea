import type { LucideIcon } from 'lucide-react';

/** Compact KPI tile. Clickable when `onClick` is set (filters the related list). */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'navy',
  active,
  onClick,
  hint,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: 'navy' | 'success' | 'warning' | 'danger' | 'neutral';
  active?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const toneCls = {
    navy: 'text-navy bg-navy-50',
    success: 'text-green-700 bg-green-50',
    warning: 'text-amber-700 bg-amber-50',
    danger: 'text-red-700 bg-red-50',
    neutral: 'text-gray-600 bg-gray-100',
  }[tone];
  const body = (
    <>
      {Icon && (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${toneCls}`}>
          <Icon size={17} aria-hidden />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-xs leading-tight text-purple">{label}</span>
        <span className="num block text-xl font-bold text-navy-900">{value}</span>
        {hint && <span className="block truncate text-[11px] text-purple">{hint}</span>}
      </span>
    </>
  );
  const cls = `flex items-center gap-3 rounded-2xl bg-white p-4 text-right shadow-card transition ${active ? 'ring-2 ring-navy' : ''}`;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${cls} hover:ring-2 hover:ring-navy-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
