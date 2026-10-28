import {
  dashboardKpis,
  byBranch,
  expenseDistribution,
  previousWindow,
} from '@/features/accounting/data/analytics';
import { balances, monthEnd, indexChart } from '@/features/accounting/data/ledger';
import { fromHalala, pctChange, sumMoney, toHalala } from '@/features/accounting/data/money';
import { arOpenItems, apOpenItems, partyBalances } from '@/features/accounting/data/receivables';
import { cashForecast, detectAnomalies } from '@/features/accounting/data/insights';
import { incomeStatementPro } from '@/features/accounting/data/statements';
import type { Account, Bill, Invoice, JournalEntry } from '@/features/accounting/types';
import { MONTH_AR } from '@/features/accounting/types';

/**
 * Accounting assistant — LOCAL, deterministic engine. It understands common
 * Arabic finance questions, answers ONLY from data the caller already loaded
 * under the user's permissions (RLS), always states the period and the data
 * source, and never changes data: posting/editing requests are refused and
 * redirected to the approval workflow.
 *
 * An external LLM provider can be plugged in later through `AiProviderConfig`;
 * until an admin configures it (and approves sending data out), nothing leaves
 * the browser and no answers are invented.
 */

export interface AiProviderConfig {
  enabled: boolean;
  provider: string | null; // e.g. 'anthropic' — key lives server-side (vault), never here
  allowSensitiveData: boolean;
}
export const DEFAULT_AI_CONFIG: AiProviderConfig = {
  enabled: false,
  provider: null,
  allowSensitiveData: false,
};

export type Intent =
  | 'revenue'
  | 'profit'
  | 'profit_drop'
  | 'overdue_customers'
  | 'top_expenses'
  | 'unpaid_invoices'
  | 'compare_branches'
  | 'anomalies'
  | 'forecast'
  | 'cash'
  | 'vat'
  | 'payables'
  | 'classify_expense'
  | 'suggest_reports'
  | 'action_refused'
  | 'help';

export interface AssistantAnswer {
  intent: Intent;
  text: string;
  period?: string;
  figures?: { label: string; value: string }[];
  table?: { headers: string[]; rows: string[][] };
  chart?: { kind: 'bar'; data: { name: string; value: number }[] };
  sources: string[];
  confidence?: string;
  assumptions?: string[];
  refused?: boolean;
}

export interface AssistantData {
  entries: JournalEntry[];
  chart: Account[];
  invoices: Invoice[];
  bills: Bill[];
  branches: readonly string[];
  today: string;
  anomalyMultiplier: number;
}

const sarTxt = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

/** Strip diacritics / tatweel and unify alef & yaa forms for matching. */
export function normalizeAr(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(normalizeAr(w)));

export function detectIntent(question: string): Intent {
  const q = normalizeAr(question);
  // imperative verbs at a word start (so «معدل» doesn't read as «عدّل»)
  if (/(^|\s)(رحل|احذف|عدل|اعتمد|الغاء|الغي\s|اقفل)/.test(q) || has(q, 'انشئ قيد', 'سجل قيد'))
    return 'action_refused';
  if (has(q, 'صنف', 'تصنيف')) return 'classify_expense';
  if (has(q, 'لماذا', 'سبب', 'ليش') && has(q, 'انخفض', 'نقص', 'تراجع', 'قل')) return 'profit_drop';
  if (has(q, 'غير معتاد', 'غريب', 'مشبوه', 'شاذ', 'غير طبيعي')) return 'anomalies';
  if (has(q, 'توقع', 'متوقع', 'تنبؤ')) return 'forecast';
  if (has(q, 'قارن', 'مقارنه') && has(q, 'فرع', 'فروع')) return 'compare_branches';
  if (has(q, 'متاخر', 'المتاخرين', 'المتاخرون', 'متعثر')) return 'overdue_customers';
  if (has(q, 'غير محصل', 'غير المحصله', 'غير مدفوع', 'غير المدفوعه', 'لم تحصل'))
    return 'unpaid_invoices';
  if (has(q, 'اكبر', 'اعلى') && has(q, 'مصروف')) return 'top_expenses';
  if (has(q, 'مورد', 'ذمم دائنه', 'مستحقات الموردين')) return 'payables';
  if (has(q, 'ضريبه', 'vat', 'القيمه المضافه')) return 'vat';
  if (has(q, 'ربح', 'ارباح', 'صافي')) return 'profit';
  if (has(q, 'ايراد', 'مبيعات', 'دخل')) return 'revenue';
  if (has(q, 'رصيد', 'نقد', 'سيوله', 'بنك', 'صندوق')) return 'cash';
  if (has(q, 'تقرير', 'تقارير', 'اقترح')) return 'suggest_reports';
  return 'help';
}

