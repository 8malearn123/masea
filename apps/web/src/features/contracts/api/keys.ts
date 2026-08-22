import type { ContractFilters } from '@/features/contracts/types';

/** Query key factory for the contracts feature. */
export const contractKeys = {
  all: ['contracts'] as const,
  list: (filters: ContractFilters) => ['contracts', 'list', filters] as const,
  detail: (id: string) => ['contracts', 'detail', id] as const,
  clauses: (id: string) => ['contracts', 'clauses', id] as const,
  history: (id: string) => ['contracts', 'history', id] as const,
  signatures: (id: string) => ['contracts', 'signatures', id] as const,
  templates: () => ['contracts', 'templates'] as const,
  stages: () => ['contracts', 'recruitment-stages'] as const,
  followups: (id: string) => ['contracts', 'followups', id] as const,
  documents: (id: string) => ['contracts', 'documents', id] as const,
  offices: () => ['contracts', 'external-offices'] as const,
};
