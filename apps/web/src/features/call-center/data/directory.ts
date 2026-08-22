import type { CallStatus } from '@/features/call-center/types';

export interface DirectoryWorker {
  name: string;
  nationality: string;
  profession: string;
  contract_no: string;
  status: string;
}

export interface CustomerHistoryItem {
  date: string;
  topic: string;
  status: CallStatus;
}

export interface DirectoryCustomer {
  phone: string;
  name: string;
  segment: string;
  city: string;
  member_since: string;
  loyalty_points: number;
  open_contracts: number;
  worker: DirectoryWorker | null;
  history: CustomerHistoryItem[];
  /** اهتمامات العميل (الخدمات التي يهتم بها) — تُلتقط عند إنشاء حساب جديد. */
  interests?: string[];
}

/** Demo CRM directory — keyed by phone. Mirrors the call-center seed customers. */
const DIRECTORY: DirectoryCustomer[] = [
  {
    phone: '0501234567',
    name: 'محمد الأحمدي',
    segment: 'عميل أفراد',
    city: 'نجران',
    member_since: '2023-05-10',
    loyalty_points: 540,
    open_contracts: 1,
    worker: {
      name: 'ماريا سانتوس',
      nationality: 'الفلبين',
      profession: 'عاملة منزلية',
      contract_no: 'MAS-2026-00001',
      status: 'على رأس العمل',
    },
    history: [
      { date: '2026-05-02', topic: 'استفسار عن تجديد العقد', status: 'resolved' },
      { date: '2026-03-18', topic: 'طلب فاتورة ضريبية', status: 'resolved' },
    ],
  },
  {
    phone: '0552345678',
    name: 'سارة القحطاني',
    segment: 'عميل مميّز',
    city: 'جازان',
    member_since: '2022-11-01',
    loyalty_points: 1280,
    open_contracts: 2,
    worker: {
      name: 'سيتي نورهاليزا',
      nationality: 'إندونيسيا',
      profession: 'عاملة منزلية',
      contract_no: 'MAS-2026-00002',
      status: 'تأجير شهري',
    },
    history: [
      { date: '2026-06-01', topic: 'تمديد التأجير الشهري', status: 'in_progress' },
      { date: '2026-04-22', topic: 'شكوى تأخر مباشرة', status: 'resolved' },
      { date: '2026-02-10', topic: 'استبدال عاملة', status: 'resolved' },
    ],
  },
  {
    phone: '0533456789',
    name: 'فهد العنزي',
    segment: 'عميل أفراد',
    city: 'شرورة',
    member_since: '2024-01-15',
    loyalty_points: 210,
    open_contracts: 0,
    worker: {
      name: 'غريس وانجيرو',
      nationality: 'كينيا',
      profession: 'خدمة يومية',
      contract_no: 'MAS-2026-00003',
      status: 'منتهٍ',
    },
    history: [{ date: '2026-05-30', topic: 'طلب معاودة اتصال', status: 'callback' }],
  },
  {
    phone: '0544567890',
    name: 'نورة الشهري',
    segment: 'عميل أفراد',
    city: 'نجران',
    member_since: '2023-09-20',
    loyalty_points: 760,
    open_contracts: 1,
    worker: {
      name: 'نيلوكا فرناندو',
      nationality: 'سريلانكا',
      profession: 'عاملة منزلية',
      contract_no: 'MAS-2026-00004',
      status: 'بانتظار المباشرة',
    },
    history: [
      { date: '2026-06-11', topic: 'شكوى تأخر مباشرة العاملة', status: 'in_progress' },
      { date: '2026-05-15', topic: 'استفسار عن موعد الوصول', status: 'resolved' },
    ],
  },
  {
    phone: '0500001111',
    name: 'عبدالله الدوسري',
    segment: 'عميل شركات',
    city: 'حبونا',
    member_since: '2021-07-01',
    loyalty_points: 3400,
    open_contracts: 4,
    worker: null,
    history: [
      { date: '2026-06-11', topic: 'تأكيد موعد خدمة يومية', status: 'resolved' },
      { date: '2026-05-28', topic: 'عقد خدمات دورية', status: 'resolved' },
    ],
  },
];

/** Normalize to the last 9 digits for forgiving matches (+966 / 0 prefixes). */
function digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-9);
}

export function lookupCustomer(phone: string): DirectoryCustomer | null {
  const key = digits(phone);
  if (key.length < 9) return null;
  return DIRECTORY.find((c) => digits(c.phone) === key) ?? null;
}

export function listDirectory(): DirectoryCustomer[] {
  return DIRECTORY.map((c) => ({ ...c, history: [...c.history] }));
}

/**
 * Create a customer account keyed by phone (رقم الجوال) with their interests
 * (اهتماماته). If a customer already exists for that number, returns it as-is.
 * Session-persistent like the calls store — becomes findable by lookupCustomer.
 */
export function createDirectoryCustomer(input: {
  phone: string;
  name: string;
  city?: string;
  interests?: string[];
}): DirectoryCustomer {
  const existing = lookupCustomer(input.phone);
  if (existing) return existing;
  const customer: DirectoryCustomer = {
    phone: input.phone.trim(),
    name: input.name.trim(),
    segment: 'عميل جديد',
    city: input.city?.trim() || '—',
    member_since: new Date().toISOString().slice(0, 10),
    loyalty_points: 0,
    open_contracts: 0,
    worker: null,
    history: [],
    ...(input.interests?.length ? { interests: input.interests } : {}),
  };
  DIRECTORY.unshift(customer);
  return customer;
}
