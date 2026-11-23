import { sar } from '@/shared/lib/format';
import { contractTermUnit, inferTermCount } from '@/features/contracts/lib/contractTerm';
import type { ContractServiceCode } from '@/features/contracts/types';

/**
 * بيانات تعبئة عقد التأجير — كلها من النظام (العقد، العميل، العاملة، ملف
 * الشركة، المدفوعات). لا قيمة هنا مكتوبة في الكود: الشركة من
 * `contract_company_profile()`، والسعر من `calc_price` المحفوظ في العقد.
 */
export interface CompanyProfile {
  name: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  mol_license_no: string;
  phone: string;
  mobile: string;
  address: string;
  email: string;
}

export interface RentalContractSource {
  contract: {
    contract_no: string | null;
    /** تاريخ تحرير العقد (issue_date ثم created_at). */
    issued_on: string;
    service_code: ContractServiceCode | null;
    start_date: string | null;
    end_date: string | null;
    base_amount: number;
    vat_amount: number;
    total_amount: number;
    amount_paid: number;
    notes?: string | null | undefined;
    work_location?: string | null | undefined;
  };
  customer: {
    full_name: string;
    national_id?: string | null | undefined;
    phone?: string | null | undefined;
    mobile?: string | null | undefined;
    address?: string | null | undefined;
    city?: string | null | undefined;
  };
  worker: {
    full_name: string;
    nationality?: string | null | undefined;
    phone?: string | null | undefined;
    passport_no?: string | null | undefined;
    iqama_no?: string | null | undefined;
  } | null;
  company: CompanyProfile;
  employee_mobile?: string | null | undefined;
  payments: { paid_at: string; amount: number; method: string }[];
  /** وصف بند الخدمة في جدول الصفحة الأولى (اسم الخدمة/الباقة). */
  service_label: string;
}

export interface RentalLineItem {
  service: string;
  unit: string;
  qty: number;
  /** «الإجمالي» في الأصل = المبلغ قبل الضريبة. */
  amount: string;
  vat: string;
  /** «الصافي» في الأصل = المبلغ شامل الضريبة. */
  net: string;
}

