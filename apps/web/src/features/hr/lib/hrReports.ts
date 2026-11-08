/**
 * HR report maths over hr_report_rows (0077): cost and headcount by branch /
 * department, Saudization and the Nitaqat band, turnover, absence.
 * Pure functions — the same numbers for demo and live, unit-tested.
 */
import type { HrReportRow, NitaqatBand } from '@/features/hr/types';

export const SAUDI_FULL_WAGE_KEY = 'saudization_full_wage';
export const SAUDI_HALF_WEIGHT_KEY = 'saudization_half_weight';
export const DEFAULT_FULL_WAGE = 4000;
export const DEFAULT_HALF_WEIGHT = 0.5;

export const DEFAULT_NITAQAT: NitaqatBand[] = [
  { code: 'platinum', name_ar: 'بلاتيني', min_pct: 40, tone: 'success', is_active: true },
  { code: 'green_high', name_ar: 'أخضر مرتفع', min_pct: 30, tone: 'success', is_active: true },
  { code: 'green_mid', name_ar: 'أخضر متوسط', min_pct: 23, tone: 'success', is_active: true },
  { code: 'green_low', name_ar: 'أخضر منخفض', min_pct: 17, tone: 'gold', is_active: true },
  { code: 'red', name_ar: 'أحمر', min_pct: 0, tone: 'danger', is_active: true },
];

export interface SaudiRule {
  fullWage: number;
  halfWeight: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Active at the end of the period. */
export const isActive = (r: HrReportRow) => r.status === 'active';

/** Nitaqat weight of one person: 1, the reduced weight under the wage, or 0. */
export function saudiWeight(r: HrReportRow, rule: SaudiRule): number {
  if (!r.counts_saudization) return 0;
  return r.nitaqat_wage >= rule.fullWage ? 1 : rule.halfWeight;
}

export interface Saudization {
  saudis: number;
  total: number;
  pct: number;
}
export function saudization(rows: HrReportRow[], rule: SaudiRule): Saudization {
  const active = rows.filter(isActive);
  const saudis = r2(active.reduce((s, r) => s + saudiWeight(r, rule), 0));
  return {
    saudis,
    total: active.length,
    pct: active.length ? r1((saudis / active.length) * 100) : 0,
  };
}

export function nitaqatBand(pct: number, bands: NitaqatBand[]): NitaqatBand | null {
  return (
    bands.filter((b) => b.is_active && b.min_pct <= pct).sort((a, b) => b.min_pct - a.min_pct)[0] ??
    null
  );
}

/** Saudis still needed to reach a band's minimum (with full-weight hires). */
export function saudisNeeded(s: Saudization, targetPct: number): number {
  if (s.pct >= targetPct) return 0;
  // (saudis + x) / (total + x) >= p  →  x >= (p·total − saudis) / (1 − p)
  const p = targetPct / 100;
  return p >= 1 ? Infinity : Math.max(0, Math.ceil((p * s.total - s.saudis) / (1 - p) - 1e-9));
}

export interface Group {
  key: string;
  headcount: number;
  cost: number | null;
  costEstimated: boolean;
  present: number;
  late: number;
  absent: number;
  lateMinutes: number;
  leaveDays: number;
  leavers: number;
  absenceRate: number;
}

/** (late + absent days) are not attendance — absence rate = absent / recorded days. */
export function absenceRate(present: number, late: number, absent: number): number {
  const days = present + late + absent;
  return days ? r1((absent / days) * 100) : 0;
}

export function groupBy(
  rows: HrReportRow[],
  dim: 'branch' | 'department' | 'nationality',
): Group[] {
  const map = new Map<string, HrReportRow[]>();
  rows.forEach((r) => {
    const k = r[dim] || 'غير محدد';
    map.set(k, [...(map.get(k) ?? []), r]);
  });
  return [...map.entries()]
    .map(([key, rs]) => {
      const sum = (f: (r: HrReportRow) => number) => rs.reduce((s, r) => s + f(r), 0);
      const hidden = rs.some((r) => r.cost === null);
      const present = sum((r) => r.present_days);
      const late = sum((r) => r.late_days);
      const absent = sum((r) => r.absent_days);
      return {
        key,
        headcount: rs.filter(isActive).length,
        cost: hidden ? null : r2(sum((r) => r.cost ?? 0)),
        costEstimated: rs.some((r) => r.cost_estimated),
        present,
        late,
        absent,
        lateMinutes: sum((r) => r.late_minutes),
        leaveDays: sum((r) => r.leave_days),
        leavers: rs.filter((r) => !isActive(r)).length,
        absenceRate: absenceRate(present, late, absent),
      };
    })
    .sort((a, b) => (b.cost ?? b.headcount) - (a.cost ?? a.headcount));
}

export interface Turnover {
  leavers: number;
  startHeadcount: number;
  endHeadcount: number;
  rate: number;
  byReason: { reason: string; count: number }[];
}
/** Leavers ÷ average headcount (start + end) / 2. */
export function turnover(rows: HrReportRow[], from: string, to: string): Turnover {
  const atStart = rows.filter(
    (r) =>
      (!r.hire_date || r.hire_date <= from) && (!r.termination_date || r.termination_date >= from),
  ).length;
  const atEnd = rows.filter(
    (r) => (!r.hire_date || r.hire_date <= to) && (!r.termination_date || r.termination_date > to),
  ).length;
  const leavers = rows.filter(
    (r) => r.termination_date && r.termination_date >= from && r.termination_date <= to,
  );
  const avg = (atStart + atEnd) / 2;
  const reasons = new Map<string, number>();
  leavers.forEach((r) =>
    reasons.set(
      r.termination_reason ?? 'other',
      (reasons.get(r.termination_reason ?? 'other') ?? 0) + 1,
    ),
  );
  return {
    leavers: leavers.length,
    startHeadcount: atStart,
    endHeadcount: atEnd,
    rate: avg ? r1((leavers.length / avg) * 100) : 0,
    byReason: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Preset periods for the report screen — period-to-date (never future months). */
export function presetRange(
  preset: 'month' | 'quarter' | 'year',
  now = new Date(),
): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(now);
  const cap = (to: string) => (to > today ? today : to);
  if (preset === 'month')
    return {
      from: iso(new Date(Date.UTC(y, m, 1))),
      to: cap(iso(new Date(Date.UTC(y, m + 1, 0)))),
    };
  if (preset === 'quarter') {
    const q = Math.floor(m / 3) * 3;
    return {
      from: iso(new Date(Date.UTC(y, q, 1))),
      to: cap(iso(new Date(Date.UTC(y, q + 3, 0)))),
    };
  }
  return { from: `${y}-01-01`, to: cap(`${y}-12-31`) };
}
