import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, Lock, Send, ShieldCheck, User } from 'lucide-react';
import { Badge, Button } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { answer, type AssistantAnswer } from '@/features/accounting/data/assistant';
import {
  useBills,
  useChart,
  useInvoices,
  useJournal,
} from '@/features/accounting/hooks/useAccounting';
import {
  useAccAccess,
  useAccConfig,
  useAiConfig,
  useAssistantLog,
} from '@/features/accounting/hooks/useAccountingPro';
import * as pro from '@/features/accounting/api/accountingPro.api';
import {
  AXIS,
  CHART_COLORS,
  GRID,
  SectionCard,
  sarTip,
  todayIso,
} from '@/features/accounting/components/kit';

const SUGGESTED = [
  'كم إجمالي إيرادات هذا الشهر؟',
  'ما صافي الأرباح؟',
  'من العملاء المتأخرون عن السداد؟',
  'ما أكبر خمسة مصروفات؟',
  'لماذا انخفض الربح؟',
  'ما الفواتير غير المحصلة؟',
  'قارن أداء الفروع',
  'هل توجد قيود محاسبية غير معتادة؟',
  'ما التدفق النقدي المتوقع؟',
  'صنّف مصروف فاتورة كهرباء سكن العمالة',
];

interface Msg {
  q: string;
  a: AssistantAnswer;
}

/** المساعد المحاسبي — محرك محلي على بيانات المستخدم المصرّح بها فقط، للاستعلام لا للتعديل. */
export function AssistantScreen() {
  const { can } = usePermissions();
  const { actor } = useAccAccess();
  const cfg = useAccConfig();
  const { data: entries = [] } = useJournal();
  const { data: chart = [] } = useChart();
  const { data: invoices = [] } = useInvoices();
  const { data: bills = [] } = useBills();
  const { data: ai } = useAiConfig();
  const { refetch: refetchLog } = useAssistantLog();
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const data = useMemo(
    () => ({
      entries,
      chart,
      invoices,
      bills,
      branches: BRANCHES_AR,
      today: todayIso(),
      anomalyMultiplier: cfg.anomalyMultiplier,
    }),
    [entries, chart, invoices, bills, cfg.anomalyMultiplier],
  );

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    const a = answer(text, data, can('accounting', 'view'));
    pro.logAssistant(actor, text, a.intent, !!a.refused);
    void refetchLog();
    setMsgs((m) => [...m, { q: text, a }]);
    setQ('');
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
      <SectionCard title="المساعد المحاسبي" icon={Bot}>
        <div className="min-h-[320px] space-y-4">
          {!msgs.length && (
            <p className="text-sm text-purple">
              اسأل بالعربية عن أرقامك المالية. الإجابات من القيود المرحّلة والفواتير المصرّح لك بها،
              مع الفترة والمصدر.
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className="space-y-2">
              <p className="flex items-start gap-2 text-sm font-semibold text-navy">
                <User size={16} className="mt-0.5 shrink-0" /> {m.q}
              </p>
              <Answer a={m.a} />
            </div>
          ))}
        </div>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="مثال: كم إيرادات أبريل؟"
            aria-label="سؤالك"
            className="flex-1 rounded-xl border border-navy-100 px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
          <Button type="submit" disabled={!q.trim()}>
            <Send size={15} /> اسأل
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full bg-navy-50 px-3 py-1 text-xs text-navy hover:bg-navy-100"
            >
              {s}
            </button>
          ))}
        </div>
      </SectionCard>
      <div className="space-y-4">
        <SectionCard title="الأمان والخصوصية" icon={ShieldCheck}>
          <ul className="space-y-2 text-xs leading-relaxed text-purple">
            <li>• يقرأ فقط ما تسمح به صلاحياتك (RLS + has_perm)، ولا يتجاوزها.</li>
            <li>• لا يرحّل ولا يعدّل ولا يحذف أي بيانات مالية؛ يحيلك لمسار الاعتماد.</li>
            <li>• لا ينفّذ استعلامات حرة: أسئلة مفهومة تُترجم إلى دوال حساب آمنة.</li>
            <li>• كل سؤال يُسجَّل في سجل المساعد (للمراجعة).</li>
          </ul>
        </SectionCard>
        <SectionCard title="مزوّد الذكاء الاصطناعي" icon={Lock}>
          {ai?.enabled ? (
            <Badge tone="success">مفعّل: {ai.provider}</Badge>
          ) : (
            <div className="space-y-2 text-xs text-purple">
              <Badge tone="neutral">غير مهيأ</Badge>
              <p>
                يعمل المساعد حاليًا بمحرك محلي داخل المتصفح — لا تُرسل أي بيانات لخدمة خارجية. تفعيل
                مزوّد خارجي يحتاج إعدادًا من المدير العام وموافقة صريحة على إرسال البيانات، ويُحفظ
                المفتاح في خزنة الخادم لا في الواجهة.
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Answer({ a }: { a: AssistantAnswer }) {
  return (
    <div className={`rounded-2xl p-3 text-sm ${a.refused ? 'bg-amber-50' : 'bg-navy-50'}`}>
      <p className="flex items-start gap-2 text-navy-900">
        <Bot size={16} className="mt-0.5 shrink-0 text-navy" /> {a.text}
      </p>
      {a.figures && (
        <dl className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
          {a.figures.map((f) => (
            <div key={f.label} className="rounded-lg bg-white px-2 py-1">
              <dt className="text-purple">{f.label}</dt>
              <dd className="num font-semibold text-navy">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.table && (
        <div className="mt-2 overflow-x-auto rounded-lg bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-navy-100 text-purple">
                {a.table.headers.map((h) => (
                  <th key={h} className="px-2 py-1.5 text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.table.rows.map((r, i) => (
                <tr key={i} className="border-b border-navy-50">
                  {r.map((c, j) => (
                    <td key={j} className="num px-2 py-1.5">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.chart && a.chart.data.length > 0 && (
        <div className="mt-2 h-48 rounded-lg bg-white p-2" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.chart.data}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: AXIS, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 10 }} width={60} />
              <Tooltip formatter={sarTip} />
              <Bar
                dataKey="value"
                name="القيمة"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 space-y-0.5 text-[11px] text-purple">
        {a.period && <p>الفترة: {a.period}</p>}
        {a.sources.length > 0 && <p>المصدر: {a.sources.join(' · ')}</p>}
        {a.confidence && <p>درجة الثقة: {a.confidence}</p>}
        {a.assumptions?.map((x) => (
          <p key={x}>افتراض: {x}</p>
        ))}
      </div>
    </div>
  );
}
