import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  FileSearch,
  Fingerprint,
  Lock,
  Printer,
  RefreshCcw,
  ScrollText,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  SkeletonCard,
  StatTile,
  useToast,
} from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfig } from '@/features/settings/hooks/useSettings';
import {
  useApproveRentalTemplate,
  useCompanyProfile,
  useRentalTemplates,
  useUpdateCompanyProfile,
} from '@/features/contracts/hooks/useRentalContract';
import {
  TEMPLATE_STATUS_LABEL,
  companyProfileSchema,
  type RentalTemplateRow,
} from '@/features/contracts/api/rentalContract.api';
import { templateFingerprint } from '@/features/contracts/lib/rentalContract/template';
import {
  COMPLIANCE_REPORT,
  complianceChecks,
} from '@/features/contracts/lib/rentalContract/compliance';
import { templatePreviewHtml } from '@/features/contracts/lib/rentalContract/print';
import { openContractPrint } from '@/features/contracts/lib/contractHtml';
import type { CompanyProfile } from '@/features/contracts/lib/rentalContract/fields';

/**
 * «مراجعة قالب عقد التأجير»: معاينة كاملة للعقد الإلكتروني + تقرير المطابقة مع
 * الأصل + بيانات الطرف الأول + الاعتماد الرسمي (contracts.approve). لا يُصدر
 * عقد على القالب قبل اعتماده (يفرضه الـ backend — 0085).
 */
export default function RentalTemplateReview() {
  const { data: rows = [], isLoading, isError, refetch } = useRentalTemplates();
  const { can } = usePermissions();
  const canApprove = can('contracts', 'approve');

  // newest version first; one doc per version (same text for monthly + daily)
  const current = rows[0] ?? null;
  const sameVersion = rows.filter((r) => current && r.version === current.version);

  if (isLoading)
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  if (isError)
    return (
      <ErrorState
        title="تعذّر تحميل قالب العقد"
        description="تحقّق من الاتصال ثم أعد المحاولة."
        onRetry={() => void refetch()}
      />
    );
  if (!current)
    return (
      <EmptyState
        icon={ScrollText}
        title="لا يوجد قالب لعقد التأجير"
        description="طبّق migration 0085 لإضافة قالب «عقد تأجير خدمات عمالية»."
      />
    );

  return (
    <div className="space-y-5">
      <Link
        to="/contracts"
        className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> العودة للعقود
      </Link>
      <Header rows={sameVersion} current={current} canApprove={canApprove} />
      <Compliance current={current} />
      <Preview current={current} />
      <div className="grid gap-5 lg:grid-cols-2">
        <CompanyCard canEdit={canApprove} />
        <ReplacementPolicyCard />
      </div>
    </div>
  );
}

function statusTone(s: RentalTemplateRow['status']) {
  return s === 'approved' ? 'success' : s === 'retired' ? 'neutral' : 'gold';
}

