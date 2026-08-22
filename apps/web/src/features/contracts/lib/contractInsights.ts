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

export function contractInsight(c: ContractListItem, now: Date = new Date()): ContractInsight {
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
    daysToExpiry <= RENEWAL_WINDOW_DAYS;

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

export function contractKpis(rows: ContractListItem[], now: Date = new Date()): ContractKpis {
  return rows.reduce<ContractKpis>(
    (acc, c) => {
      const ins = contractInsight(c, now);
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
