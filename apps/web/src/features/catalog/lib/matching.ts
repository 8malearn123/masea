/**
 * ترشيح/مطابقة العاملة بناءً على احتياج الطلب (Prototype).
 *
 * لا بيانات جديدة: المطابقة تُحسب من نفس ملف العاملة القائم (`worker_profiles`)
 * ومن إثراء الكتالوج الموجود (`skillsOf` / `ratingOf`) ومن جدول التوفّر
 * (`availability.ts`)، مقابل احتياج الطلب الذي يدخله العميل في النموذج.
 *
 * الأوزان مجمّعة في `MATCH_WEIGHTS` (مجموعها ١٠٠) وقابلة للضبط من مكان واحد،
 * وحدّ الترشيح الأدنى قيمة إدارية تُقرأ من إعدادات النظام (`match_min_score`).
 */
import type { WorkerProfile } from '@/lib/funnel';
import { ratingOf, skillsOf } from '@/features/catalog/lib/catalog';
import { conflictFor, nextFreeDay, type BookedRange } from '@/features/catalog/lib/availability';
import { periodDays } from '@/features/requests/lib/period';
import type { PlaceDetails, RequestPeriod } from '@/features/requests/types';
import { isOccasion } from '@/features/requests/types';

/** احتياج الطلب كما يصل من نموذج العميل. */
export interface RequestNeed {
  place: PlaceDetails;
  period: RequestPeriod | null;
  /** تفضيل الجنسية إن حدّده العميل. */
  nationality?: string | undefined;
  /** المهنة المطلوبة إن حدّدها العميل. */
  profession?: string | undefined;
}

export interface MatchResult {
  /** نسبة المطابقة ٠–١٠٠. */
  score: number;
  /** ما يجعل العاملة مناسبة لهذا الطلب. */
  reasons: string[];
  /** ما ينقصها مقابل الاحتياج. */
  gaps: string[];
  /** متاحة في المدة المطلوبة. */
  available: boolean;
  /** الحجز المتعارض إن وُجد. */
  conflict: BookedRange | null;
  /** أقرب تاريخ تتوفّر فيه عند التعارض. */
  nextFree: string | null;
}

/** أوزان معايير المطابقة — مجموعها ١٠٠. */
export const MATCH_WEIGHTS = {
  careNeeds: 28,
  beneficiaryFit: 20,
  workload: 14,
  household: 14,
  availability: 16,
  quality: 8,
} as const;

/** القيمة الاحتياطية لحدّ الترشيح الأدنى حين لم تُحمّل إعدادات النظام بعد. */
export const MATCH_MIN_SCORE_FALLBACK = 45;

/** ما يُناسب كل احتياج رعاية من مهن ومهارات. */
const CARE_FIT: Record<string, { professions: string[]; keywords: string[] }> = {
  newborn: { professions: ['مربية أطفال'], keywords: ['حديثي الولادة', 'رعاية الأطفال', 'الرضّع'] },
  children: {
    professions: ['مربية أطفال'],
    keywords: ['رعاية الأطفال', 'المتابعة الدراسية', 'الأطفال'],
  },
  elderly: { professions: ['عاملة منزلية'], keywords: ['كبار السن', 'العناية'] },
  bedridden: { professions: ['عاملة منزلية'], keywords: ['كبار السن', 'العناية'] },
  special_needs: { professions: ['مربية أطفال', 'عاملة منزلية'], keywords: ['رعاية', 'العناية'] },
  cooking: {
    professions: ['طباخة'],
    keywords: ['الطبخ', 'المأكولات', 'الحلويات', 'الولائم', 'وجبات'],
  },
  cleaning: {
    professions: ['عاملة منزلية'],
    keywords: ['التنظيف', 'تنظيم المنزل', 'الغسيل والكي', 'الكي'],
  },
  serving: { professions: ['عاملة منزلية', 'طباخة'], keywords: ['تنظيم', 'الطبخ', 'التنظيف'] },
};

