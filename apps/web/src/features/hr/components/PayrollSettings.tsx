import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Calculator,
  History,
  Lock,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { auditFieldLabel, type AuditEntry } from '@/shared/lib/auditTrail';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuditLog } from '@/features/audit/hooks/useAuditLog';
import { EMPTY_AUDIT_FILTERS } from '@/features/audit/api/audit.api';
import {
  usePayrollSettings,
  useUpdateGosiConfig,
  useUpdatePayrollConfig,
} from '@/features/hr/hooks/useHr';
import {
  gosiConfigSchema,
  payrollConfigSchema,
  PAYROLL_DEFAULTS,
} from '@/features/hr/api/payrollSettings.api';
import type { GosiConfig, PayrollConfig } from '@/features/hr/api/hr.api';
import { LeaveTypesSettings } from '@/features/hr/components/LeaveTypesSettings';
import { AttendanceSettings } from '@/features/hr/components/AttendanceSettings';

/* ------------------------------- helpers --------------------------------- */
type Errors<T> = Partial<Record<keyof T, string>>;

/** Zod issues → first message per field. */
function fieldErrors<T>(issues: { path: PropertyKey[]; message: string }[]): Errors<T> {
  const out: Errors<T> = {};
  issues.forEach((i) => {
    const k = i.path[0] as keyof T | undefined;
    if (k !== undefined && !out[k]) out[k] = i.message;
  });
  return out;
}

/** 8.5 → "08:30" and back (shift_start_hour is stored as decimal hours). */
function hourToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function timeToHour(t: string): number {
  const [h, m] = t.split(':').map(Number);
  if (h === undefined || Number.isNaN(h)) return Number.NaN;
  return h + (m ?? 0) / 60;
}

/** Rates live as fractions (0.0975); the screen edits percentages (9.75). */
const toPct = (r: number) => Math.round(r * 10000) / 100;
const fromPct = (p: number) => Math.round(p * 100) / 10000;

const RATE_FIELDS = new Set([
  'saudi_old_employee',
  'saudi_old_company',
  'saudi_new_employee',
  'saudi_new_company',
  'nonsaudi_company',
]);
function auditValue(field: string, v: unknown): string {
  const n = Number(v);
  if (Number.isNaN(n)) return String(v ?? '—');
  if (RATE_FIELDS.has(field)) return `${toPct(n)}٪`;
  if (field === 'shift_start_hour') return hourToTime(n);
  return String(n);
}

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

