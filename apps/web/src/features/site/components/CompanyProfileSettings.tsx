import { useEffect, useState } from 'react';
import { ExternalLink, ImageUp, Save, Trash2 } from 'lucide-react';
import { Button, Card, Input, useToast } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useSaveCompanyProfile,
  useSiteInfo,
  useUploadSiteImage,
} from '@/features/site/hooks/useSite';
import { companyProfileError } from '@/features/site/api/site.api';
import { EMPTY_COMPANY, type CompanyProfile } from '@/features/site/types';

type Field = {
  key: keyof CompanyProfile;
  label: string;
  placeholder?: string;
  ltr?: boolean;
  hint?: string;
};

const GROUPS: { title: string; hint: string; fields: Field[] }[] = [
  {
    title: 'هوية الشركة',
    hint: 'تظهر في رأس الصفحة وتذييلها وفي بيانات محركات البحث.',
    fields: [
      { key: 'display_name', label: 'الاسم التجاري', placeholder: 'ماسية الشرق للاستقدام' },
      { key: 'legal_name', label: 'الاسم النظامي (اختياري)' },
      { key: 'cr_number', label: 'رقم السجل التجاري', ltr: true },
      { key: 'vat_number', label: 'الرقم الضريبي', ltr: true },
      {
        key: 'founded_year',
        label: 'سنة التأسيس',
        placeholder: 'مثال: 2012',
        ltr: true,
        hint: 'تُعرض «سنوات الخبرة» فقط عند إدخالها',
      },
    ],
  },
  {
    title: 'التواصل الرسمي',
    hint: 'لا يظهر في الموقع إلا ما تُدخله هنا — زر واتساب يظهر فقط عند إدخال رقمه.',
    fields: [
      { key: 'phone', label: 'الهاتف', placeholder: '9200xxxxx أو 05xxxxxxxx', ltr: true },
      { key: 'whatsapp', label: 'واتساب (دولي)', placeholder: '9665xxxxxxxx', ltr: true },
      { key: 'email', label: 'البريد الإلكتروني', placeholder: 'info@example.sa', ltr: true },
      { key: 'working_hours', label: 'أوقات العمل', placeholder: 'السبت – الخميس، 9 ص – 9 م' },
      { key: 'address', label: 'العنوان' },
      { key: 'maps_url', label: 'رابط الموقع على الخريطة', placeholder: 'https://', ltr: true },
    ],
  },
  {
    title: 'التواصل الاجتماعي والسياسات',
    hint: 'روابط https فقط.',
    fields: [
      { key: 'instagram_url', label: 'إنستغرام', placeholder: 'https://', ltr: true },
      { key: 'x_url', label: 'إكس', placeholder: 'https://', ltr: true },
      { key: 'snapchat_url', label: 'سناب شات', placeholder: 'https://', ltr: true },
      { key: 'tiktok_url', label: 'تيك توك', placeholder: 'https://', ltr: true },
      { key: 'linkedin_url', label: 'لينكدإن', placeholder: 'https://', ltr: true },
      { key: 'privacy_url', label: 'سياسة الخصوصية', placeholder: 'https://', ltr: true },
      { key: 'terms_url', label: 'الشروط والأحكام', placeholder: 'https://', ltr: true },
    ],
  },
];

const IMAGES: { key: 'hero_image_url' | 'experience_image_url'; label: string; hint: string }[] = [
  {
    key: 'hero_image_url',
    label: 'صورة الافتتاحية',
    hint: 'صورة حقيقية للشركة أو الخدمة — عمودية يُفضَّل (4:5).',
  },
  {
    key: 'experience_image_url',
    label: 'صورة قسم «تجربة ماسية الشرق»',
    hint: 'أفقية يُفضَّل (5:4).',
  },
];

/**
 * «بيانات الشركة والموقع» (company_profile، 0086): ما تعرضه صفحة الهبوط من تواصل
 * ومعلومات وصور. التعديل لمن يملك settings.manage؛ كل تعديل في سجل التدقيق.
 */
export function CompanyProfileSettings() {
  const { can } = usePermissions();
  const editable = can('settings', 'manage');
  const { data: info, isLoading } = useSiteInfo();
  const save = useSaveCompanyProfile();
  const upload = useUploadSiteImage();
  const toast = useToast();
  const [p, setP] = useState<CompanyProfile>(EMPTY_COMPANY);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (info) setP(info.company);
  }, [info]);

  const error = touched ? companyProfileError(p) : null;
  const dirty = info ? JSON.stringify(info.company) !== JSON.stringify(p) : false;
  const setField = (k: keyof CompanyProfile, raw: string) =>
    setP((x) => ({
      ...x,
      [k]: k === 'founded_year' ? (raw.trim() === '' ? null : Number(raw)) : raw,
    }));

  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-purple">
          هذه البيانات تظهر في صفحة الهبوط العامة. الحقل الفارغ لا يُعرض للزوار.
        </p>
        <a
          href="/site"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:underline"
        >
          <ExternalLink size={15} /> معاينة الصفحة
        </a>
      </Card>

      {GROUPS.map((g) => (
        <Card key={g.title}>
          <h2 className="text-sm font-bold text-navy">{g.title}</h2>
          <p className="mb-4 text-[11px] text-purple">{g.hint}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <div key={f.key}>
                <Input
                  label={f.label}
                  value={p[f.key] === null ? '' : String(p[f.key])}
                  placeholder={f.placeholder}
                  disabled={!editable}
                  dir={f.ltr ? 'ltr' : undefined}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
                {f.hint && <p className="mt-1 text-[11px] text-purple">{f.hint}</p>}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <h2 className="text-sm font-bold text-navy">صور الموقع</h2>
        <p className="mb-4 text-[11px] text-purple">
          بدون صورة يعرض الموقع تصميم «الماسة» الخاص بالهوية. JPG / PNG / WebP حتى 3 ميجابايت.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {IMAGES.map((im) => (
            <div key={im.key} className="rounded-xl border border-navy-100 p-3">
              <p className="text-sm font-medium text-navy-900">{im.label}</p>
              <p className="mb-3 text-[11px] text-purple">{im.hint}</p>
              {p[im.key] ? (
                <img
                  src={p[im.key] ?? ''}
                  alt={im.label}
                  className="mb-3 h-36 w-full rounded-lg object-cover"
                />
              ) : (
                <div className="mb-3 grid h-36 place-items-center rounded-lg bg-navy-50 text-xs text-purple">
                  لا توجد صورة
                </div>
              )}
              {editable && (
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy-50">
                    <ImageUp size={14} /> {p[im.key] ? 'استبدال' : 'رفع صورة'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      aria-label={`رفع ${im.label}`}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        upload.mutate(file, {
                          onSuccess: (url) => setP((x) => ({ ...x, [im.key]: url })),
                          onError: (err) => toast.error(err.message),
                        });
                      }}
                    />
                  </label>
                  {p[im.key] && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setP((x) => ({ ...x, [im.key]: null }))}
                    >
                      <Trash2 size={14} /> إزالة
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {editable && (
        <div className="flex items-center justify-end gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button
            disabled={!dirty}
            loading={save.isPending || upload.isPending}
            onClick={() => {
              setTouched(true);
              if (companyProfileError(p)) return;
              save.mutate(p, {
                onSuccess: () => toast.success('تم حفظ بيانات الشركة — تظهر في الموقع الآن'),
                onError: (e) => toast.error(e.message),
              });
            }}
          >
            <Save size={16} /> حفظ بيانات الشركة
          </Button>
        </div>
      )}
    </div>
  );
}