export interface RentalContractData {
  fields: Record<string, string>;
  items: RentalLineItem[];
  payments: { date: string; amount: string; method: string }[];
  /** للـ QR (ZATCA Phase-1): */
  qr: { sellerName: string; vatNumber: string; timestamp: string; total: number; vat: number };
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** yyyy-mm-dd (أول 10 أحرف من أي طابع زمني). */
function isoDay(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : '';
}

/** dd-mm-yyyy — الصيغة المستعملة في متن العقد الأصلي. */
export function dmy(v: string | null | undefined): string {
  const d = isoDay(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, day] = d.split('-');
  return `${day}-${m}-${y}`;
}

export function weekdayAr(v: string | null | undefined): string {
  const d = isoDay(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? '';
}

/** «1 يوم» / «3 شهر» — بنفس صيغة الأصل. */
export function durationLabel(
  service: ContractServiceCode | null,
  start: string | null,
  end: string | null,
): string {
  const unit = contractTermUnit(service);
  const n = inferTermCount(service, start, end);
  if (!unit || n === null) return '';
  return `${n} ${unit === 'day' ? 'يوم' : 'شهر'}`;
}

export function buildRentalContractData(src: RentalContractSource): RentalContractData {
  const { contract: c, customer, worker, company } = src;
  const remaining = Math.max(0, Math.round((c.total_amount - c.amount_paid) * 100) / 100);
  const unit = contractTermUnit(c.service_code);
  const qty = inferTermCount(c.service_code, c.start_date, c.end_date) ?? 1;
  // العنوان ثم المدينة — دون تكرار المدينة إن كانت ضمن العنوان
  const address =
    customer.address && customer.city && customer.address.includes(customer.city)
      ? customer.address
      : [customer.address, customer.city].filter(Boolean).join(' - ');

  const fields: Record<string, string> = {
    contract_no: c.contract_no ?? '',
    contract_date: dmy(c.issued_on),
    contract_date_iso: isoDay(c.issued_on),
    contract_weekday: weekdayAr(c.issued_on),
    company_name: company.name,
    company_name_en: company.name_en,
    company_vat: company.vat_number,
    company_cr: company.cr_number,
    company_mol_license: company.mol_license_no,
    company_mobile: company.mobile,
    company_phone: company.phone,
    company_address: company.address,
    company_email: company.email,
    employee_mobile: src.employee_mobile ?? '',
    customer_name: customer.full_name,
    customer_id_no: customer.national_id ?? '',
    customer_phone: customer.phone ?? '',
    customer_mobile: customer.mobile ?? customer.phone ?? '',
    customer_address: address,
    work_location: c.work_location ?? '',
    worker_name: worker?.full_name ?? '',
    worker_phone: worker?.phone ?? '',
    worker_nationality: worker?.nationality ?? '',
    worker_doc_no: worker?.iqama_no || worker?.passport_no || '',
    duration: durationLabel(c.service_code, c.start_date, c.end_date),
    start_date: dmy(c.start_date),
    end_date: dmy(c.end_date),
    total: sar(c.total_amount),
    paid: sar(c.amount_paid),
    remaining: sar(remaining),
    notes: c.notes ?? '',
  };

  return {
    fields,
    items: [
      {
        service: src.service_label,
        unit: unit === 'day' ? 'يوم' : unit === 'month' ? 'شهر' : '',
        qty,
        amount: sar(c.base_amount),
        vat: sar(c.vat_amount),
        net: sar(c.total_amount),
      },
    ],
    payments: src.payments.map((p) => ({
      date: p.paid_at.replace('T', ' ').slice(0, 19),
      amount: sar(p.amount),
      method: p.method,
    })),
    qr: {
      sellerName: company.name,
      vatNumber: company.vat_number,
      timestamp: c.issued_on,
      total: c.total_amount,
      vat: c.vat_amount,
    },
  };
}

/** أسماء الحقول المتغيّرة كما تظهر في معاينة القالب (بدل القيم). */
export const FIELD_LABEL: Record<string, string> = {
  contract_no: 'رقم العقد',
  contract_date: 'تاريخ العقد',
  contract_date_iso: 'تاريخ العقد',
  contract_weekday: 'اليوم',
  company_name: 'اسم الشركة',
  company_name_en: 'اسم الشركة بالإنجليزية',
  company_vat: 'الرقم الضريبي',
  company_cr: 'السجل التجاري',
  company_mol_license: 'رقم ترخيص الوزارة',
  company_mobile: 'جوال الشركة',
  company_phone: 'هاتف الشركة',
  company_address: 'عنوان الشركة',
  company_email: 'بريد الشركة',
  employee_mobile: 'جوال الموظف',
  customer_name: 'اسم العميل',
  customer_id_no: 'رقم هوية العميل',
  customer_phone: 'هاتف العميل',
  customer_mobile: 'جوال العميل',
  customer_address: 'عنوان العميل',
  work_location: 'مكان العمل',
  worker_name: 'اسم العاملة',
  worker_phone: 'هاتف العاملة',
  worker_nationality: 'الجنسية',
  worker_doc_no: 'رقم الجواز/الإقامة',
  duration: 'المدة',
  start_date: 'تاريخ البداية',
  end_date: 'تاريخ النهاية',
  total: 'الإجمالي',
  paid: 'المدفوع',
  remaining: 'المتبقي',
  notes: 'ملاحظات',
};

/** بيانات معاينة القالب: كل حقل يظهر باسمه «…» ليتّضح الثابت من المتغيّر. */
export function placeholderData(keys: string[]): RentalContractData {
  const ph = (k: string) => `«${FIELD_LABEL[k] ?? k}»`;
  const fields: Record<string, string> = {};
  for (const k of keys) fields[k] = ph(k);
  return {
    fields,
    items: [
      {
        service: '«الخدمة/الباقة»',
        unit: '«الوحدة»',
        qty: 1,
        amount: '«قبل الضريبة»',
        vat: '«الضريبة»',
        net: '«الشامل»',
      },
    ],
    payments: [{ date: '«تاريخ الدفعة»', amount: '«المبلغ»', method: '«طريقة الدفع»' }],
    qr: { sellerName: '', vatNumber: '', timestamp: '', total: 0, vat: 0 },
  };
}
