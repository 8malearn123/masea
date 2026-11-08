import { useMemo, useState } from 'react';
import {
  Briefcase,
  IdCard,
  KeyRound,
  Lock,
  ShieldCheck,
  UserRound,
  Wallet,
  Wand2,
} from 'lucide-react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { MODULES, ROLE_META, roleCan, type RoleCode } from '@/lib/permissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useAccountOptions, usePayrollSettings } from '@/features/hr/hooks/useHr';
import type { EmployeeInput } from '@/features/hr/api/hr.api';
import {
  employeeFormSchema,
  normalizeIban,
  SAUDI_BANKS,
} from '@/features/hr/lib/employeeValidation';
import { CONTRACT_TYPE_LABEL, type Employee } from '@/features/hr/types';
import { useHrLookups } from '@/features/hr/hooks/useHrLookups';

type Tab = 'basic' | 'identity' | 'job' | 'pay' | 'account';

const TABS: { key: Tab; label: string; icon: typeof IdCard }[] = [
  { key: 'basic', label: 'الأساسية', icon: UserRound },
  { key: 'identity', label: 'الهوية', icon: IdCard },
  { key: 'job', label: 'الوظيفة', icon: Briefcase },
  { key: 'pay', label: 'الراتب والبنك', icon: Wallet },
  { key: 'account', label: 'حساب الدخول', icon: KeyRound },
];

/** Which tab holds each field — an error jumps to its tab. */
const FIELD_TAB: Record<string, Tab> = {
  full_name: 'basic',
  english_name: 'basic',
  nationality: 'basic',
  dob: 'basic',
  phone: 'basic',
  email: 'basic',
  id_number: 'identity',
  passport_no: 'identity',
  job_title: 'job',
  department: 'job',
  branch: 'job',
  join_date: 'job',
  contract_type: 'job',
  manager_id: 'job',
  base_salary: 'pay',
  housing_allowance: 'pay',
  transport_allowance: 'pay',
  other_allowance: 'pay',
  iban: 'pay',
  bank_name: 'pay',
  gosi_reg_date: 'pay',
  user_id: 'account',
};

const MARITAL = ['أعزب', 'متزوج', 'مطلق', 'أرمل'] as const;
/** GOSI: registered before 3 July 2024 = old system (9.75٪), after = new. */
const GOSI_NEW_FROM = '2024-07-03';

interface FormState {
  full_name: string;
  english_name: string;
  nationality: string;
  gender: 'male' | 'female';
  dob: string;
  marital_status: string;
  phone: string;
  email: string;
  id_number: string;
  passport_no: string;
  job_title: string;
  department: string;
  branch: string;
  join_date: string;
  contract_type: 'full_time' | 'part_time' | 'temp';
  manager_id: string;
  role: RoleCode;
  base_salary: string;
  housing_allowance: string;
  transport_allowance: string;
  other_allowance: string;
  iban: string;
  bank_name: string;
  gosi_system: 'old' | 'new';
  gosi_reg_date: string;
  user_id: string;
}

function initialState(e: Employee | null): FormState {
  const saudi = (e?.nationality ?? 'السعودية') === 'السعودية';
  // legacy records: the whole allowance total sits in housing
  const housing = e?.housing_allowance ?? e?.allowances ?? 0;
  return {
    full_name: e?.full_name ?? '',
    english_name: e?.english_name ?? '',
    nationality: e?.nationality ?? 'السعودية',
    gender: e?.gender ?? 'male',
    dob: e?.dob ?? '',
    marital_status: e?.marital_status ?? '',
    phone: e?.phone ?? '',
    email: e?.email ?? '',
    id_number: (saudi ? e?.national_id : e?.iqama_no) ?? '',
    passport_no: e?.passport_no ?? '',
    job_title: e?.job_title ?? '',
    department: e?.department ?? 'الإدارة',
    branch: e?.branch ?? 'نجران',
    join_date: e?.join_date ?? '',
    contract_type: e?.contract_type ?? 'full_time',
    manager_id: e?.manager_id ?? '',
    role: e?.role ?? 'sales',
    base_salary: String(e?.base_salary ?? ''),
    housing_allowance: String(housing),
    transport_allowance: String(e?.transport_allowance ?? 0),
    other_allowance: String(e?.other_allowance ?? 0),
    iban: e?.iban ?? '',
    bank_name: e?.bank_name ?? '',
    gosi_system: e?.gosi_system ?? 'new',
    gosi_reg_date: e?.gosi_reg_date ?? '',
    user_id: e?.user_id ?? '',
  };
}

const toNum = (v: string) => (v.trim() === '' ? 0 : Number(v));

