import { useState } from 'react';
import {
  IdCard,
  FileText,
  Wallet,
  UserRound,
  Phone,
  ShieldCheck,
  Plus,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { Badge, Button, Card, Input, Modal, Select } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { ROLE_META } from '@/lib/permissions';
import { expiryStatus } from '@/features/hr/api/hr.api';
import {
  useAddDocument,
  useAddEmergencyContact,
  useDocuments,
  useEmergencyContacts,
  useIqamas,
} from '@/features/hr/hooks/useHr';
import {
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  EMP_STATUS_LABEL,
  EMP_STATUS_TONE,
  type Employee,
} from '@/features/hr/types';

const DOC_TYPES = [
  'الهوية الوطنية',
  'الإقامة',
  'جواز سفر',
  'رخصة العمل',
  'التأشيرة',
  'عقد عمل',
  'السيرة الذاتية',
  'شهادة علمية/مهنية',
  'التأمين الطبي',
  'رخصة قيادة',
  'أخرى',
];

type Tab = 'overview' | 'personal' | 'job' | 'finance' | 'docs' | 'emergency';

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
  const { data: allDocs = [] } = useDocuments();
  const { data: allIqamas = [] } = useIqamas();
  const { data: allEmergency = [] } = useEmergencyContacts();
  const addDoc = useAddDocument();
  const addEmer = useAddEmergencyContact();

  const docs = allDocs.filter((d) => d.employee_name === employee.full_name);
  const iqamas = allIqamas.filter((i) => i.employee_name === employee.full_name);
  const contacts = allEmergency.filter((c) => c.employee_name === employee.full_name);

  const idType = employee.id_type ?? (employee.nationality === 'السعودية' ? 'saudi' : 'expat');
  const docNum = (t: string) => docs.find((d) => d.type.includes(t))?.number;
  const iqama = employee.iqama_no ?? docNum('إقامة') ?? '';
  const passport = employee.passport_no ?? docNum('جواز') ?? '';
  const nationalId = employee.national_id ?? docNum('هوية') ?? '';
  const gosiSystem = employee.gosi_system ?? 'new';
  const countsSaudization = employee.counts_in_saudization ?? idType === 'saudi';

  const alertsCount = docs.filter((d) => expiryStatus(d.expiry_date) !== 'valid').length;

  const [doc, setDoc] = useState({
    type: DOC_TYPES[0]!,
    number: '',
    issue_date: '',
    expiry_date: '',
  });
  const [contact, setContact] = useState({ name: '', relation: '', phone: '' });

  function uploadDoc() {
    if (!doc.number.trim()) return;
    addDoc.mutate({
      employee_name: employee.full_name,
      type: doc.type,
      number: doc.number.trim(),
      issue_date: doc.issue_date || new Date().toISOString().slice(0, 10),
      expiry_date: doc.expiry_date || null,
    });
    setDoc({ type: DOC_TYPES[0]!, number: '', issue_date: '', expiry_date: '' });
  }

  function addContact() {
    if (!contact.name.trim() || !contact.phone.trim()) return;
    addEmer.mutate({ employee_name: employee.full_name, ...contact });
    setContact({ name: '', relation: '', phone: '' });
  }

  const TABS: { value: Tab; label: string; icon: typeof IdCard }[] = [
    { value: 'overview', label: 'نظرة عامة', icon: UserRound },
    { value: 'personal', label: 'البيانات الشخصية', icon: IdCard },
    { value: 'job', label: 'الوظيفية', icon: ShieldCheck },
    { value: 'finance', label: 'الراتب والبنك', icon: Wallet },
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

        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
          </div>
        )}

        {tab === 'finance' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="الراتب الأساسي" value={`${sar(employee.base_salary)} ر.س`} />
            <Field label="البدلات" value={`${sar(employee.allowances)} ر.س`} />
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

        {tab === 'docs' && (
          <div className="space-y-3">
            {docs.length === 0 && iqamas.length === 0 ? (
              <Card className="py-6 text-center text-sm text-purple">
                لا توجد مستندات لهذا الموظف بعد.
              </Card>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => {
                  const st = expiryStatus(d.expiry_date);
                  return (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-xl border border-navy-50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-navy">{d.type}</p>
                        <p className="num text-[11px] text-purple">
                          {d.number} · انتهاء: {d.expiry_date ? dateAr(d.expiry_date) : 'دائم'}
                        </p>
                      </div>
                      <Badge tone={DOC_STATUS_TONE[st]}>{DOC_STATUS_LABEL[st]}</Badge>
                    </div>
                  );
                })}
                {iqamas.map((i) => {
                  const st = expiryStatus(i.expiry_date);
                  return (
                    <div
                      key={i.id}
                      className="flex items-center justify-between rounded-xl border border-navy-50 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-navy">
                          إقامة · {i.profession}
                          {i.work_permit ? ' · رخصة عمل سارية' : ''}
                        </p>
                        <p className="num text-[11px] text-purple">
                          {i.iqama_no} · انتهاء: {dateAr(i.expiry_date)}
                        </p>
                      </div>
                      <Badge tone={DOC_STATUS_TONE[st]}>{DOC_STATUS_LABEL[st]}</Badge>
                    </div>
                  );
                })}
              </div>
            )}

            {editable && (
              <Card className="bg-navy-50/40">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-navy">
                  <Upload size={14} /> رفع مستند رسمي
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={doc.type}
                    onChange={(e) => setDoc((d) => ({ ...d, type: e.target.value }))}
                    options={DOC_TYPES.map((t) => ({ value: t, label: t }))}
                  />
                  <Input
                    placeholder="الرقم"
                    value={doc.number}
                    onChange={(e) => setDoc((d) => ({ ...d, number: e.target.value }))}
                  />
                  <div>
                    <label className="mb-1 block text-[11px] text-purple">تاريخ الإصدار</label>
                    <input
                      type="date"
                      value={doc.issue_date}
                      onChange={(e) => setDoc((d) => ({ ...d, issue_date: e.target.value }))}
                      className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2 text-sm outline-none focus:border-navy"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-purple">
                      تاريخ الانتهاء (اختياري)
                    </label>
                    <input
                      type="date"
                      value={doc.expiry_date}
                      onChange={(e) => setDoc((d) => ({ ...d, expiry_date: e.target.value }))}
                      className="w-full rounded-xl border border-navy-100 bg-white px-3 py-2 text-sm outline-none focus:border-navy"
                    />
                  </div>
                </div>
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  loading={addDoc.isPending}
                  onClick={uploadDoc}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Plus size={14} /> إضافة المستند
                  </span>
                </Button>
              </Card>
            )}
          </div>
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
