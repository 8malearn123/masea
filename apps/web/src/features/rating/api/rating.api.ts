import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isIgnorableWriteError } from '@/shared/lib/demoBackend';
import {
  isPublished,
  type ModerationAction,
  type Rating,
  type RatingSummary,
  type ReviewStatus,
} from '@/features/rating/types';

const RATINGS: Rating[] = [
  {
    id: 'rt1',
    customer_name: 'محمد الأحمدي',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'عاملة ممتازة ومتعاونة جدًا',
    status: 'approved',
    created_at: '2026-06-12T10:00:00Z',
  },
  {
    id: 'rt2',
    customer_name: 'سارة القحطاني',
    target_type: 'service',
    target_name: 'الاستقدام',
    stars: 4,
    comment: 'الخدمة جيدة لكن المباشرة تأخرت قليلًا',
    status: 'approved',
    created_at: '2026-06-11T18:00:00Z',
  },
  {
    id: 'rt3',
    customer_name: 'فهد العنزي',
    target_type: 'driver',
    target_name: 'سعيد المطيري',
    stars: 5,
    comment: 'سائق ملتزم بالمواعيد',
    status: 'approved',
    created_at: '2026-06-11T09:30:00Z',
  },
  {
    id: 'rt4',
    customer_name: 'نورة الشهري',
    target_type: 'worker',
    target_name: 'سيتي نورهاليزا',
    worker_id: 'w3',
    stars: 3,
    comment: 'أداء متوسط',
    status: 'approved',
    created_at: '2026-06-10T20:15:00Z',
  },
  {
    id: 'rt5',
    customer_name: 'عبدالله الدوسري',
    target_type: 'branch',
    target_name: 'فرع نجران',
    stars: 5,
    comment: 'تعامل راقٍ من الموظفين',
    status: 'approved',
    created_at: '2026-06-10T12:00:00Z',
  },
  {
    id: 'rt6',
    customer_name: 'هند المالكي',
    target_type: 'service',
    target_name: 'التأجير الشهري',
    stars: 2,
    comment: 'تأخر في الرد على الاستفسارات',
    status: 'approved',
    created_at: '2026-06-09T14:00:00Z',
  },
  {
    id: 'rt7',
    customer_name: 'تركي السبيعي',
    target_type: 'worker',
    target_name: 'غريس وانجيرو',
    worker_id: 'w5',
    stars: 4,
    comment: 'جيدة في الأعمال المنزلية',
    status: 'approved',
    created_at: '2026-06-08T16:40:00Z',
  },
  {
    id: 'rt8',
    customer_name: 'ريم الحارثي',
    target_type: 'driver',
    target_name: 'سعيد المطيري',
    stars: 4,
    comment: 'مهذب ومتعاون',
    status: 'approved',
    created_at: '2026-06-08T08:00:00Z',
  },
  {
    id: 'rt9',
    customer_name: 'أمل الشهراني',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'نظيفة ومرتّبة، وتعاملها مع الأطفال ممتاز.',
    status: 'approved',
    created_at: '2026-07-02T09:10:00Z',
  },
  {
    id: 'rt10',
    customer_name: 'خالد بن يحيى',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 4,
    comment: 'ملتزمة بالمواعيد، وتحتاج وقتًا للتأقلم مع المطبخ السعودي.',
    status: 'approved',
    created_at: '2026-06-24T17:30:00Z',
  },
  {
    id: 'rt11',
    customer_name: 'منيرة آل مفرح',
    target_type: 'worker',
    target_name: 'غريس ريّس',
    worker_id: 'w2',
    stars: 5,
    comment: 'خبرتها مع الرضّع واضحة، والوالدة ارتاحت لها من أول يوم.',
    status: 'approved',
    created_at: '2026-08-05T11:00:00Z',
  },
  {
    id: 'rt12',
    customer_name: 'سلطان الوادعي',
    target_type: 'worker',
    target_name: 'غريس ريّس',
    worker_id: 'w2',
    stars: 4,
    comment: 'متعاونة، لكن نتمنى تحسّن لغتها العربية.',
    status: 'approved',
    created_at: '2026-07-19T08:45:00Z',
  },
  {
    id: 'rt13',
    customer_name: 'حصة اليامي',
    target_type: 'worker',
    target_name: 'سيتي نورهاليزا',
    worker_id: 'w3',
    stars: 4,
    comment: 'شغلها في تنظيم البيت ممتاز، والطبخ مقبول.',
    status: 'approved',
    created_at: '2026-08-12T15:20:00Z',
  },
  {
    id: 'rt14',
    customer_name: 'ماجد الحارثي',
    target_type: 'worker',
    target_name: 'ديوي أنغرايني',
    worker_id: 'w4',
    stars: 5,
    comment: 'جهّزت وليمة لستين شخصًا بإتقان — ننصح بها للمناسبات.',
    status: 'approved',
    created_at: '2026-09-02T19:00:00Z',
  },
  {
    id: 'rt15',
    customer_name: 'لطيفة القحطاني',
    target_type: 'worker',
    target_name: 'ديوي أنغرايني',
    worker_id: 'w4',
    stars: 5,
    comment: 'حلوياتها ممتازة والتقديم منظّم.',
    status: 'approved',
    created_at: '2026-08-21T20:10:00Z',
  },
  {
    id: 'rt16',
    customer_name: 'بدر المنجومي',
    target_type: 'worker',
    target_name: 'فيث أتيينو',
    worker_id: 'w6',
    stars: 5,
    comment: 'صبورة جدًا مع الأطفال وتتابع واجباتهم.',
    status: 'approved',
    created_at: '2026-07-28T16:00:00Z',
  },
  {
    id: 'rt17',
    customer_name: 'نوف آل سالم',
    target_type: 'worker',
    target_name: 'روكسانا بيغم',
    worker_id: 'w9',
    stars: 4,
    comment: 'اعتنت بوالدي خلال فترة النقاهة باهتمام.',
    status: 'approved',
    created_at: '2026-09-08T10:25:00Z',
  },
  {
    id: 'rt18',
    customer_name: 'عهود الصيعري',
    target_type: 'worker',
    target_name: 'نيلوكا فرناندو',
    worker_id: 'w11',
    stars: 5,
    comment: 'خبرتها مع حديثي الولادة أراحتنا كثيرًا.',
    status: 'approved',
    created_at: '2026-09-11T07:40:00Z',
  },
  {
    id: 'rt19',
    customer_name: 'عبدالرحمن الزهراني',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'منظّمة جدًا، والبيت صار مرتّبًا من أول أسبوع.',
    status: 'approved',
    created_at: '2026-08-14T13:00:00Z',
  },
  {
    id: 'rt20',
    customer_name: 'وعد السلمي',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'تتعامل مع الأطفال بلطف وتلتزم بتعليمات الأم.',
    status: 'approved',
    created_at: '2026-08-28T18:20:00Z',
  },
  {
    id: 'rt21',
    customer_name: 'فيصل القرني',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 4,
    comment: '',
    status: 'approved',
    created_at: '2026-09-05T09:00:00Z',
  },
  {
    id: 'rt22',
    customer_name: 'جواهر العتيبي',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'ممتازة في التنظيف والكي، وأمينة.',
    status: 'approved',
    created_at: '2026-09-15T16:45:00Z',
  },
  {
    id: 'rt23',
    customer_name: 'مشعل آل منصور',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'تجربة ثانية معها وكانت أفضل من الأولى.',
    status: 'approved',
    created_at: '2026-09-22T11:10:00Z',
  },
  {
    id: 'rt24',
    customer_name: 'أروى الغامدي',
    target_type: 'worker',
    target_name: 'ديوي أنغرايني',
    worker_id: 'w4',
    stars: 4,
    comment: 'أكلها لذيذ، تحتاج وقتًا إضافيًا في الولائم الكبيرة.',
    status: 'approved',
    created_at: '2026-09-18T20:30:00Z',
  },
  {
    id: 'rt25',
    customer_name: 'سعود اليامي',
    target_type: 'worker',
    target_name: 'سيتي نورهاليزا',
    worker_id: 'w3',
    stars: 3,
    comment: 'تحتاج متابعة في التفاصيل، لكنها متعاونة.',
    status: 'approved',
    created_at: '2026-09-20T10:00:00Z',
  },
  // في قائمة المراجعة — لم تُنشر بعد (لا يظهر أي تعليق للزوار قبل موافقة الإدارة)
  {
    id: 'rt26',
    customer_name: 'فيصل آل منصور',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 2,
    status: 'pending',
    comment: 'تأخرت المباشرة يومين عن الموعد المتفق عليه.',
    created_at: '2026-10-20T13:15:00Z',
  },
  {
    id: 'rt27',
    customer_name: 'جواهر العسيري',
    target_type: 'service',
    target_name: 'التأجير اليومي',
    stars: 5,
    status: 'pending',
    comment: 'خدمة سريعة في جازان، والعاملة وصلت في الوقت.',
    created_at: '2026-10-22T09:40:00Z',
  },
  {
    id: 'rt28',
    customer_name: 'زائر',
    target_type: 'worker',
    target_name: 'غريس ريّس',
    worker_id: 'w2',
    stars: 1,
    status: 'rejected',
    moderation_note: 'تعليق مسيء وغير مرتبط بالخدمة.',
    comment: 'تواصل معي على الرقم ٠٥٠٠٠٠٠٠٠٠ لعروض أرخص',
    created_at: '2026-10-18T22:05:00Z',
  },
];

