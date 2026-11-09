import { useRef, useState, type ReactNode } from 'react';
import {
  Camera,
  FileText,
  Home,
  IdCard,
  Landmark,
  Lock,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Select } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import { useDormOptions, useSaveWorkerFile } from '@/features/hr/hooks/useHr';
import { useHrLookups } from '@/features/hr/hooks/useHrLookups';
import { OwnerDocuments } from '@/features/hr/components/DocumentsBoard';
import {
  documentSchema,
  firstIssue,
  todayIso,
  validateDocFile,
} from '@/features/hr/lib/documentsEngine';
import {
  ageFrom,
  cleanIban,
  validatePhoto,
  workerErrors,
  type WorkerFormErrors,
} from '@/features/hr/lib/workerValidation';
import type { PendingDoc } from '@/features/hr/api/workerFile.api';
import {
  PAYMENT_METHOD_LABEL,
  WORKER_STATUS_LABEL,
  type DocFile,
  type HouseWorker,
  type WorkerStatus,
} from '@/features/hr/types';

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof IdCard;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-navy-50 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Icon size={16} /> {title}
        </h3>
        {hint && <p className="mt-0.5 text-[11px] text-purple">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Chips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-navy-900">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o)}
              className={`rounded-full border px-3 py-1 text-xs transition ${on ? 'border-navy bg-navy text-white' : 'border-navy-100 bg-white text-navy hover:bg-navy-50'}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const QUICK_DOCS = ['iqama', 'passport', 'work_permit', 'visa'] as const;

/** «إضافة / تعديل عاملة» — the complete worker file in one form (0078). */
export function WorkerFileForm({
  worker,
  onClose,
}: {
  worker: HouseWorker | null;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const canManage = can('hr', 'manage');
  const lk = useHrLookups();
  const { data: dorms = [] } = useDormOptions();
  const save = useSaveWorkerFile();
  const photoRef = useRef<HTMLInputElement>(null);

  const [w, setW] = useState<HouseWorker>(() => ({
    id: worker?.id ?? `w-${Date.now()}`,
    full_name: worker?.full_name ?? '',
    photo_url: worker?.photo_url ?? null,
    nationality: worker?.nationality ?? '',
    profession: worker?.profession ?? '',
    age: worker?.age ?? 30,
    experience_years: worker?.experience_years ?? 0,
    monthly_salary: worker?.monthly_salary ?? 0,
    languages: worker?.languages ?? [],
    skills: worker?.skills ?? [],
    status: worker?.status ?? 'available',
    branch: worker?.branch || BRANCHES_AR[0],
    bio: worker?.bio ?? '',
    passport_no: worker?.passport_no ?? '',
    iqama_no: worker?.iqama_no ?? '',
    border_no: worker?.border_no ?? '',
    birth_date: worker?.birth_date ?? '',
    arrival_date: worker?.arrival_date ?? '',
    phone: worker?.phone ?? '',
    dorm: worker?.dorm ?? '',
    barcode: worker?.barcode ?? '',
    bank_name: worker?.bank_name ?? '',
    iban: worker?.iban ?? '',
    account_holder: worker?.account_holder ?? '',
    payment_method: worker?.payment_method ?? 'bank',
  }));
  const [photo, setPhoto] = useState<DocFile | null>(null);
  const [preview, setPreview] = useState<string | null>(worker?.photo_url ?? null);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [errors, setErrors] = useState<WorkerFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof HouseWorker>(k: K, v: HouseWorker[K]) =>
    setW((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'languages' | 'skills', v: string) =>
    setW((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const err = (k: string) => (errors[k] ? { error: errors[k] } : {});
  const age = ageFrom(w.birth_date);
  const branchDorms = dorms.filter((d) => !d.branch || d.branch === w.branch);

  function submit() {
    const e = workerErrors({ ...w, age: age ?? w.age });
    setErrors(e);
    if (Object.keys(e).length) return setFormError('راجع الحقول المظللة بالأحمر.');
    setFormError(null);
    save.mutate({ worker: w, isNew: !worker, photo, docs }, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={worker ? `ملف العاملة — ${worker.full_name}` : 'إضافة عاملة'}
      size="xl"
    >
      <div className="max-h-[78vh] space-y-4 overflow-y-auto pl-1">
        {/* 1) photo + basics */}
        <Section icon={UserRound} title="البيانات الأساسية">
          <div className="flex flex-wrap items-center gap-4">
            {preview ? (
              <img
                src={preview}
                alt="صورة العاملة"
                className="h-24 w-24 rounded-2xl object-cover"
              />
            ) : (
              <span className="grid h-24 w-24 place-items-center rounded-2xl bg-navy-50 text-navy">
                <UserRound size={36} />
              </span>
            )}
            <div className="space-y-1">
              <input
                ref={photoRef}
                type="file"
                aria-label="صورة العاملة"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const bad = validatePhoto(f);
                  if (bad) {
                    setErrors((x) => ({ ...x, photo: bad }));
                    e.target.value = '';
                    return;
                  }
                  setErrors((x) => ({ ...x, photo: undefined }));
                  setPhoto({ name: f.name, type: f.type, size: f.size, blob: f });
                  setPreview(
                    typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null,
                  );
                }}
              />
              <Button size="sm" variant="outline" onClick={() => photoRef.current?.click()}>
                <Camera size={15} /> {preview ? 'تغيير الصورة' : 'إرفاق صورة'}
              </Button>
              <p className="text-[11px] text-purple">
                JPG / PNG / WEBP حتى 5 ميجابايت — تظهر للعملاء في الكتالوج.
              </p>
              {errors.photo && <p className="text-xs text-red-600">{errors.photo}</p>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label="الاسم الكامل"
              value={w.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              {...err('full_name')}
            />
            <Select
              label="الجنسية"
              value={w.nationality}
              onChange={(e) => set('nationality', e.target.value)}
              options={[
                { value: '', label: 'اختر الجنسية' },
                ...lk.options('nationality', {
                  scope: 'worker',
                  keep: worker?.nationality ?? null,
                }),
              ]}
              {...err('nationality')}
            />
            <Select
              label="المهنة"
              value={w.profession}
              onChange={(e) => set('profession', e.target.value)}
              options={[
                { value: '', label: 'اختر المهنة' },
                ...lk.options('profession', { keep: worker?.profession ?? null }),
              ]}
              {...err('profession')}
            />
            <Input
              label="تاريخ الميلاد"
              type="date"
              value={w.birth_date}
              onChange={(e) => set('birth_date', e.target.value)}
              {...err('birth_date')}
            />
            <Input
              label="العمر"
              type="number"
              min={18}
              value={age ?? w.age}
              disabled={age !== null}
              {...(age !== null ? { hint: 'محسوب من تاريخ الميلاد' } : {})}
              onChange={(e) => set('age', Number(e.target.value))}
              {...err('age')}
            />
            <Input
              label="سنوات الخبرة"
              type="number"
              min={0}
              value={w.experience_years}
              onChange={(e) => set('experience_years', Number(e.target.value))}
              {...err('experience_years')}
            />
            <Select
              label="الحالة"
              value={w.status}
              onChange={(e) => set('status', e.target.value as WorkerStatus)}
              options={(Object.keys(WORKER_STATUS_LABEL) as WorkerStatus[]).map((s) => ({
                value: s,
                label: WORKER_STATUS_LABEL[s],
              }))}
            />
            <Select
              label="الفرع"
              value={w.branch}
              onChange={(e) => {
                set('branch', e.target.value);
                set('dorm', '');
              }}
              options={BRANCHES_AR.map((b) => ({ value: b, label: b }))}
              {...err('branch')}
            />
          </div>
        </Section>

        {/* 2) identity */}
        <Section
          icon={IdCard}
          title="الهوية والإقامة"
          hint="بيانات خاصة — تظهر للموارد البشرية في نطاق الفرع فقط ولا تظهر في كتالوج العملاء."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label="رقم الجواز"
              value={w.passport_no}
              onChange={(e) => set('passport_no', e.target.value.toUpperCase())}
              {...err('passport_no')}
            />
            <Input
              label="رقم الإقامة"
              inputMode="numeric"
              value={w.iqama_no}
              onChange={(e) => set('iqama_no', e.target.value.trim())}
              {...err('iqama_no')}
            />
            <Input
              label="رقم الحدود"
              inputMode="numeric"
              value={w.border_no}
              onChange={(e) => set('border_no', e.target.value.trim())}
              {...err('border_no')}
            />
            <Input
              label="تاريخ الوصول للمملكة"
              type="date"
              value={w.arrival_date}
              onChange={(e) => set('arrival_date', e.target.value)}
              {...err('arrival_date')}
            />
          </div>
        </Section>

        {/* 3) contact + housing */}
        <Section icon={Home} title="التواصل والسكن">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="رقم الجوال"
              inputMode="tel"
              placeholder="05xxxxxxxx"
              value={w.phone}
              onChange={(e) => set('phone', e.target.value.trim())}
              {...err('phone')}
            />
            <Select
              label="السكن"
              value={w.dorm}
              onChange={(e) => set('dorm', e.target.value)}
              options={[
                { value: '', label: 'بدون سكن' },
                ...branchDorms.map((d) => ({ value: d.name, label: d.name })),
                ...(w.dorm && !branchDorms.some((d) => d.name === w.dorm)
                  ? [{ value: w.dorm, label: w.dorm }]
                  : []),
              ]}
            />
            <div>
              <p className="mb-1.5 text-sm font-medium text-navy-900">باركود السكن</p>
              <p className="rounded-xl bg-navy-50 px-3 py-2.5 text-sm text-navy">
                {w.barcode ? (
                  <span className="num font-semibold">{w.barcode}</span>
                ) : (
                  'يُولَّد تلقائيًا عند الحفظ'
                )}
              </p>
            </div>
          </div>
        </Section>

        {/* 4) salary + bank */}
        <Section
          icon={Landmark}
          title="الراتب والحساب البنكي"
          hint={
            canManage
              ? 'لصرف راتب العاملة — الآيبان يبدأ بـ SA ويليه 22 رقمًا.'
              : 'البيانات البنكية والراتب من صلاحية مدير الموارد البشرية.'
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label="الراتب الشهري"
              type="number"
              min={0}
              suffix="ر.س"
              value={w.monthly_salary}
              onChange={(e) => set('monthly_salary', Number(e.target.value))}
              {...err('monthly_salary')}
            />
            <Select
              label="طريقة صرف الراتب"
              value={w.payment_method}
              disabled={!canManage}
              onChange={(e) =>
                set('payment_method', e.target.value as HouseWorker['payment_method'])
              }
              options={(Object.keys(PAYMENT_METHOD_LABEL) as HouseWorker['payment_method'][]).map(
                (m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }),
              )}
            />
            {w.payment_method === 'bank' && (
              <>
                <Select
                  label="البنك"
                  value={w.bank_name}
                  disabled={!canManage}
                  onChange={(e) => set('bank_name', e.target.value)}
                  options={[
                    { value: '', label: 'اختر البنك' },
                    ...lk.options('bank', { keep: worker?.bank_name || null }),
                  ]}
                  {...err('bank_name')}
                />
                <Input
                  label="رقم الآيبان"
                  dir="ltr"
                  placeholder="SA0000000000000000000000"
                  value={w.iban}
                  disabled={!canManage}
                  onChange={(e) => set('iban', cleanIban(e.target.value))}
                  {...err('iban')}
                />
                <Input
                  label="اسم صاحب الحساب"
                  dir="ltr"
                  value={w.account_holder}
                  disabled={!canManage}
                  onChange={(e) => set('account_holder', e.target.value)}
                  {...err('account_holder')}
                />
              </>
            )}
          </div>
          {!canManage && (
            <p className="flex items-center gap-1 text-[11px] text-purple">
              <Lock size={12} /> للعرض فقط
            </p>
          )}
        </Section>

        {/* 5) skills */}
        <Section icon={Sparkles} title="اللغات والمهارات">
          <Chips
            label="اللغات"
            options={lk.names('language', { keep: worker?.languages ?? [] })}
            selected={w.languages}
            onToggle={(v) => toggle('languages', v)}
          />
          <Chips
            label="المهارات والصفات"
            options={lk.names('skill', { keep: worker?.skills ?? [] })}
            selected={w.skills}
            onToggle={(v) => toggle('skills', v)}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-900">نبذة (تظهر للعملاء)</p>
            <textarea
              value={w.bio}
              onChange={(e) => set('bio', e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-navy-100 px-3 py-2 text-sm outline-none focus:border-navy"
            />
          </div>
        </Section>

        {/* 6) official documents */}
        <Section
          icon={FileText}
          title="الوثائق الرسمية وتواريخ انتهائها"
          hint="تدخل في تنبيهات الانتهاء وسجل الإقامات."
        >
          {worker ? (
            <OwnerDocuments
              kind="worker"
              ownerId={worker.id}
              ownerName={worker.full_name}
              editable={canManage}
            />
          ) : canManage ? (
            <PendingDocs docs={docs} setDocs={setDocs} />
          ) : (
            <p className="text-xs text-purple">
              إضافة الوثائق من صلاحية مدير الموارد البشرية — تُضاف من ملف العاملة بعد حفظها.
            </p>
          )}
        </Section>

        {formError && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
        )}
        <Button className="w-full" size="lg" loading={save.isPending} onClick={submit}>
          <Save size={16} /> {worker ? 'حفظ ملف العاملة' : 'إضافة العاملة بملفها الكامل'}
        </Button>
      </div>
    </Modal>
  );
}

/** Documents typed in before the worker exists — saved right after her. */
function PendingDocs({
  docs,
  setDocs,
}: {
  docs: PendingDoc[];
  setDocs: (d: PendingDoc[]) => void;
}) {
  const lk = useHrLookups();
  const fileRef = useRef<HTMLInputElement>(null);
  const empty = {
    type: 'iqama',
    number: '',
    issue_date: todayIso(),
    expiry_date: '',
    renewal_cost: 0,
    notes: '',
  };
  const [d, setD] = useState(empty);
  const [file, setFile] = useState<DocFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  function add() {
    const e = firstIssue(
      documentSchema.safeParse({ ...d, owner_kind: 'worker', owner_id: 'pending' }),
    );
    if (e) return setError(e);
    setError(null);
    setDocs([...docs, { key: `${Date.now()}`, draft: d, file }]);
    setD({ ...empty, type: d.type === 'iqama' ? 'passport' : 'iqama' });
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      {docs.length > 0 && (
        <ul className="space-y-1.5">
          {docs.map((x) => (
            <li
              key={x.key}
              className="flex items-center justify-between rounded-xl bg-navy-50 px-3 py-2 text-sm"
            >
              <span className="text-navy">
                <span className="font-semibold">{lk.docTypeLabel(x.draft.type)}</span> ·{' '}
                <span className="num">{x.draft.number}</span>
                {x.draft.expiry_date && (
                  <>
                    {' '}
                    · ينتهي <span className="num">{dateAr(x.draft.expiry_date)}</span>
                  </>
                )}
                {x.file && <Badge tone="navy">مرفق</Badge>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="حذف"
                onClick={() => setDocs(docs.filter((y) => y.key !== x.key))}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_DOCS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setD({ ...d, type: t })}
            className={`rounded-full border px-3 py-1 text-xs ${d.type === t ? 'border-navy bg-navy text-white' : 'border-navy-100 text-navy'}`}
          >
            {lk.docTypeLabel(t)}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          aria-label="نوع الوثيقة"
          value={d.type}
          onChange={(e) => setD({ ...d, type: e.target.value })}
          options={lk.docTypes(d.type)}
        />
        <Input
          aria-label="رقم الوثيقة"
          placeholder="رقم الوثيقة"
          value={d.number}
          onChange={(e) => setD({ ...d, number: e.target.value })}
        />
        <Input
          aria-label="تاريخ الإصدار"
          type="date"
          value={d.issue_date}
          onChange={(e) => setD({ ...d, issue_date: e.target.value })}
        />
        <Input
          aria-label="تاريخ الانتهاء"
          type="date"
          value={d.expiry_date}
          onChange={(e) => setD({ ...d, expiry_date: e.target.value })}
        />
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            aria-label="ملف الوثيقة"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const picked = { name: f.name, type: f.type, size: f.size, blob: f };
              const bad = validateDocFile(picked);
              setError(bad);
              setFile(bad ? null : picked);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            title={file?.name ?? 'إرفاق ملف'}
          >
            <FileText size={14} /> {file ? 'مرفق' : 'ملف'}
          </Button>
          <Button size="sm" onClick={add}>
            <Plus size={14} /> إضافة
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {docs.length === 0 && (
        <p className="text-[11px] text-purple">
          أضف الإقامة والجواز ورخصة العمل والتأشيرة مع تواريخ انتهائها — تُحفظ مع العاملة.
        </p>
      )}
    </div>
  );
}