/* -------------------------------- screen --------------------------------- */
export default function PayrollSettings() {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const { data, isLoading, isError, refetch } = usePayrollSettings();

  if (isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل إعدادات الرواتب"
        description="تحقّق من الاتصال ثم أعد المحاولة."
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
            <SlidersHorizontal size={16} /> إعدادات الرواتب والتأمينات
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-purple">
            هذه القيم هي مصدر حساب الرواتب في النظام: مسير الرواتب وقسيمة الراتب وتكلفة الموظف وقيد
            الرواتب المحاسبي. أي تعديل يُطبَّق فورًا على المسيرات غير المعتمدة ويُسجَّل في سجل
            التدقيق.
          </p>
        </div>
        {canManage ? (
          <Badge tone="success">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={12} /> صلاحية التعديل مفعّلة
            </span>
          </Badge>
        ) : (
          <Badge tone="neutral">
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> عرض فقط
            </span>
          </Badge>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <PayrollConfigCard
          key={JSON.stringify(data.payroll)}
          initial={data.payroll}
          editable={canManage}
        />
        <GosiConfigCard key={JSON.stringify(data.gosi)} initial={data.gosi} editable={canManage} />
      </div>

      <LeaveTypesSettings editable={canManage} />

      <AttendanceSettings editable={canManage} />

      <SettingsHistory />
    </div>
  );
}

/* ---------------------------- payroll config ----------------------------- */
interface PayrollForm {
  standardWorkDays: string;
  dailyHours: string;
  overtimeMultiplier: string;
  shiftStart: string; // HH:MM
  lateGraceMinutes: string;
  defaultHousingPct: string;
  defaultTransportPct: string;
}
const toPayrollForm = (c: PayrollConfig): PayrollForm => ({
  standardWorkDays: String(c.standardWorkDays),
  dailyHours: String(c.dailyHours),
  overtimeMultiplier: String(c.overtimeMultiplier),
  shiftStart: hourToTime(c.shiftStartHour),
  lateGraceMinutes: String(c.lateGraceMinutes),
  defaultHousingPct: String(c.defaultHousingPct),
  defaultTransportPct: String(c.defaultTransportPct),
});
const fromPayrollForm = (f: PayrollForm): PayrollConfig => ({
  standardWorkDays: num(f.standardWorkDays),
  dailyHours: num(f.dailyHours),
  overtimeMultiplier: num(f.overtimeMultiplier),
  shiftStartHour: timeToHour(f.shiftStart),
  lateGraceMinutes: num(f.lateGraceMinutes),
  defaultHousingPct: num(f.defaultHousingPct),
  defaultTransportPct: num(f.defaultTransportPct),
});

/** Worked example so HR sees what a value means in riyals before saving. */
const EXAMPLE_BASIC = 10000;

function PayrollConfigCard({ initial, editable }: { initial: PayrollConfig; editable: boolean }) {
  const save = useUpdatePayrollConfig();
  const [form, setForm] = useState<PayrollForm>(() => toPayrollForm(initial));
  const [errors, setErrors] = useState<Errors<PayrollConfig>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(toPayrollForm(initial));
  const set = (k: keyof PayrollForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const parsed = payrollConfigSchema.safeParse(fromPayrollForm(form));
  const preview = parsed.success ? parsed.data : null;
  const daily = preview ? EXAMPLE_BASIC / preview.standardWorkDays : 0;
  const hourly = preview ? daily / preview.dailyHours : 0;

  function submit() {
    const r = payrollConfigSchema.safeParse(fromPayrollForm(form));
    if (!r.success) {
      setErrors(fieldErrors<PayrollConfig>(r.error.issues));
      return;
    }
    setErrors({});
    save.mutate(r.data);
  }

  return (
    <Card>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
        <Calculator size={16} /> إعدادات الرواتب والدوام
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="أيام الشهر المعتمدة"
          type="number"
          inputMode="numeric"
          suffix="يوم"
          value={form.standardWorkDays}
          onChange={set('standardWorkDays')}
          disabled={!editable}
          error={errors.standardWorkDays}
          hint="أجر اليوم = الأساسي ÷ هذه الأيام"
        />
        <Input
          label="ساعات العمل اليومية"
          type="number"
          step="0.5"
          suffix="ساعة"
          value={form.dailyHours}
          onChange={set('dailyHours')}
          disabled={!editable}
          error={errors.dailyHours}
          hint="ما زاد عنها يُحتسب عملًا إضافيًا"
        />
        <Input
          label="معامل العمل الإضافي"
          type="number"
          step="0.25"
          suffix="×"
          value={form.overtimeMultiplier}
          onChange={set('overtimeMultiplier')}
          disabled={!editable}
          error={errors.overtimeMultiplier}
          hint="نظام العمل السعودي: 1.5 من أجر الساعة"
        />
        <Input
          label="بداية الدوام"
          type="time"
          value={form.shiftStart}
          onChange={set('shiftStart')}
          disabled={!editable}
          error={errors.shiftStartHour}
          hint="يُقاس التأخير من هذا الوقت"
        />
        <Input
          label="فترة سماح التأخير"
          type="number"
          inputMode="numeric"
          suffix="دقيقة"
          value={form.lateGraceMinutes}
          onChange={set('lateGraceMinutes')}
          disabled={!editable}
          error={errors.lateGraceMinutes}
          hint="لا يُخصم تأخير داخل هذه المدة"
        />
        <Input
          label="بدل السكن الافتراضي"
          type="number"
          suffix="٪"
          value={form.defaultHousingPct}
          onChange={set('defaultHousingPct')}
          disabled={!editable}
          error={errors.defaultHousingPct}
          hint="يُقترح للموظف الجديد كنسبة من الأساسي"
        />
        <Input
          label="بدل النقل الافتراضي"
          type="number"
          suffix="٪"
          value={form.defaultTransportPct}
          onChange={set('defaultTransportPct')}
          disabled={!editable}
          error={errors.defaultTransportPct}
          hint="يُقترح للموظف الجديد كنسبة من الأساسي"
        />
      </div>

      <div className="mt-4 rounded-xl bg-navy-50 p-3 text-xs leading-relaxed text-navy-900">
        <p className="mb-1 font-semibold text-navy">
          مثال لراتب أساسي <span className="num">{sar(EXAMPLE_BASIC)}</span> ر.س:
        </p>
        {preview ? (
          <p>
            أجر اليوم <span className="num font-semibold">{sar(daily)}</span> · أجر الساعة{' '}
            <span className="num font-semibold">{sar(hourly)}</span> · الساعة الإضافية{' '}
            <span className="num font-semibold">{sar(hourly * preview.overtimeMultiplier)}</span> ·
            ساعة التأخير تُخصم بـ <span className="num font-semibold">{sar(hourly)}</span> بعد{' '}
            <span className="num">{hourToTime(preview.shiftStartHour)}</span> +{' '}
            <span className="num">{preview.lateGraceMinutes}</span> دقيقة سماح
          </p>
        ) : (
          <p className="text-purple">صحّح الحقول لعرض المثال.</p>
        )}
      </div>

      {editable && (
        <FormActions
          dirty={dirty}
          saving={save.isPending}
          onSave={submit}
          onReset={() => {
            setErrors({});
            setForm(toPayrollForm(PAYROLL_DEFAULTS.payroll));
          }}
          onCancel={() => {
            setErrors({});
            setForm(toPayrollForm(initial));
          }}
        />
      )}
    </Card>
  );
}

/* ------------------------------ GOSI config ------------------------------ */
type GosiForm = Record<keyof GosiConfig, string>;
const RATE_KEYS: (keyof GosiConfig)[] = [
  'saudiOldEmployee',
  'saudiOldCompany',
  'saudiNewEmployee',
  'saudiNewCompany',
  'nonSaudiCompany',
];
const toGosiForm = (c: GosiConfig): GosiForm => ({
  ceiling: String(c.ceiling),
  saudiOldEmployee: String(toPct(c.saudiOldEmployee)),
  saudiOldCompany: String(toPct(c.saudiOldCompany)),
  saudiNewEmployee: String(toPct(c.saudiNewEmployee)),
  saudiNewCompany: String(toPct(c.saudiNewCompany)),
  nonSaudiCompany: String(toPct(c.nonSaudiCompany)),
});
const fromGosiForm = (f: GosiForm): GosiConfig => {
  const out = { ceiling: num(f.ceiling) } as GosiConfig;
  RATE_KEYS.forEach((k) => {
    const p = num(f[k]);
    out[k] = Number.isNaN(p) ? Number.NaN : fromPct(p);
  });
  return out;
};

function GosiConfigCard({ initial, editable }: { initial: GosiConfig; editable: boolean }) {
  const save = useUpdateGosiConfig();
  const [form, setForm] = useState<GosiForm>(() => toGosiForm(initial));
  const [errors, setErrors] = useState<Errors<GosiConfig>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(toGosiForm(initial));
  const set = (k: keyof GosiConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit() {
    const r = gosiConfigSchema.safeParse(fromGosiForm(form));
    if (!r.success) {
      setErrors(fieldErrors<GosiConfig>(r.error.issues));
      return;
    }
    setErrors({});
    save.mutate(r.data);
  }

  const rateInput = (k: keyof GosiConfig, label: string) => (
    <Input
      aria-label={label}
      type="number"
      step="0.25"
      suffix="٪"
      value={form[k]}
      onChange={set(k)}
      disabled={!editable}
      error={errors[k]}
    />
  );

  const rows: { label: string; sub: string; emp: keyof GosiConfig | null; co: keyof GosiConfig }[] =
    [
      {
        label: 'سعودي — النظام القديم',
        sub: 'مسجّل قبل 3 يوليو 2024',
        emp: 'saudiOldEmployee',
        co: 'saudiOldCompany',
      },
      {
        label: 'سعودي — النظام الجديد',
        sub: 'مسجّل من 3 يوليو 2024 (متصاعد سنويًا)',
        emp: 'saudiNewEmployee',
        co: 'saudiNewCompany',
      },
      { label: 'وافد', sub: 'أخطار مهنية فقط', emp: null, co: 'nonSaudiCompany' },
    ];

  return (
    <Card>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
        <ShieldCheck size={16} /> التأمينات الاجتماعية (GOSI)
      </h3>
      <Input
        label="سقف وعاء الاشتراك الشهري"
        type="number"
        inputMode="numeric"
        suffix="ر.س"
        value={form.ceiling}
        onChange={set('ceiling')}
        disabled={!editable}
        error={errors.ceiling}
        hint="الوعاء = الأساسي + بدل السكن، بحد أقصى هذا السقف"
      />

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-xs text-purple">
              <th className="pb-2 text-right font-medium">الفئة</th>
              <th className="pb-2 text-right font-medium">حصة الموظف</th>
              <th className="pb-2 text-right font-medium">حصة المنشأة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.co} className="border-t border-navy-50 align-top">
                <td className="py-2.5 pl-2">
                  <p className="font-semibold text-navy">{r.label}</p>
                  <p className="text-[11px] text-purple">{r.sub}</p>
                </td>
                <td className="py-2 pl-2">
                  {r.emp ? (
                    rateInput(r.emp, `${r.label} — حصة الموظف`)
                  ) : (
                    <div className="pt-2.5 text-purple">
                      <span className="num">0٪ (معفى)</span>
                    </div>
                  )}
                </td>
                <td className="py-2">{rateInput(r.co, `${r.label} — حصة المنشأة`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <FormActions
          dirty={dirty}
          saving={save.isPending}
          onSave={submit}
          onReset={() => {
            setErrors({});
            setForm(toGosiForm(PAYROLL_DEFAULTS.gosi));
          }}
          onCancel={() => {
            setErrors({});
            setForm(toGosiForm(initial));
          }}
        />
      )}
    </Card>
  );
}

/* ------------------------------ shared bits ------------------------------ */
function FormActions({
  dirty,
  saving,
  onSave,
  onReset,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button onClick={onSave} disabled={!dirty} loading={saving}>
        <Save size={16} /> حفظ
      </Button>
      {dirty && (
        <Button variant="ghost" onClick={onCancel}>
          تراجع
        </Button>
      )}
      <Button variant="outline" onClick={onReset} className="mr-auto">
        <RotateCcw size={15} /> القيم الافتراضية
      </Button>
    </div>
  );
}

/** Last edits to these settings — the shared audit trail (0061/0067). */
function SettingsHistory() {
  const qc = useQueryClient();
  const payroll = useAuditLog({ ...EMPTY_AUDIT_FILTERS, entity: 'payroll_config' });
  const gosi = useAuditLog({ ...EMPTY_AUDIT_FILTERS, entity: 'gosi_config' });
  const leaveTypes = useAuditLog({ ...EMPTY_AUDIT_FILTERS, entity: 'leave_types' });
  const entries: AuditEntry[] = [
    ...(payroll.data ?? []),
    ...(gosi.data ?? []),
    ...(leaveTypes.data ?? []),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);
  const loading = payroll.isLoading || gosi.isLoading;
  const failed = payroll.isError || gosi.isError;

  return (
    <Card>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
        <History size={16} /> آخر التعديلات على الإعدادات
      </h3>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : failed ? (
        <ErrorState
          title="تعذّر تحميل سجل التعديلات"
          description="السجل الكامل متاح في شاشة التدقيق لمن يملك صلاحيتها."
          onRetry={() => void qc.invalidateQueries({ queryKey: ['audit-log'] })}
        />
      ) : entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-purple">
          لم تُعدَّل الإعدادات بعد — القيم الحالية هي القيم الافتراضية للنظام.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-navy-100 px-3 py-2 text-xs">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-navy">
                  {e.entity === 'gosi_config'
                    ? 'التأمينات'
                    : e.entity === 'leave_types'
                      ? `الإجازات (${e.record_ref ?? ''})`
                      : 'الرواتب'}{' '}
                  · {e.actor_name ?? 'النظام'}
                </span>
                <span className="num text-purple">
                  {new Date(e.created_at).toLocaleString('ar-SA-u-ca-gregory')}
                </span>
              </div>
              <ul className="space-y-0.5">
                {Object.keys(e.new_data ?? {}).map((f) => (
                  <li key={f} className="text-purple">
                    {auditFieldLabel(f)}:{' '}
                    <span className="num text-red-600 line-through">
                      {auditValue(f, e.old_data?.[f])}
                    </span>{' '}
                    ←{' '}
                    <span className="num font-semibold text-green-700">
                      {auditValue(f, e.new_data?.[f])}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
