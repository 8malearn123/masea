import { Badge } from '@/shared/ui';
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE } from '@/features/contracts/lib/contractState';
import type { ContractStatus } from '@/features/contracts/types';

export function StatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={CONTRACT_STATUS_TONE[status]}>{CONTRACT_STATUS_LABEL[status]}</Badge>;
}
