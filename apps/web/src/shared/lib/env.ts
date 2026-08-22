import { z } from 'zod';

/**
 * Boot-time environment validation. The app fails fast with a clear message
 * if a required variable is missing, instead of obscure runtime errors later.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = schema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `• ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`[env] متغيّرات البيئة غير صحيحة:\n${issues}`);
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;
