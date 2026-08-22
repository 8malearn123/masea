/**
 * Local knowledge base for the call-center policy assistant. A lightweight
 * keyword matcher (no external service) so agents can pull the right policy
 * text instantly and attach it to the call notes.
 */
export interface Policy {
  id: string;
  category: string;
  title: string;
  answer: string;
  keywords: string[];
}

export const POLICIES: Policy[] = [
  {
    id: 'trial',
    category: 'الاستبدال',
    title: 'فترة التجربة والاستبدال',
    answer:
      'يحق للعميل طلب استبدال العاملة خلال فترة التجربة (٩٠ يوماً من تاريخ المباشرة) في حال عدم الكفاءة أو عدم التوافق، دون رسوم إضافية ومرة واحدة. يُقدَّم الطلب عبر مركز الاتصال ويُعالَج خلال ٥ أيام عمل.',
    keywords: ['استبدال', 'تبديل', 'تجربة', 'غير كفؤة', 'ما تنفع', 'تغيير العاملة', '90', 'تسعين'],
  },
  {
    id: 'refund',
    category: 'المالية',
    title: 'سياسة استرجاع المبالغ',
    answer:
      'يُسترجع المبلغ كاملاً إذا لم تتم المباشرة خلال المدة المتفق عليها بسبب المكتب. بعد المباشرة يُحتسب الاسترجاع بحسب الأيام المتبقية مخصوماً منها رسوم الخدمة الفعلية. مدة المعالجة ١٤ يوم عمل للتحويل البنكي.',
    keywords: ['استرجاع', 'استرداد', 'فلوس', 'مبلغ', 'إلغاء', 'استرجع', 'تعويض'],
  },
  {
    id: 'delay',
    category: 'العمليات',
    title: 'تأخر مباشرة العاملة',
    answer:
      'عند تأخر المباشرة عن الموعد المتفق عليه، يُفتح بلاغ بأولوية عالية ويُحوَّل لقسم العمليات. يُعوَّض العميل عن كل يوم تأخير من مدة العقد، ويُبلَّغ بموعد بديل خلال ٤٨ ساعة.',
    keywords: ['تأخر', 'تأخير', 'ما باشرت', 'متأخرة', 'موعد', 'مباشرة', 'وصول'],
  },
  {
    id: 'warranty',
    category: 'الضمان',
    title: 'الضمان وما يشمله',
    answer:
      'يشمل الضمان استبدال العاملة في حال الهروب أو الانقطاع عن العمل أو عدم اللياقة الطبية خلال فترة الضمان (سنتان للاستقدام). لا يشمل الضمان سوء معاملة العاملة من قِبل العميل.',
    keywords: ['ضمان', 'هروب', 'هربت', 'مرضت', 'لياقة', 'انقطاع', 'كفالة الضمان'],
  },
  {
    id: 'transfer',
    category: 'القانوني',
    title: 'نقل الكفالة',
    answer:
      'يتم نقل الكفالة إلكترونياً عبر منصة «مساند» بعد سداد الرسوم وموافقة الطرفين. تستغرق العملية ٣ إلى ٥ أيام عمل، ويشترط ألا يكون على العاملة بلاغ تغيب.',
    keywords: ['نقل', 'كفالة', 'مساند', 'تنازل', 'نقل كفالة'],
  },
  {
    id: 'monthly',
    category: 'الخدمات',
    title: 'التأجير الشهري',
    answer:
      'التأجير الشهري عقد مرن يبدأ من شهر واحد قابل للتجديد. تشمل القيمة الإقامة والتأمين وراتب العاملة. يُشترط إشعار قبل ٧ أيام لإنهاء أو تجديد العقد.',
    keywords: ['تأجير', 'شهري', 'إيجار', 'تجديد', 'عقد شهري'],
  },
  {
    id: 'complaint',
    category: 'الجودة',
    title: 'تصعيد الشكاوى',
    answer:
      'تُسجَّل الشكوى وتُصنَّف بأولوية عالية، ويتواصل مشرف الجودة خلال ٢٤ ساعة. إذا لم تُحل خلال ٣ أيام تُصعَّد لإدارة العمليات مع تعويض مناسب حسب الحالة.',
    keywords: ['شكوى', 'تصعيد', 'زعلان', 'مشكلة', 'سيئة', 'تذمر', 'غير راضٍ'],
  },
];

/** Rank policies by keyword overlap with the query. Returns best matches. */
export function searchPolicies(query: string): Policy[] {
  const q = query.trim();
  if (!q) return [];
  const scored = POLICIES.map((p) => {
    const hits = p.keywords.filter((k) => q.includes(k)).length + (q.includes(p.title) ? 2 : 0);
    return { p, hits };
  })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.p);
}
