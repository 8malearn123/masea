import type { Rating, RatingSummary } from '@/features/rating/types';

const RATINGS: Rating[] = [
  {
    id: 'rt1',
    customer_name: 'محمد الأحمدي',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
    worker_id: 'w1',
    stars: 5,
    comment: 'عاملة ممتازة ومتعاونة جدًا',
    created_at: '2026-06-12T10:00:00Z',
  },
  {
    id: 'rt2',
    customer_name: 'سارة القحطاني',
    target_type: 'service',
    target_name: 'الاستقدام',
    stars: 4,
    comment: 'الخدمة جيدة لكن المباشرة تأخرت قليلًا',
    created_at: '2026-06-11T18:00:00Z',
  },
  {
    id: 'rt3',
    customer_name: 'فهد العنزي',
    target_type: 'driver',
    target_name: 'سعيد المطيري',
    stars: 5,
    comment: 'سائق ملتزم بالمواعيد',
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
    created_at: '2026-06-10T20:15:00Z',
  },
  {
    id: 'rt5',
    customer_name: 'عبدالله الدوسري',
    target_type: 'branch',
    target_name: 'فرع نجران',
    stars: 5,
    comment: 'تعامل راقٍ من الموظفين',
    created_at: '2026-06-10T12:00:00Z',
  },
  {
    id: 'rt6',
    customer_name: 'هند المالكي',
    target_type: 'service',
    target_name: 'التأجير الشهري',
    stars: 2,
    comment: 'تأخر في الرد على الاستفسارات',
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
    created_at: '2026-06-08T16:40:00Z',
  },
  {
    id: 'rt8',
    customer_name: 'ريم الحارثي',
    target_type: 'driver',
    target_name: 'سعيد المطيري',
    stars: 4,
    comment: 'مهذب ومتعاون',
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
    created_at: '2026-09-20T10:00:00Z',
  },
];

const newest = (a: Rating, b: Rating) => (a.created_at < b.created_at ? 1 : -1);

export async function listRatings(): Promise<Rating[]> {
  return [...RATINGS].sort(newest);
}

/** تقييمات وتعليقات عاملة واحدة — الأحدث أولًا. */
export async function listWorkerReviews(workerId: string): Promise<Rating[]> {
  return RATINGS.filter((r) => r.worker_id === workerId).sort(newest);
}

/** ملخّص تقييمات عاملة (متوسّط + عدد + توزيع) — يُحسب من السجلات نفسها، بلا تخزين مكرّر. */
export function ratingSummaryOf(workerId: string): RatingSummary {
  const rows = RATINGS.filter((r) => r.worker_id === workerId);
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

/** تقييم سابق لنفس (الطلب + العاملة) إن وُجد. */
export function findRequestReview(requestNo: string, workerId: string): Rating | null {
  return RATINGS.find((r) => r.request_no === requestNo && r.worker_id === workerId) ?? null;
}

let reviewSeq = 1;

/**
 * حفظ تقييم عاملة في المخزن (Prototype). التحقق ومنع التكرار في خدمة التقييمات
 * (`services/reviewService.ts`) — لا يُستدعى هذا مباشرة من الواجهة.
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
    created_at: new Date().toISOString(),
    request_no: input.requestNo,
  };
  RATINGS.unshift(row);
  return row;
}
