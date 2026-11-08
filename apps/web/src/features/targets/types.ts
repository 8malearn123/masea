import type { TargetBoardRow } from '@/features/hr/api/performance.api';

export type TargetRow = TargetBoardRow;

/** Overall achievement: contracts and sales value, equally weighted (each capped at the target). */
export function achievementPct(t: TargetRow): number {
  const parts = [
    t.contracts_target ? Math.min(1, t.contracts_achieved / t.contracts_target) : null,
    t.sales_target ? Math.min(1, t.sales_achieved / t.sales_target) : null,
  ].filter((x): x is number => x !== null);
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : 0;
}
