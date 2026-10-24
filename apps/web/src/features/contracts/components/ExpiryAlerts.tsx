import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CalendarClock, CalendarOff, ChevronLeft, Eye, GitBranch } from 'lucide-react';
import { Badge, Card, Skeleton } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { useExpiryWindow } from '@/features/contracts/hooks/useExpiryWindow';
import {
  expiryAlerts,
  expirySummary,
  expiryTone,
  EXPIRY_URGENCY_LABEL,
} from '@/features/contracts/lib/contractInsights';
import { activeRenewalsOf } from '@/features/contracts/lib/contractRenewal';
import { RenewContractButton } from '@/features/contracts/components/RenewContract';
import { SERVICE_LABEL, type ContractListItem } from '@/features/contracts/types';

const PREVIEW = 3;

/**
 * تنبيهات انتهاء العقود: العقود السارية التي اقترب انتهاؤها داخل مهلة التنبيه
 * أو تجاوزت تاريخ نهايتها ولم تُجدَّد. المهلة قيمة إدارية من إعدادات النظام
 * (`contract_expiry_alert_days`) — تغييرها من الواجهة يغيّر التنبيهات فورًا.
 * التصنيف كله من `contractInsights` (expiryAlerts / expirySummary) — لا منطق هنا.
 *
 * `variant="dashboard"` يعرض نفس البطاقة مختصرة مع رابط لتبويب التجديدات.
 */
export function ExpiryAlerts({
  contracts,
  variant = 'page',
}: {
  contracts: ContractListItem[];
  variant?: 'page' | 'dashboard';
}) {
  const alertWindow = useExpiryWindow();
  const [expanded, setExpanded] = useState(false);
  const demo = isDemoMode();

  const alerts = useMemo(
    () => expiryAlerts(contracts, alertWindow.days, new Date()),
    [contracts, alertWindow.days],
  );
  const summary = useMemo(
    () => expirySummary(contracts, alertWindow.days, new Date()),
    [contracts, alertWindow.days],
  );

  const preview = variant === 'dashboard' || !expanded ? alerts.slice(0, PREVIEW) : alerts;

  if (alertWindow.isLoading) {
    return (
      <Card className="mb-4" data-testid="expiry-alerts-loading">
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  return (
    <Card className="mb-4 border border-gold-100" data-testid="expiry-alerts">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-100 text-gold-600">
            <BellRing size={16} />
          </span>
          تنبيهات انتهاء العقود
          {demo && <Badge tone="neutral">بيانات تجريبية</Badge>}
        </h2>
        <p className="text-[11px] text-purple">
          مهلة التنبيه <span className="num">{alertWindow.days}</span> يومًا ·{' '}
          {alertWindow.configured ? 'من إعدادات النظام' : 'قيمة افتراضية — غير مضبوطة في الإعدادات'}
        </p>
      </div>

      {/* الأعداد حسب الحالة */}
      <div className="mb-3 flex flex-wrap gap-2">
        <Count label="منتهية" value={summary.expired} tone="danger" />
        <Count label="حرجة" value={summary.critical} tone="danger" />
        <Count label="قريبة الانتهاء" value={summary.soon} tone="gold" />
        <Count label="تاريخ النهاية غير محدد" value={summary.noEndDate} tone="neutral" />
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-xl bg-navy-50/60 px-3.5 py-2.5 text-sm text-purple">
          لا توجد عقود سارية منتهية أو تنتهي خلال {alertWindow.days} يومًا.
        </p>
      ) : (
        <ul className="space-y-2">
          {preview.map(({ contract, insight, urgency, message }) => (
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
              <span className="ms-auto flex flex-wrap items-center gap-2">
                <RowActions contract={contract} all={contracts} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {summary.noEndDate > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-purple">
          <CalendarOff size={13} />
          <span className="num">{summary.noEndDate}</span> عقد ساري بلا تاريخ نهاية — لا يدخل في
          التنبيهات حتى يُحدَّد تاريخ نهايته.
        </p>
      )}

      {variant === 'dashboard'
        ? alerts.length > 0 && (
            <Link
              to="/contracts?tab=renewals"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
            >
              عرض العقود التي تحتاج تجديدًا ({alerts.length})
              <ChevronLeft size={13} />
            </Link>
          )
        : alerts.length > PREVIEW && (
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

/**
 * إجراء الصف: إن وُجد تجديد قائم فرابطه، وإلا زر «تجديد العقد» (يظهر لمن يملك
 * الصلاحية وتنطبق عليه القواعد) مع «عرض العقد».
 */
function RowActions({ contract, all }: { contract: ContractListItem; all: ContractListItem[] }) {
  const renewals = activeRenewalsOf(contract.id, all);
  const renewal = renewals[0];
  const linkCls =
    'inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-navy ring-1 ring-navy-100 transition hover:bg-navy-50';
  return (
    <>
      {renewal ? (
        <Link to={`/contracts/${renewal.id}`} className={linkCls}>
          <GitBranch size={12} /> تم التجديد · <span className="num">{renewal.contract_no}</span>
        </Link>
      ) : (
        <RenewContractButton contract={contract} existingRenewals={renewals} />
      )}
      <Link to={`/contracts/${contract.id}`} className={linkCls}>
        <Eye size={12} /> عرض العقد
      </Link>
    </>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'gold' | 'neutral';
}) {
  const cls =
    tone === 'danger'
      ? 'bg-red-50 text-red-700'
      : tone === 'gold'
        ? 'bg-gold-100 text-gold-600'
        : 'bg-gray-100 text-gray-600';
  return (
    <span
      aria-label={`${label} ${value}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${cls}`}
    >
      {label}
      <span className="num font-bold">{value}</span>
    </span>
  );
}
