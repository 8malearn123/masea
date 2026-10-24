import type {
  Contract,
  ContractServiceCode,
  ContractStatus,
} from '@/features/contracts/schemas/contract.schema';

export type {
  Contract,
  ContractStatus,
  ContractServiceCode,
  ContractOrigin,
  ContractTemplate,
  ContractClause,
  ContractSignature,
  ContractStatusHistory,
  CreateContractInput,
  UpdateDraftInput,
  PriceBreakdown,
  RecruitmentStage,
  RecruitmentFollowup,
  RecruitmentDocument,
  ExternalOfficeAccount,
} from '@/features/contracts/schemas/contract.schema';

export interface ContractListItem extends Contract {
  customer_name: string | null;
  worker_name: string | null;
  /** Branch display name (backend join on `branches.city`); demo rows carry the name in branch_id. */
  branch_name?: string | null;
}

/** Human branch label for a contract — the joined name, else the stored value. */
export function branchLabel(c: Pick<ContractListItem, 'branch_id' | 'branch_name'>): string {
  return c.branch_name ?? c.branch_id ?? '—';
}

export interface ContractFilters {
  status: ContractStatus | 'all';
  service: ContractServiceCode | 'all';
  branch: string | 'all';
  search: string;
}

export const SERVICE_LABEL: Record<ContractServiceCode, string> = {
  recruitment: 'استقدام',
  monthly_rental: 'تأجير شهري',
  daily_rental: 'تأجير يومي',
  sponsorship_transfer: 'نقل كفالة',
};
