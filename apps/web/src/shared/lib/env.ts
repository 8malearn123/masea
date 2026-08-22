import { z } from 'zod';

/**
 * Boot-time environment validation.
 *
 * The result is *reported*, never thrown at module load. A throw here runs
 * before React mounts, so neither ErrorBoundary nor any UI can catch it and
 * the deployment renders as a blank white page with no clue what went wrong —
 * the worst possible failure mode on a fresh Vercel deploy. main.tsx reads
 * `envError` and paints a readable diagnosis instead.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = schema.safeParse(import.meta.env);

/** Human-readable list of what is missing/invalid, or null when the env is good. */
export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');

/**
 * Placeholder values keep `createClient()` constructible when the env is bad,
 * so the boot screen can render its diagnosis rather than dying on an unrelated
 * error first. Nothing ever reaches this host: main.tsx refuses to mount the
 * app while `envError` is set.
 */
export const env: z.infer<typeof schema> = parsed.success
  ? parsed.data
  : { VITE_SUPABASE_URL: 'https://unconfigured.invalid', VITE_SUPABASE_ANON_KEY: 'unconfigured' };

export type Env = z.infer<typeof schema>;
