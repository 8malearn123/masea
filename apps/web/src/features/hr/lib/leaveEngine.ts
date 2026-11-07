/**
 * Leave rules — the demo mirror of supabase/migrations/0070_leave.sql
 * (leave_annual_accrued / leave_balance / validate_leave_request and the leave
 * part of calculate_payslip). Same rules, same Arabic messages, so demo and live
 * behave identically. With a backend the server is the authority.
 */
import type { Employee, LeaveBalance, LeaveRequest, LeaveTypeConfig } from '@/features/hr/types';

/** Defaults = the 0070 seed (Saudi labour law). Edited from «الإعدادات». */
export const DEFAULT_LEAVE_TYPES: LeaveTypeConfig[] = [
  t('annual', 'سنوية', 'annual', 21, { entitlement_days_after: 30, after_years: 5, sort_order: 1 }),
  t('sick', 'مرضية', 'sick', 30, {
    sick_partial_days: 60,
    sick_partial_pay_pct: 75,
    sick_unpaid_days: 30,
    requires_attachment: true,
    sort_order: 2,
  }),
  t('emergency', 'اضطرارية', 'other', 5, { deducts_from_annual: true, sort_order: 3 }),
  t('marriage', 'زواج', 'statutory', 5, { requires_attachment: true, sort_order: 4 }),
  t('bereavement', 'وفاة قريب', 'statutory', 5, { sort_order: 5 }),
  t('paternity', 'مولود', 'statutory', 3, { gender: 'male', sort_order: 6 }),
  t('hajj', 'حج', 'statutory', 15, {
    min_service_months: 24,
    once_per_service: true,
    sort_order: 7,
  }),
  t('maternity', 'وضع (أمومة)', 'statutory', 84, {
    gender: 'female',
    requires_attachment: true,
    sort_order: 8,
  }),
  t('iddah', 'عدة (وفاة الزوج)', 'statutory', 130, {
    gender: 'female',
    requires_attachment: true,
    sort_order: 9,
  }),
  t('unpaid', 'بدون راتب', 'unpaid', null, { paid: false, sort_order: 10 }),
];

function t(
  code: string,
  name_ar: string,
  category: LeaveTypeConfig['category'],
  entitlement_days: number | null,
  over: Partial<LeaveTypeConfig> = {},
): LeaveTypeConfig {
  return {
    code,
    name_ar,
    category,
    entitlement_days,
    entitlement_days_after: null,
    after_years: null,
    sick_partial_days: null,
    sick_partial_pay_pct: null,
    sick_unpaid_days: null,
    paid: true,
    deducts_from_annual: false,
    gender: null,
    min_service_months: 0,
    once_per_service: false,
    requires_attachment: false,
    is_active: true,
    sort_order: 0,
    ...over,
  };
}

const DAY = 86400000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Calendar days, both ends included (same as the server). */
export function daysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const d = Math.round((ms(to) - ms(from)) / DAY) + 1;
  return d > 0 ? d : 0;
}

/** Annual days accrued from hire to asOf: 21/yr, then 30/yr after 5 years. */
export function annualAccrued(hire: string, asOf: string, types: LeaveTypeConfig[]): number {
  const a = types.find((x) => x.code === 'annual');
  if (!a || !hire || !asOf || asOf < hire) return 0;
  const years = (ms(asOf) - ms(hire)) / DAY / 365.25;
  const r = (n: number) => Math.round(n * 100) / 100;
  const first = a.entitlement_days ?? 0;
  if (a.after_years == null || years <= a.after_years) return r(years * first);
  return r(a.after_years * first + (years - a.after_years) * (a.entitlement_days_after ?? first));
}

const mine = (l: LeaveRequest, e: Employee) =>
  l.employee_id ? l.employee_id === e.id : l.employee_name === e.full_name;
const typeOf = (code: string, types: LeaveTypeConfig[]) => types.find((x) => x.code === code);
const countsAgainstAnnual = (code: string, types: LeaveTypeConfig[]) => {
  const x = typeOf(code, types);
  return !!x && (x.category === 'annual' || x.deducts_from_annual);
};

export function annualUsed(
  e: Employee,
  leaves: LeaveRequest[],
  types: LeaveTypeConfig[],
  status: 'approved' | 'pending',
  excludeId?: string,
): number {
  return leaves
    .filter(
      (l) =>
        mine(l, e) &&
        l.status === status &&
        l.id !== excludeId &&
        countsAgainstAnnual(l.type, types),
    )
    .reduce((s, l) => s + l.days, 0);
}

const sickLimit = (s: LeaveTypeConfig | undefined) =>
  (s?.entitlement_days ?? 0) + (s?.sick_partial_days ?? 0) + (s?.sick_unpaid_days ?? 0);

export function leaveBalance(
  e: Employee,
  leaves: LeaveRequest[],
  types: LeaveTypeConfig[],
  asOf: string,
): LeaveBalance {
  const accrued = annualAccrued(e.join_date, asOf, types);
  const used = annualUsed(e, leaves, types, 'approved');
  const sick = typeOf('sick', types);
  const year = asOf.slice(0, 4);
  const sickUsed = leaves
    .filter(
      (l) =>
        mine(l, e) &&
        l.status === 'approved' &&
        typeOf(l.type, types)?.category === 'sick' &&
        l.from_date.slice(0, 4) === year,
    )
    .reduce((s, l) => s + l.days, 0);
  return {
    annual_accrued: accrued,
    annual_used: used,
    annual_pending: annualUsed(e, leaves, types, 'pending'),
    annual_remaining: Math.round((accrued - used) * 100) / 100,
    sick_used_this_year: sickUsed,
    sick_full_left: Math.max((sick?.entitlement_days ?? 0) - sickUsed, 0),
    sick_total_limit: sickLimit(sick),
  };
}

