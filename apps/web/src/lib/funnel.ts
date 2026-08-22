/**
 * Customer funnel domain types + offline fallback data.
 *
 * The hooks query Supabase first; if the funnel tables are not yet
 * migrated (or return nothing), these constants keep the public pages
 * presentable. They mirror supabase/migrations/0012_sales_funnel_seed.sql.
 */

export type ServiceCode =
  | 'recruitment'
  | 'monthly_rental'
  | 'daily_rental'
  | 'sponsorship_transfer';

export interface ServiceItem {
  code: ServiceCode | string;
  name_ar: string;
  tagline_ar: string;
  description_ar: string;
  icon: string;
  unit: string;
}

export interface WorkerProfile {
  id: string;
  full_name: string;
  nationality: string;
  profession: string;
  age: number | null;
  experience_years: number;
  languages: string[];
  monthly_salary: number;
  status: string;
  photo_url: string | null;
  bio_ar: string | null;
  religion?: string | null;
  marital_status?: string | null;
  mother_tongue?: string | null;
}

export interface PriceBreakdown {
  base: number;
  vat: number;
  total: number;
}

export const BRANCHES_AR = ['نجران', 'جازان', 'شرورة', 'حبونا'] as const;

export const FALLBACK_SERVICES: ServiceItem[] = [
  {
    code: 'recruitment',
    name_ar: 'استقدام',
    tagline_ar: 'استقدام عمالة منزلية من الخارج',
    description_ar: 'استقدم عاملتك المنزلية بعقد موثّق وإجراءات كاملة حتى الوصول.',
    icon: '🛬',
    unit: 'fixed',
  },
  {
    code: 'monthly_rental',
    name_ar: 'تأجير شهري',
    tagline_ar: 'عاملة بعقد شهري مرن',
    description_ar: 'استأجر عاملة منزلية بعقد شهري قابل للتجديد دون التزامات الاستقدام.',
    icon: '🗓️',
    unit: 'month',
  },
  {
    code: 'daily_rental',
    name_ar: 'تأجير يومي',
    tagline_ar: 'خدمة منزلية ليوم واحد',
    description_ar: 'احجز عاملة لمهمة يومية: تنظيف، طبخ، أو رعاية — بسرعة ومرونة.',
    icon: '🧹',
    unit: 'day',
  },
  {
    code: 'sponsorship_transfer',
    name_ar: 'نقل كفالة',
    tagline_ar: 'نقل كفالة عاملة قائمة',
    description_ar: 'انقل كفالة عاملة حالية إليك بإجراءات نظامية عبر مساند وأبشر.',
    icon: '🔁',
    unit: 'fixed',
  },
];

