import { useState } from 'react';
import { z } from 'zod';
import { Ticket } from 'lucide-react';
import { Button, Input, Modal, Select } from '@/shared/ui';
import { useAddCampaign, useUpdateCampaign } from '@/features/loyalty/hooks/useLoyalty';
import { generateCampaignCoupon } from '@/features/loyalty/api/loyalty.api';
import { CAMPAIGN_TYPE_LABEL, type Campaign, type CampaignType } from '@/features/loyalty/types';

const TYPE_OPTS = (Object.entries(CAMPAIGN_TYPE_LABEL) as [CampaignType, string][]).map(
  ([value, label]) => ({ value, label }),
);

/** ISO ↔ حقل تاريخ (YYYY-MM-DD). */
const toDateInput = (iso: string): string => (iso ? iso.slice(0, 10) : '');
const toIso = (d: string): string => (d ? `${d}T00:00:00Z` : '');

const schema = z
  .object({
    name: z.string().trim().min(2, 'اسم الحملة قصير جداً'),
    type: z.enum(['discount', 'cashback', 'seasonal', 'referral']),
    discount_pct: z.number().min(0, 'النسبة غير صالحة').max(100, 'النسبة لا تتجاوز 100'),
    start_at: z.string().min(1, 'تاريخ البداية مطلوب'),
    end_at: z.string().min(1, 'تاريخ النهاية مطلوب'),
    is_active: z.boolean(),
    coupon_code: z.string().nullable(),
  })
  .refine((v) => v.end_at >= v.start_at, {
    message: 'تاريخ النهاية قبل البداية',
    path: ['end_at'],
  });

export function CampaignFormModal({
  campaign,
  open,
  onClose,
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
}) {
  const add = useAddCampaign();
  const update = useUpdateCampaign();
  const editing = Boolean(campaign);

  const [name, setName] = useState(campaign?.name ?? '');
  const [type, setType] = useState<CampaignType>(campaign?.type ?? 'discount');
  const [discount, setDiscount] = useState(String(campaign?.discount_pct ?? 10));
  const [startAt, setStartAt] = useState(toDateInput(campaign?.start_at ?? ''));
  const [endAt, setEndAt] = useState(toDateInput(campaign?.end_at ?? ''));
  const [isActive, setIsActive] = useState(campaign?.is_active ?? true);
  const [coupon, setCoupon] = useState(campaign?.coupon_code ?? '');
  const [error, setError] = useState<string | null>(null);

  const busy = add.isPending || update.isPending;

  function submit() {
    const parsed = schema.safeParse({
      name: name.trim(),
      type,
      discount_pct: Number(discount) || 0,
      start_at: toIso(startAt),
      end_at: toIso(endAt),
      is_active: isActive,
      coupon_code: coupon.trim() ? coupon.trim() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'تحقّق من الحقول');
      return;
    }
    setError(null);
    if (editing && campaign) {
      update.mutate({ id: campaign.id, patch: parsed.data }, { onSuccess: onClose });
    } else {
      add.mutate(parsed.data, { onSuccess: onClose });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'تعديل حملة' : 'حملة تسويقية جديدة'}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">اسم الحملة</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: عرض العودة للمدارس"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">النوع</label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as CampaignType)}
              options={TYPE_OPTS}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">نسبة الخصم (٪)</label>
            <Input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">تاريخ البداية</label>
            <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-navy-900">تاريخ النهاية</label>
            <Input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-navy">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-navy"
          />
          حملة نشطة
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-navy-900">كود الكوبون</label>
          <div className="flex gap-2">
            <Input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
              placeholder="MAS-DISC15-XXXX"
              className="num"
            />
            <Button
              variant="outline"
              onClick={() => setCoupon(generateCampaignCoupon(type, Number(discount) || 0))}
            >
              <Ticket size={15} /> توليد
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-purple">
            يُبنى الكوبون مباشرة ويُمنح للعملاء ضمن هذه الحملة.
          </p>
        </div>

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {editing ? 'حفظ' : 'إضافة'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
