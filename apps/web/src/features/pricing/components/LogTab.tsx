import { useMemo, useState } from 'react';
import { Eye, FileSpreadsheet, ScrollText } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Skeleton,
  paginate,
} from '@/shared/ui';
import { dateTimeAr } from '@/shared/lib/format';
import { exportExcel } from '@/shared/lib/exportTable';
import { usePermissions } from '@/hooks/usePermissions';
import { usePricingLog } from '@/features/pricing/hooks/usePricingRules';
import {
  PRICING_OP_LABEL,
  PRICING_SERVICE_LABEL,
  type PricingLogEntry,
} from '@/features/pricing/types';
import {
  FilterSelect,
  Money,
  SearchBox,
  SectionTitle,
  Toolbar,
  today,
  useUrlState,
} from '@/features/pricing/components/shared';

const PAGE = 15;
const PARAM_LABEL: Record<string, string> = {
  nationality: 'الجنسية',
  profession: 'المهنة',
  quantity: 'الكمية/المدة',
  lateDays: 'أيام التأخر',
  late_days: 'أيام التأخر',
  absenceDays: 'أيام الغياب',
  absence_days: 'أيام الغياب',
  cancelled: 'إلغاء بعد المباشرة',
  promotion_id: 'الخصم',
  promotion_code: 'كود الكوبون',
  couponCode: 'كود الكوبون',
  service: 'الخدمة',
};

