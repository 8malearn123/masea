import type { Rating } from '@/features/rating/types';

const RATINGS: Rating[] = [
  {
    id: 'rt1',
    customer_name: 'محمد الأحمدي',
    target_type: 'worker',
    target_name: 'ماريا سانتوس',
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
];

export async function listRatings(): Promise<Rating[]> {
  return RATINGS;
}
