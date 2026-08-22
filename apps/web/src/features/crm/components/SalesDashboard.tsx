import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  CalendarClock,
  Coins,
  KanbanSquare,
  Target,
  Trophy,
} from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { dateAr, dateTimeAr, sar } from '@/shared/lib/format';
import { useActivities, useLeads, useMyTarget, useRenewals } from '@/features/crm/hooks/useCrm';
import { useCrmMeta } from '@/features/crm/hooks/useCrmMeta';
import { ACTIVITY_LABEL, SERVICE_LABEL } from '@/features/crm/types';

function todayKey(iso: string) {
  return iso.slice(0, 10);
}

/** "لوحتي" — the sales rep's personal cockpit (replaces company KPIs). */
export function SalesDashboard() {
  const { data: target } = useMyTarget();
  const { data: leads = [] } = useLeads();
  const { data: activities = [] } = useActivities();
  const { data: renewals = [] } = useRenewals();
  const { stageOrder, stageLabel, stageTone, commissionRate } = useCrmMeta();

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    stageOrder.forEach((s) => (c[s] = 0));
    leads.forEach((l) => (c[l.stage_code] = (c[l.stage_code] ?? 0) + 1));
    return c;
  }, [leads, stageOrder]);

  const pipelineValue = useMemo(
    () =>
      leads
        .filter((l) => l.stage_code !== 'won' && l.stage_code !== 'lost')
        .reduce((s, l) => s + l.est_value, 0),
    [leads],
  );

  const dueFollowUps = useMemo(() => {
    const today = todayKey(new Date().toISOString());
    return activities
      .filter((a) => !a.done && a.follow_up_at && todayKey(a.follow_up_at) <= today)
      .sort((a, b) => (a.follow_up_at ?? '').localeCompare(b.follow_up_at ?? ''));
  }, [activities]);

  const wonDeals = useMemo(() => leads.filter((l) => l.stage_code === 'won'), [leads]);
  const commissionTotal = useMemo(
    () => Math.round(wonDeals.reduce((s, l) => s + l.est_value * commissionRate, 0)),
    [wonDeals, commissionRate],
  );

  const leadName = (id: string) => leads.find((l) => l.id === id)?.full_name ?? '—';
  const targetPct =
    target && target.contracts_target
      ? Math.min(100, Math.round((target.contracts_achieved / target.contracts_target) * 100))
      : 0;
  const collectionPct =
    target && target.collection_target
      ? Math.min(100, Math.round((target.collection_achieved / target.collection_target) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* top KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="py-4">
          <p className="flex items-center gap-1.5 text-xs text-purple">
            <KanbanSquare size={14} /> خط مبيعاتي
          </p>
          <p className="num mt-1 text-2xl font-bold text-navy">{sar(pipelineValue)}</p>
          <p className="text-[11px] text-purple">ر.س قيد التفاوض</p>
        </Card>
        <Card className="py-4">
          <p className="flex items-center gap-1.5 text-xs text-purple">
            <Coins size={14} /> عمولاتي المحقّقة
          </p>
          <p className="num mt-1 text-2xl font-bold text-gold-600">{sar(commissionTotal)}</p>
          <p className="text-[11px] text-purple">ر.س من الصفقات المغلقة</p>
        </Card>
        <Card className="py-4">
          <p className="flex items-center gap-1.5 text-xs text-purple">
            <Trophy size={14} /> ترتيبي
          </p>
          <p className="num mt-1 text-2xl font-bold text-teal">
            {target?.rank ?? '—'}
            <span className="text-base text-purple"> / {target?.rank_total ?? '—'}</span>
          </p>
          <p className="text-[11px] text-purple">على لوحة الشرف</p>
        </Card>
        <Card className="py-4">
          <p className="flex items-center gap-1.5 text-xs text-purple">
            <BellRing size={14} /> متابعات اليوم
          </p>
          <p className="num mt-1 text-2xl font-bold text-navy">{dueFollowUps.length}</p>
          <p className="text-[11px] text-purple">مهمة مستحقّة</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* target progress */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Target size={16} /> هدفي هذا الشهر
          </h2>
          <Gauge
            label="العقود"
            actual={target?.contracts_achieved ?? 0}
            target={target?.contracts_target ?? 0}
            pct={targetPct}
            unit="عقد"
          />
          <div className="mt-4">
            <Gauge
              label="التحصيل"
              actual={target?.collection_achieved ?? 0}
              target={target?.collection_target ?? 0}
              pct={collectionPct}
              money
            />
          </div>
        </Card>

        {/* pipeline distribution */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <KanbanSquare size={16} /> صفقاتي بكل مرحلة
          </h2>
          <div className="space-y-2.5">
            {stageOrder.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <span className="w-24 shrink-0">
                  <Badge tone={stageTone(s)}>{stageLabel(s)}</Badge>
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${Math.min(100, (counts[s] ?? 0) * 20)}%` }}
                  />
                </div>
                <span className="num w-6 text-left text-sm font-semibold text-navy">
                  {counts[s] ?? 0}
                </span>
              </div>
            ))}
          </div>
          <Link
            to="/leads"
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline"
          >
            فتح خط المبيعات <ArrowLeft size={13} />
          </Link>
        </Card>

        {/* today's follow-ups */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <BellRing size={16} /> متابعات اليوم
          </h2>
          {dueFollowUps.length === 0 ? (
            <p className="text-sm text-purple">لا توجد متابعات مستحقّة اليوم. 🎯</p>
          ) : (
            <ol className="space-y-2.5">
              {dueFollowUps.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-600" />
                  <div>
                    <p className="font-medium text-navy-900">
                      {leadName(a.lead_id)} <Badge tone="teal">{ACTIVITY_LABEL[a.kind]}</Badge>
                    </p>
                    {a.note && <p className="text-[11px] text-purple">{a.note}</p>}
                    <p className="num text-[11px] text-purple">{dateTimeAr(a.follow_up_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* renewals */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <CalendarClock size={16} /> عقودي القاربة على الانتهاء (فرص تجديد)
          </h2>
          {renewals.length === 0 ? (
            <p className="text-sm text-purple">لا توجد عقود قاربة على الانتهاء.</p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {renewals.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-navy-900">{r.customer_name}</span>
                    <Badge tone="teal">
                      {SERVICE_LABEL[r.service_code as keyof typeof SERVICE_LABEL] ??
                        r.service_code}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="num text-xs text-purple">ينتهي {dateAr(r.end_date)}</span>
                    <span className="num font-semibold text-gold-600">
                      {sar(r.total_amount)} ر.س
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* commissions breakdown (from won deals) */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <Coins size={16} /> تفصيل عمولاتي (الصفقات المغلقة)
          </h2>
          {wonDeals.length === 0 ? (
            <p className="text-sm text-purple">لا توجد صفقات مغلقة بعد.</p>
          ) : (
            <>
              <ul className="divide-y divide-navy-50">
                {wonDeals.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-medium text-navy-900">{l.full_name}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-xs text-purple">{sar(l.est_value)} ر.س</span>
                      <span className="num font-semibold text-gold-600">
                        {sar(Math.round(l.est_value * commissionRate))} ر.س
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between border-t border-navy-100 pt-2 text-sm font-bold text-navy">
                <span>الإجمالي ({Math.round(commissionRate * 1000) / 10}٪)</span>
                <span className="num text-gold-600">{sar(commissionTotal)} ر.س</span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Gauge({
  label,
  actual,
  target,
  pct,
  money,
  unit,
}: {
  label: string;
  actual: number;
  target: number;
  pct?: number;
  money?: boolean;
  unit?: string;
}) {
  const p = pct ?? (target ? Math.min(100, Math.round((actual / target) * 100)) : 0);
  const fmt = (n: number) => (money ? sar(n) : String(n));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-navy-900">{label}</span>
        <span className="num font-semibold text-navy">
          {fmt(actual)}{' '}
          <span className="text-purple">
            / {fmt(target)} {unit ?? ''}
          </span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-navy-50">
        <div
          className={`h-full rounded-full ${p >= 100 ? 'bg-teal' : 'bg-gold-600'}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-purple">إنجاز {p}٪</p>
    </div>
  );
}
