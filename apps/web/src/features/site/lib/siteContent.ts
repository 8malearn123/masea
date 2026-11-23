/**
 * نصوص صفحة الهبوط. القاعدة: لا أرقام ولا سياسات ولا ضمانات مختلَقة — كل ما يُذكر
 * إمّا آلية موجودة فعلًا في النظام (عرض سعر مكتوب، عقد إلكتروني، تتبّع برقم الطلب،
 * ملفات العاملات، مسار مساند) أو قيمة مُدارة تأتي من public_site_info (الفروع،
 * حدود الساعات، مدة الضمان). ما لا تتوفّر قيمته لا يُعرض.
 */
import { CalendarClock, CalendarDays, Plane, Sparkles, type LucideIcon } from 'lucide-react';
import type { PublicSiteInfo } from '@/features/site/types';

export const SITE_SERVICE_ORDER = [
  'recruitment',
  'monthly_rental',
  'daily_rental',
  'hourly_rental',
] as const;
export type SiteServiceCode = (typeof SITE_SERVICE_ORDER)[number];

export interface SiteService {
  code: SiteServiceCode;
  title: string;
  kicker: string;
  body: string;
  /** سطر الحقائق تحت الوصف — من البيانات المُدارة فقط */
  fact: (info: PublicSiteInfo) => string | null;
  icon: LucideIcon;
  /** مسار التصفّح في الطلب الإلكتروني القائم */
  browse: string | null;
}

export const hoursRange = (info: PublicSiteInfo): string | null =>
  info.hourly_min_hours && info.hourly_max_hours
    ? `من ${info.hourly_min_hours} إلى ${info.hourly_max_hours} ساعة في الزيارة الواحدة`
    : null;

export const SITE_SERVICES: Record<SiteServiceCode, SiteService> = {
  recruitment: {
    code: 'recruitment',
    title: 'استقدام العمالة المنزلية',
    kicker: 'عاملة باسمك',
    body: 'نستقدم العاملة المنزلية باسمك عبر منصة مساند، ونتابع معك مراحل الاستقدام خطوة بخطوة: التعاقد مع المكتب، اختيار العاملة، التأشيرة، والسفر حتى الوصول.',
    fact: () => 'عقد الاستقدام يُوثَّق على منصة مساند',
    icon: Plane,
    browse: '/order/workers',
  },
  monthly_rental: {
    code: 'monthly_rental',
    title: 'تأجير العمالة المنزلية',
    kicker: 'بعقد شهري مرن',
    body: 'عاملة منزلية جاهزة للعمل بعقد شهري، دون إجراءات استقدام. تختار المدة التي تناسب بيتك، وتطّلع على ملف العاملة وخبرتها قبل التعاقد.',
    fact: () => 'عقد إلكتروني يُوقَّع من الطرفين',
    icon: CalendarDays,
    browse: '/order/workers',
  },
  daily_rental: {
    code: 'daily_rental',
    title: 'التأجير اليومي',
    kicker: 'ليوم أو أيام محددة',
    body: 'خدمة منزلية لأيام محددة — للمناسبات العائلية، والتنظيف العميق، والفترات التي يزدحم فيها البيت.',
    fact: () => 'تحدد الأيام والمهمة، ويصلك عرض السعر مكتوبًا',
    icon: Sparkles,
    browse: null,
  },
  hourly_rental: {
    code: 'hourly_rental',
    title: 'التأجير بالساعة',
    kicker: 'زيارة بموعد',
    body: 'حجز بالساعة لمهمة واحدة: تنظيف، أو رعاية، أو طبخ. تحدد موعد الوصول والانصراف، ونؤكد لك الحجز مع العاملة المتاحة في ذلك الوقت.',
    fact: (info) => hoursRange(info),
    icon: CalendarClock,
    browse: null,
  },
};

/** الخدمات المعروضة: الأربع الرئيسية متى كانت فعّالة في النظام. */
export function visibleServices(info: PublicSiteInfo): SiteService[] {
  const active = new Set(info.services.map((s) => s.code));
  return SITE_SERVICE_ORDER.filter((c) => active.has(c)).map((c) => SITE_SERVICES[c]);
}

export const STEPS: { title: string; body: string }[] = [
  {
    title: 'أرسل طلبك',
    body: 'اسمك وجوالك والخدمة وأقرب فرع — أقل من دقيقة، دون تسجيل حساب.',
  },
  {
    title: 'نتواصل معك',
    body: 'يتصل بك فريق الفرع لفهم احتياج بيتك، ويرشّح لك الخيارات المتاحة.',
  },
  {
    title: 'عرض سعر وعقد واضحان',
    body: 'يصلك عرض سعر مكتوب بالتفاصيل، ثم عقد بالبنود نفسها توقّعه إلكترونيًا.',
  },
  {
    title: 'تبدأ الخدمة',
    body: 'تباشر العاملة في الموعد المتفق عليه، وتتابع طلبك برقمه في أي وقت.',
  },
];