function addMonths(date: string, months: number): string {
  const d = new Date(ms(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Throws (Arabic message) when a pending/approved request breaks a rule —
 * overlap, balance, eligibility (gender / service / once), caps, sick limit.
 */
export function validateLeave(
  req: LeaveRequest,
  e: Employee,
  leaves: LeaveRequest[],
  types: LeaveTypeConfig[],
): void {
  if (!req.from_date || !req.to_date) throw new Error('تاريخا البداية والنهاية مطلوبان');
  if (req.to_date < req.from_date) throw new Error('تاريخ النهاية قبل تاريخ البداية');
  if (req.status !== 'pending' && req.status !== 'approved') return;
  const days = daysInclusive(req.from_date, req.to_date);
  const x = typeOf(req.type, types);
  if (!x || !x.is_active) throw new Error('نوع الإجازة غير متاح');
  if (e.status === 'terminated') throw new Error('الموظف منتهي الخدمة');
  if (x.gender && e.gender && x.gender !== e.gender)
    throw new Error(`إجازة «${x.name_ar}» لا تنطبق على هذا الموظف`);
  if (
    x.min_service_months > 0 &&
    (!e.join_date || req.from_date < addMonths(e.join_date, x.min_service_months))
  )
    throw new Error(`إجازة «${x.name_ar}» تتطلب خدمة ${x.min_service_months} شهراً على الأقل`);
  const others = leaves.filter((l) => mine(l, e) && l.id !== req.id);
  if (x.once_per_service && others.some((l) => l.type === req.type && l.status === 'approved'))
    throw new Error(`إجازة «${x.name_ar}» تُمنح مرة واحدة طوال الخدمة`);
  if (
    others.some(
      (l) =>
        (l.status === 'pending' || l.status === 'approved') &&
        l.from_date <= req.to_date &&
        l.to_date >= req.from_date,
    )
  )
    throw new Error('تتداخل مع إجازة أخرى للموظف في نفس الفترة');

  if (x.category === 'annual' || x.deducts_from_annual) {
    const avail =
      annualAccrued(e.join_date, req.to_date, types) -
      annualUsed(e, leaves, types, 'approved', req.id) -
      (req.status === 'pending' ? annualUsed(e, leaves, types, 'pending', req.id) : 0);
    if (days > Math.floor(avail))
      throw new Error(
        `الرصيد السنوي غير كافٍ: المتاح ${Math.max(Math.floor(avail), 0)} يوم والمطلوب ${days} يوم`,
      );
  }
  if ((x.category === 'statutory' || x.category === 'other') && x.entitlement_days != null) {
    const used =
      x.category === 'other'
        ? others
            .filter(
              (l) =>
                l.type === req.type &&
                (l.status === 'pending' || l.status === 'approved') &&
                l.from_date.slice(0, 4) === req.from_date.slice(0, 4),
            )
            .reduce((s, l) => s + l.days, 0)
        : 0;
    if (used + days > x.entitlement_days)
      throw new Error(`إجازة «${x.name_ar}»: الحد ${x.entitlement_days} يوم`);
  }
  if (x.category === 'sick') {
    const used = others
      .filter(
        (l) =>
          typeOf(l.type, types)?.category === 'sick' &&
          (l.status === 'pending' || l.status === 'approved') &&
          l.from_date.slice(0, 4) === req.from_date.slice(0, 4),
      )
      .reduce((s, l) => s + l.days, 0);
    if (used + days > sickLimit(x))
      throw new Error(`تجاوز حد الإجازة المرضية السنوي (${sickLimit(x)} يوم)`);
  }
}

/**
 * Leave days deducted in a payroll period: unpaid days + the unpaid share of
 * sick days by their yearly tier (full → partial % → unpaid).
 */
export function leaveDeductionDays(
  e: Employee,
  period: string,
  leaves: LeaveRequest[],
  types: LeaveTypeConfig[],
): { unpaid_days: number; sick_deduction_days: number } {
  const start = `${period}-01`;
  const endD = new Date(ms(start));
  endD.setUTCMonth(endD.getUTCMonth() + 1);
  endD.setUTCDate(0);
  const end = endD.toISOString().slice(0, 10);
  const approved = leaves.filter((l) => mine(l, e) && l.status === 'approved');

  let unpaid = 0;
  approved
    .filter((l) => typeOf(l.type, types)?.paid === false)
    .forEach((l) => {
      const from = l.from_date > start ? l.from_date : start;
      const to = l.to_date < end ? l.to_date : end;
      unpaid += daysInclusive(from, to);
    });

  const sick = typeOf('sick', types);
  const full = sick?.entitlement_days ?? 0;
  const partial = sick?.sick_partial_days ?? 0;
  const partialCut = 1 - (sick?.sick_partial_pay_pct ?? 100) / 100;
  const year = period.slice(0, 4);
  const sickDays: string[] = [];
  approved
    .filter((l) => typeOf(l.type, types)?.category === 'sick')
    .forEach((l) => {
      for (let d = ms(l.from_date); d <= ms(l.to_date); d += DAY) {
        const iso = new Date(d).toISOString().slice(0, 10);
        if (iso.slice(0, 4) === year) sickDays.push(iso);
      }
    });
  sickDays.sort();
  let sickDed = 0;
  sickDays.forEach((d, i) => {
    const n = i + 1;
    if (d < start || d > end) return;
    if (n <= full) return;
    sickDed += n <= full + partial ? partialCut : 1;
  });
  return { unpaid_days: unpaid, sick_deduction_days: Math.round(sickDed * 100) / 100 };
}
