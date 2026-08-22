import { z } from 'zod';

/**
 * Boot-time environment validation.
 *
 * Supabase credentials are optional: the app is demo-first and every feature
 * api falls back to seed data, so an unconfigured host still serves a working
 * site instead of an error. What is *not* tolerated is a half-configured one —
 * a present-but-malformed value is a real mistake and gets a visible diagnosis.
 *
 * The result is reported, never thrown at module load: a throw here runs before
 * React mounts, so neither ErrorBoundary nor any UI can catch it and the page
 * renders blank with no clue what went wrong.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

const raw = import.meta.env as unknown as Record<string, unknown>;
const parsed = schema.safeParse(raw);

/** True when either credential was supplied — i.e. a backend was intended. */
const attempted = (['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const).some(
  (k) => typeof raw[k] === 'string' && (raw[k] as string).trim() !== '',
);

/** True when a real Supabase backend is configured and usable. */
export const isBackendConfigured = parsed.success;

/**
 * Set only for a half-configured host (something was supplied, but it is
 * invalid or incomplete). Absent credentials are not an error — they select
 * demo mode. main.tsx paints this instead of mounting the app.
 */
export const envError: string | null =
  parsed.success || !attempted
    ? null
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');

/**
 * Placeholder values keep `createClient()` constructible in demo mode. No
 * request ever reaches this host: supabase.ts short-circuits every fetch while
 * `isBackendConfigured` is false.
 */
export const env: z.infer<typeof schema> = parsed.success
  ? parsed.data
  : { VITE_SUPABASE_URL: 'https://unconfigured.invalid', VITE_SUPABASE_ANON_KEY: 'unconfigured' };

export type Env = z.infer<typeof schema>;
