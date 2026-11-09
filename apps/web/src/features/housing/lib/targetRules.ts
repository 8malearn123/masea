import { z } from 'zod';
import type { HousingTarget } from '@/features/housing/types';

/** قواعد مستهدف السكن — مرآة guard_housing_target (0083). */
const pctField = (label: string) =>
  z
    .number({ error: `${label} مطلوب` })
    .int(`${label} عدد صحيح`)
    .min(0, `${label} بين 0 و100`)
    .max(100, `${label} بين 0 و100`);

export const housingTargetSchema = z.object({
  id: z.string().nullable(),
  supervisor_id: z.string().min(1, 'اختر المشرفة'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  occupancy_target_pct: pctField('مستهدف الإشغال'),
  attendance_target_pct: pctField('مستهدف الحضور'),
  notes: z.string().nullable(),
  is_active: z.boolean(),
});
export type HousingTargetInput = z.infer<typeof housingTargetSchema>;

export function targetInputOf(t: HousingTarget): HousingTargetInput {
  return {
    id: t.id,
    supervisor_id: t.supervisor_id,
    month: t.month,
    year: t.year,
    occupancy_target_pct: t.occupancy_target_pct,
    attendance_target_pct: t.attendance_target_pct,
    notes: t.notes,
    is_active: t.is_active,
  };
}

/** أول خطأ، أو `null`. `sameMonth` = مستهدفات الشهر نفسه (مستهدف واحد لكل مشرفة). */
export function targetChangeError(
  input: HousingTargetInput,
  sameMonth: Pick<HousingTarget, 'id' | 'supervisor_id' | 'month' | 'year'>[],
): string | null {
  const parsed = housingTargetSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'بيانات غير صالحة';
  const dup = sameMonth.some(
    (t) =>
      t.id !== input.id &&
      t.supervisor_id === input.supervisor_id &&
      t.month === input.month &&
      t.year === input.year,
  );
  return dup ? 'لهذه المشرفة مستهدف لهذا الشهر — عدّله بدل إضافة جديد' : null;
}
