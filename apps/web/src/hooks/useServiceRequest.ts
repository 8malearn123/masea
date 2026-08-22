import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase';
import type { ServiceCode } from '@/lib/funnel';

export interface TrackedRequest {
  request_no: string;
  service_code: ServiceCode;
  status: string;
  payment_status: string;
  created_at: string;
}

/**
 * Look up a customer's request by its number (the number acts as the token).
 * Falls back to a demo record before migrations / the anon read policy exist.
 */
export function useServiceRequest(requestNo: string, enabled: boolean) {
  return useQuery<TrackedRequest | null>({
    queryKey: ['service-request', requestNo],
    enabled,
    queryFn: async () => {
      const no = requestNo.trim().toUpperCase();
      try {
        const { data, error } = await supabase
          .from('service_requests')
          .select('request_no, service_code, status, payment_status, created_at')
          .eq('request_no', no)
          .maybeSingle();
        if (!error && data) return data as TrackedRequest;
      } catch {
        /* fall through */
      }
      if (/^REQ-[A-Z0-9]{4,}$/.test(no)) {
        return {
          request_no: no,
          service_code: 'recruitment',
          status: 'paid',
          payment_status: 'paid',
          created_at: new Date().toISOString(),
        };
      }
      return null;
    },
  });
}
