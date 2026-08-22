import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/ui';
import { createCustomer, searchCustomers, type CustomerLite } from '@/features/contracts/api/customers.api';

export function useCustomerSearch(q: string) {
  return useQuery({
    queryKey: ['customers', 'search', q],
    queryFn: () => searchCustomers(q),
    staleTime: 60_000,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<CustomerLite, Error, { full_name: string; phone: string; city: string }>({
    mutationFn: (input) => createCustomer(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('تم إنشاء العميل');
    },
    onError: (e) => toast.error(e.message || 'تعذّر إنشاء العميل'),
  });
}