const newest = (a: Rating, b: Rating) => (a.created_at < b.created_at ? 1 : -1);

const COLUMNS =
  'id, customer_name, target_type, target_name, worker_id, stars, comment, status, moderation_note, moderated_at, deleted_at, created_at';

/** Backend read (RLS returns only approved rows to visitors) — null → use the demo store. */
async function fetchRatings(workerId?: string): Promise<Rating[] | null> {
  try {
    let q = supabase.from('ratings').select(COLUMNS).order('created_at', { ascending: false });
    if (workerId) q = q.eq('worker_id', workerId);
    const { data, error } = await q;
    if (!error && data && data.length > 0) return data as Rating[];
  } catch {
    /* fall through */
  }
  return null;
}

/** Admin moderation queue — every review incl. pending / rejected / deleted. */
export async function listRatings(): Promise<Rating[]> {
  return (await fetchRatings()) ?? RATINGS.map((r) => ({ ...r })).sort(newest);
}

/** تقييمات وتعليقات عاملة واحدة المنشورة فقط (الموافَق عليها) — الأحدث أولًا. */
export async function listWorkerReviews(workerId: string): Promise<Rating[]> {
  const rows = (await fetchRatings(workerId)) ?? RATINGS.filter((r) => r.worker_id === workerId);
  return rows
    .filter(isPublished)
    .map((r) => ({ ...r }))
    .sort(newest);
}

