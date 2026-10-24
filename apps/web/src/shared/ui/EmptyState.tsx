import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  /** lucide-react icon only (no emoji) — per the identity conventions. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-navy-100 bg-white p-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-navy">
        <Icon size={26} />
      </span>
      <p className="mt-3 font-bold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-purple">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
