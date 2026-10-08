/**
 * ترشيح/مطابقة العاملة بناءً على احتياج الطلب (Prototype) — قابل للتفسير.
 *
 * لا بيانات جديدة: المطابقة تُحسب من نفس ملف العاملة القائم (`worker_profiles`:
 * المهنة، سنوات الخبرة، اللغات، الجنسية، النبذة) ومن مهاراتها المعروضة في
 * الكتالوج (`skillsOf`)، ومن تقييمات العملاء الفعلية فقط (`ratingSummaryOf`)،
 * مقابل احتياج الطلب الذي يدخله العميل في النموذج.
 *
 * كل معيار يُقيَّم بحالة صريحة:
 *   matched — بيانات العاملة تثبت المطابقة.
 *   partial — مطابقة جزئية (مثل خبرة أقل قليلًا من المطلوب).
 *   missing — بيانات العاملة المعروفة تنفي المطابقة (مهنة لا تشمل الخدمة).
 *   unknown — لا توجد بيانات تثبت أو تنفي → لا تُحسب مطابقة إيجابية ولا سلبية في النص.
 *
 * التوفّر شرط مستقل لا يدخل في النسبة: يُقرأ من `isWorkerAvailable`
 * (availability.ts) كما هو، فلا تبدو عاملة محجوزة «مطابقة ٩٥٪ — متاحة».
 *
 * الأوزان مجمّعة في `MATCH_WEIGHTS`، والنسبة = مجموع أوزان المعايير المحققة ÷
 * مجموع أوزان المعايير المنطبقة على هذا الطلب فقط. حدّ الترشيح الأدنى قيمة
 * إدارية تُقرأ من إعدادات النظام (`match_min_score`).
 */
import type { WorkerProfile } from '@/lib/funnel';
import { skillsOf } from '@/features/catalog/lib/catalog';
import { ratingSummaryOf } from '@/features/rating/api/rating.api';
import {
  isWorkerAvailable,
  nextFreeDay,
  type AvailabilityResult,
  type BookedRange,
} from '@/features/catalog/lib/availability';
import { periodDays } from '@/features/requests/lib/period';
import type { PlaceDetails, RequestPeriod } from '@/features/requests/types';
import {
  COMMERCIAL_CODE,
  FACILITY_CODE,
  HOME_CODE,
  OCCASION_BENEFICIARY_CODE,
} from '@/features/requests/types';

/** احتياج الطلب كما يصل من نموذج العميل. */
export interface RequestNeed {
  place: PlaceDetails;
  period: RequestPeriod | null;
  /** تفضيل الجنسية إن حدّده العميل. */
  nationality?: string | undefined;
  /** المهنة المطلوبة إن حدّدها العميل. */
  profession?: string | undefined;
}

export type CriterionStatus = 'matched' | 'partial' | 'missing' | 'unknown';

/** معيار واحد من معايير المطابقة مع سبب حالته. */
export interface MatchCriterion {
  key: string;
  /** اسم المعيار (للعرض المختصر). */
  label: string;
  status: CriterionStatus;
  /** جملة التفسير المعروضة للعميل. */
  detail: string;
  weight: number;
}

export interface MatchResult {
  /** نسبة المطابقة ٠–١٠٠ (لا يدخل فيها التوفّر). */
  score: number;
  /** كل المعايير المنطبقة على الطلب بحالاتها. */
  criteria: MatchCriterion[];
  /** أسباب المطابقة (المعايير المحققة + التوفّر الكامل إن وُجد). */
  reasons: string[];
  /** ما ينقصها مقابل الاحتياج (معايير غير محققة أو جزئية). */
  gaps: string[];
  /** معايير لا توجد عنها بيانات — لا تُحسب لها ولا عليها في النص. */
  unknowns: string[];
  /** نتيجة التوفّر كما هي من `isWorkerAvailable`. */
  availability: AvailabilityResult;
  /** متاحة طوال الفترة المطلوبة (فترة صالحة بلا أي تعارض). */
  available: boolean;
  /** قابلة للاختيار: متاحة بالكامل، أو لم تُحدَّد فترة بعد. */
  eligible: boolean;
  /** أول حجز متعارض إن وُجد. */
  conflict: BookedRange | null;
  /** أقرب تاريخ تتوفّر فيه للمدة نفسها عند التعارض. */
  nextFree: string | null;
}

