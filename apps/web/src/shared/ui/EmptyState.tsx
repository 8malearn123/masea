import type { ReactNode } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

/** حالة «لا يوجد» موحّدة — أيقونة lucide (لا إيموجي — CLAUDE.md). */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-navy-100 bg-white p-10 text-center">
      <Icon size={36} aria-hidden className="text-navy-200" strokeWidth={1.5} />
      <p className="mt-3 font-bold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-purple">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
