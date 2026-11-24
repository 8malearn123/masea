import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { Badge, Input, Select, Skeleton } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useSources } from '@/features/settings/hooks/useSettings';
import { useCampaigns } from '@/features/loyalty/hooks/useLoyalty';
import { customerOfferMessages } from '@/features/marketing/api/whatsapp.api';
import {
  getCustomerAcquisition,
  noteRequired,
  sourceLabelOf,
  type Acquisition,
} from '@/features/marketing/api/attribution.api';

/** ما تجمعه خطوة «العميل» — يُرسل مع إنشاء العقد ولا يدخل نصّه. */
export interface MarketingDraft {
  acquisition_source_code: string;
  acquisition_source_note: string;
  first_contact_at: string;
  source_code: string;
  source_note: string;
  campaign_id: string;
  /** رسالة عرض واتساب أُرسلت لهذا العميل وأدت للعقد (علاقة موثّقة — 0102) */
  campaign_message_id?: string | undefined;
}
export const EMPTY_MARKETING: MarketingDraft = {
  acquisition_source_code: '',
  acquisition_source_note: '',
  first_contact_at: '',
  source_code: '',
  source_note: '',
  campaign_id: '',
};

export function useCustomerAcquisition(customerId: string | null | undefined) {
  return useQuery({
    queryKey: ['marketing', 'acquisition', customerId],
    queryFn: () => getCustomerAcquisition(customerId ?? ''),
    enabled: Boolean(customerId),
  });
}

/** أول خطأ في البيانات التسويقية، أو null. */
export function marketingError(
  m: MarketingDraft,
  existing: Acquisition | null,
  sources: { code: string; requires_note?: boolean }[],
): string | null {
  const s = sources.map((x) => ({ ...x, name_ar: '', is_active: true, sort_order: 0 }));
  if (!existing) {
    if (!m.acquisition_source_code) return 'حدّد مصدر العميل الأصلي (كيف عرف الشركة)';
    if (noteRequired(s, m.acquisition_source_code) && m.acquisition_source_note.trim().length < 2)
      return 'وضّح مصدر العميل الأصلي';
  }
  if (!m.source_code) return 'حدّد مصدر العقد الحالي';
  if (noteRequired(s, m.source_code) && m.source_note.trim().length < 2) return 'وضّح مصدر العقد';
  return null;
}

/**
 * «البيانات التسويقية» في خطوة العميل: مصدر الاكتساب الأصلي من ملف العميل (أو
 * يُسجَّل الآن إن لم يكن مسجّلاً)، ومصدر العقد والحملة مستقلان، والموظف والفرع
 * وتاريخ أول تواصل. تُحفظ مع العقد ولا تظهر في نص العقد أو ملف PDF.
 */
