/** رمز الخصم فريد بلا حساسية لحالة الأحرف (uq_promotions_code) ويُخزَّن بحروف كبيرة. */
import { describe, expect, it } from 'vitest';
import {
  createPromotion,
  listPromotions,
  updatePromotion,
} from '@/features/pricing/api/promotions.api';

const base = {
  name: 'خصم عملاء شرورة',
  code: null as string | null,
  description: null,
  discount_pct: 8,
  discount_amount: null,
  service_codes: [],
  min_base_amount: null,
  max_discount_amount: null,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  is_active: true,
  requires_code: false,
};

describe('رمز الخصم', () => {
  it('رمز مكرر (حتى بحروف صغيرة) مرفوض برسالة واضحة', async () => {
    const existing = (await listPromotions()).find((p) => p.code)!;
    await expect(createPromotion({ ...base, code: existing.code!.toLowerCase() })).rejects.toThrow(
      'مستخدم لخصم آخر',
    );
  });

  it('الرمز يُخزَّن بحروف كبيرة، وتعديل الخصم نفسه برمزه لا يُعدّ تكرارًا', async () => {
    const p = await createPromotion({ ...base, code: ' srr-8 ' });
    expect(p.code).toBe('SRR-8');
    await expect(
      updatePromotion(p.id, { code: 'srr-8', name: 'خصم شرورة' }),
    ).resolves.toBeUndefined();
    const other = (await listPromotions()).find((x) => x.code && x.id !== p.id)!;
    await expect(updatePromotion(p.id, { code: other.code! })).rejects.toThrow('مستخدم لخصم آخر');
  });
});