/**
 * أوزان المعايير (نسبية؛ النسبة النهائية تُطبَّع على المعايير المنطبقة فقط).
 * احتياجات الرعاية تُقسَم بالتساوي على الاحتياجات المختارة.
 */
export const MATCH_WEIGHTS = {
  beneficiaryFit: 20,
  profession: 15,
  nationality: 8,
  careNeeds: 30,
  children: 12,
  elderly: 12,
  experience: 14,
  occasion: 10,
  language: 6,
  rating: 6,
} as const;

/** القيمة الاحتياطية لحدّ الترشيح الأدنى حين لم تُحمّل إعدادات النظام بعد. */
export const MATCH_MIN_SCORE_FALLBACK = 45;

/** درجة كل حالة في النسبة: غير المعروف لا يُحسب مطابقة إيجابية. */
const STATUS_VALUE: Record<CriterionStatus, number> = {
  matched: 1,
  partial: 0.5,
  missing: 0,
  unknown: 0,
};

/** مهن خارج الخدمة المنزلية: احتياجات الرعاية لا تشملها (بيانات معروفة). */
const NON_DOMESTIC_PROFESSIONS = new Set(['سائق']);

/**
 * ما يثبت كل احتياج رعاية: مهنة تشمله أو كلمة في مهاراتها/نبذتها. لا تُفترض
 * رعاية كبار السن أو الحالات الخاصة من المهنة وحدها — تحتاج دليلًا صريحًا.
 */
const CARE_FIT: Record<string, { label: string; professions: string[]; keywords: string[] }> = {
  newborn: {
    label: 'رعاية حديثي الولادة',
    professions: ['مربية أطفال'],
    keywords: ['حديثي الولادة', 'الرضّع'],
  },
  children: {
    label: 'رعاية الأطفال',
    professions: ['مربية أطفال'],
    keywords: ['رعاية الأطفال', 'المتابعة الدراسية', 'الأطفال'],
  },
  elderly: { label: 'رعاية كبار السن', professions: [], keywords: ['كبار السن'] },
  bedridden: { label: 'رعاية طريح الفراش', professions: [], keywords: ['طريح', 'كبار السن'] },
  special_needs: { label: 'رعاية ذوي الاحتياج الخاص', professions: [], keywords: ['احتياج خاص'] },
  cooking: {
    label: 'الطبخ',
    professions: ['طباخة'],
    keywords: ['الطبخ', 'المأكولات', 'الولائم', 'وجبات'],
  },
  cleaning: {
    label: 'التنظيف والترتيب',
    professions: ['عاملة منزلية'],
    keywords: ['التنظيف', 'تنظيم المنزل', 'الغسيل والكي'],
  },
  serving: {
    label: 'الضيافة والتقديم',
    professions: ['طباخة'],
    keywords: ['الولائم', 'الضيافة', 'التقديم'],
  },
};

/** المهن المناسبة لكل نوع مستفيد. */
const BENEFICIARY_FIT: Record<string, { label: string; professions: string[] }> = {
  [HOME_CODE]: { label: 'المنزل', professions: ['عاملة منزلية', 'مربية أطفال', 'طباخة'] },
  [FACILITY_CODE]: { label: 'المنشأة', professions: ['عاملة منزلية', 'طباخة'] },
  [COMMERCIAL_CODE]: { label: 'النشاط التجاري', professions: ['عاملة منزلية', 'طباخة'] },
  [OCCASION_BENEFICIARY_CODE]: { label: 'المناسبة', professions: ['طباخة', 'عاملة منزلية'] },
};

