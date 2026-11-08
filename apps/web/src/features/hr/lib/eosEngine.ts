/**
 * End-of-service rules — demo mirror of supabase/migrations/0073_end_of_service.sql
 * (eos_service_years / eos_award / eos_wages / eos_calculate). Saudi labour law:
 * م84 award, م85 resignation ratios, م87 full despite resignation, م80 none,
 * م111 unused leave paid, م77 compensation (15 days a year, min 2 months).
 */
import { annualAccrued, annualUsed } from '@/features/hr/lib/leaveEngine';
import type {
  EosCalc,
  EosWageBasis,
  Employee,
  LeaveRequest,
  LeaveTypeConfig,
  TerminationReason,
} from '@/features/hr/types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

/** Years of service = days ÷ 365 (4 decimals), same as the server. */
export function serviceYears(hire: string, end: string): number {
  if (!hire || !end || end < hire) return 0;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${hire}T00:00:00Z`)) / DAY);
  return Math.round((days / 365) * 10000) / 10000;
}

/** م85 resignation ratio; م80 none; anything else (incl. م87) full. */
export function eosRatio(years: number, reason: TerminationReason): number {
  if (reason === 'article_80') return 0;
  if (reason === 'resignation') return years < 2 ? 0 : years < 5 ? 1 / 3 : years < 10 ? 2 / 3 : 1;
  return 1;
}

/** م84: ½ month per year for the first 5 years, then a full month (fractions pro-rata). */
export function eosAward(years: number, wage: number, reason: TerminationReason) {
  const full = r2((Math.min(years, 5) * 0.5 + Math.max(years - 5, 0)) * wage);
  const ratio = Math.round(eosRatio(years, reason) * 10000) / 10000;
  return { full, ratio, award: r2(full * eosRatio(years, reason)) };
}

export function eosWages(e: Employee, basis: EosWageBasis): { full: number; eos: number } {
  const housing = e.housing_allowance ?? e.allowances;
  const transport = e.housing_allowance !== undefined ? (e.transport_allowance ?? 0) : 0;
  const other = e.housing_allowance !== undefined ? (e.other_allowance ?? 0) : 0;
  const full = e.base_salary + housing + transport + other;
  return {
    full,
    eos:
      basis === 'basic'
        ? e.base_salary
        : basis === 'basic_housing'
          ? e.base_salary + housing
          : full,
  };
}

export function eosCalculate(
  e: Employee,
  end: string,
  reason: TerminationReason,
  art77: boolean,
  basis: EosWageBasis,
  leaves: LeaveRequest[],
  leaveTypes: LeaveTypeConfig[],
): EosCalc {
  const w = eosWages(e, basis);
  const years = serviceYears(e.join_date, end);
  const a = eosAward(years, w.eos, reason);
  const leaveDays = Math.max(
    r2(annualAccrued(e.join_date, end, leaveTypes) - annualUsed(e, leaves, leaveTypes, 'approved')),
    0,
  );
  const leaveAmount = r2((w.full / 30) * leaveDays);
  const art77Amount = art77 ? Math.max(r2((w.full / 30) * 15 * years), r2(w.full * 2)) : 0;
  return {
    service_years: years,
    wage: w.eos,
    full_wage: w.full,
    wage_basis: basis,
    award_full: a.full,
    award_ratio: a.ratio,
    award: a.award,
    leave_days: leaveDays,
    leave_amount: leaveAmount,
    art77_amount: art77Amount,
    total: r2(a.award + leaveAmount + art77Amount),
  };
}

/** Provision target: every current employee leaving at asOf by employer termination. */
export function provisionTarget(employees: Employee[], asOf: string, basis: EosWageBasis): number {
  return r2(
    employees
      .filter((e) => e.status !== 'terminated' && e.join_date && e.join_date <= asOf)
      .reduce(
        (s, e) =>
          s +
          eosAward(serviceYears(e.join_date, asOf), eosWages(e, basis).eos, 'employer_termination')
            .award,
        0,
      ),
  );
}
