export interface TargetRow {
  id: string;
  employee_name: string;
  role_label: string;
  branch: string;
  contracts_target: number;
  contracts_achieved: number;
  collection_target: number;
  collection_achieved: number;
  avg_rating: number;
  reward_amount: number;
}

/** Overall achievement percentage (contracts + collection, equally weighted). */
export function achievementPct(t: TargetRow): number {
  const c = t.contracts_target ? t.contracts_achieved / t.contracts_target : 0;
  const m = t.collection_target ? t.collection_achieved / t.collection_target : 0;
  return Math.round(((c + m) / 2) * 100);
}