/** المهن المناسبة لكل نوع مستفيد. */
const BENEFICIARY_FIT: Record<string, string[]> = {
  home: ['عاملة منزلية', 'مربية أطفال', 'طباخة'],
  facility: ['عاملة منزلية', 'طباخة'],
  commercial: ['عاملة منزلية', 'طباخة'],
  occasion: ['طباخة', 'عاملة منزلية'],
};

/** نص العاملة القابل للبحث: المهنة + المهارات + النبذة. */
function haystack(w: WorkerProfile): string {
  return [w.profession, w.bio_ar ?? '', ...skillsOf(w).map((s) => s.label)].join(' ');
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** تغطية احتياجات الرعاية المطلوبة (٠–١). */
function careCoverage(w: WorkerProfile, needs: string[]): { ratio: number; missing: string[] } {
  if (needs.length === 0) return { ratio: 1, missing: [] };
  const hay = haystack(w);
  const missing: string[] = [];
  let covered = 0;
  for (const code of needs) {
    const fit = CARE_FIT[code];
    if (!fit) {
      covered += 0.5; // احتياج أضافه الإداري ولم تُعرَّف له مطابقة بعد
      continue;
    }
    const byProfession = fit.professions.includes(w.profession);
    const byKeyword = fit.keywords.some((k) => hay.includes(k));
    if (byProfession && byKeyword) covered += 1;
    else if (byProfession || byKeyword) covered += 0.6;
    else missing.push(code);
  }
  return { ratio: clamp01(covered / needs.length), missing };
}

/** حجم العمل المطلوب مقابل خبرة العاملة (٠–١). */
function workloadFit(w: WorkerProfile, place: PlaceDetails): number {
  const size =
    place.floors + place.rooms / 3 + place.children / 2 + place.elderly + place.guests / 60;
  const neededExperience = clamp01(size / 8) * 8; // ٠–٨ سنوات
  if (neededExperience <= 1) return 1;
  return clamp01(w.experience_years / neededExperience);
}

/** ملاءمة العاملة لتركيبة الأسرة (أطفال/كبار سن). */
function householdFit(w: WorkerProfile, place: PlaceDetails): { ratio: number; notes: string[] } {
  const hay = haystack(w);
  const notes: string[] = [];
  const parts: number[] = [];
  if (place.children > 0) {
    const good = w.profession === 'مربية أطفال' || hay.includes('الأطفال');
    parts.push(good ? 1 : 0.35);
    if (good) notes.push('خبرة في التعامل مع الأطفال');
  }
  if (place.elderlyCareNeeded || place.elderly > 0) {
    const good = hay.includes('كبار السن') || w.experience_years >= 5;
    parts.push(good ? 1 : 0.35);
    if (good) notes.push('مؤهّلة لرعاية كبار السن');
  }
  if (parts.length === 0) return { ratio: 1, notes };
  return { ratio: parts.reduce((a, b) => a + b, 0) / parts.length, notes };
}

/**
 * نسبة مطابقة عاملة واحدة لاحتياج الطلب مع تفسير النتيجة.
 * عدم التوفّر في المدة المطلوبة لا يُلغي العاملة بل يخفض درجتها ويُظهر
 * أقرب تاريخ متاح — القرار للعميل.
 */
export function matchWorker(w: WorkerProfile, need: RequestNeed, from?: string): MatchResult {
  const { place, period } = need;
  const reasons: string[] = [];
  const gaps: string[] = [];

  const care = careCoverage(w, place.careNeeds);
  if (place.careNeeds.length > 0) {
    if (care.ratio >= 0.8) reasons.push('تغطي احتياجات الرعاية المطلوبة');
    else if (care.missing.length > 0) gaps.push('لا تغطي كل احتياجات الرعاية المطلوبة');
  }

  const fitProfessions = BENEFICIARY_FIT[place.beneficiaryType] ?? [];
  let beneficiary =
    fitProfessions.length === 0 ? 0.7 : fitProfessions.includes(w.profession) ? 1 : 0.4;
  if (need.profession)
    beneficiary = w.profession === need.profession ? 1 : Math.min(beneficiary, 0.5);
  if (isOccasion(place.beneficiaryType) && w.profession === 'طباخة') {
    beneficiary = 1;
    reasons.push('مناسبة لخدمة المناسبات والولائم');
  } else if (beneficiary >= 1) {
    reasons.push('مهنتها مطابقة لنوع المستفيد');
  } else if (beneficiary <= 0.5) {
    gaps.push('مهنتها أقل ملاءمة لنوع المستفيد المطلوب');
  }

  const workload = workloadFit(w, place);
  if (workload >= 0.9 && (place.rooms >= 5 || place.floors >= 2 || place.guests >= 50)) {
    reasons.push('خبرتها تكفي حجم مكان الخدمة');
  } else if (workload < 0.6) {
    gaps.push('خبرتها أقل من حجم مكان الخدمة');
  }

  const household = householdFit(w, place);
  reasons.push(...household.notes);
  if (household.ratio < 0.6) gaps.push('خبرتها المعلنة لا تشمل تركيبة الأسرة المطلوبة');

  const conflict = period ? conflictFor(w.id, period.startDate, period.endDate, from) : null;
  const available = conflict === null;
  const nextFree =
    conflict && period
      ? nextFreeDay(w.id, periodDays(period), from)
      : period
        ? period.startDate
        : null;
  if (period) {
    if (available) reasons.push('متاحة في المدة المطلوبة بالكامل');
    else gaps.push('جدولها محجوز في جزء من المدة المطلوبة');
  }

  const rating = ratingOf(w);
  const quality = clamp01((rating - 4) / 1) * 0.6 + clamp01(w.experience_years / 10) * 0.4;
  if (rating >= 4.7) reasons.push(`تقييم مرتفع ${rating.toFixed(1)} من ٥`);

  if (need.nationality && w.nationality === need.nationality) {
    reasons.push('من الجنسية المطلوبة');
  }

  const score =
    care.ratio * MATCH_WEIGHTS.careNeeds +
    beneficiary * MATCH_WEIGHTS.beneficiaryFit +
    workload * MATCH_WEIGHTS.workload +
    household.ratio * MATCH_WEIGHTS.household +
    (available ? 1 : 0) * MATCH_WEIGHTS.availability +
    quality * MATCH_WEIGHTS.quality;

  return {
    score: Math.round(score),
    reasons,
    gaps,
    available,
    conflict,
    nextFree,
  };
}

export interface RankedWorker {
  worker: WorkerProfile;
  match: MatchResult;
}

/**
 * ترتيب المرشّحات: الأعلى مطابقة أولًا، والمتاحة قبل المحجوزة عند التساوي.
 * `minScore` يُستبعد ما تحته (قيمة إدارية من الإعدادات).
 */
export function rankWorkers(
  workers: WorkerProfile[],
  need: RequestNeed,
  minScore = MATCH_MIN_SCORE_FALLBACK,
  from?: string,
): RankedWorker[] {
  return workers
    .map((worker) => ({ worker, match: matchWorker(worker, need, from) }))
    .filter((r) => r.match.score >= minScore)
    .sort((a, b) => {
      if (a.match.available !== b.match.available) return a.match.available ? -1 : 1;
      return b.match.score - a.match.score;
    });
}

/** لون شارة نسبة المطابقة. */
export function matchTone(score: number): 'success' | 'gold' | 'neutral' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'gold';
  return 'neutral';
}

export function matchLabel(score: number): string {
  if (score >= 80) return 'مطابقة عالية';
  if (score >= 60) return 'مطابقة جيدة';
  return 'مطابقة جزئية';
}
