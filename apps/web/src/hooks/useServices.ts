import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FALLBACK_SERVICES, type ServiceItem } from '@/lib/funnel';

/** Public catalog of service types. Falls back to bundled data pre-migration. */
export function useServices() {
  return useQuery<ServiceItem[]>({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('code, name_ar, tagline_ar, description_ar, icon, unit')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error || !data || data.length === 0) return FALLBACK_SERVICES;
      return data as ServiceItem[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
