import type { ReactNode } from 'react';

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-navy-100 bg-white p-10 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="mt-3 font-bold text-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-purple">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