/** ملخّص تقييمات عاملة (متوسّط + عدد + توزيع) — من التقييمات المنشورة فقط، بلا تخزين مكرّر. */
export function ratingSummaryOf(workerId: string): RatingSummary {
  const rows = RATINGS.filter((r) => r.worker_id === workerId && isPublished(r));
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  rows.forEach((r) => {
    distribution[r.stars] = (distribution[r.stars] ?? 0) + 1;
  });
  const average =
    rows.length === 0
      ? null
      : Math.round((rows.reduce((sum, r) => sum + r.stars, 0) / rows.length) * 10) / 10;
  return { count: rows.length, average, distribution };
}

/**
 * تقييم سابق لنفس (الطلب + العاملة) إن وُجد — بأي حالة مراجعة (قيد المراجعة أو
 * مرفوض يمنع تقييمًا ثانيًا لنفس الطلب). المحذوف (تعطيل) لا يُحتسب.
 */
export function findRequestReview(requestNo: string, workerId: string): Rating | null {
  return (
    RATINGS.find((r) => r.request_no === requestNo && r.worker_id === workerId && !r.deleted_at) ??
    null
  );
}

let reviewSeq = 1;

/**
 * حفظ تقييم عاملة في المخزن (Prototype). التحقق ومنع التكرار في خدمة التقييمات
 * (`services/reviewService.ts`) — لا يُستدعى هذا مباشرة من الواجهة.
 * يُحفظ «قيد المراجعة» دائماً ولا يظهر للزوار حتى توافق عليه الإدارة.
 */
export function insertWorkerReview(input: {
  workerId: string;
  workerName: string;
  customerName: string;
  stars: number;
  comment: string;
  requestNo: string;
}): Rating {
  const row: Rating = {
    id: `rt-new-${reviewSeq++}`,
    customer_name: input.customerName,
    target_type: 'worker',
    target_name: input.workerName,
    worker_id: input.workerId,
    stars: input.stars,
    comment: input.comment,
    status: 'pending',
    created_at: new Date().toISOString(),
    request_no: input.requestNo,
  };
  RATINGS.unshift(row);
  return { ...row };
}

/** The resulting status after a moderation action (pure — mirrors moderate_rating()). */
export function applyModeration(r: Rating, action: ModerationAction, note?: string): Rating {
  const status: ReviewStatus =
    action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : action === 'pending'
          ? 'pending'
          : r.status;
  const deleted_at =
    action === 'delete'
      ? new Date().toISOString()
      : action === 'restore'
        ? null
        : (r.deleted_at ?? null);
  return {
    ...r,
    status,
    deleted_at,
    moderation_note: note?.trim() ? note.trim() : (r.moderation_note ?? null),
    moderated_at: new Date().toISOString(),
  };
}

/** Approve / reject / hold / delete (soft) / restore a review — audited in the backend. */
export async function moderateRating(
  id: string,
  action: ModerationAction,
  note?: string,
): Promise<void> {
  const local = RATINGS.find((r) => r.id === id);
  if (local) Object.assign(local, applyModeration(local, action, note));
  if (isDemoId(id)) return;
  const { error } = await supabase.rpc('moderate_rating', {
    p_rating_id: id,
    p_action: action,
    p_note: note ?? null,
  });
  if (error && !isIgnorableWriteError(error.message)) throw new Error(error.message);
}