export function EmployeeForm({
  employee,
  employees,
  canManagePay,
  saving,
  onSave,
  onClose,
}: {
  employee: Employee | null;
  /** for the direct-manager picker */
  employees: Employee[];
  canManagePay: boolean;
  saving: boolean;
  onSave: (input: EmployeeInput) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('basic');
  const lk = useHrLookups();
  const [f, setF] = useState<FormState>(() => initialState(employee));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: settings } = usePayrollSettings();
  const { data: accounts = [], isError: accountsError } = useAccountOptions(canManagePay);

  const saudi = f.nationality === 'السعودية';
  const set =
    <K extends keyof FormState>(k: K) =>
    (ev: { target: { value: string } }) =>
      setF((s) => ({ ...s, [k]: ev.target.value as FormState[K] }));
  const err = (k: string) => (errors[k] ? { error: errors[k] } : {});

  const total =
    toNum(f.base_salary) +
    toNum(f.housing_allowance) +
    toNum(f.transport_allowance) +
    toNum(f.other_allowance);

  const managers = employees.filter((e) => e.id !== employee?.id && e.status !== 'terminated');
  const accountChoices = accounts.filter(
    (a) => !a.linked_employee || a.linked_employee === employee?.id || a.id === f.user_id,
  );
  const grantedModules = useMemo(
    () => MODULES.filter((m) => roleCan(f.role, m.module, 'view')),
    [f.role],
  );

  function applyDefaults() {
    const basic = toNum(f.base_salary);
    const h = settings?.payroll.defaultHousingPct ?? 25;
    const t = settings?.payroll.defaultTransportPct ?? 10;
    setF((s) => ({
      ...s,
      housing_allowance: String(Math.round((basic * h) / 100)),
      transport_allowance: String(Math.round((basic * t) / 100)),
    }));
  }

  function onJoinDate(v: string) {
    // a new hire's GOSI system follows the registration date (editable after)
    setF((s) => ({
      ...s,
      join_date: v,
      ...(employee ? {} : { gosi_system: v && v < GOSI_NEW_FROM ? 'old' : 'new' }),
    }));
  }

  function submit() {
    const schema = employeeFormSchema({
      initialId: (saudi ? employee?.national_id : employee?.iqama_no) ?? '',
      initialIban: employee?.iban ?? '',
    });
    const r = schema.safeParse({
      ...f,
      base_salary: toNum(f.base_salary),
      housing_allowance: toNum(f.housing_allowance),
      transport_allowance: toNum(f.transport_allowance),
      other_allowance: toNum(f.other_allowance),
    });
    const next: Record<string, string> = {};
    if (!r.success) {
      r.error.issues.forEach((i) => {
        const k = String(i.path[0] ?? '');
        if (k && !next[k]) next[k] = i.message;
      });
    }
    if (canManagePay && !(toNum(f.base_salary) > 0))
      next.base_salary = 'الراتب الأساسي أكبر من صفر';
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setTab(FIELD_TAB[first] ?? 'basic');
      return;
    }
    const housing = toNum(f.housing_allowance);
    const transport = toNum(f.transport_allowance);
    const other = toNum(f.other_allowance);
    const manager = managers.find((m) => m.id === f.manager_id);
    const input: EmployeeInput = {
      full_name: f.full_name.trim(),
      job_title: f.job_title.trim(),
      department: f.department,
      branch: f.branch,
      nationality: f.nationality,
      base_salary: toNum(f.base_salary),
      allowances: housing + transport + other,
      housing_allowance: housing,
      transport_allowance: transport,
      other_allowance: other,
      status: employee?.status ?? 'active',
      role: f.role,
      join_date: f.join_date,
      phone: f.phone.trim(),
      email: f.email.trim(),
      id_type: saudi ? 'saudi' : 'expat',
      gender: f.gender,
      contract_type: f.contract_type,
      gosi_system: f.gosi_system,
      counts_in_saudization: saudi,
    };
    const optional: Partial<Record<keyof EmployeeInput, string>> = {
      english_name: f.english_name.trim(),
      dob: f.dob,
      marital_status: f.marital_status,
      passport_no: f.passport_no.trim(),
      iban: normalizeIban(f.iban),
      bank_name: f.bank_name,
      gosi_reg_date: f.gosi_reg_date,
      manager_id: f.manager_id,
      manager: manager?.full_name ?? '',
      user_id: f.user_id,
      [saudi ? 'national_id' : 'iqama_no']: f.id_number.trim(),
    };
    const out = input as unknown as Record<string, unknown>;
    Object.entries(optional).forEach(([k, v]) => {
      if (v) out[k] = v;
    });
    // keep the employee number / termination data that the form does not edit
    if (employee?.employee_no) out.employee_no = employee.employee_no;
    onSave(input);
  }

  const payLocked = !canManagePay;

  return (
    <Modal open onClose={onClose} size="lg" title={employee ? 'تعديل ملف الموظف' : 'إضافة موظف'}>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-navy-100 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const hasError = Object.keys(errors).some((k) => FIELD_TAB[k] === t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${tab === t.key ? 'bg-navy text-white' : 'text-purple hover:bg-navy-50'} ${hasError ? 'ring-2 ring-red-300' : ''}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto pl-1">
        {tab === 'basic' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="الاسم الكامل (عربي)"
              value={f.full_name}
              onChange={set('full_name')}
              {...err('full_name')}
            />
            <Input
              label="الاسم بالإنجليزية"
              dir="ltr"
              value={f.english_name}
              onChange={set('english_name')}
            />
            <Select
              label="الجنسية"
              value={f.nationality}
              onChange={set('nationality')}
              options={lk.options('nationality', {
                scope: 'staff',
                keep: employee?.nationality ?? null,
              })}
            />
            <Select
              label="الجنس"
              value={f.gender}
              onChange={set('gender')}
              options={[
                { value: 'male', label: 'ذكر' },
                { value: 'female', label: 'أنثى' },
              ]}
            />
            <Input label="تاريخ الميلاد" type="date" value={f.dob} onChange={set('dob')} />
            <Select
              label="الحالة الاجتماعية"
              value={f.marital_status}
              onChange={set('marital_status')}
              options={[{ value: '', label: '—' }, ...MARITAL.map((m) => ({ value: m, label: m }))]}
            />
            <Input
              label="الجوال"
              inputMode="tel"
              dir="ltr"
              placeholder="05XXXXXXXX"
              value={f.phone}
              onChange={set('phone')}
              {...err('phone')}
            />
            <Input
              label="البريد الإلكتروني"
              type="email"
              dir="ltr"
              value={f.email}
              onChange={set('email')}
              {...err('email')}
            />
          </div>
        )}

        {tab === 'identity' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={saudi ? 'رقم الهوية الوطنية' : 'رقم الإقامة'}
              inputMode="numeric"
              dir="ltr"
              placeholder={saudi ? '1XXXXXXXXX' : '2XXXXXXXXX'}
              value={f.id_number}
              onChange={set('id_number')}
              hint={saudi ? '10 أرقام تبدأ بـ 1' : '10 أرقام تبدأ بـ 2'}
              {...err('id_number')}
            />
            {!saudi && (
              <Input
                label="رقم الجواز"
                dir="ltr"
                value={f.passport_no}
                onChange={set('passport_no')}
              />
            )}
            <p className="text-xs leading-relaxed text-purple sm:col-span-2">
              تواريخ انتهاء الإقامة والجواز تُسجَّل في تبويب «المستندات» داخل ملف الموظف لتصل
              تنبيهات التجديد.
            </p>
          </div>
        )}

        {tab === 'job' && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="المسمى الوظيفي"
                value={f.job_title}
                onChange={set('job_title')}
                options={[
                  { value: '', label: 'اختر المسمى…' },
                  ...lk.options('job_title', { keep: employee?.job_title ?? null }),
                ]}
                {...err('job_title')}
              />
              <Select
                label="القسم"
                value={f.department}
                onChange={set('department')}
                options={lk.options('department', { keep: employee?.department ?? null })}
              />
              <Select
                label="الفرع"
                value={f.branch}
                onChange={set('branch')}
                options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
              />
              <Input
                label="تاريخ التعيين"
                type="date"
                value={f.join_date}
                onChange={(ev) => onJoinDate(ev.target.value)}
                {...err('join_date')}
              />
              <Select
                label="نوع العقد"
                value={f.contract_type}
                onChange={set('contract_type')}
                options={(Object.keys(CONTRACT_TYPE_LABEL) as FormState['contract_type'][]).map(
                  (c) => ({ value: c, label: CONTRACT_TYPE_LABEL[c] }),
                )}
              />
              <Select
                label="المدير المباشر"
                value={f.manager_id}
                onChange={set('manager_id')}
                options={[
                  { value: '', label: '—' },
                  ...managers.map((m) => ({
                    value: m.id,
                    label: `${m.full_name} · ${m.job_title}`,
                  })),
                ]}
              />
              <Select
                label="الدور في النظام (الصلاحيات)"
                value={f.role}
                onChange={set('role')}
                options={(Object.keys(ROLE_META) as RoleCode[]).map((r) => ({
                  value: r,
                  label: ROLE_META[r].label,
                }))}
              />
            </div>
            <div className="rounded-xl bg-navy-50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-navy">
                <ShieldCheck size={14} /> الصلاحيات الممنوحة لهذا الدور
              </p>
              <div className="flex flex-wrap gap-1.5">
                {grantedModules.length === 0 ? (
                  <span className="text-xs text-purple">
                    لا صلاحيات إدارية على الويب (دور ميداني عبر التطبيق).
                  </span>
                ) : (
                  grantedModules.map((m) => (
                    <span
                      key={m.module}
                      className="rounded-md bg-white px-2 py-1 text-[11px] text-navy"
                    >
                      {m.label}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'pay' && (
          <div className="space-y-3">
            {payLocked && (
              <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <Lock size={13} /> الراتب والبنك والتأمينات من صلاحية الموارد البشرية — لتغيير راتب
                ارفع «طلب تعديل» من شاشة الرواتب.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="الراتب الأساسي"
                type="number"
                min={0}
                suffix="ر.س"
                value={f.base_salary}
                onChange={set('base_salary')}
                disabled={payLocked}
                {...err('base_salary')}
              />
              <Input
                label="بدل السكن"
                type="number"
                min={0}
                suffix="ر.س"
                value={f.housing_allowance}
                onChange={set('housing_allowance')}
                disabled={payLocked}
                hint="يدخل في وعاء التأمينات"
                {...err('housing_allowance')}
              />
              <Input
                label="بدل النقل"
                type="number"
                min={0}
                suffix="ر.س"
                value={f.transport_allowance}
                onChange={set('transport_allowance')}
                disabled={payLocked}
                {...err('transport_allowance')}
              />
              <Input
                label="بدلات أخرى"
                type="number"
                min={0}
                suffix="ر.س"
                value={f.other_allowance}
                onChange={set('other_allowance')}
                disabled={payLocked}
                {...err('other_allowance')}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50 px-3 py-2 text-sm">
              <span className="text-purple">
                إجمالي الراتب الشهري:{' '}
                <span className="num font-bold text-navy">{sar(total)} ر.س</span>
              </span>
              {!payLocked && (
                <Button variant="outline" size="sm" onClick={applyDefaults}>
                  <Wand2 size={14} /> النسب الافتراضية ({settings?.payroll.defaultHousingPct ?? 25}٪
                  سكن · {settings?.payroll.defaultTransportPct ?? 10}٪ نقل)
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="الآيبان (IBAN)"
                dir="ltr"
                placeholder="SA0000000000000000000000"
                value={f.iban}
                onChange={set('iban')}
                disabled={payLocked}
                {...err('iban')}
              />
              <Select
                label="البنك"
                value={f.bank_name}
                onChange={set('bank_name')}
                disabled={payLocked}
                options={[
                  { value: '', label: '—' },
                  ...SAUDI_BANKS.map((b) => ({ value: b, label: b })),
                ]}
                {...err('bank_name')}
              />
              <Select
                label="نظام التأمينات (GOSI)"
                value={f.gosi_system}
                onChange={set('gosi_system')}
                disabled={payLocked || !saudi}
                options={[
                  { value: 'old', label: 'النظام القديم (قبل 3 يوليو 2024)' },
                  { value: 'new', label: 'النظام الجديد' },
                ]}
              />
              <Input
                label="تاريخ التسجيل في التأمينات"
                type="date"
                value={f.gosi_reg_date}
                onChange={set('gosi_reg_date')}
                disabled={payLocked}
              />
            </div>
            {!saudi && (
              <p className="text-xs text-purple">
                الوافد معفى من حصة الموظف في التأمينات؛ تدفع المنشأة حصة الأخطار المهنية فقط.
              </p>
            )}
          </div>
        )}

        {tab === 'account' && (
          <div className="space-y-3">
            {!canManagePay ? (
              <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <Lock size={13} /> ربط حساب الدخول من صلاحية الموارد البشرية.
              </p>
            ) : accountsError ? (
              <p className="text-sm text-red-600">تعذّر تحميل الحسابات.</p>
            ) : (
              <Select
                label="حساب الدخول المرتبط"
                value={f.user_id}
                onChange={set('user_id')}
                options={[
                  { value: '', label: 'بدون حساب (موظف لا يدخل النظام)' },
                  ...accountChoices.map((a) => ({
                    value: a.id,
                    label: `${a.full_name} · ${ROLE_META[a.role as RoleCode]?.label ?? a.role}${a.branch ? ` · ${a.branch}` : ''}`,
                  })),
                ]}
              />
            )}
            <p className="text-xs leading-relaxed text-purple">
              يُنشئ المدير العام حسابات الدخول من شاشة «الصلاحيات»، ثم يُربط كل حساب بموظف واحد هنا
              — فيرى الموظف قسيمته وطلباته.
            </p>
          </div>
        )}
      </div>

      {Object.keys(errors).length > 0 && (
        <p className="mt-3 text-xs text-red-600">صحّح الحقول المحددة بالأحمر.</p>
      )}
      <Button onClick={submit} className="mt-4 w-full" loading={saving}>
        {employee ? 'حفظ التعديلات' : 'إضافة الموظف'}
      </Button>
    </Modal>
  );
}
