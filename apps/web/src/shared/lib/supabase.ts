import { createClient } from '@supabase/supabase-js';
import { env } from '@/shared/lib/env';
import { isDemoActive } from '@/lib/demo';

/**
 * Network budget for a single Supabase request. The app runs demo-first: when
 * the backend isn't provisioned (or a free-tier project is paused/unreachable),
 * a request can hang until the browser's default network timeout — leaving the
 * UI stuck on loading skeletons for tens of seconds. Every feature api already
 * falls back to seed data on error, so we cap each request here: on timeout the
 * fetch aborts, the query returns an error, and the demo fallback shows fast.
 */
const REQUEST_TIMEOUT_MS = 5000;

/** fetch() wrapper that aborts after REQUEST_TIMEOUT_MS, preserving any caller signal. */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Demo mode: no real backend — reject immediately so every read shows its seed
  // data at once and every write swallows the (ignorable) unreachable-backend
  // error, keeping the optimistic UI. Avoids a pointless network wait per page.
  if (isDemoActive()) {
    return Promise.reject(new DOMException('demo mode — offline', 'AbortError'));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Respect an abort signal supabase-js may already pass (e.g. .abortSignal()).
  const external = init?.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Single typed Supabase client for the whole app.
 *
 * TODO(types): generate database types and parameterize the client:
 *   supabase gen types typescript --project-id <ref> > src/shared/types/database.types.ts
 *   createClient<Database>(...)
 * Requires Supabase project access (not available in this sandbox).
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchWithTimeout },
});
