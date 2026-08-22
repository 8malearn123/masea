import { useMemo } from 'react';
import {
  BookOpenText,
  Building2,
  Coins,
  Landmark,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { BRANCHES_AR } from '@/lib/funnel';
import { financialSnapshot } from '@/features/accounting/data/engine';
import { costCenters } from '@/features/accounting/data/reports';
import { SOURCE_LABEL } from '@/features/accounting/types';
import { useBills, useInvoices, useJournal } from '@/features/accounting/hooks/useAccounting';

function Kpi({
  label,
  value,
  icon: Icon,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-purple">{label}</p>
        <Icon size={16} className="text-navy-200" />
      </div>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

export function AccountantDashboard() {
  const { data: entries = [] } = useJournal();
  const { data: invoices = [] } = useInvoices();
  const { data: bills = [] } = useBills();

  const snap = useMemo(() => financialSnapshot(entries), [entries]);
  const centers = useMemo(() => costCenters(entries, BRANCHES_AR), [entries]);
  const maxNet = Math.max(1, ...centers.map((c) => Math.abs(c.net)));

  const ar = invoices
    .filter((i) => i.status !== 'void')
    .reduce((s, i) => s + (i.total - i.amount_paid), 0);
  const ap = bills
    .filter((b) => b.status !== 'void' && b.status !== 'paid')
    .reduce((s, b) => s + (b.total - b.amount_paid), 0);

  const recent = [...entries].sort((a, b) => b.entry_no - a.entry_no).slice(0, 7);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="الإيراد (قبل الضريبة)"
          value={sar(snap.revenue)}
          icon={TrendingUp}
          tone="text-green-600"
        />
        <Kpi label="المصروفات" value={sar(snap.expenses)} icon={TrendingDown} tone="text-red-600" />
        <Kpi label="صافي الربح" value={sar(snap.netProfit)} icon={Scale} tone="text-gold-600" />
        <Kpi label="النقدية والبنوك" value={sar(snap.cash)} icon={Landmark} tone="text-navy" />
        <Kpi label="ذمم العملاء (تحصيل)" value={sar(ar)} icon={Wallet} tone="text-teal" />
        <Kpi label="ذمم الموردين (سداد)" value={sar(ap)} icon={Coins} tone="text-red-600" />
        <Kpi
          label="ضريبة مستحقة (VAT)"
          value={sar(snap.vatPayable)}
          icon={Receipt}
          tone="text-gold-600"
        />
        <Card className="flex flex-col justify-center py-4">
          <p className="text-xs text-purple">سلامة الدفتر</p>
          {snap.balanced ? (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              متوازن ✓
            </span>
          ) : (
            <Badge tone="danger">غير متوازن</Badge>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* net profit per cost center */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Building2 size={16} /> صافي الربح حسب مركز التكلفة
          </h2>
          <div className="space-y-3">
            {centers.map((c) => (
              <div key={c.branch} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-sm text-navy-900">{c.branch}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className={`h-full rounded-full ${c.net >= 0 ? 'bg-teal' : 'bg-red-500'}`}
                    style={{ width: `${(Math.abs(c.net) / maxNet) * 100}%` }}
                  />
                </div>
                <span className="num w-24 text-left text-sm font-semibold text-navy">
                  {sar(c.net)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* recent journal entries */}
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <BookOpenText size={16} /> أحدث القيود
          </h2>
          <ul className="space-y-1.5">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-navy-50"
              >
                <span className="flex items-center gap-2">
                  <Badge tone="teal">{SOURCE_LABEL[e.source_type]}</Badge>
                  <span className="text-navy-900">{e.description}</span>
                </span>
                <span className="num text-xs text-purple">
                  {sar(e.lines.reduce((s, l) => s + l.debit, 0))} · {dateAr(e.entry_date)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="text-xs leading-relaxed text-purple">
        لوحة مالية مخصّصة للمحاسب — كل الأرقام محسوبة مباشرةً من دفتر اليومية (إيراد قبل الضريبة،
        ضريبة مستقلة، مراكز تكلفة على الفروع). للتفاصيل الكاملة افتح وحدة «المحاسبة».
      </Card>
    </div>
  );
}
