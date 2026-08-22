import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FALLBACK_WORKERS, type WorkerProfile } from '@/lib/funnel';

/** Publicly available worker profiles (available + active). */
export function useWorkerProfiles(limit?: number) {
  return useQuery<WorkerProfile[]>({
    queryKey: ['worker_profiles', limit ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('worker_profiles')
        .select('id, full_name, nationality, profession, age, experience_years, languages, monthly_salary, status, photo_url, bio_ar')
        .eq('is_active', true)
        .eq('status', 'available')
        .order('created_at', { ascending: false });
      if (limit) q = q.limit(limit);

      const { data, error } = await q;
      if (error || !data || data.length === 0) {
        return limit ? FALLBACK_WORKERS.slice(0, limit) : FALLBACK_WORKERS;
      }
      return data as WorkerProfile[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
