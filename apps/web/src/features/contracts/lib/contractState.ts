import type { ContractOrigin, ContractStatus } from '@/features/contracts/schemas/contract.schema';
import type { BadgeTone } from '@/shared/ui/Badge';

/**
 * Allowed contract status transitions — a frontend mirror of the backend
 * `transition_contract` DB function (which is the enforced source of truth).
 *
 * Two tracks by contract origin (0049):
 *   • internal (تأجير)            → full in-system lifecycle
 *   • musaned  (استقدام / نقل كفالة) → the contract is created & signed on منصة مساند;
 *     we only track: أُنشئ على مساند → وقّع العميل على مساند → نشط → منتهٍ.
 */
const INTERNAL_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['awaiting_signature', 'cancelled'],
  awaiting_signature: ['signed', 'cancelled'],
  signed: ['active'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  musaned_created: [],
  musaned_signed: [],
};

const MUSANED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['musaned_created', 'cancelled'],
  musaned_created: ['musaned_signed', 'cancelled'],
  musaned_signed: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  pending_approval: [],
  approved: [],
  awaiting_signature: [],
  signed: [],
};

/** Back-compat export — the internal (rental) transition table. */
export const CONTRACT_TRANSITIONS = INTERNAL_TRANSITIONS;

function tableFor(origin: ContractOrigin): Record<ContractStatus, ContractStatus[]> {
  return origin === 'musaned' ? MUSANED_TRANSITIONS : INTERNAL_TRANSITIONS;
}

export function canTransition(
  from: ContractStatus,
  to: ContractStatus,
  origin: ContractOrigin = 'internal',
): boolean {
  return tableFor(origin)[from].includes(to);
}

export function nextStatuses(
  from: ContractStatus,
  origin: ContractOrigin = 'internal',
): ContractStatus[] {
  return tableFor(origin)[from];
}

/** Only a draft is editable; once it moves forward its core terms are locked. */
export function isEditable(status: ContractStatus): boolean {
  return status === 'draft';
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'مسودة',
  musaned_created: 'أُنشئ على مساند',
  musaned_signed: 'وقّع العميل على مساند',
  pending_approval: 'بانتظار الاعتماد',
  approved: 'معتمد',
  awaiting_signature: 'بانتظار التوقيع',
  signed: 'موقّع',
  active: 'نشط',
  completed: 'منتهٍ',
  cancelled: 'ملغى',
};

export const CONTRACT_STATUS_TONE: Record<ContractStatus, BadgeTone> = {
  draft: 'neutral',
  musaned_created: 'gold',
  musaned_signed: 'teal',
  pending_approval: 'gold',
  approved: 'teal',
  awaiting_signature: 'gold',
  signed: 'navy',
  active: 'success',
  completed: 'navy',
  cancelled: 'danger',
};