function Header({
  rows,
  current,
  canApprove,
}: {
  rows: RentalTemplateRow[];
  current: RentalTemplateRow;
  canApprove: boolean;
}) {
  const toast = useToast();
  const approve = useApproveRentalTemplate();
  const [confirm, setConfirm] = useState(false);
  const pending = rows.some((r) => r.status === 'pending_review' || r.status === 'draft');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-navy-50 text-navy">
            <ScrollText size={22} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-navy">{current.doc.title}</h1>
            <p className="mt-0.5 text-sm text-purple">
              القالب الإلكتروني المطابق لعقد ماسية الشرق الأصلي — النسخة{' '}
              <span className="num">{current.version}</span> · لخدمتي التأجير الشهري واليومي
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={statusTone(current.status)}>
                {TEMPLATE_STATUS_LABEL[current.status]}
              </Badge>
              {current.status === 'approved' && (
                <Badge tone="navy">
                  <Lock size={12} className="ml-1 inline" /> النص مقفل
                </Badge>
              )}
              {current.approved_at && (
                <span className="text-xs text-purple">اعتُمد {dateAr(current.approved_at)}</span>
              )}
            </div>
          </div>
        </div>
        {pending &&
          (canApprove ? (
            <Button variant="accent" onClick={() => setConfirm(true)}>
              <BadgeCheck size={16} /> اعتماد القالب
            </Button>
          ) : (
            <p className="max-w-xs text-xs text-purple">
              الاعتماد بصلاحية «اعتماد العقود» (مدير الفرع، مدير العمليات، المدير العام).
            </p>
          ))}
      </div>
      {pending && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-gold-100/60 p-3 text-sm text-navy-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-gold-600" />
          القالب بانتظار الاعتماد: راجع المعاينة وتقرير المطابقة أدناه. لن يُصدر أي عقد تأجير على
          هذا القالب قبل اعتماده، وتبقى العقود السابقة بقوالبها كما هي.
        </p>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="اعتماد قالب عقد التأجير">
        <p className="text-sm leading-relaxed text-navy-900">
          بعد الاعتماد يُقفل نص العقد نهائياً: لا يُعدَّل ولا يُحذف، وكل عقد تأجير جديد يُصدر عليه
          بنفس البنود. أي تعديل مستقبلي = نسخة جديدة تُعتمد رسمياً. هل راجعت المعاينة وتقرير
          المطابقة؟
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            إلغاء
          </Button>
          <Button
            variant="accent"
            loading={approve.isPending}
            onClick={() =>
              approve.mutate(current.version, {
                onSuccess: () => {
                  toast.success('تم اعتماد القالب — يُستخدم الآن في عقود التأجير الجديدة');
                  setConfirm(false);
                },
                onError: (e) => toast.error(e.message || 'تعذّر اعتماد القالب'),
              })
            }
          >
            <BadgeCheck size={16} /> اعتماد
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function Compliance({ current }: { current: RentalTemplateRow }) {
  const [sha, setSha] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void templateFingerprint(current.doc).then((h) => live && setSha(h));
    return () => {
      live = false;
    };
  }, [current.doc]);
  const checks = useMemo(() => complianceChecks(current.doc, sha), [current.doc, sha]);
  const passed = checks.filter((c) => c.ok).length;
  const r = COMPLIANCE_REPORT;

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-navy">
        <FileSearch size={18} /> تقرير المطابقة مع الأصل
      </h2>
      <p className="mb-4 text-xs text-purple">
        المصدر: {r.source} · فُحص بتاريخ <span className="num">{r.checked_at}</span>
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile
          label="الفحوص الناجحة"
          value={`${passed} / ${checks.length}`}
          icon={CircleCheck}
          tone={passed === checks.length ? 'success' : 'danger'}
        />
        <StatTile
          label="حروف الأصل / القالب"
          value={`${r.stats.characters_original} / ${r.stats.characters_template}`}
        />
        <StatTile
          label="اختلافات في نص البنود"
          value={r.stats.character_differences}
          tone={r.stats.character_differences === 0 ? 'success' : 'danger'}
        />
        <StatTile
          label="صفوف الجداول المطابقة"
          value={`${r.stats.table_rows_matched} / ${r.stats.table_rows}`}
        />
      </div>

      <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-navy-900">
              {c.ok ? (
                <CircleCheck size={16} className="text-green-600" />
              ) : (
                <CircleAlert size={16} className="text-red-600" />
              )}
              {c.label}
            </span>
            <span className={`text-xs ${c.ok ? 'text-purple' : 'text-red-700'}`}>
              {c.label.startsWith('بصمة') && <Fingerprint size={12} className="ml-1 inline" />}
              <span className={c.label.startsWith('بصمة') ? 'num' : ''}>{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 mt-5 text-sm font-bold text-navy">طريقة التحقق</h3>
      <ul className="list-inside list-disc space-y-1 text-sm text-navy-900">
        {r.method.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>

      <h3 className="mb-2 mt-5 text-sm font-bold text-navy">
        ملاحظات على الأصل (نُقلت حرفياً دون تصحيح)
      </h3>
      <div className="overflow-x-auto rounded-xl border border-navy-100">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-right text-xs text-navy">
            <tr>
              <th className="px-3 py-2">الموضع</th>
              <th className="px-3 py-2">النص في الأصل</th>
              <th className="px-3 py-2">الملاحظة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {r.source_observations.map((o) => (
              <tr key={o.where + o.original}>
                <td className="whitespace-nowrap px-3 py-2 text-purple">{o.where}</td>
                <td className="px-3 py-2 font-medium text-navy-900">{o.original}</td>
                <td className="px-3 py-2 text-navy-900">{o.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-bold text-navy">
        فروق العرض الإلكتروني (خارج نص البنود)
      </h3>
      <div className="overflow-x-auto rounded-xl border border-navy-100">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-right text-xs text-navy">
            <tr>
              <th className="px-3 py-2">الموضع</th>
              <th className="px-3 py-2">الأصل</th>
              <th className="px-3 py-2">النسخة الإلكترونية</th>
              <th className="px-3 py-2">السبب</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {r.deviations.map((d) => (
              <tr key={d.where}>
                <td className="whitespace-nowrap px-3 py-2 text-purple">{d.where}</td>
                <td className="px-3 py-2">{d.original}</td>
                <td className="px-3 py-2">{d.electronic}</td>
                <td className="px-3 py-2 text-navy-900">{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Preview({ current }: { current: RentalTemplateRow }) {
  const watermark = current.status === 'approved' ? null : 'معاينة — القالب بانتظار الاعتماد';
  const html = useMemo(() => templatePreviewHtml(current.doc, watermark), [current.doc, watermark]);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-navy">معاينة كاملة للعقد</h2>
          <p className="text-xs text-purple">
            كل البنود بنصها وترتيبها الأصلي — الحقول المتغيّرة تظهر بأسمائها «…» وتُعبّأ من النظام
            عند إصدار العقد.
          </p>
        </div>
        <Button variant="outline" onClick={() => openContractPrint(html)}>
          <Printer size={16} /> فتح للطباعة / PDF
        </Button>
      </div>
      <iframe
        title="معاينة عقد تأجير خدمات عمالية"
        srcDoc={html}
        className="h-[80vh] w-full rounded-xl border border-navy-100 bg-gray-100"
      />
    </Card>
  );
}

const COMPANY_FIELDS: { key: keyof CompanyProfile; label: string; ltr?: boolean }[] = [
  { key: 'name', label: 'اسم الشركة' },
  { key: 'name_en', label: 'الاسم بالإنجليزية', ltr: true },
  { key: 'vat_number', label: 'الرقم الضريبي', ltr: true },
  { key: 'cr_number', label: 'السجل التجاري', ltr: true },
  { key: 'mol_license_no', label: 'ترخيص وزارة العمل', ltr: true },
  { key: 'phone', label: 'الهاتف (ت)', ltr: true },
  { key: 'mobile', label: 'الجوال (ج)', ltr: true },
  { key: 'email', label: 'البريد الإلكتروني', ltr: true },
  { key: 'address', label: 'العنوان' },
];

function CompanyCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useCompanyProfile();
  const save = useUpdateCompanyProfile();
  const [form, setForm] = useState<CompanyProfile | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyProfile, string>>>({});
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function submit() {
    if (!form) return;
    const parsed = companyProfileSchema.safeParse(form);
    if (!parsed.success) {
      const e: Partial<Record<keyof CompanyProfile, string>> = {};
      for (const i of parsed.error.issues) e[i.path[0] as keyof CompanyProfile] = i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: () => toast.success('حُفظت بيانات الطرف الأول — تظهر في العقود الجديدة'),
      onError: (e) => toast.error(e.message || 'تعذّر الحفظ'),
    });
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-bold text-navy">بيانات الطرف الأول</h2>
      <p className="mb-4 text-xs text-purple">
        تُعبّأ في رأس العقد وجدول «الطرف الأول». العقد الصادر يحتفظ بالبيانات وقت إصداره.
      </p>
      {isLoading && <SkeletonCard />}
      {isError && (
        <ErrorState
          title="تعذّر التحميل"
          description="أعد المحاولة."
          onRetry={() => void refetch()}
        />
      )}
      {form && (
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPANY_FIELDS.map((f) => (
            <div key={f.key} className={f.key === 'address' ? 'sm:col-span-2' : ''}>
              <Input
                label={f.label}
                value={form[f.key]}
                dir={f.ltr ? 'ltr' : undefined}
                className={f.ltr ? 'num text-left' : ''}
                disabled={!canEdit}
                error={errors[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
          {canEdit && (
            <div className="flex justify-end sm:col-span-2">
              <Button onClick={submit} loading={save.isPending} disabled={form === data}>
                حفظ
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReplacementPolicyCard() {
  const { data: config = [], isLoading } = useConfig();
  const item = config.find((c) => c.key === 'replacement_max_proposed');
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-navy">
        <RefreshCcw size={18} /> سياسة الاستبدال المقترحة
      </h2>
      <p className="mb-4 text-xs text-purple">إعداد تشغيلي منفصل — ليس جزءاً من العقد.</p>
      {isLoading ? (
        <SkeletonCard />
      ) : (
        <div className="space-y-3 text-sm text-navy-900">
          <p>
            الحد الأقصى المقترح لمرات الاستبدال:{' '}
            <span className="num text-lg font-bold text-navy">{item?.value ?? '—'}</span>{' '}
            {item?.unit ?? ''}
          </p>
          <p className="rounded-xl bg-navy-50 p-3 leading-relaxed">
            بنود الاستبدال وتوفير البديل في العقد (البند الثاني فقرة 4، والبند الثالث فقرتا 9 و12)
            باقية بنصها الأصلي دون تعديل. هذا الحد مقترح من الإدارة ولا يُطبَّق كشرط تعاقدي، ولا
            يُضاف إلى العقد إلا بإصدار نسخة عقد معدّلة واعتمادها رسمياً.
          </p>
          <Link to="/settings" className="inline-block text-xs font-semibold text-navy underline">
            تعديل القيمة من الإعدادات ← «سياسة الاستبدال المقترحة»
          </Link>
        </div>
      )}
    </Card>
  );
}
