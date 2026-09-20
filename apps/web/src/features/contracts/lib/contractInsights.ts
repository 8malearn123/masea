import type { BadgeTone } from '@/shared/ui/Badge';
import {
  SERVICE_LABEL,
  type ContractListItem,
  type ContractStatus,
} from '@/features/contracts/types';

/**
 * Derived, read-only insight for a single contract — the financial + lifecycle
 * signals the enhanced list surfaces. Everything here is COMPUTED from the
 * contract row (base/total/amount_paid/status/dates); no business figure is
 * stored in the UI. The one tunable threshold is exported so it can move to
 * system settings (app_config) later.
 */
export const RENEWAL_WINDOW_DAYS = 30;

export interface ContractInsight {
  paid: number;
  remaining: number;
  /** 0–100, rounded — share of the total that has been collected. */
  paidPct: number;
  payLabel: string;
  payTone: Extract<BadgeTone, 'success' | 'gold' | 'danger'>;
  /** A live contract (active/completed) that still has money owed. */
  isOverdue: boolean;
  /** Whole days until end_date (negative = already past). null when no end_date. */
  daysToExpiry: number | null;
  /** Active contract inside the renewal window — a renewal opportunity. */
  nearExpiry: boolean;
  /** Short service term label, e.g. «استقدام» / «تأجير شهري». */
  termLabel: string;
}

const DAY = 86_400_000;

function daysBetween(from: Date, isoDate: string | null): number | null {
  if (!isoDate) return null;
  const to = new Date(isoDate);
  if (Number.isNaN(to.getTime())) return null;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / DAY);
}

/**
 * `windowDays` هي مهلة التنبيه قبل انتهاء العقد، وقيمتها إدارية تُقرأ من
 * إعدادات النظام (`contract_expiry_alert_days`)؛ الثابت هنا قيمة احتياطية فقط.
 */
export function contractInsight(
  c: ContractListItem,
  now: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): ContractInsight {
  const total = c.total_amount ?? 0;
  const paid = Math.min(c.amount_paid ?? 0, total);
  const remaining = Math.max(total - paid, 0);
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;

  const isLive = c.status === 'active' || c.status === 'completed';
  const isOverdue = isLive && remaining > 0;

  const daysToExpiry = daysBetween(now, c.end_date);
  const nearExpiry =
    c.status === 'active' &&
    daysToExpiry !== null &&
    daysToExpiry >= 0 &&
    daysToExpiry <= windowDays;

  const payLabel =
    remaining === 0 ? 'مسدّد بالكامل' : `متبقٍ ${Math.round(remaining).toLocaleString('en-US')}`;
  const payTone: ContractInsight['payTone'] =
    remaining === 0 ? 'success' : isOverdue ? 'danger' : 'gold';

  return {
    paid,
    remaining,
    paidPct,
    payLabel,
    payTone,
    isOverdue,
    daysToExpiry,
    nearExpiry,
    termLabel: c.service_code ? SERVICE_LABEL[c.service_code] : '—',
  };
}

/**
 * A descriptive lifecycle stage line (richer than the raw status badge).
 * `recruitmentStageName` is the resolved Arabic name of the active recruitment
 * stage, passed in by the caller (which already has the managed stages list).
 */
export function contractStageLabel(
  c: ContractListItem,
  ins: ContractInsight,
  recruitmentStageName: string | null,
): string {
  switch (c.status) {
    case 'draft':
      return 'مسودة — جاهزة للإرسال';
    case 'musaned_created':
      return 'أُنشئ على مساند — بانتظار توقيع العميل';
    case 'musaned_signed':
      return 'وقّع العميل على مساند — جاهز للتفعيل';
    case 'pending_approval':
      return 'بانتظار اعتماد المدير';
    case 'approved':
      return c.service_code === 'recruitment' ? 'جاهز للإسناد لمكتب' : 'جاهز للجدولة';
    case 'awaiting_signature':
      return 'بانتظار توقيع العميل';
    case 'signed':
      return 'موقّع — بانتظار التفعيل';
    case 'active':
      if (c.service_code === 'recruitment' && recruitmentStageName) return recruitmentStageName;
      if (ins.nearExpiry) return 'قارب الانتهاء — تجديد';
      return 'تحت التشغيل';
    case 'completed':
      return 'مكتمل ومؤرشف';
    case 'cancelled':
      return 'ملغى';
    default:
      return '—';
  }
}

/* ------------------------------ tab grouping ----------------------------- */
export type ContractTab = 'all' | 'action' | 'live' | 'renewals' | 'cancelled';

const NEEDS_ACTION: ContractStatus[] = [
  'draft',
  'musaned_created',
  'musaned_signed',
  'pending_approval',
  'approved',
  'awaiting_signature',
];

