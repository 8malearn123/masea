import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/shared/lib/queryKeys';
import type { PriceArgs } from '@/shared/lib/pricing';
import { managedPrice } from '@/features/pricing/api/pricing.api';
import { isDemoMode } from '@/shared/lib/demoBackend';
import type { PriceBreakdown, ServiceCode } from '@/lib/funnel';

/**
 * Pricing for an order. With a backend, `calc_price` is the ONLY source — an error
 * is shown, never a price computed in the browser. In demo mode the managed price
 * list and VAT setting stand in (`managedPrice`).
 */
export function usePrice(service: ServiceCode, args: PriceArgs, enabled: boolean) {
  return useQuery<PriceBreakdown>({
    queryKey: queryKeys.price(service, args),
    enabled,
    queryFn: async () => {
      if (isDemoMode()) return managedPrice(service, args);
      const { data, error } = await supabase.rpc('calc_price', {
        p_service_code: service,
        p_params: args,
      });
      if (error) throw new Error(`تعذّر حساب السعر: ${error.message}`);
      if (typeof (data as PriceBreakdown | null)?.total !== 'number') {
        throw new Error('لا توجد قاعدة سعر نشطة لهذه الخدمة');
      }
      return data as PriceBreakdown;
    },
  });
}