/** سجل التسعير — shows what each record actually holds; never invents history. */
export function LogTab() {
  const { can } = usePermissions();
  const { data: log = [], isLoading, isError, refetch } = usePricingLog();
  const [q, setQ] = useUrlState('gq', '');
  const [user, setUser] = useUrlState('gu', 'all');
  const [service, setService] = useUrlState('gs', 'all');
  const [from, setFrom] = useUrlState('gf', '');
  const [to, setTo] = useUrlState('gt', '');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PricingLogEntry | null>(null);

  // stable operation number: chronological position (oldest = 1)
  const numbered = useMemo(() => {
    const asc = [...log].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const no = new Map(asc.map((l, i) => [l.id, i + 1]));
    return log.map((l) => ({ ...l, no: no.get(l.id) ?? 0 }));
  }, [log]);
  const users = useMemo(
    () => [...new Set(log.map((l) => l.user_name).filter((v): v is string => !!v))],
    [log],
  );
  const rows = numbered.filter(
    (l) =>
      (user === 'all' || (user === 'none' ? !l.user_name : l.user_name === user)) &&
      (service === 'all' || l.service_code === service) &&
      (!from || l.created_at.slice(0, 10) >= from) &&
      (!to || l.created_at.slice(0, 10) <= to) &&
      (!q.trim() || `${l.no} ${l.reference ?? ''} ${JSON.stringify(l.params)}`.includes(q.trim())),
  );

  const fees = (l: PricingLogEntry) => l.result.penalties;
  return (
    <div>
      <SectionTitle
        title="سجل التسعير"
        desc="كل عملية حساب أو عرض سعر أو عقد. الحقول الجديدة (المستخدم، نوع العملية، المرجع) تُسجل من الآن فصاعدًا؛ العمليات القديمة تُعرض بما فيها فقط."
        actions={
          can('pricing', 'export') && (
            <Button
              size="sm"
              variant="outline"
              disabled={!rows.length}
              onClick={() =>
                exportExcel({
                  title: 'سجل التسعير',
                  subtitle: `تاريخ التصدير ${today()}`,
                  headers: [
                    'رقم العملية',
                    'التاريخ والوقت',
                    'المستخدم',
                    'الخدمة',
                    'الأساسي',
                    'الخصومات',
                    'الرسوم والغرامات',
                    'الضريبة',
                    'الإجمالي',
                    'نوع العملية',
                    'المرجع',
                  ],
                  rows: rows.map((l) => [
                    l.no,
                    l.created_at,
                    l.user_name ?? '',
                    PRICING_SERVICE_LABEL[l.service_code] ?? l.service_code,
                    l.result.base,
                    l.result.discounts,
                    fees(l),
                    l.result.vat,
                    l.result.total,
                    l.op_type ? PRICING_OP_LABEL[l.op_type] : '',
                    l.reference ?? '',
                  ]),
                })
              }
            >
              <FileSpreadsheet size={14} /> تصدير Excel
            </Button>
          )
        }
      />
      <Card>
        <Toolbar>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="بحث برقم العملية أو المرجع"
          />
          <FilterSelect
            label="الموظف"
            value={user}
            onChange={(v) => {
              setUser(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الموظفين' },
              ...users.map((u) => ({ value: u, label: u })),
              { value: 'none', label: 'غير مسجل (قديم)' },
            ]}
          />
          <FilterSelect
            label="الخدمة"
            value={service}
            onChange={(v) => {
              setService(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'كل الخدمات' },
              ...Object.entries(PRICING_SERVICE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <div className="w-36">
            <Input
              aria-label="من تاريخ"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-36">
            <Input
              aria-label="إلى تاريخ"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </Toolbar>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, n) => (
              <Skeleton key={n} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={ScrollText}
            title={log.length ? 'لا عمليات مطابقة' : 'لا توجد عمليات تسعير مسجّلة'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-navy-100 text-purple">
                  {['رقم العملية', 'التاريخ والوقت', 'المستخدم', 'الخدمة'].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                  {['الأساسي', 'الخصومات', 'الرسوم والغرامات', 'الضريبة', 'الإجمالي'].map((h) => (
                    <th key={h} className="px-3 py-3 text-left font-semibold">
                      {h}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-semibold">نوع العملية</th>
                  <th className="px-3 py-3 font-semibold">المرجع</th>
                  <th className="px-3 py-3">
                    <span className="sr-only">تفاصيل</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginate(rows, page, PAGE).map((l) => (
                  <tr key={l.id} className="border-b border-navy-50 hover:bg-navy-50/40">
                    <td className="num px-3 py-2.5 font-semibold text-navy">#{l.no}</td>
                    <td className="px-3 py-2.5">{dateTimeAr(l.created_at)}</td>
                    <td className="px-3 py-2.5">
                      {l.user_name ?? <span className="text-purple">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {PRICING_SERVICE_LABEL[l.service_code] ?? l.service_code}
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <Money v={l.result.base} />
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <Money v={l.result.discounts} className="text-green-700" />
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <Money v={fees(l)} className="text-amber-700" />
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <Money v={l.result.vat} />
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <Money v={l.result.total} strong className="text-navy" />
                    </td>
                    <td className="px-3 py-2.5">
                      {l.op_type ? (
                        <Badge tone="navy">{PRICING_OP_LABEL[l.op_type]}</Badge>
                      ) : (
                        <span className="text-purple">—</span>
                      )}
                    </td>
                    <td className="num px-3 py-2.5">{l.reference ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        aria-label="عرض التفاصيل"
                        onClick={() => setOpen(l)}
                        className="rounded-lg p-1.5 text-navy hover:bg-navy-50"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} size={PAGE} total={rows.length} onChange={setPage} />
          </div>
        )}
      </Card>
      {open && (
        <Drawer
          open
          onClose={() => setOpen(null)}
          title="تفاصيل عملية التسعير"
          subtitle={dateTimeAr(open.created_at)}
        >
          <div className="space-y-4 text-sm">
            <dl className="space-y-1.5 rounded-xl border border-navy-100 p-3">
              <Item k="الخدمة" v={PRICING_SERVICE_LABEL[open.service_code] ?? open.service_code} />
              <Item k="المستخدم" v={open.user_name ?? 'غير مسجل (عملية قبل تتبّع المستخدم)'} />
              <Item
                k="نوع العملية"
                v={open.op_type ? PRICING_OP_LABEL[open.op_type] : 'غير مسجل'}
              />
              <Item k="المرجع" v={open.reference ?? '—'} />
            </dl>
            <div>
              <p className="mb-1.5 text-xs font-bold text-navy">المدخلات</p>
              <dl className="space-y-1.5 rounded-xl border border-navy-100 p-3">
                {Object.entries(open.params)
                  .filter(
                    ([, v]) => v !== null && v !== undefined && v !== '' && v !== false && v !== 0,
                  )
                  .map(([k, v]) => (
                    <Item key={k} k={PARAM_LABEL[k] ?? k} v={v === true ? 'نعم' : String(v)} />
                  ))}
              </dl>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-bold text-navy">النتيجة</p>
              <dl className="space-y-1.5 rounded-xl border border-navy-100 p-3">
                <Item k="السعر الأساسي" v={<Money v={open.result.base} />} />
                <Item k="الخصومات" v={<Money v={open.result.discounts} />} />
                <Item k="الرسوم والغرامات" v={<Money v={open.result.penalties} />} />
                <Item k="الصافي" v={<Money v={open.result.net} />} />
                <Item k="الضريبة" v={<Money v={open.result.vat} />} />
                <Item k="الإجمالي" v={<Money v={open.result.total} strong />} />
              </dl>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3">
    <dt className="text-purple">{k}</dt>
    <dd className="text-left text-navy-900">{v}</dd>
  </div>
);
