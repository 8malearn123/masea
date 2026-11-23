import type { ContractStatus } from '@/features/contracts/schemas/contract.schema';

/**
 * تخصيص العاملة على العقود — مرآة 0089 (`contract_status_is_live` و
 * `contracts_worker_no_overlap`). المسودة لا تحجز؛ ما بعدها يحجز حتى الإكمال/الإلغاء.
 */
export const LIVE_CONTRACT_STATUSES: readonly ContractStatus[] = [
  'pending_approval',
  'approved',
  'awaiting_signature',
  'signed',
  'musaned_created',
  'musaned_signed',
  'active',
];

export function isLiveStatus(s: ContractStatus): boolean {
  return LIVE_CONTRACT_STATUSES.includes(s);
}

/** Inclusive day ranges overlap ([a,b] ∩ [c,d]); an open end means "until further notice". */
export function periodsOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aE = aEnd ?? '9999-12-31';
  const bE = bEnd ?? '9999-12-31';
  return aStart <= bE && bStart <= aE;
}

interface Allocatable {
  id: string;
  contract_no: string | null;
  status: ContractStatus;
  start_date: string | null;
  end_date: string | null;
  worker_profile_id: string | null;
}

/** The live contract that already holds this worker in the period, if any. */
export function workerConflict<T extends Allocatable>(
  contracts: readonly T[],
  profileId: string | null,
  start: string | null,
  end: string | null,
  excludeId?: string,
): T | null {
  if (!profileId || !start) return null;
  return (
    contracts.find(
      (c) =>
        c.id !== excludeId &&
        c.worker_profile_id === profileId &&
        isLiveStatus(c.status) &&
        c.start_date !== null &&
        periodsOverlap(c.start_date, c.end_date, start, end),
    ) ?? null
  );
}

export function conflictMessage(workerName: string | null, c: Allocatable): string {
  return `العاملة ${workerName ?? ''} محجوزة على العقد ${c.contract_no ?? c.id} في الفترة نفسها`
    .replace(/\s+/g, ' ')
    .trim();
}
