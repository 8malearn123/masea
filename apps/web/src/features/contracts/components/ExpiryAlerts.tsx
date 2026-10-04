import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CalendarClock, ChevronLeft, RefreshCw } from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import {
  expiryAlerts,
  expiryTone,
  EXPIRY_URGENCY_LABEL,
  RENEWAL_WINDOW_DAYS,
} from '@/features/contracts/lib/contractInsights';
import { SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';

const PREVIEW = 3;

/**
 * تنبيهات انتهاء العقود: العقود السارية التي اقترب انتهاؤها داخل مهلة التنبيه
 * أو تجاوزت تاريخ نهايتها ولم تُجدَّد. المهلة قيمة إدارية من إعدادات النظام
 * (`contract_expiry_alert_days`) — تغييرها من الواجهة يغيّر التنبيهات فورًا.
 */
export function ExpiryAlerts({ contracts }: { contracts: ContractListItem[] }) {
  const { data: config = [] } = useConfig();
  const windowDays = configValue(config, 'contract_expiry_alert_days', RENEWAL_WINDOW_DAYS);
  const [expanded, setExpanded] = useState(false);

  const alerts = useMemo(
    () => expiryAlerts(contracts, windowDays, new Date()),
    [contracts, windowDays],
  );

  if (alerts.length === 0) return null;

  const expired = alerts.filter((a) => a.urgency === 'expired').length;
  const shown = expanded ? alerts : alerts.slice(0, PREVIEW);

  return (
    <Card className="mb-4 border border-gold-100">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-100 text-gold-600">
            <BellRing size={16} />
          </span>
          تنبيهات انتهاء العقود
          <span className="num rounded-full bg-gold-100 px-2 py-0.5 text-xs text-gold-600">
            {alerts.length}
          </span>
        </h2>
        <p className="num text-[11px] text-purple">
          خلال {windowDays} يوم
          {expired > 0 && <span className="text-red-600"> · {expired} منتهٍ ولم يُجدَّد</span>}
        </p>
      </div>

      <ul className="space-y-2">
        {shown.map(({ contract, insight, urgency, message }) => (
          <li
            key={contract.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-navy-50 bg-navy-50/40 px-3.5 py-2.5"
          >
            <Badge tone={expiryTone(urgency)}>{EXPIRY_URGENCY_LABEL[urgency]}</Badge>
            <span className="num text-sm font-bold text-navy">{contract.contract_no}</span>
            <span className="text-sm text-navy-900">{contract.customer_name ?? '—'}</span>
            <span className="text-[11px] text-purple">
              {contract.service_code ? SERVICE_LABEL[contract.service_code] : '—'}
            </span>
            <span className="num flex items-center gap-1 text-[11px] text-purple">
              <CalendarClock size={12} /> {message} ({dateAr(contract.end_date)})
            </span>
            {insight.remaining > 0 && (
              <span className="num text-[11px] font-semibold text-red-600">
                متبقٍ {sar(insight.remaining)} ر.س
              </span>
            )}
            <Link
              to={`/contracts/${contract.id}`}
              className="ms-auto inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-navy ring-1 ring-navy-100 transition hover:bg-navy-50"
            >
              <RefreshCw size={12} /> تجديد العقد
            </Link>
          </li>
        ))}
      </ul>

      {alerts.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
        >
          {expanded ? 'عرض أقل' : `عرض الكل (${alerts.length})`}
          <ChevronLeft size={13} className={expanded ? 'rotate-90' : ''} />
        </button>
      )}
    </Card>
  );
}