const MONTH_ALIASES: string[][] = MONTH_AR.map((m, i) =>
  [
    m,
    ...([
      ['جانفي'],
      ['فيفري'],
      [],
      ['ابريل'],
      ['ماي'],
      ['جوان'],
      ['جويليه', 'يوليه'],
      ['اغسطس'],
      [],
      [],
      [],
      [],
    ][i] ?? []),
  ].map(normalizeAr),
);

/** Resolve the period a question refers to (defaults to year-to-date). */
export function resolvePeriod(
  question: string,
  today: string,
): { from: string; to: string; label: string } {
  const q = normalizeAr(question);
  const y = Number(today.slice(0, 4));
  const curMonth = today.slice(0, 7);
  if (has(q, 'هذا الشهر', 'الشهر الحالي'))
    return { from: `${curMonth}-01`, to: today, label: `الشهر الحالي (${curMonth})` };
  if (has(q, 'الشهر الماضي', 'الشهر السابق')) {
    const d = new Date(`${curMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const p = d.toISOString().slice(0, 7);
    return { from: `${p}-01`, to: monthEnd(p), label: `الشهر الماضي (${p})` };
  }
  for (let i = 0; i < 12; i++) {
    if ((MONTH_ALIASES[i] ?? []).some((a) => q.includes(a))) {
      const p = `${y}-${String(i + 1).padStart(2, '0')}`;
      return { from: `${p}-01`, to: monthEnd(p), label: `${MONTH_AR[i]} ${y}` };
    }
  }
  const quarter = /الربع (الاول|الثاني|الثالث|الرابع)/.exec(q);
  if (quarter) {
    const n = ['الاول', 'الثاني', 'الثالث', 'الرابع'].indexOf(quarter[1] ?? '');
    const sm = n * 3 + 1;
    const from = `${y}-${String(sm).padStart(2, '0')}-01`;
    return {
      from,
      to: monthEnd(`${y}-${String(sm + 2).padStart(2, '0')}`),
      label: `الربع ${quarter[1]} ${y}`,
    };
  }
  return { from: `${y}-01-01`, to: today, label: `منذ بداية ${y} حتى ${today}` };
}

const ARABIC_COUNT: Record<string, number> = {
  ثلاث: 3,
  ثلاثه: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  عشر: 10,
  عشره: 10,
};
function countIn(q: string, fallback: number): number {
  const n = /(\d+)/.exec(q.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  if (n) return Math.min(Number(n[1]), 20);
  for (const [w, v] of Object.entries(ARABIC_COUNT)) if (normalizeAr(q).includes(w)) return v;
  return fallback;
}

/** Suggest an expense account for a free-text description (keyword + chart names). */
export function classifyExpense(
  text: string,
  chart: Account[],
): { code: string; name: string; why: string } {
  const q = normalizeAr(text);
  const rules: [string[], string][] = [
    [['كهرباء', 'مياه', 'اتصالات', 'انترنت', 'جوال'], '5800'],
    [['ايجار', 'اجار'], '5700'],
    [['راتب', 'رواتب', 'اجور', 'بدل'], '5100'],
    [['تامينات', 'gosi'], '5200'],
    [['اعلان', 'تسويق', 'حمله', 'سناب', 'سوشال'], '5300'],
    [['مكتب خارجي', 'استقدام', 'تذاكر', 'تاشيره'], '5600'],
    [['مدى', 'بوابه', 'تمارا', 'عموله دفع'], '5500'],
  ];
  const idx = indexChart(chart);
  for (const [words, code] of rules) {
    const w = words.find((x) => q.includes(normalizeAr(x)));
    if (w && idx.get(code)?.is_active !== false)
      return { code, name: idx.get(code)?.name_ar ?? code, why: `كلمة «${w}»` };
  }
  const exp = chart.filter((a) => a.type === 'expense' && a.is_postable && a.is_active !== false);
  for (const a of exp) {
    const token = normalizeAr(a.name_ar)
      .split(' ')
      .find((t) => t.length > 3 && q.includes(t));
    if (token) return { code: a.code, name: a.name_ar, why: `يطابق اسم الحساب (${token})` };
  }
  return {
    code: '5400',
    name: idx.get('5400')?.name_ar ?? '5400',
    why: 'افتراضي: مصروفات تشغيلية عامة',
  };
}

const SRC_GL = 'دفتر الأستاذ العام (القيود المرحّلة)';
const SRC_AR = 'فواتير العملاء (دفتر المبيعات المشترك)';
const SRC_AP = 'فواتير الموردين';

/** Answer a question. `canView` = has_perm('accounting','view') for this user. */
export function answer(question: string, d: AssistantData, canView: boolean): AssistantAnswer {
  if (!canView)
    return {
      intent: 'help',
      text: 'لا تملك صلاحية عرض البيانات المحاسبية؛ لا يمكن للمساعد تجاوز صلاحياتك.',
      sources: [],
      refused: true,
    };
  const intent = detectIntent(question);
  const per = resolvePeriod(question, d.today);
  const f = { from: per.from, to: per.to };
  const empty = (what: string): AssistantAnswer => ({
    intent,
    text: `لا توجد ${what} مرحّلة في ${per.label}. آخر حركة في الدفتر: ${lastEntryDate(d.entries) ?? '—'}.`,
    period: per.label,
    sources: [SRC_GL],
  });

  switch (intent) {
    case 'action_refused':
      return {
        intent,
        refused: true,
        text: 'المساعد للاستعلام فقط: لا يُرحّل ولا يعدّل ولا يحذف أي بيانات مالية. نفّذ العملية من شاشة القيود حيث تمر بالاعتماد وصلاحية الترحيل، وتُسجَّل في سجل التدقيق.',
        sources: [],
      };
    case 'revenue': {
      const is = incomeStatementPro(d.entries, d.chart, f);
      const total = sumMoney([is.revenue.total, is.otherIncome.total]);
      if (toHalala(total) === 0) return empty('إيرادات');
      return {
        intent,
        period: per.label,
        text: `إجمالي الإيرادات (قبل الضريبة) ${sarTxt(total)}.`,
        figures: [...is.revenue.lines, ...is.otherIncome.lines].map((l) => ({
          label: l.name,
          value: sarTxt(l.amount),
        })),
        chart: {
          kind: 'bar',
          data: [...is.revenue.lines, ...is.otherIncome.lines].map((l) => ({
            name: l.name,
            value: l.amount,
          })),
        },
        sources: [SRC_GL, 'حسابات الإيرادات 4xxx'],
      };
    }
    case 'profit': {
      const is = incomeStatementPro(d.entries, d.chart, f);
      if (toHalala(is.revenue.total) === 0 && toHalala(is.operatingExpenses.total) === 0)
        return empty('حركات');
      return {
        intent,
        period: per.label,
        text: `صافي ${is.netProfit >= 0 ? 'الربح' : 'الخسارة'} ${sarTxt(Math.abs(is.netProfit))} — هامش صافي ${is.netMargin ?? '—'}٪.`,
        figures: [
          { label: 'الإيرادات', value: sarTxt(is.revenue.total) },
          { label: 'تكلفة الإيرادات', value: sarTxt(is.costOfSales.total) },
          { label: 'مجمل الربح', value: sarTxt(is.grossProfit) },
          { label: 'المصروفات التشغيلية', value: sarTxt(is.operatingExpenses.total) },
          { label: 'صافي الربح', value: sarTxt(is.netProfit) },
        ],
        sources: [SRC_GL, 'قائمة الدخل المصنّفة'],
      };
    }
    case 'profit_drop': {
      // compare the resolved period with the same-length window before it
      const cur = per.label.startsWith('منذ')
        ? lastTwoMonths(d)
        : { cur: f, prev: previousWindow(f.from, f.to) };
      const a = incomeStatementPro(d.entries, d.chart, cur.cur);
      const b = incomeStatementPro(d.entries, d.chart, cur.prev);
      const diff = fromHalala(toHalala(a.netProfit) - toHalala(b.netProfit));
      const balA = balances(d.entries, d.chart, cur.cur, { excludeClosing: true });
      const balB = balances(d.entries, d.chart, cur.prev, { excludeClosing: true });
      const idx = indexChart(d.chart);
      const drivers = [...new Set([...balA.keys(), ...balB.keys()])]
        .map((code) => {
          const t = idx.get(code)?.type;
          if (t !== 'revenue' && t !== 'expense') return null;
          const delta = toHalala(balA.get(code) ?? 0) - toHalala(balB.get(code) ?? 0);
          const impact = t === 'revenue' ? delta : -delta; // effect on profit
          return { name: idx.get(code)?.name_ar ?? code, impact: fromHalala(impact) };
        })
        .filter((x): x is { name: string; impact: number } => !!x && x.impact !== 0)
        .sort((x, y) => x.impact - y.impact)
        .slice(0, 5);
      return {
        intent,
        period: `${cur.cur.from} → ${cur.cur.to} مقابل ${cur.prev.from} → ${cur.prev.to}`,
        text:
          diff < 0
            ? `انخفض صافي الربح بمقدار ${sarTxt(-diff)} (${pctChange(a.netProfit, b.netProfit) ?? '—'}٪). أكبر المؤثرات السلبية أدناه.`
            : `لم ينخفض صافي الربح؛ التغير ${sarTxt(diff)}. المؤثرات الرئيسية أدناه.`,
        table: {
          headers: ['البند', 'الأثر على الربح'],
          rows: drivers.map((x) => [x.name, sarTxt(x.impact)]),
        },
        sources: [SRC_GL],
      };
    }
    case 'overdue_customers': {
      const items = arOpenItems(d.invoices, d.today).filter((i) => i.days_overdue > 0);
      if (!items.length)
        return {
          intent,
          text: 'لا يوجد عملاء متأخرون عن السداد حاليًا.',
          period: `حتى ${d.today}`,
          sources: [SRC_AR],
        };
      const parties = partyBalances(items);
      return {
        intent,
        period: `حتى ${d.today}`,
        text: `${parties.length} عميل متأخر بإجمالي ${sarTxt(sumMoney(parties.map((p) => p.overdue)))}.`,
        table: {
          headers: ['العميل', 'المتأخر', 'أقدم تأخر (يوم)'],
          rows: parties.map((p) => [p.party, sarTxt(p.overdue), String(p.oldestDays)]),
        },
        sources: [SRC_AR],
      };
    }
    case 'unpaid_invoices': {
      const items = arOpenItems(d.invoices, d.today);
      if (!items.length)
        return { intent, text: 'كل الفواتير محصّلة.', sources: [SRC_AR], period: `حتى ${d.today}` };
      return {
        intent,
        period: `حتى ${d.today}`,
        text: `${items.length} فاتورة غير محصّلة بالكامل، المتبقي ${sarTxt(sumMoney(items.map((i) => i.outstanding)))}.`,
        table: {
          headers: ['الفاتورة', 'العميل', 'الاستحقاق', 'المتبقي'],
          rows: items.map((i) => [`#${i.no}`, i.party, i.due_date, sarTxt(i.outstanding)]),
        },
        sources: [SRC_AR],
      };
    }
    case 'top_expenses': {
      const n = countIn(question, 5);
      const rows = expenseDistribution(d.entries, d.chart, f).slice(0, n);
      if (!rows.length) return empty('مصروفات');
      return {
        intent,
        period: per.label,
        text: `أكبر ${rows.length} بنود مصروفات.`,
        table: {
          headers: ['الحساب', 'المبلغ'],
          rows: rows.map((r) => [`${r.code} ${r.name}`, sarTxt(r.value)]),
        },
        chart: { kind: 'bar', data: rows.map((r) => ({ name: r.name, value: r.value })) },
        sources: [SRC_GL, 'حسابات المصروفات 5xxx'],
      };
    }
    case 'compare_branches': {
      const pts = byBranch(d.entries, d.chart, f, d.branches);
      const best = [...pts].sort((a, b) => b.profit - a.profit)[0];
      return {
        intent,
        period: per.label,
        text: best ? `الأعلى ربحًا: ${best.branch} (${sarTxt(best.profit)}).` : 'لا بيانات للفروع.',
        table: {
          headers: ['الفرع', 'الإيراد', 'المصروف', 'الربح'],
          rows: pts.map((p) => [p.branch, sarTxt(p.revenue), sarTxt(p.expenses), sarTxt(p.profit)]),
        },
        chart: { kind: 'bar', data: pts.map((p) => ({ name: p.branch, value: p.profit })) },
        sources: [SRC_GL, 'مراكز التكلفة (الفروع)'],
      };
    }
    case 'anomalies': {
      const an = detectAnomalies(d.entries, d.chart, d.anomalyMultiplier);
      return {
        intent,
        text: an.length
          ? `رُصد ${an.length} قيد يستحق المراجعة (قواعد قابلة للتفسير).`
          : 'لم تُرصد قيود غير معتادة وفق القواعد الحالية.',
        table: an.length
          ? {
              headers: ['القيد', 'التاريخ', 'المبلغ', 'الأسباب'],
              rows: an
                .slice(0, 10)
                .map((a) => [`#${a.entry_no}`, a.date, sarTxt(a.amount), a.reasons.join('، ')]),
            }
          : undefined,
        sources: [SRC_GL],
        assumptions: [`معامل الاكتشاف ${d.anomalyMultiplier}× (من الإعدادات)`],
      } as AssistantAnswer;
    }
    case 'forecast': {
      const fc = cashForecast(
        d.entries,
        d.chart,
        arOpenItems(d.invoices, d.today),
        apOpenItems(d.bills, d.today),
        d.today,
      );
      if (!fc.sufficient)
        return {
          intent,
          text: `البيانات غير كافية لتوقع موثوق (${fc.historyMonths} شهر من الحركة؛ المطلوب 3 على الأقل). المعروض تقدير أولي.`,
          table: {
            headers: ['الشهر', 'متوقع وارد', 'متوقع صادر', 'الرصيد المتوقع'],
            rows: fc.points.map((p) => [
              p.month,
              sarTxt(p.expectedIn),
              sarTxt(p.expectedOut),
              sarTxt(p.projectedCash),
            ]),
          },
          confidence: fc.confidence,
          assumptions: fc.assumptions,
          sources: [SRC_GL, SRC_AR, SRC_AP],
        };
      return {
        intent,
        text: `الرصيد الحالي ${sarTxt(fc.openingCash)}؛ المتوقع بعد ${fc.points.length} أشهر ${sarTxt(fc.points.at(-1)?.projectedCash ?? fc.openingCash)}.`,
        table: {
          headers: ['الشهر', 'متوقع وارد', 'متوقع صادر', 'الرصيد المتوقع'],
          rows: fc.points.map((p) => [
            p.month,
            sarTxt(p.expectedIn),
            sarTxt(p.expectedOut),
            sarTxt(p.projectedCash),
          ]),
        },
        chart: {
          kind: 'bar',
          data: fc.points.map((p) => ({ name: p.month, value: p.projectedCash })),
        },
        confidence: fc.confidence,
        assumptions: fc.assumptions,
        sources: [SRC_GL, SRC_AR, SRC_AP],
      };
    }
    case 'cash':
    case 'vat':
    case 'payables': {
      const k = dashboardKpis(d.entries, d.chart, d.invoices, d.bills, {
        from: per.from,
        to: d.today,
      });
      if (intent === 'cash')
        return {
          intent,
          period: `حتى ${d.today}`,
          text: `الرصيد النقدي والبنكي ${sarTxt(k.cash)}.`,
          sources: [SRC_GL, 'حسابات النقدية 111x/113x'],
        };
      if (intent === 'vat')
        return {
          intent,
          period: `حتى ${d.today}`,
          text: `صافي ضريبة القيمة المضافة المستحقة ${sarTxt(k.vatPayable)} (مخرجات − مدخلات).`,
          sources: [SRC_GL, 'الحسابين 2120 و1140'],
        };
      const ap = partyBalances(apOpenItems(d.bills, d.today));
      return {
        intent,
        period: `حتى ${d.today}`,
        text: `مستحقات الموردين ${sarTxt(k.totalAP)}.`,
        table: {
          headers: ['المورد', 'المستحق', 'منها متأخر'],
          rows: ap.map((p) => [p.party, sarTxt(p.outstanding), sarTxt(p.overdue)]),
        },
        sources: [SRC_AP],
      };
    }
    case 'classify_expense': {
      const text = question.replace(/صنّف|صنف|تصنيف|مصروف|:/g, '').trim();
      const c = classifyExpense(text, d.chart);
      return {
        intent,
        text: `الحساب المقترح: ${c.code} — ${c.name} (${c.why}). الاقتراح لا يُرحَّل تلقائيًا.`,
        sources: ['دليل الحسابات'],
        confidence: c.why.startsWith('افتراضي') ? 'منخفضة' : 'متوسطة',
      };
    }
    case 'suggest_reports':
      return {
        intent,
        text: 'تقارير مقترحة: قائمة الدخل المقارنة شهريًا، أعمار الذمم المدينة، الموازنة مقابل الفعلي، ربحية الفروع، والتسوية البنكية لآخر شهر.',
        sources: [],
      };
    default:
      return {
        intent: 'help',
        text: 'أستطيع الإجابة عن: الإيرادات، صافي الربح، لماذا انخفض الربح، العملاء المتأخرون، أكبر المصروفات، الفواتير غير المحصلة، مقارنة الفروع، القيود غير المعتادة، التدفق النقدي المتوقع، الرصيد النقدي، الضريبة، مستحقات الموردين، وتصنيف المصروفات.',
        sources: [],
      };
  }
}

function lastEntryDate(entries: JournalEntry[]): string | null {
  const posted = entries
    .filter((e) => e.status === 'posted')
    .map((e) => e.entry_date)
    .sort();
  return posted.at(-1) ?? null;
}

function lastTwoMonths(d: AssistantData) {
  const last = lastEntryDate(d.entries) ?? d.today;
  const p = last.slice(0, 7);
  const dt = new Date(`${p}-01T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  const q = dt.toISOString().slice(0, 7);
  return { cur: { from: `${p}-01`, to: monthEnd(p) }, prev: { from: `${q}-01`, to: monthEnd(q) } };
}
