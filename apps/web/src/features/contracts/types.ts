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
  PriceBreakdown,
  RecruitmentStage,
  RecruitmentFollowup,
  RecruitmentDocument,
  ExternalOfficeAccount,
} from '@/features/contracts/schemas/contract.schema';

export interface ContractListItem extends Contract {
  customer_name: string | null;
  worker_name: string | null;
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