export function MarketingSection({
  customerId,
  branch,
  value,
  onChange,
}: {
  customerId: string;
  branch: string;
  value: MarketingDraft;
  onChange: (m: MarketingDraft) => void;
}) {
  const { fullName } = usePermissions();
  const { data: sources = [] } = useSources();
  const { data: campaigns = [] } = useCampaigns();
  const acq = useCustomerAcquisition(customerId);
  const active = sources.filter((s) => s.is_active);
  const opts = [
    { value: '', label: 'اختر…' },
    ...active.map((s) => ({ value: s.code, label: s.name_ar })),
  ];
  const existing = acq.data ?? null;
  const set = (p: Partial<MarketingDraft>) => onChange({ ...value, ...p });

  // مصدر العقد يبدأ بمصدر الاكتساب ويبقى قابلاً للتغيير
  useEffect(() => {
    const base = existing?.source_code ?? value.acquisition_source_code;
    if (!value.source_code && base) onChange({ ...value, source_code: base });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per customer/source
  }, [existing?.source_code, value.acquisition_source_code]);

  const offers = useQuery({
    queryKey: ['marketing', 'customer-offers', customerId],
    queryFn: () => customerOfferMessages(customerId),
  });
  const liveCampaigns = campaigns.filter((c) => c.is_active || c.id === value.campaign_id);

  return (
    <section className="mt-5 rounded-xl border border-navy-100 p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-navy">
        <Megaphone size={16} /> البيانات التسويقية
      </h3>
      <p className="mb-3 text-[11px] text-purple">
        تُحفظ مع العقد للتقارير — لا تظهر في نص العقد ولا في ملف PDF المرسل للعميل.
      </p>
      {acq.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {existing ? (
            <div className="rounded-xl bg-navy-50 p-3 text-sm">
              <p className="text-xs text-purple">مصدر العميل الأصلي (من ملفه)</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 font-semibold text-navy">
                {sourceLabelOf(sources, existing.source_code)}
                {existing.source_note && (
                  <span className="text-xs font-normal">— {existing.source_note}</span>
                )}
                <Badge tone="navy">ثابت</Badge>
              </p>
              {existing.first_contact_at && (
                <p className="mt-1 text-[11px] text-purple">
                  أول تواصل <span className="num">{dateAr(existing.first_contact_at)}</span>
                </p>
              )}
            </div>
          ) : (
            <>
              <Select
                label="مصدر العميل الأصلي (إلزامي)"
                value={value.acquisition_source_code}
                onChange={(e) => set({ acquisition_source_code: e.target.value })}
                options={opts}
              />
              {noteRequired(sources, value.acquisition_source_code) && (
                <Input
                  label="توضيح المصدر الأصلي"
                  value={value.acquisition_source_note}
                  onChange={(e) => set({ acquisition_source_note: e.target.value })}
                />
              )}
              <Input
                label="تاريخ أول تواصل"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={value.first_contact_at}
                onChange={(e) => set({ first_contact_at: e.target.value })}
              />
            </>
          )}
          <Select
            label="مصدر العقد الحالي"
            value={value.source_code}
            onChange={(e) => set({ source_code: e.target.value })}
            options={opts}
          />
          {noteRequired(sources, value.source_code) && (
            <Input
              label="توضيح مصدر العقد"
              value={value.source_note}
              onChange={(e) => set({ source_note: e.target.value })}
            />
          )}
          {(offers.data ?? []).length > 0 && (
            <Select
              label="عرض واتساب أُرسل للعميل (إن كان سبب العقد)"
              value={value.campaign_message_id ?? ''}
              onChange={(e) => {
                const o = (offers.data ?? []).find((x) => x.id === e.target.value);
                set({ campaign_message_id: o?.id, ...(o ? { campaign_id: o.campaign_id } : {}) });
              }}
              options={[
                { value: '', label: 'لا علاقة بعرض مرسل' },
                ...(offers.data ?? []).map((o) => ({
                  value: o.id,
                  label: `${o.campaign_name} — ${o.offer_text ?? ''} (${o.created_at.slice(0, 10)})`,
                })),
              ]}
            />
          )}
          <Select
            label="الحملة التسويقية المرتبطة"
            value={value.campaign_id}
            disabled={Boolean(value.campaign_message_id)}
            onChange={(e) => set({ campaign_id: e.target.value })}
            options={[
              { value: '', label: 'بدون حملة' },
              ...liveCampaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-navy-50 p-3 text-xs">
            <div>
              <dt className="text-purple">الموظف المسؤول</dt>
              <dd className="font-semibold text-navy">{fullName}</dd>
            </div>
            <div>
              <dt className="text-purple">الفرع</dt>
              <dd className="font-semibold text-navy">{branch || 'غير محدد'}</dd>
            </div>
          </dl>
        </div>
      )}
      {!existing && !acq.isLoading && (
        <p className="mt-2 text-[11px] text-gold-600">
          لا يوجد مصدر مسجّل لهذا العميل — يُسجَّل في ملفه مرة واحدة مع هذا العقد.
        </p>
      )}
    </section>
  );
}