export interface Promise_ {
  title: string;
  body: string;
}

/** «لماذا ماسية الشرق» — ما يحصل عليه العميل فعلًا في النظام. */
export function promises(info: PublicSiteInfo): Promise_[] {
  const list: Promise_[] = [
    {
      title: 'تعرف السعر قبل أن تلتزم',
      body: 'عرض سعر مكتوب يفصّل السعر الأساسي والخصم والضريبة والإجمالي، ومدة صلاحيته محددة.',
    },
    {
      title: 'عقد تقرؤه وتوقّعه إلكترونيًا',
      body: 'بنود العقد تُجمَّد كما وافقت عليها، وتوقيع الطرفين يُوثَّق بالاسم والتاريخ.',
    },
    {
      title: 'ملف واضح لكل عاملة',
      body: 'المهنة والخبرة واللغات وجدول التوفّر — تطّلع عليها قبل أن تختار.',
    },
    {
      title: 'طلبك له رقم ومتابعة',
      body: 'كل طلب برقم مرجعي، وصفحة تتبّع تعرض حالته حتى المباشرة.',
    },
  ];
  if (info.replacement_guarantee_days)
    list.push({
      title: `ضمان استبدال ${info.replacement_guarantee_days} يومًا`,
      body: 'وفق شروط العقد المعتمدة — تُوضَّح لك قبل التوقيع.',
    });
  return list;
}

export interface Faq {
  q: string;
  a: string;
  link?: { to: string; label: string };
}

export function faqs(info: PublicSiteInfo): Faq[] {
  const hours = hoursRange(info);
  const branches = info.branches.length ? info.branches.join(' و') : null;
  const list: Faq[] = [
    {
      q: 'ما الفرق بين الاستقدام والتأجير؟',
      a: 'في الاستقدام تُستقدم العاملة باسمك من بلدها عبر منصة مساند وتكون على كفالتك. في التأجير تعمل لديك عاملة على كفالة الشركة لمدة محددة — شهريًا أو يوميًا أو بالساعة — دون إجراءات استقدام.',
    },
    {
      q: 'كم مدة التأجير بالساعة؟',
      a: hours
        ? `${hours}، تحدد فيها موعد الوصول والانصراف عند الحجز.`
        : 'تحدد موعد الوصول والانصراف عند الحجز، ويؤكد لك الفرع المدة المتاحة.',
    },
    {
      q: 'كيف أعرف السعر؟',
      a: 'يختلف السعر حسب الخدمة والمدة والجنسية أو المهنة والفرع. بعد طلبك يصلك عرض سعر مكتوب يوضح الأساسي والخصم والضريبة والإجمالي قبل أي التزام.',
    },
    {
      q: 'هل أستطيع اختيار العاملة؟',
      a: 'نعم. تصفّح ملفات العاملات المتاحة بالمهنة والخبرة واللغات وجدول التوفّر، أو اطلب أن يرشّح لك الفرع الأنسب.',
      link: { to: '/order/workers', label: 'تصفّح العاملات' },
    },
    {
      q: 'كيف يتم التعاقد والتوقيع؟',
      a: 'عقود التأجير تُوقَّع إلكترونيًا من الطرفين بعد مراجعة بنودها. عقود الاستقدام تُنشأ وتُوقَّع على منصة مساند ونتابعها معك.',
    },
    {
      q: 'كيف أتابع طلبي؟',
      a: 'لكل طلب رقم مرجعي. أدخله في صفحة تتبّع الطلب لتعرف حالته في أي وقت.',
      link: { to: '/order/track', label: 'تتبّع طلبك' },
    },
  ];
  if (branches)
    list.push({
      q: 'أين تقع فروعكم؟',
      a: `نخدمك من فروعنا في ${branches}. اختر أقرب فرع عند إرسال طلبك ليتواصل معك فريقه.`,
    });
  list.push({
    q: 'هل يوجد ضمان؟',
    a: info.replacement_guarantee_days
      ? `يوجد ضمان استبدال لمدة ${info.replacement_guarantee_days} يومًا وفق شروط العقد المعتمدة، وتُوضَّح الشروط قبل التوقيع.`
      : 'شروط الضمان مكتوبة في العقد وتُوضَّح لك قبل التوقيع.',
  });
  return list;
}