/** نص العاملة القابل للبحث: المهنة + المهارات + النبذة. */
function haystack(w: WorkerProfile): string {
  return [w.profession, w.bio_ar ?? '', ...skillsOf(w).map((s) => s.label)].join(' ');
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** «سنة واحدة» / «سنتان» / «٥ سنوات» / «١٢ سنة». */
function yearsLabel(n: number): string {
  if (n === 1) return 'سنة واحدة';
  if (n === 2) return 'سنتان';
  return `${n} ${n >= 3 && n <= 10 ? 'سنوات' : 'سنة'}`;
}

/** حجم العمل في مكان الخدمة بحسب نوع المستفيد (يُحوَّل لسنوات خبرة مطلوبة). */
function workloadSize(place: PlaceDetails): number | null {
  switch (place.beneficiaryType) {
    case HOME_CODE:
      return (
        place.floors +
        place.rooms / 3 +
        (place.hasChildren === false ? 0 : place.children / 2) +
        (place.hasElderly || place.elderly > 0 ? 1 : 0)
      );
    case FACILITY_CODE:
      return place.sections / 2 + place.guests / 25;
    case COMMERCIAL_CODE:
      return place.branchesCount + place.guests / 30;
    case OCCASION_BENEFICIARY_CODE:
      return place.guests / 40;
    default:
      return null;
  }
}

function criterion(
  key: string,
  label: string,
  weight: number,
  status: CriterionStatus,
  detail: string,
): MatchCriterion {
  return { key, label, weight, status, detail };
}

/** معايير المطابقة المنطبقة على هذا الطلب لعاملة واحدة. */
export function matchCriteria(w: WorkerProfile, need: RequestNeed): MatchCriterion[] {
  const { place } = need;
  const hay = haystack(w);
  const out: MatchCriterion[] = [];
  const nonDomestic = NON_DOMESTIC_PROFESSIONS.has(w.profession);

  // ١) نوع الخدمة / المستفيد — المهنة معروفة دائمًا
  const fit = BENEFICIARY_FIT[place.beneficiaryType];
  if (fit) {
    const ok = fit.professions.includes(w.profession);
    out.push(
      criterion(
        'beneficiary',
        'نوع الخدمة',
        MATCH_WEIGHTS.beneficiaryFit,
        ok ? 'matched' : 'missing',
        ok ? `مناسبة لخدمة ${fit.label}` : `مهنتها (${w.profession}) لا تناسب خدمة ${fit.label}`,
      ),
    );
  }

  // ٢) المهنة والجنسية المطلوبتان — فقط إن حدّدهما العميل
  if (need.profession) {
    const ok = w.profession === need.profession;
    out.push(
      criterion(
        'profession',
        'المهنة',
        MATCH_WEIGHTS.profession,
        ok ? 'matched' : 'missing',
        ok ? `مهنتها ${w.profession} كما طلبت` : `مهنتها ${w.profession} وليست ${need.profession}`,
      ),
    );
  }
  if (need.nationality) {
    const ok = w.nationality === need.nationality;
    out.push(
      criterion(
        'nationality',
        'الجنسية',
        MATCH_WEIGHTS.nationality,
        ok ? 'matched' : 'missing',
        ok ? 'من الجنسية المطلوبة' : `جنسيتها ${w.nationality} وليست ${need.nationality}`,
      ),
    );
  }

  // ٣) احتياجات الرعاية — دليل من المهنة أو المهارات/النبذة، وإلا «لا توجد بيانات»
  const careCodes = place.careNeeds;
  const careWeight = careCodes.length > 0 ? MATCH_WEIGHTS.careNeeds / careCodes.length : 0;
  for (const code of careCodes) {
    const f = CARE_FIT[code];
    const label = f?.label ?? 'احتياج الرعاية المطلوب';
    let status: CriterionStatus;
    let detail: string;
    if (nonDomestic) {
      status = 'missing';
      detail = `مهنتها (${w.profession}) لا تشمل ${label}`;
    } else if (
      f &&
      (f.professions.includes(w.profession) || f.keywords.some((k) => hay.includes(k)))
    ) {
      status = 'matched';
      detail = `لديها خبرة في ${label}`;
    } else {
      status = 'unknown';
      detail = `لا توجد بيانات عن خبرتها في ${label}`;
    }
    out.push(criterion(`care:${code}`, label, careWeight, status, detail));
  }

  if (place.beneficiaryType === HOME_CODE) {
    // ٤) الأطفال — إن وُجدوا ولم يُغطَّ ذلك باحتياج رعاية الأطفال نفسه
    const hasChildren =
      place.hasChildren === true || (place.hasChildren === null && place.children > 0);
    if (hasChildren && !careCodes.some((c) => c === 'children' || c === 'newborn')) {
      const ok = w.profession === 'مربية أطفال' || /الأطفال|الرضّع/.test(hay);
      out.push(
        criterion(
          'children',
          'التعامل مع الأطفال',
          MATCH_WEIGHTS.children,
          nonDomestic ? 'missing' : ok ? 'matched' : 'unknown',
          ok
            ? 'لديها خبرة في التعامل مع الأطفال'
            : nonDomestic
              ? `مهنتها (${w.profession}) لا تشمل رعاية الأطفال`
              : 'لا توجد بيانات عن خبرتها مع الأطفال',
        ),
      );
    }
    // ٥) رعاية كبار السن — فقط إذا كانوا يحتاجون رعاية
    const elderlyCare = place.elderlyCareNeeded === true;
    if (elderlyCare && !careCodes.some((c) => c === 'elderly' || c === 'bedridden')) {
      const ok = hay.includes('كبار السن');
      out.push(
        criterion(
          'elderly',
          'رعاية كبار السن',
          MATCH_WEIGHTS.elderly,
          nonDomestic ? 'missing' : ok ? 'matched' : 'unknown',
          ok
            ? 'لديها خبرة في رعاية كبار السن'
            : nonDomestic
              ? `مهنتها (${w.profession}) لا تشمل رعاية كبار السن`
              : 'لا توجد بيانات عن خبرتها في رعاية كبار السن',
        ),
      );
    }
  }

  // ٦) متطلبات المناسبة — خبرة الولائم والمناسبات
  if (place.beneficiaryType === OCCASION_BENEFICIARY_CODE) {
    const ok = w.profession === 'طباخة' || /الولائم|المناسبات/.test(hay);
    out.push(
      criterion(
        'occasion',
        'خبرة المناسبات',
        MATCH_WEIGHTS.occasion,
        ok ? 'matched' : 'unknown',
        ok ? 'لديها خبرة في تجهيز الولائم والمناسبات' : 'لا توجد بيانات عن خبرتها في المناسبات',
      ),
    );
  }

  // ٧) الخبرة مقابل حجم مكان الخدمة — سنوات الخبرة معروفة دائمًا
  const size = workloadSize(place);
  if (size !== null) {
    const needed = Math.round(clamp01(size / 8) * 8);
    if (needed >= 2) {
      const years = w.experience_years;
      const status: CriterionStatus =
        years >= needed ? 'matched' : years >= needed * 0.6 ? 'partial' : 'missing';
      out.push(
        criterion(
          'experience',
          'الخبرة',
          MATCH_WEIGHTS.experience,
          status,
          status === 'matched'
            ? `خبرتها ${yearsLabel(years)} تكفي حجم مكان الخدمة`
            : `خبرتها ${yearsLabel(years)} أقل من المقترح لحجم المكان (${yearsLabel(needed)})`,
        ),
      );
    }
  }

  // ٨) اللغة العربية — إذا طلبها العميل في ملاحظاته (اللغات معروفة في الملف)
  if (/العربي/.test(place.notes)) {
    const ok = w.languages.includes('العربية');
    out.push(
      criterion(
        'language',
        'اللغة العربية',
        MATCH_WEIGHTS.language,
        ok ? 'matched' : 'missing',
        ok ? 'تجيد العربية كما طلبت' : 'لا تتحدث العربية حسب ملفها',
      ),
    );
  }

  // ٩) تقييم العملاء — فقط من تقييمات فعلية (لا تقدير افتراضي)
  const rating = ratingSummaryOf(w.id);
  if (rating.count > 0) {
    const status: CriterionStatus =
      rating.average >= 4.5 ? 'matched' : rating.average >= 3.5 ? 'partial' : 'missing';
    out.push(
      criterion(
        'rating',
        'تقييم العملاء',
        MATCH_WEIGHTS.rating,
        status,
        `تقييم العملاء ${rating.average.toFixed(1)} من ٥ (${rating.count})`,
      ),
    );
  }

  return out;
}

/** النسبة ٠–١٠٠ من المعايير المنطبقة فقط (حتمية، بلا عشوائية). */
export function scoreOf(criteria: MatchCriterion[]): number {
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  if (total === 0) return 0;
  const earned = criteria.reduce((s, c) => s + c.weight * STATUS_VALUE[c.status], 0);
  return Math.round((earned / total) * 100);
}

/**
 * نسبة مطابقة عاملة واحدة لاحتياج الطلب مع تفسير النتيجة، وتوفّرها للفترة
 * كشرط مستقل (من `isWorkerAvailable` دون إعادة كتابة منطقه).
 */
export function matchWorker(w: WorkerProfile, need: RequestNeed, from?: string): MatchResult {
  const criteria = matchCriteria(w, need);
  const { period } = need;
  const availability = isWorkerAvailable(
    w.id,
    period?.startDate ?? '',
    period?.endDate ?? '',
    from,
  );
  const available = availability.status === 'available';
  const conflict = availability.conflicts[0] ?? null;
  const nextFree = conflict && period ? nextFreeDay(w.id, periodDays(period), from) : null;

  const reasons = criteria.filter((c) => c.status === 'matched').map((c) => c.detail);
  if (available) reasons.push('متاحة طوال فترة الخدمة');

  return {
    score: scoreOf(criteria),
    criteria,
    reasons,
    gaps: criteria
      .filter((c) => c.status === 'missing' || c.status === 'partial')
      .map((c) => c.detail),
    unknowns: criteria.filter((c) => c.status === 'unknown').map((c) => c.detail),
    availability,
    available,
    eligible: available || availability.status === 'unknown',
    conflict,
    nextFree,
  };
}

export interface RankedWorker {
  worker: WorkerProfile;
  match: MatchResult;
}

/** ترتيب التوفّر: القابلة للاختيار أولًا، ثم التعارض الجزئي، ثم غير المتاحة. */
const AVAILABILITY_RANK: Record<AvailabilityResult['status'], number> = {
  available: 0,
  unknown: 0,
  partial: 1,
  unavailable: 2,
};

/**
 * ترتيب المرشّحات: (١) التوفّر للفترة، (٢) نسبة المطابقة، (٣) معرّف العاملة
 * لترتيب ثابت بين كل عرض. لا تتقدّم عاملة غير متاحة على متاحة مهما علت نسبتها.
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
    .sort(
      (a, b) =>
        AVAILABILITY_RANK[a.match.availability.status] -
          AVAILABILITY_RANK[b.match.availability.status] ||
        b.match.score - a.match.score ||
        (a.worker.id < b.worker.id ? -1 : a.worker.id > b.worker.id ? 1 : 0),
    );
}

/** لون شارة نسبة المطابقة. */
export function matchTone(score: number): 'success' | 'gold' | 'neutral' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'gold';
  return 'neutral';
}

export function matchLabel(score: number): string {
  if (score >= 90) return 'مطابقة ممتازة';
  if (score >= 80) return 'مطابقة عالية';
  if (score >= 60) return 'مطابقة جيدة';
  return 'مطابقة جزئية';
}
