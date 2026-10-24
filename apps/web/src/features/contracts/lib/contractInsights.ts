import type { BadgeTone } from '@/shared/ui/Badge';
import {
  SERVICE_LABEL,
  type ContractListItem,
  type ContractStatus,
} from '@/features/contracts/types';
import { contractTermUnit } from '@/features/contracts/lib/contractTerm';

/**
 * Derived, read-only insight for a single contract — the financial + lifecycle
 * signals the enhanced list surfaces. Everything here is COMPUTED from the
 * contract row (base/total/amount_paid/status/dates); no business figure is
 * stored in the UI. The one tunable threshold is exported so it can move to
 * system settings (app_config) later.
 */
export const RENEWAL_WINDOW_DAYS = 30;

/** مفتاح مهلة التنبيه في إعدادات النظام (app_config). */
export const EXPIRY_WINDOW_KEY = 'contract_expiry_alert_days';

/**
 * حالة انتهاء العقد — التصنيف الوحيد الذي تبني عليه التنبيهات والمؤشرات
 * والتبويبات ولوحة التحكم:
 * - expired: عقد ساري تجاوز تاريخ نهايته ولم يُجدَّد أو يُغلق.
 * - critical / soon: ساري وينتهي داخل مهلة التنبيه (حرِج = أقل من ثلثها).
 * - ok: ساري ونهايته بعد المهلة.
 * - no_end_date: ساري لخدمة لها مدة لكن تاريخ نهايته غير محدّد — لا يُصنَّف
 *   منتهيًا ولا قريبًا من الانتهاء، ويُعرض كحالة مستقلة.
 * - not_applicable: ليس ساريًا (مسودة/مكتمل/ملغى…) أو خدمة بلا مدة (نقل كفالة).
 */
export type ExpiryState = 'expired' | 'critical' | 'soon' | 'ok' | 'no_end_date' | 'not_applicable';

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
  /** تصنيف الانتهاء (انظر ExpiryState). */
  expiry: ExpiryState;
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
  const expiry = expiryStateOf(c, daysToExpiry, windowDays);

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
    expiry,
    termLabel: c.service_code ? SERVICE_LABEL[c.service_code] : '—',
  };
}

/** حدّ «حرِج»: أقل من ثلث المهلة — مشتقّ من القيمة الإدارية لا رقم ثابت. */
function criticalDays(windowDays: number): number {
  return Math.max(1, Math.round(windowDays / 3));
}

function expiryStateOf(
  c: ContractListItem,
  daysToExpiry: number | null,
  windowDays: number,
): ExpiryState {
  if (c.status !== 'active') return 'not_applicable';
  if (contractTermUnit(c.service_code) === null && !c.end_date) return 'not_applicable';
  if (daysToExpiry === null) return 'no_end_date';
  if (daysToExpiry < 0) return 'expired';
  if (daysToExpiry <= criticalDays(windowDays)) return 'critical';
  if (daysToExpiry <= windowDays) return 'soon';
  return 'ok';
}

/** يحتاج تجديدًا (أو إغلاقًا): منتهٍ ولم يُجدَّد، أو ينتهي داخل المهلة. */
export function needsRenewal(state: ExpiryState): boolean {
  return state === 'expired' || state === 'critical' || state === 'soon';
}

export const EXPIRY_STATE_LABEL: Partial<Record<ExpiryState, string>> = {
  expired: 'منتهٍ',
  critical: 'حرِج',
  soon: 'قريب الانتهاء',
  no_end_date: 'تاريخ النهاية غير محدد',
};

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
      if (ins.expiry === 'expired') return 'انتهت مدته — يحتاج تجديدًا أو إغلاقًا';
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
      return needsRenewal(ins.expiry);
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
  /** ساري تجاوز تاريخ نهايته. */
  expired: number;
  /** ساري ينتهي داخل المهلة (حرِج + قريب). */
  expiringSoon: number;
  /** ساري لخدمة لها مدة وتاريخ نهايته غير محدد. */
  noEndDate: number;
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
      if (needsRenewal(ins.expiry)) acc.renewals += 1;
      if (ins.expiry === 'expired') acc.expired += 1;
      if (ins.expiry === 'critical' || ins.expiry === 'soon') acc.expiringSoon += 1;
      if (ins.expiry === 'no_end_date') acc.noEndDate += 1;
      if (c.status === 'pending_approval') acc.pendingApproval += 1;
      if (c.status === 'active') acc.activeCount += 1;
      return acc;
    },
    {
      overdueTotal: 0,
      portfolioValue: 0,
      renewals: 0,
      expired: 0,
      expiringSoon: 0,
      noEndDate: 0,
      pendingApproval: 0,
      activeCount: 0,
    },
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
  return rows
    .map((contract) => ({ contract, insight: contractInsight(contract, now, windowDays) }))
    .filter(({ insight }) => needsRenewal(insight.expiry))
    .map(({ contract, insight }) => ({
      contract,
      insight,
      urgency: insight.expiry as ExpiryUrgency,
      message: daysMessage(insight.daysToExpiry ?? 0),
    }))
    .sort((a, b) => (a.insight.daysToExpiry ?? 0) - (b.insight.daysToExpiry ?? 0));
}

/** أعداد التنبيهات لملخّص صفحة العقود ولوحة التحكم — من نفس التصنيف. */
export interface ExpirySummary {
  expired: number;
  critical: number;
  soon: number;
  noEndDate: number;
  /** منتهٍ + حرِج + قريب = يحتاج تجديدًا. */
  needsRenewal: number;
}

export function expirySummary(
  rows: ContractListItem[],
  windowDays: number = RENEWAL_WINDOW_DAYS,
  now: Date = new Date(),
): ExpirySummary {
  const out: ExpirySummary = { expired: 0, critical: 0, soon: 0, noEndDate: 0, needsRenewal: 0 };
  for (const c of rows) {
    const { expiry } = contractInsight(c, now, windowDays);
    if (expiry === 'expired') out.expired += 1;
    else if (expiry === 'critical') out.critical += 1;
    else if (expiry === 'soon') out.soon += 1;
    else if (expiry === 'no_end_date') out.noEndDate += 1;
    if (needsRenewal(expiry)) out.needsRenewal += 1;
  }
  return out;
}
