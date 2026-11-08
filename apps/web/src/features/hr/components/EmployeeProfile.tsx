import { useState } from 'react';
import {
  IdCard,
  FileText,
  Wallet,
  UserRound,
  Phone,
  ShieldCheck,
  Plus,
  CalendarCheck,
  AlertTriangle,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { ROLE_META } from '@/lib/permissions';
import { usePermissions } from '@/hooks/usePermissions';
import { OwnerDocuments } from '@/features/hr/components/DocumentsBoard';
import { useDocAlertDays, useHrDocuments } from '@/features/hr/hooks/useHrDocuments';
import { docStatus, isCurrent } from '@/features/hr/lib/documentsEngine';
import {
  useLeaveBalance,
  useLeaveRequests,
  useLeaveTypes,
  useAddEmergencyContact,
  useEmergencyContacts,
} from '@/features/hr/hooks/useHr';
import {
  EMP_STATUS_LABEL,
  EMP_STATUS_TONE,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  TERMINATION_REASON_LABEL,
  type Employee,
} from '@/features/hr/types';

type Tab = 'overview' | 'personal' | 'job' | 'finance' | 'leave' | 'docs' | 'emergency';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-navy-50 p-3">
      <p className="text-[11px] text-purple">{label}</p>
      <p className="num mt-0.5 text-sm font-semibold text-navy">{value || '—'}</p>
    </div>
  );
}

