import type { BudgetAlert } from '@/features/accounting/data/budgets';
import type { Anomaly } from '@/features/accounting/data/insights';
import type { OpenItem } from '@/features/accounting/data/receivables';
import type { EInvoiceRecord } from '@/features/accounting/data/zatca';
import { daysBetween } from '@/features/accounting/data/receivables';
import { sumMoney } from '@/features/accounting/data/money';
import type { JournalEntry, Period } from '@/features/accounting/types';

/**
 * Financial alerts center — alerts are DERIVED from live data (never typed in);
 * their workflow state (owner, priority override, status) is stored separately
 * and keyed by a deterministic alert id so it survives recomputation.
 */
export type AlertType =
  | 'overdue_invoice'
  | 'bill_due'
  | 'budget'
  | 'low_cash'
  | 'anomaly'
  | 'pending_entry'
  | 'period_close'
  | 'bank_rec'
  | 'einvoice';
export type AlertPriority = 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  overdue_invoice: 'فواتير متأخرة',
  bill_due: 'مدفوعات مستحقة',
  budget: 'تجاوز الموازنة',
  low_cash: 'انخفاض السيولة',
  anomaly: 'عمليات غير معتادة',
  pending_entry: 'قيود معلّقة',
  period_close: 'فترات تحتاج إقفالًا',
  bank_rec: 'التسوية البنكية',
  einvoice: 'التكامل الضريبي',
};
export const ALERT_PRIORITY_LABEL: Record<AlertPriority, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
};
export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'جديد',
  in_progress: 'قيد المعالجة',
  resolved: 'تمت المعالجة',
  dismissed: 'متجاهَل',
};

export interface FinAlert {
  id: string;
  type: AlertType;
  title: string;
  detail: string;
  priority: AlertPriority;
  amount?: number;
  target: string; // accounting screen key to open
}

export interface AlertState {
  assignee: string | null;
  status: AlertStatus;
  priority?: AlertPriority;
  note?: string;
}

export interface AlertInputs {
  today: string;
  arOpen: OpenItem[];
  apOpen: OpenItem[];
  billDueDays: number;
  budgetAlerts: BudgetAlert[];
  cash: number;
  lowCashThreshold: number;
  anomalies: Anomaly[];
  workflowEntries: JournalEntry[]; // draft/pending/approved
  periods: Period[];
  unreconciledBankItems: number;
  einvoices: EInvoiceRecord[];
}

export function deriveAlerts(i: AlertInputs): FinAlert[] {
  const out: FinAlert[] = [];
  const overdue = i.arOpen.filter((x) => x.days_overdue > 0);
  for (const x of overdue)
    out.push({
      id: `ar-${x.id}`,
      type: 'overdue_invoice',
      title: `فاتورة #${x.no} متأخرة ${x.days_overdue} يومًا`,
      detail: `${x.party} — المتبقي ${x.outstanding.toLocaleString('en-US')} ر.س`,
      priority: x.days_overdue > 60 ? 'high' : x.days_overdue > 30 ? 'medium' : 'low',
      amount: x.outstanding,
      target: 'receivables',
    });
  for (const x of i.apOpen) {
    const d = daysBetween(i.today, x.due_date);
    if (d > i.billDueDays) continue;
    out.push({
      id: `ap-${x.id}`,
      type: 'bill_due',
      title:
        d < 0
          ? `فاتورة مورد #${x.no} متأخرة ${-d} يومًا`
          : `فاتورة مورد #${x.no} تستحق خلال ${d} يوم`,
      detail: `${x.party} — ${x.outstanding.toLocaleString('en-US')} ر.س`,
      priority: d < 0 ? 'high' : 'medium',
      amount: x.outstanding,
      target: 'payables',
    });
  }
  for (const b of i.budgetAlerts)
    out.push({
      id: `bud-${b.budget}-${b.code}`,
      type: 'budget',
      title: b.overrun ? `تجاوز موازنة ${b.name}` : `اقتراب من حد موازنة ${b.name}`,
      detail: `${b.budget} — مستهلك ${b.usedPct}٪`,
      priority: b.overrun ? 'high' : 'medium',
      target: 'budgets',
    });
  if (i.cash < i.lowCashThreshold)
    out.push({
      id: 'cash-low',
      type: 'low_cash',
      title: 'السيولة أقل من الحد الأدنى',
      detail: `الرصيد ${i.cash.toLocaleString('en-US')} ر.س < الحد ${i.lowCashThreshold.toLocaleString('en-US')} ر.س`,
      priority: 'high',
      amount: i.cash,
      target: 'banks',
    });
  for (const a of i.anomalies.slice(0, 10))
    out.push({
      id: `anom-${a.entry_id}`,
      type: 'anomaly',
      title: `قيد #${a.entry_no} غير معتاد`,
      detail: a.reasons.join(' · '),
      priority: a.score >= 4 ? 'high' : 'medium',
      amount: a.amount,
      target: 'journal',
    });
  const pending = i.workflowEntries.filter(
    (e) => e.status === 'pending' || e.status === 'approved',
  );
  if (pending.length)
    out.push({
      id: 'je-pending',
      type: 'pending_entry',
      title: `${pending.length} قيد بانتظار الاعتماد/الترحيل`,
      detail: `إجمالي ${sumMoney(pending.map((e) => sumMoney(e.lines.map((l) => l.debit)))).toLocaleString('en-US')} ر.س`,
      priority: 'medium',
      target: 'journal',
    });
  const cur = i.today.slice(0, 7);
  const toClose = i.periods.filter((p) => p.status === 'open' && p.id < cur);
  if (toClose.length)
    out.push({
      id: `close-${toClose.map((p) => p.id).join(',')}`,
      type: 'period_close',
      title: `${toClose.length} فترة منتهية لم تُقفل`,
      detail: toClose.map((p) => p.id).join('، '),
      priority: toClose.length > 2 ? 'high' : 'low',
      target: 'closing',
    });
  if (i.unreconciledBankItems > 0)
    out.push({
      id: 'bank-unrec',
      type: 'bank_rec',
      title: `${i.unreconciledBankItems} حركة بنكية غير مطابقة`,
      detail: 'راجع شاشة التسوية البنكية',
      priority: 'medium',
      target: 'bank_rec',
    });
  for (const r of i.einvoices.filter((x) => x.status === 'error' || x.status === 'rejected'))
    out.push({
      id: `einv-${r.invoice_id}`,
      type: 'einvoice',
      title: `خطأ في الفاتورة الإلكترونية (ICV ${r.icv})`,
      detail: r.messages.join(' · ') || 'رفض من المنصة',
      priority: 'high',
      target: 'einvoice',
    });
  return out;
}

const RANK: Record<AlertPriority, number> = { high: 0, medium: 1, low: 2 };
export function withState(alerts: FinAlert[], state: Record<string, AlertState>) {
  return alerts
    .map((a) => {
      const s = state[a.id];
      return {
        ...a,
        priority: s?.priority ?? a.priority,
        state: s ?? { assignee: null, status: 'open' as AlertStatus },
      };
    })
    .sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}