export function matchesTab(c: ContractListItem, ins: ContractInsight, tab: ContractTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'action':
      return NEEDS_ACTION.includes(c.status);
    case 'live':
      return c.status === 'signed' || c.status === 'active';
    case 'renewals':
      return ins.nearExpiry;
    case 'cancelled':
      return c.status === 'cancelled';
    default:
      return true;
  }
}

/* ------------------------------- KPI totals ------------------------------ */
export interface ContractKpis {
  overdueTotal: number;
  portfolioValue: number;
  renewals: number;
  pendingApproval: number;
  activeCount: number;
}

export function contractKpis(
  rows: ContractListItem[],
  now: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): ContractKpis {
  return rows.reduce<ContractKpis>(
    (acc, c) => {
      const ins = contractInsight(c, now, windowDays);
      if (ins.isOverdue) acc.overdueTotal += ins.remaining;
      if (c.status !== 'cancelled') acc.portfolioValue += c.total_amount ?? 0;
      if (ins.nearExpiry) acc.renewals += 1;
      if (c.status === 'pending_approval') acc.pendingApproval += 1;
      if (c.status === 'active') acc.activeCount += 1;
      return acc;
    },
    { overdueTotal: 0, portfolioValue: 0, renewals: 0, pendingApproval: 0, activeCount: 0 },
  );
}

/* -------------------------------- sorting -------------------------------- */
export type ContractSort = 'recent' | 'value' | 'due';

export function sortContracts(
  rows: ContractListItem[],
  sort: ContractSort,
  now: Date = new Date(),
): ContractListItem[] {
  const copy = [...rows];
  switch (sort) {
    case 'value':
      return copy.sort((a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0));
    case 'due': {
      const rank = (c: ContractListItem) => {
        const d = daysBetween(now, c.end_date);
        return d === null ? Number.POSITIVE_INFINITY : d;
      };
      return copy.sort((a, b) => rank(a) - rank(b));
    }
    case 'recent':
    default:
      return copy.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
}

/* --------------------------- تنبيهات انتهاء العقود -------------------------- */
/** درجة إلحاح التنبيه: منتهٍ فعلًا · حرِج · قريب. */
export type ExpiryUrgency = 'expired' | 'critical' | 'soon';

export interface ExpiryAlert {
  contract: ContractListItem;
  insight: ContractInsight;
  urgency: ExpiryUrgency;
  /** نص التنبيه جاهزًا للعرض («ينتهي بعد ٥ أيام» / «انتهى منذ يومين»). */
  message: string;
}

export const EXPIRY_URGENCY_LABEL: Record<ExpiryUrgency, string> = {
  expired: 'منتهٍ',
  critical: 'حرِج',
  soon: 'قريب الانتهاء',
};

const EXPIRY_TONE: Record<ExpiryUrgency, Extract<BadgeTone, 'danger' | 'gold' | 'navy'>> = {
  expired: 'danger',
  critical: 'danger',
  soon: 'gold',
};

export function expiryTone(urgency: ExpiryUrgency): Extract<BadgeTone, 'danger' | 'gold' | 'navy'> {
  return EXPIRY_TONE[urgency];
}

function daysMessage(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    if (n === 1) return 'انتهى أمس';
    if (n === 2) return 'انتهى منذ يومين';
    return `انتهى منذ ${n} يومًا`;
  }
  if (days === 0) return 'ينتهي اليوم';
  if (days === 1) return 'ينتهي غدًا';
  if (days === 2) return 'ينتهي بعد يومين';
  return `ينتهي بعد ${days} يومًا`;
}

/**
 * العقود التي تستوجب تنبيهًا: السارية التي اقترب انتهاؤها داخل مهلة التنبيه،
 * والسارية التي تجاوزت تاريخ نهايتها ولم تُجدَّد أو تُقفل. الأقرب انتهاءً أولًا.
 * «حرِج» = ما تبقّى له أقل من ثلث المهلة — مشتقّة من القيمة الإدارية لا رقم ثابت.
 */
export function expiryAlerts(
  rows: ContractListItem[],
  windowDays: number = RENEWAL_WINDOW_DAYS,
  now: Date = new Date(),
): ExpiryAlert[] {
  const criticalAt = Math.max(1, Math.round(windowDays / 3));
  return rows
    .map((contract) => ({ contract, insight: contractInsight(contract, now, windowDays) }))
    .filter(({ contract, insight }) => {
      if (contract.status !== 'active') return false;
      const d = insight.daysToExpiry;
      return d !== null && d <= windowDays;
    })
    .map(({ contract, insight }) => {
      const days = insight.daysToExpiry ?? 0;
      const urgency: ExpiryUrgency =
        days < 0 ? 'expired' : days <= criticalAt ? 'critical' : 'soon';
      return { contract, insight, urgency, message: daysMessage(days) };
    })
    .sort((a, b) => (a.insight.daysToExpiry ?? 0) - (b.insight.daysToExpiry ?? 0));
}