export const FALLBACK_WORKERS: WorkerProfile[] = [
  {
    id: 'w1',
    full_name: 'ماريا سانتوس',
    nationality: 'الفلبين',
    profession: 'عاملة منزلية',
    age: 32,
    experience_years: 6,
    languages: ['العربية', 'الإنجليزية'],
    monthly_salary: 1500,
    status: 'available',
    photo_url: null,
    bio_ar: 'خبرة في تنظيف المنازل والعناية بالأطفال.',
  },
  {
    id: 'w2',
    full_name: 'غريس ريّس',
    nationality: 'الفلبين',
    profession: 'مربية أطفال',
    age: 29,
    experience_years: 5,
    languages: ['الإنجليزية', 'الفلبينية'],
    monthly_salary: 1600,
    status: 'available',
    photo_url: null,
    bio_ar: 'متخصصة في رعاية الأطفال حديثي الولادة.',
  },
  {
    id: 'w3',
    full_name: 'سيتي نورهاليزا',
    nationality: 'إندونيسيا',
    profession: 'عاملة منزلية',
    age: 35,
    experience_years: 8,
    languages: ['العربية', 'الإندونيسية'],
    monthly_salary: 1400,
    status: 'available',
    photo_url: null,
    bio_ar: 'خبرة طويلة في الأعمال المنزلية والطبخ البسيط.',
  },
  {
    id: 'w4',
    full_name: 'ديوي أنغرايني',
    nationality: 'إندونيسيا',
    profession: 'طباخة',
    age: 38,
    experience_years: 10,
    languages: ['العربية', 'الإندونيسية'],
    monthly_salary: 1700,
    status: 'available',
    photo_url: null,
    bio_ar: 'تجيد المأكولات العربية والآسيوية باحتراف.',
  },
  {
    id: 'w5',
    full_name: 'غريس وانجيرو',
    nationality: 'كينيا',
    profession: 'عاملة منزلية',
    age: 27,
    experience_years: 4,
    languages: ['الإنجليزية', 'السواحيلية'],
    monthly_salary: 1300,
    status: 'available',
    photo_url: null,
    bio_ar: 'نشيطة ومنظّمة، خبرة في تنظيف المنازل.',
  },
  {
    id: 'w6',
    full_name: 'فيث أتيينو',
    nationality: 'كينيا',
    profession: 'مربية أطفال',
    age: 30,
    experience_years: 6,
    languages: ['الإنجليزية', 'السواحيلية'],
    monthly_salary: 1450,
    status: 'available',
    photo_url: null,
    bio_ar: 'صبورة ومحبة للأطفال مع متابعة دراسية.',
  },
  {
    id: 'w7',
    full_name: 'سارة ناكاتو',
    nationality: 'أوغندا',
    profession: 'عاملة منزلية',
    age: 26,
    experience_years: 3,
    languages: ['الإنجليزية'],
    monthly_salary: 1250,
    status: 'available',
    photo_url: null,
    bio_ar: 'مجتهدة وسريعة التعلّم في الأعمال المنزلية.',
  },
  {
    id: 'w8',
    full_name: 'بريندا أكينيي',
    nationality: 'أوغندا',
    profession: 'طباخة',
    age: 33,
    experience_years: 7,
    languages: ['الإنجليزية', 'السواحيلية'],
    monthly_salary: 1550,
    status: 'available',
    photo_url: null,
    bio_ar: 'تتقن الطبخ المنزلي وتجهيز الولائم.',
  },
  {
    id: 'w9',
    full_name: 'روكسانا بيغم',
    nationality: 'بنغلاديش',
    profession: 'عاملة منزلية',
    age: 31,
    experience_years: 5,
    languages: ['العربية', 'البنغالية'],
    monthly_salary: 1300,
    status: 'available',
    photo_url: null,
    bio_ar: 'خبرة في التنظيف والكي والعناية بكبار السن.',
  },
  {
    id: 'w10',
    full_name: 'نسرين أكتر',
    nationality: 'بنغلاديش',
    profession: 'عاملة منزلية',
    age: 28,
    experience_years: 4,
    languages: ['العربية', 'البنغالية'],
    monthly_salary: 1300,
    status: 'available',
    photo_url: null,
    bio_ar: 'دقيقة في تنظيم المنزل والاعتناء بالتفاصيل.',
  },
  {
    id: 'w11',
    full_name: 'نيلوكا فرناندو',
    nationality: 'سريلانكا',
    profession: 'مربية أطفال',
    age: 34,
    experience_years: 9,
    languages: ['الإنجليزية', 'السنهالية'],
    monthly_salary: 1650,
    status: 'available',
    photo_url: null,
    bio_ar: 'خبرة واسعة في رعاية الأطفال والرضّع.',
  },
  {
    id: 'w12',
    full_name: 'راجو كومارا',
    nationality: 'سريلانكا',
    profession: 'سائق',
    age: 40,
    experience_years: 12,
    languages: ['العربية', 'الإنجليزية', 'السنهالية'],
    monthly_salary: 1800,
    status: 'available',
    photo_url: null,
    bio_ar: 'سائق خاص بخبرة طويلة يلتزم بالمواعيد.',
  },
];
