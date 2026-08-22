import { BellRing, AlertTriangle } from 'lucide-react';
import { Badge } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { expiryStatus } from '@/features/hr/api/hr.api';
import { useDocuments, useIqamas } from '@/features/hr/hooks/useHr';
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from '@/features/hr/types';

interface AlertItem {
  key: string;
  employee: string;
  label: string;
  expiry: string;
  status: 'expiring' | 'expired';
}

/**
 * Cross-employee document/iqama expiry alerts. Surfaced on the dashboard so HR
 * sees renewals due without opening each profile.
 */
export function DocExpiryAlerts() {
  const { data: docs = [] } = useDocuments();
  const { data: iqamas = [] } = useIqamas();

  const items: AlertItem[] = [];
  docs.forEach((d) => {
    const st = expiryStatus(d.expiry_date);
    if (st !== 'valid' && d.expiry_date)
      items.push({
        key: `d-${d.id}`,
        employee: d.employee_name,
        label: d.type,
        expiry: d.expiry_date,
        status: st,
      });
  });
  iqamas.forEach((i) => {
    const st = expiryStatus(i.expiry_date);
    if (st !== 'valid')
      items.push({
        key: `i-${i.id}`,
        employee: i.employee_name,
        label: `إقامة (${i.profession})`,
        expiry: i.expiry_date,
        status: st,
      });
  });
  items.sort(
    (a, b) =>
      (a.status === 'expired' ? 0 : 1) - (b.status === 'expired' ? 0 : 1) ||
      a.expiry.localeCompare(b.expiry),
  );

  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <BellRing size={16} className="text-gold-600" /> تنبيهات انتهاء الوثائق
        </h2>
        {items.length > 0 && <Badge tone="danger">{items.length}</Badge>}
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-purple">لا توجد وثائق قاربت الانتهاء.</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 8).map((a) => (
            <li
              key={a.key}
              className="flex items-center justify-between border-b border-navy-50 pb-1.5 last:border-0"
            >
              <div className="flex items-center gap-2">
                {a.status === 'expired' && <AlertTriangle size={14} className="text-red-500" />}
                <div>
                  <p className="text-xs font-semibold text-navy">{a.employee}</p>
                  <p className="text-[11px] text-purple">
                    {a.label} · <span className="num">{dateAr(a.expiry)}</span>
                  </p>
                </div>
              </div>
              <Badge tone={DOC_STATUS_TONE[a.status]}>{DOC_STATUS_LABEL[a.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
