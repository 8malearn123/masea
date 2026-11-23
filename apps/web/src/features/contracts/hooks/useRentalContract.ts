import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveRentalTemplate,
  getCompanyProfile,
  listRentalTemplates,
  updateCompanyProfile,
} from '@/features/contracts/api/rentalContract.api';
import type { CompanyProfile } from '@/features/contracts/lib/rentalContract/fields';

export const rentalKeys = {
  templates: ['contracts', 'rental-templates'] as const,
  company: ['contracts', 'company-profile'] as const,
};

export function useRentalTemplates() {
  return useQuery({ queryKey: rentalKeys.templates, queryFn: listRentalTemplates });
}

export function useCompanyProfile() {
  return useQuery({ queryKey: rentalKeys.company, queryFn: getCompanyProfile });
}

export function useApproveRentalTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => approveRentalTemplate(version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rentalKeys.templates });
      void qc.invalidateQueries({ queryKey: ['contracts', 'templates'] });
    },
  });
}

export function useUpdateCompanyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: CompanyProfile) => updateCompanyProfile(p),
    onSuccess: (data) => qc.setQueryData(rentalKeys.company, data),
  });
}
