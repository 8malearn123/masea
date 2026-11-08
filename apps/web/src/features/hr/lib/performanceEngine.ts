/**
 * Performance engine (0076) — same rules as perf_auto_scores /
 * save_performance_review / perf_rating, shared by the demo store and screens.
 */
import { z } from 'zod';
import type { PerfAuto, PerfBand, PerfCriterion, PerfCriterionScore } from '@/features/hr/types';

export const PERF_LATE_WEIGHT_KEY = 'perf_late_day_weight';
export const DEFAULT_LATE_WEIGHT = 0.5;

/** Same rows as the 0076 seeds. */
export const DEFAULT_CRITERIA: PerfCriterion[] = [
  {
    code: 'quality',
    name_ar: 'جودة العمل وإتقانه',
    source: 'manual',
    weight: 25,
    roles: [],
    is_active: true,
    sort_order: 1,
  },
  {
    code: 'discipline',
    name_ar: 'الانضباط والالتزام بالدوام',
    source: 'attendance',
    weight: 20,
    roles: [],
    is_active: true,
    sort_order: 2,
  },
  {
    code: 'teamwork',
    name_ar: 'التعاون والعمل الجماعي',
    source: 'manual',
    weight: 15,
    roles: [],
    is_active: true,
    sort_order: 3,
  },
  {
    code: 'customers',
    name_ar: 'خدمة العملاء والتعامل',
    source: 'manual',
    weight: 15,
    roles: [],
    is_active: true,
    sort_order: 4,
  },
  {
    code: 'contracts',
    name_ar: 'تحقيق مستهدف عدد العقود',
    source: 'sales_count',
    weight: 15,
    roles: ['sales', 'call_center', 'branch_manager'],
    is_active: true,
    sort_order: 5,
  },
  {
    code: 'sales_value',
    name_ar: 'تحقيق مستهدف قيمة المبيعات',
    source: 'sales_amount',
    weight: 10,
    roles: ['sales', 'call_center', 'branch_manager'],
    is_active: true,
    sort_order: 6,
  },
];

export const DEFAULT_BANDS: PerfBand[] = [
  { code: 'excellent', name_ar: 'ممتاز', min_score: 90, tone: 'success', is_active: true },
  { code: 'very_good', name_ar: 'جيد جدًا', min_score: 80, tone: 'success', is_active: true },
  { code: 'good', name_ar: 'جيد', min_score: 70, tone: 'gold', is_active: true },
  { code: 'needs', name_ar: 'يحتاج تحسين', min_score: 0, tone: 'danger', is_active: true },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Achieved vs target, capped at 100 — null when there is no target. */
export function ratioScore(achieved: number, target: number): number | null {
  return target > 0 ? Math.min(100, r2((achieved / target) * 100)) : null;
}

/** (present + late × weight) / recorded days — null without attendance. */
export function attendanceScore(
  present: number,
  late: number,
  absent: number,
  lateWeight: number,
): number | null {
  const days = present + late + absent;
  return days > 0 ? r2(((present + late * lateWeight) / days) * 100) : null;
}

/** Criteria that apply to a role (empty roles = everyone), in order. */
export function applicableCriteria(
  criteria: PerfCriterion[],
  role: string | null | undefined,
): PerfCriterion[] {
  return criteria
    .filter((c) => c.is_active && (c.roles.length === 0 || (!!role && c.roles.includes(role))))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The band whose minimum the score reaches (highest first). */
export function bandFor(score: number, bands: PerfBand[]): PerfBand | null {
  return (
    bands
      .filter((b) => b.is_active && b.min_score <= score)
      .sort((a, b) => b.min_score - a.min_score)[0] ?? null
  );
}

type Def = Pick<PerfCriterionScore, 'code' | 'name' | 'source' | 'weight'>;

/** Weighted total exactly as save_performance_review (errors in the same words). */
export function computeReview(
  defs: Def[],
  manual: Record<string, number>,
  auto: PerfAuto,
): { criteria: PerfCriterionScore[]; score: number } {
  if (defs.length === 0) throw new Error('لا توجد معايير تقييم مفعّلة لهذا الدور');
  let sum = 0;
  let weights = 0;
  const criteria = defs.map((d): PerfCriterionScore => {
    let score: number | null;
    let detail: PerfCriterionScore['detail'] = null;
    if (d.source === 'manual') {
      const v = manual[d.code];
      if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`أدخل درجة «${d.name}»`);
      if (v < 0 || v > 100) throw new Error(`درجة «${d.name}» بين 0 و100`);
      score = v;
    } else {
      const a = auto[d.source];
      score = a.score;
      detail = { ...a };
    }
    if (score !== null) {
      sum += d.weight * score;
      weights += d.weight;
    }
    return { ...d, score, detail };
  });
  if (weights === 0) throw new Error('لا توجد درجات كافية لحساب التقييم');
  return { criteria, score: r2(sum / weights) };
}

/** 'YYYY-MM' months touched by a period (targets are monthly). */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = to.slice(0, 7);
  while (d.toISOString().slice(0, 7) <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/* ------------------------------- validation ------------------------------- */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاريخ غير صحيح' });

export const reviewSchema = z
  .object({
    employee_id: z.string().min(1, { message: 'اختر الموظف' }),
    period: z
      .string()
      .trim()
      .min(1, { message: 'حدّد فترة التقييم' })
      .max(40, { message: 'اسم الفترة طويل' }),
    period_from: isoDate,
    period_to: isoDate,
    notes: z.string().max(1000, { message: 'الملاحظات طويلة جدًا' }),
  })
  .refine((r) => r.period_from <= r.period_to, {
    message: 'فترة التقييم غير صحيحة',
    path: ['period_to'],
  });

export const criterionSchema = z.object({
  name_ar: z
    .string()
    .trim()
    .min(1, { message: 'أدخل اسم المعيار' })
    .max(60, { message: 'الاسم طويل جدًا' }),
  weight: z
    .number({ message: 'الوزن رقم' })
    .gt(0, { message: 'الوزن أكبر من صفر' })
    .max(100, { message: 'الوزن حتى 100' }),
});

export const bandSchema = z.object({
  name_ar: z
    .string()
    .trim()
    .min(1, { message: 'أدخل اسم التقدير' })
    .max(40, { message: 'الاسم طويل جدًا' }),
  min_score: z
    .number({ message: 'الحد رقم' })
    .min(0, { message: 'الحد بين 0 و100' })
    .max(100, { message: 'الحد بين 0 و100' }),
});

export const targetSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'الشهر غير صحيح' }),
  contracts_target: z
    .number({ message: 'رقم' })
    .int({ message: 'عدد صحيح' })
    .min(0, { message: 'لا يكون سالبًا' }),
  sales_amount_target: z.number({ message: 'رقم' }).min(0, { message: 'لا يكون سالبًا' }),
});

export function firstError(r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string | null {
  return r.success ? null : (r.error?.issues[0]?.message ?? 'بيانات غير صحيحة');
}
