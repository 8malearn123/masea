import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/shared/lib/queryKeys';
import { fallbackPrice, type PriceArgs } from '@/shared/lib/pricing';
import type { PriceBreakdown, ServiceCode } from '@/lib/funnel';

/**
 * Pricing for an order. The backend `calc_price` RPC is the source of truth;
 * the seed-mirrored fallback (shared/lib/pricing) is used only until the
 * 0011/0012 migrations are applied.
 */
export function usePrice(service: ServiceCode, args: PriceArgs, enabled: boolean) {
  return useQuery<PriceBreakdown>({
    queryKey: queryKeys.price(service, args),
    enabled,
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc('calc_price', {
          p_service_code: service,
          p_params: args,
        });
        if (!error && data && typeof (data as PriceBreakdown).total === 'number') {
          return data as PriceBreakdown;
        }
      } catch {
        /* RPC not available yet — fall back below */
      }
      return fallbackPrice(service, args);
    },
  });
}
