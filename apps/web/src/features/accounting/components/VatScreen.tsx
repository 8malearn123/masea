import { useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Receipt, Settings2 } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { computeVatReturn } from '@/features/accounting/data/vat';
import {
  useFileVatReturn,
  useJournal,
  useUpdateVatConfig,
  useVatConfig,
  useVatReturns,
} from '@/features/accounting/hooks/useAccounting';

const PERIODS = ['2026-04', '2026-05', '2026-06'] as const;

export function VatScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: entries = [] } = useJournal();
  const { data: config } = useVatConfig();
  const { data: filed = [] } = useVatReturns();
  const file = useFileVatReturn();
  const [period, setPeriod] = useState('2026-06');
  const [settings, setSettings] = useState(false);

  const rate = config?.rate ?? 0.15;
  const ret = useMemo(() => computeVatReturn(entries, period, rate), [entries, period, rate]);
  const filedRec = filed.find((r) => r.period === period);

  function Row({
    label,
    base,
    vat,
    tone,
  }: {
    label: string;
    base?: number;
    vat: number;
    tone?: string;
  }) {
    return (
      <div className="flex items-center justify-between border-b border-navy-50 py-2.5 text-sm last:border-0">
        <span className="text-purple">{label}</span>
        <span className="flex items-center gap-6">
          {base !== undefined && <span className="num text-navy-300">{sar(base)}</span>}
          <span className={`num w-28 text-left font-semibold ${tone ?? 'text-navy'}`}>
            {sar(vat)}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Receipt size={16} className="text-navy" />
          <span className="font-semibold text-navy">الإقرار الضريبي (ضريبة القيمة المضافة)</span>
          <span className="text-purple">
            النسبة <span className="num font-semibold">{Math.round(rate * 100)}٪</span> · الرقم
            الضريبي <span className="num">{config?.tax_number ?? '—'}</span> ·{' '}
            {config?.frequency === 'quarterly' ? 'ربع سنوي' : 'شهري'}
          </span>
        </div>
        {editable && (
          <Button variant="outline" onClick={() => setSettings(true)}>
            <Settings2 size={15} /> إعدادات الضريبة
          </Button>
        )}
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select
          label="الفترة الضريبية"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          options={PERIODS.map((p) => ({ value: p, label: p }))}
        />
        {editable &&
          (filedRec ? (
            <Badge tone={filedRec.status === 'paid' ? 'success' : 'navy'}>
              {filedRec.status === 'paid' ? 'مُقدَّم ومسدَّد' : 'مُقدَّم'}
            </Badge>
          ) : (
            <Button
              onClick={() =>
                file.mutate({
                  period,
                  output_vat: ret.output_vat,
                  input_vat: ret.input_vat,
                  net_vat: ret.net_vat,
                })
              }
            >
              <CheckCircle2 size={16} /> تقديم الإقرار
            </Button>
          ))}
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-purple">
          <span>البند</span>
          <span className="flex items-center gap-6">
            <span>الأساس الخاضع</span>
            <span className="w-28 text-left">الضريبة</span>
          </span>
        </div>
        <Row
          label="ضريبة المخرجات (المبيعات الخاضعة ١٥٪)"
          base={ret.sales_base}
          vat={ret.output_vat}
          tone="text-green-600"
        />
        <Row
          label="ضريبة المدخلات (المشتريات الخاضعة ١٥٪)"
          base={ret.purchases_base}
          vat={ret.input_vat}
          tone="text-red-600"
        />
        <div className="bg-gold-50 mt-2 flex items-center justify-between rounded-xl px-4 py-3">
          <span className="text-sm font-bold text-navy">
            {ret.net_vat >= 0 ? 'صافي الضريبة المستحقة للهيئة' : 'صافي الضريبة القابلة للاسترداد'}
          </span>
          <span className="num text-xl font-bold text-gold-600">
            {sar(Math.abs(ret.net_vat))} ر.س
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-purple">
          محسوب آليًا من دفتر اليومية: ضريبة المخرجات (٢١٢٠) − ضريبة المدخلات (١١٤٠) خلال الفترة.
        </p>
      </Card>

      {filed.length > 0 && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <FileSpreadsheet size={16} /> سجل الإقرارات المقدَّمة
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-xs text-purple">
                <th className="py-2 text-right">الفترة</th>
                <th className="py-2 text-left">المخرجات</th>
                <th className="py-2 text-left">المدخلات</th>
                <th className="py-2 text-left">الصافي</th>
                <th className="py-2 text-left">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {filed.map((r) => (
                <tr key={r.period} className="border-b border-navy-50">
                  <td className="num py-2">{r.period}</td>
                  <td className="num py-2 text-left text-green-600">{sar(r.output_vat)}</td>
                  <td className="num py-2 text-left text-red-600">{sar(r.input_vat)}</td>
                  <td className="num py-2 text-left font-semibold text-navy">{sar(r.net_vat)}</td>
                  <td className="py-2 text-left">
                    <Badge tone={r.status === 'paid' ? 'success' : 'navy'}>
                      {r.status === 'paid' ? 'مسدَّد' : 'مُقدَّم'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {settings && <VatSettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

function VatSettingsModal({ onClose }: { onClose: () => void }) {
  const { data: config } = useVatConfig();
  const update = useUpdateVatConfig();
  const [ratePct, setRatePct] = useState(Math.round((config?.rate ?? 0.15) * 100));
  const [taxNo, setTaxNo] = useState(config?.tax_number ?? '');
  const [freq, setFreq] = useState<'monthly' | 'quarterly'>(config?.frequency ?? 'monthly');

  function submit() {
    update.mutate(
      { rate: ratePct / 100, tax_number: taxNo, frequency: freq },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="إعدادات ضريبة القيمة المضافة">
      <div className="space-y-3">
        <Input
          label="النسبة (٪)"
          type="number"
          min={0}
          max={100}
          value={ratePct}
          onChange={(e) => setRatePct(Number(e.target.value))}
        />
        <Input label="الرقم الضريبي" value={taxNo} onChange={(e) => setTaxNo(e.target.value)} />
        <Select
          label="دورية الإقرار"
          value={freq}
          onChange={(e) => setFreq(e.target.value as 'monthly' | 'quarterly')}
          options={[
            { value: 'monthly', label: 'شهري' },
            { value: 'quarterly', label: 'ربع سنوي' },
          ]}
        />
        <Button onClick={submit} className="w-full">
          حفظ الإعدادات
        </Button>
      </div>
    </Modal>
  );
}
