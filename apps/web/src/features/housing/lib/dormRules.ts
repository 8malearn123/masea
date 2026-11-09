import { z } from 'zod';
import type { Dorm, HousingSupervisor } from '@/features/housing/types';

/**
 * قواعد السكن — مرآة الواجهة لحارسي `guard_housing_dorm` و`guard_worker_dorm` (0081).
 * الخادم هو المرجع؛ هنا لرسائل فورية في النموذج ولمخزن العرض التجريبي.
 */
export const dormSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(1, 'اسم السكن مطلوب'),
  branch: z.string().min(1, 'اختر الفرع'),
  capacity: z.number().int('السعة عدد صحيح').positive('السعة أكبر من صفر').nullable(),
  supervisor_id: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
});
export type DormInput = z.infer<typeof dormSchema>;

export function dormInputOf(d: Dorm): DormInput {
  return {
    id: d.id,
    name: d.name,
    branch: d.branch,
    capacity: d.capacity,
    supervisor_id: d.supervisor_id,
    notes: d.notes,
    is_active: d.is_active,
  };
}

/** أول خطأ في حفظ سكن، أو `null`. `current` = السكن قبل التعديل (null للجديد). */
export function dormChangeError(
  input: DormInput,
  ctx: {
    current: Dorm | null;
    others: Pick<Dorm, 'id' | 'name'>[];
    supervisors: HousingSupervisor[];
  },
): string | null {
  const parsed = dormSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'بيانات غير صالحة';
  const name = input.name.trim();
  if (ctx.others.some((o) => o.id !== input.id && o.name.trim() === name)) {
    return `يوجد سكن باسم «${name}»`;
  }
  if (input.supervisor_id) {
    const sup = ctx.supervisors.find((s) => s.id === input.supervisor_id);
    if (!sup || (sup.branch && sup.branch !== input.branch)) {
      return 'المشرفة يجب أن تكون مستخدمة نشطة بدور «مشرفة السكن» من فرع السكن';
    }
  }
  const cur = ctx.current;
  if (cur) {
    const occ = cur.occupied;
    if (cur.is_active && !input.is_active && occ > 0) {
      return `لا يمكن تعطيل السكن وفيه ${occ} عاملة: انقل العاملات أولًا`;
    }
    if (input.capacity !== null && input.capacity < occ) {
      return `السعة (${input.capacity}) أقل من عدد المقيمات الحالي (${occ})`;
    }
    if (input.branch !== cur.branch && occ > 0) return 'لا يمكن نقل السكن لفرع آخر وفيه عاملات';
  }
  return null;
}

/** هل يقبل السكن عاملة جديدة من هذا الفرع؟ `null` = يقبل. */
export function dormAssignError(dorm: Dorm | undefined, workerBranch: string): string | null {
  if (!dorm) return 'السكن غير موجود';
  if (!dorm.is_active) return `السكن «${dorm.name}» معطّل: اختر سكنًا آخر`;
  if (dorm.branch && workerBranch && dorm.branch !== workerBranch) {
    return `السكن «${dorm.name}» من فرع آخر: اختر سكنًا من فرع العاملة`;
  }
  if (dorm.capacity !== null && dorm.occupied >= dorm.capacity) {
    return `السكن «${dorm.name}» ممتلئ (${dorm.occupied} من ${dorm.capacity})`;
  }
  return null;
}
