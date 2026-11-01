/**
 * تصنيف العملاء ومؤشرات الأداء — دوال صافية فوق صفوف customer_insights، والعتبات
 * من الإعدادات (لا أرقام ثابتة). مصدر واحد للقائمة والملف ولوحة التحليل.
 */
import type { CrmThresholds, CustomerInsight, CustomerSegment } from '@/features/customers/types';

const DAY = 86_400_000;

function daysSince(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  return Math.floor((today.getTime() - new Date(iso).getTime()) / DAY);
}

function daysUntil(iso: string | null, today: Date): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(`${iso.slice(0, 10)}T23:59:59Z`).getTime() - today.getTime()) / DAY);
}

/** Every segment a customer belongs to (a customer can be in several). */
export function customerSegments(
  c: CustomerInsight,
  t: CrmThresholds,
  today = new Date(),
): Set<CustomerSegment> {
  const s = new Set<CustomerSegment>();
  const sincePurchase = c.days_since_purchase ?? daysSince(c.last_purchase_at, today);
  const sinceContact = c.days_since_contact ?? daysSince(c.last_contact_at, today);
  const age = daysSince(c.created_at, today) ?? 0;
  const bought = c.purchases > 0;
  const hasWorker = c.active_contracts > 0;

  if (age <= t.newDays) s.add('new');
  if (hasWorker || (bought && sincePurchase !== null && sincePurchase <= t.inactiveDays))
    s.add('active');
  else if (bought) s.add('inactive');
  if (c.purchases >= 2) s.add('repeat');
  s.add(hasWorker ? 'with_worker' : 'without_worker');
  if (bought) s.add('served_before');
  if (bought && !hasWorker) s.add('ended_no_worker');

  const endsIn = daysUntil(c.next_end_date, today);
  const avgInterval =
    c.purchases >= 2 && c.first_purchase_at && c.last_purchase_at
      ? (new Date(c.last_purchase_at).getTime() - new Date(c.first_purchase_at).getTime()) /
        DAY /
        (c.purchases - 1)
      : null;
  if (
    (hasWorker && endsIn !== null && endsIn <= t.returnWindowDays) ||
    (!hasWorker && avgInterval !== null && sincePurchase !== null && sincePurchase >= avgInterval)
  )
    s.add('expected_return');

  const quiet = sinceContact === null || sinceContact > t.followupDays;
  if (c.is_active && quiet && !hasWorker && (bought || age > t.newDays)) s.add('needs_followup');
  return s;
}

export interface CrmKpis {
  total: number;
  active: number;
  inactive: number;
  newCount: number;
  repeat: number;
  purchasers: number;
  withWorker: number;
  /** % of customers who ever bought that are still active */
  retentionPct: number;
  /** % of buyers who bought more than once */
  repeatRatePct: number;
  /** average net value per buying customer */
  avgCustomerValue: number;
  /** purchasers without a running contract whose last purchase is at least N days old */
  noPurchaseSince: { d30: number; d60: number; d90: number };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export function crmKpis(rows: CustomerInsight[], t: CrmThresholds, today = new Date()): CrmKpis {
  const live = rows.filter((r) => r.is_active);
  const segs = live.map((r) => ({ r, s: customerSegments(r, t, today) }));
  const count = (k: CustomerSegment) => segs.filter((x) => x.s.has(k)).length;
  const buyers = live.filter((r) => r.purchases > 0);
  const lapsed = (n: number) =>
    buyers.filter((r) => {
      const d = r.days_since_purchase ?? daysSince(r.last_purchase_at, today);
      return r.active_contracts === 0 && d !== null && d >= n;
    }).length;
  const activeBuyers = segs.filter((x) => x.r.purchases > 0 && x.s.has('active')).length;
  const repeat = count('repeat');
  return {
    total: live.length,
    active: count('active'),
    inactive: count('inactive'),
    newCount: count('new'),
    repeat,
    purchasers: buyers.length,
    withWorker: count('with_worker'),
    retentionPct: pct(activeBuyers, buyers.length),
    repeatRatePct: pct(repeat, buyers.length),
    avgCustomerValue: buyers.length
      ? Math.round((buyers.reduce((s, r) => s + r.sales_value, 0) / buyers.length) * 100) / 100
      : 0,
    noPurchaseSince: { d30: lapsed(30), d60: lapsed(60), d90: lapsed(90) },
  };
}
