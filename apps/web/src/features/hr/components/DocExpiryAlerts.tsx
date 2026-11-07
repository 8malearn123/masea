import { BellRing, AlertTriangle } from 'lucide-react';
import { Badge } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useDocAlertDays, useHrDocuments } from '@/features/hr/hooks/useHrDocuments';
import { expiryAlerts } from '@/features/hr/lib/documentsEngine';
import { useHrLookups } from '@/features/hr/hooks/useHrLookups';
import { DOC_OWNER_LABEL, DOC_STATUS_LABEL, DOC_STATUS_TONE } from '@/features/hr/types';

/**
 * Company-wide expiry alerts (staff + workers) inside the managed window
 * (app_config.doc_expiry_alert_days). Only current versions count — a renewed
 * iqama no longer alerts.
 */
export function DocExpiryAlerts() {
  const { data: docs = [] } = useHrDocuments();
  const alertDays = useDocAlertDays();
  const lk = useHrLookups();
  const items = expiryAlerts(docs, alertDays);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <BellRing size={16} className="text-gold-600" /> تنبيهات انتهاء الوثائق
        </h2>
        {items.length > 0 && <Badge tone="danger">{items.length}</Badge>}
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-purple">
          لا توجد وثائق تنتهي خلال <span className="num">{alertDays}</span> يومًا.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 8).map(({ doc, status, days }) => (
            <li
              key={doc.id}
              className="flex items-center justify-between border-b border-navy-50 pb-1.5 last:border-0"
            >
              <div className="flex items-center gap-2">
                {status === 'expired' && <AlertTriangle size={14} className="text-red-500" />}
                <div>
                  <p className="text-xs font-semibold text-navy">
                    {doc.owner_name}{' '}
                    <span className="font-normal text-purple">
                      ({DOC_OWNER_LABEL[doc.owner_kind]})
                    </span>
                  </p>
                  <p className="text-[11px] text-purple">
                    {lk.docTypeLabel(doc.type)} ·{' '}
                    <span className="num">{dateAr(doc.expiry_date ?? '')}</span>
                    {' · '}
                    {days < 0 ? (
                      <>
                        منذ <span className="num">{-days}</span> يوم
                      </>
                    ) : (
                      <>
                        بعد <span className="num">{days}</span> يوم
                      </>
                    )}
                  </p>
                </div>
              </div>
              <Badge tone={DOC_STATUS_TONE[status]}>{DOC_STATUS_LABEL[status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
