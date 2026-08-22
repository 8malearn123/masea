/**
 * Centralized React Query key factory. Every feature derives its keys here so
 * invalidation stays precise and consistent.
 */
export const queryKeys = {
  services: () => ['services'] as const,
  workerProfiles: (limit?: number) => ['worker_profiles', limit ?? 'all'] as const,
  price: (service: string, params: unknown) => ['price', service, params] as const,
  dashboardStats: () => ['dashboard-stats'] as const,
  myPermissions: () => ['my-permissions'] as const,
} as const;

/** Sensible defaults for server-state caching. */
export const QUERY_DEFAULTS = {
  staleTime: 5 * 60 * 1000, // 5 min
  gcTime: 30 * 60 * 1000, // 30 min
} as const;