export function EmployeeProfile({
  employee,
  editable,
  onClose,
}: {
  employee: Employee;
  editable: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const { data: allDocs = [] } = useHrDocuments();
  const alertDays = useDocAlertDays();
  const canManageDocs = usePermissions().can('hr', 'manage');
  const { data: allEmergency = [] } = useEmergencyContacts();
  const addEmer = useAddEmergencyContact();

  // rows link by employee_id (backend); demo seeds without an id fall back to the name
  const mine = (r: { employee_id?: string; employee_name: string }) =>
    r.employee_id ? r.employee_id === employee.id : r.employee_name === employee.full_name;
  const docs = allDocs.filter(
    (d) => d.owner_kind === 'employee' && d.owner_id === employee.id && isCurrent(d),
  );
  const contacts = allEmergency.filter(mine);

  const idType = employee.id_type ?? (employee.nationality === 'السعودية' ? 'saudi' : 'expat');
  const docNum = (t: string) => docs.find((d) => d.type === t)?.number;
  const iqama = employee.iqama_no ?? docNum('iqama') ?? '';
  const passport = employee.passport_no ?? docNum('passport') ?? '';
  const nationalId = employee.national_id ?? docNum('national_id') ?? '';
  const gosiSystem = employee.gosi_system ?? 'new';
  const countsSaudization = employee.counts_in_saudization ?? idType === 'saudi';

  const alertsCount = docs.filter((d) => docStatus(d.expiry_date, alertDays) !== 'valid').length;

  const [contact, setContact] = useState({ name: '', relation: '', phone: '' });

  function addContact() {
    if (!contact.name.trim() || !contact.phone.trim()) return;
    addEmer.mutate({ employee_id: employee.id, employee_name: employee.full_name, ...contact });
    setContact({ name: '', relation: '', phone: '' });
  }

  const TABS: { value: Tab; label: string; icon: typeof IdCard }[] = [
    { value: 'overview', label: 'نظرة عامة', icon: UserRound },
    { value: 'personal', label: 'البيانات الشخصية', icon: IdCard },
    { value: 'job', label: 'الوظيفية', icon: ShieldCheck },
    { value: 'finance', label: 'الراتب والبنك', icon: Wallet },
    { value: 'leave', label: 'الإجازات', icon: CalendarCheck },
    { value: 'docs', label: 'المستندات والإقامات', icon: FileText },
    { value: 'emergency', label: 'الطوارئ', icon: Phone },
  ];

  return (
    <Modal open onClose={onClose} title={`ملف الموظف — ${employee.full_name}`}>
      <div className="max-h-[80vh] space-y-4 overflow-y-auto pl-1">
        {/* header */}
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-navy-50 text-lg font-bold text-navy">
            {employee.full_name.charAt(0)}
          </span>
          <div>
            <p className="text-base font-bold text-navy">
              {employee.full_name}
              {employee.english_name ? ` · ${employee.english_name}` : ''}
            </p>
            <p className="text-xs text-purple">
              {employee.job_title} · {employee.branch}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge tone={EMP_STATUS_TONE[employee.status]}>
                {EMP_STATUS_LABEL[employee.status]}
              </Badge>
              <Badge tone={idType === 'saudi' ? 'success' : 'navy'}>
                {idType === 'saudi' ? 'سعودي' : 'وافد'}
              </Badge>
              {alertsCount > 0 && <Badge tone="danger">{alertsCount} وثيقة تحتاج متابعة</Badge>}
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="flex flex-wrap gap-1 border-b border-navy-100 pb-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${tab === t.value ? 'bg-navy text-white' : 'text-purple hover:bg-navy-50'}`}
              >
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>

        {employee.status === 'terminated' && employee.termination_date && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            انتهت الخدمة في{' '}
            <span className="num font-semibold">{dateAr(employee.termination_date)}</span>
            {employee.termination_reason &&
              ` — ${TERMINATION_REASON_LABEL[employee.termination_reason]}`}
            {employee.termination_note && ` · ${employee.termination_note}`}
          </div>
        )}

        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="الرقم الوظيفي" value={employee.employee_no ?? ''} />
            <Field
              label="الراتب الإجمالي"
              value={`${sar(employee.base_salary + employee.allowances)} ر.س`}
            />
            <Field label="القسم" value={employee.department} />
            <Field label="تاريخ التعيين" value={dateAr(employee.join_date)} />
            <Field label="عدد المستندات" value={String(docs.length)} />
            <Field label="وثائق تحتاج متابعة" value={String(alertsCount)} />
            <Field label="الدور (الصلاحيات)" value={ROLE_META[employee.role].label} />
          </div>
        )}

        {tab === 'personal' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="الجنسية" value={employee.nationality} />
            <Field label="نوع الهوية" value={idType === 'saudi' ? 'هوية وطنية' : 'إقامة'} />
            {idType === 'saudi' ? (
              <Field label="رقم الهوية" value={nationalId} />
            ) : (
              <>
                <Field label="رقم الإقامة" value={iqama} />
                <Field label="رقم الجواز" value={passport} />
                <Field label="رقم الحدود" value={employee.border_no ?? ''} />
              </>
            )}
            <Field label="الجوال" value={employee.phone} />
            <Field label="البريد" value={employee.email} />
            <Field label="الحالة الاجتماعية" value={employee.marital_status ?? ''} />
            <Field label="الاسم بالإنجليزية" value={employee.english_name ?? ''} />
            <Field label="تاريخ الميلاد" value={employee.dob ? dateAr(employee.dob) : ''} />
            <Field
              label="الجنس"
              value={
                employee.gender === 'female' ? 'أنثى' : employee.gender === 'male' ? 'ذكر' : ''
              }
            />
          </div>
        )}

        {tab === 'job' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="المسمى الوظيفي" value={employee.job_title} />
            <Field label="الدور" value={ROLE_META[employee.role].label} />
            <Field label="القسم" value={employee.department} />
            <Field label="الفرع" value={employee.branch} />
            <Field label="تاريخ التعيين" value={dateAr(employee.join_date)} />
            <Field
              label="نوع العقد"
              value={
                employee.contract_type === 'part_time'
                  ? 'دوام جزئي'
                  : employee.contract_type === 'temp'
                    ? 'مؤقت'
                    : 'دوام كامل'
              }
            />
            <Field label="المدير المباشر" value={employee.manager ?? ''} />
            <Field label="يُحتسب في التوطين" value={countsSaudization ? 'نعم' : 'لا'} />
            <Field label="حساب الدخول" value={employee.user_id ? 'مرتبط بحساب' : 'بدون حساب'} />
          </div>
        )}

        {tab === 'finance' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="الراتب الأساسي" value={`${sar(employee.base_salary)} ر.س`} />
            <Field
              label="بدل السكن"
              value={`${sar(employee.housing_allowance ?? employee.allowances)} ر.س`}
            />
            <Field label="بدل النقل" value={`${sar(employee.transport_allowance ?? 0)} ر.س`} />
            <Field label="بدلات أخرى" value={`${sar(employee.other_allowance ?? 0)} ر.س`} />
            <Field
              label="الإجمالي"
              value={`${sar(employee.base_salary + employee.allowances)} ر.س`}
            />
            <Field label="الآيبان (IBAN)" value={employee.iban ?? ''} />
            <Field label="البنك" value={employee.bank_name ?? ''} />
            <Field
              label="نظام التأمينات (GOSI)"
              value={gosiSystem === 'old' ? 'قديم (قبل يوليو 2024)' : 'جديد'}
            />
            <Field
              label="تاريخ تسجيل التأمينات"
              value={employee.gosi_reg_date ? dateAr(employee.gosi_reg_date) : ''}
            />
            <Field
              label="استقطاع الموظف (GOSI)"
              value={
                idType === 'saudi' ? (gosiSystem === 'old' ? '9.75٪' : 'متصاعد') : 'لا يوجد (وافد)'
              }
            />
          </div>
        )}

        {tab === 'leave' && <ProfileLeave employee={employee} />}

        {tab === 'docs' && (
          <OwnerDocuments
            kind="employee"
            ownerId={employee.id}
            ownerName={employee.full_name}
            editable={editable && canManageDocs}
          />
        )}

        {tab === 'emergency' && (
          <div className="space-y-3">
            {contacts.length === 0 ? (
              <Card className="py-6 text-center text-sm text-purple">
                لا توجد جهات طوارئ مسجّلة.
              </Card>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-navy-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-navy">{c.name}</p>
                    <p className="text-[11px] text-purple">{c.relation}</p>
                  </div>
                  <span className="num text-sm text-navy">{c.phone}</span>
                </div>
              ))
            )}
            {editable && (
              <Card className="bg-navy-50/40">
                <p className="mb-2 text-xs font-bold text-navy">إضافة جهة طوارئ</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    placeholder="الاسم"
                    value={contact.name}
                    onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                  />
                  <Input
                    placeholder="صلة القرابة"
                    value={contact.relation}
                    onChange={(e) => setContact((c) => ({ ...c, relation: e.target.value }))}
                  />
                  <Input
                    placeholder="الجوال"
                    inputMode="tel"
                    value={contact.phone}
                    onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  />
                </div>
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  loading={addEmer.isPending}
                  onClick={addContact}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Plus size={14} /> إضافة
                  </span>
                </Button>
              </Card>
            )}
          </div>
        )}

        {alertsCount > 0 && tab !== 'docs' && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={14} /> لدى الموظف {alertsCount} وثيقة قاربت الانتهاء أو منتهية —
            راجع تبويب المستندات.
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Leave tab: balance as of today + this employee's requests. */
function ProfileLeave({ employee }: { employee: Employee }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: b, isLoading } = useLeaveBalance(employee, today);
  const { data: all = [] } = useLeaveRequests();
  const { data: types = [] } = useLeaveTypes();
  const mine = all.filter((l) =>
    l.employee_id ? l.employee_id === employee.id : l.employee_name === employee.full_name,
  );
  const name = (code: string) => types.find((t) => t.code === code)?.name_ar ?? code;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          label="المستحق حتى اليوم"
          value={isLoading || !b ? '…' : `${b.annual_accrued} يوم`}
        />
        <Field label="المستخدم" value={isLoading || !b ? '…' : `${b.annual_used} يوم`} />
        <Field label="الرصيد المتبقي" value={isLoading || !b ? '…' : `${b.annual_remaining} يوم`} />
        <Field
          label="المرضية هذا العام"
          value={isLoading || !b ? '…' : `${b.sick_used_this_year} / ${b.sick_total_limit}`}
        />
      </div>
      {mine.length === 0 ? (
        <Card className="py-6 text-center text-sm text-purple">لا توجد إجازات مسجلة.</Card>
      ) : (
        <ul className="space-y-2">
          {mine.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between rounded-xl border border-navy-50 px-3 py-2"
            >
              <div>
                <p className="text-sm font-semibold text-navy">
                  {name(l.type)} · <span className="num">{l.days}</span> يوم
                </p>
                <p className="num text-[11px] text-purple">
                  {dateAr(l.from_date)} → {dateAr(l.to_date)}
                </p>
              </div>
              <Badge tone={LEAVE_STATUS_TONE[l.status]}>{LEAVE_STATUS_LABEL[l.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
