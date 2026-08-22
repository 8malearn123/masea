import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import {
  DEFAULT_SERVICE_ORIGIN,
  type ServiceOriginMap,
} from '@/features/contracts/lib/contractOrigin';
import type { ContractOrigin } from '@/features/contracts/types';

/**
 * The managed per-service contract origin (مساند / داخلي) from `services`
 * (0049). Falls back to the bundled defaults pre-migration / offline so the
 * whole contracts flow keeps working without Supabase (وضع التشغيل الحالي).
 */
export function useServiceOrigins() {
  return useQuery<ServiceOriginMap>({
    queryKey: ['contracts', 'service-origins'],
    queryFn: async () => {
      const map: ServiceOriginMap = { ...DEFAULT_SERVICE_ORIGIN };
      try {
        const { data, error } = await supabase.from('services').select('code, contract_origin');
        if (!error && data) {
          for (const row of data as Array<{ code: string; contract_origin: string | null }>) {
            if (row.contract_origin === 'musaned' || row.contract_origin === 'internal') {
              map[row.code] = row.contract_origin as ContractOrigin;
            }
          }
        }
      } catch {
        /* offline → defaults */
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}
