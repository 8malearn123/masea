/**
 * Helpers for running write operations gracefully in demo mode.
 *
 * The app ships with seed/fallback data whose ids are short tokens ("c1", "o3",
 * "l4") rather than real UUIDs, and the Supabase backend may not have every
 * table/function/RLS policy provisioned yet. In those cases a write can't reach
 * a real row, so the optimistic UI update is the source of truth and must NOT be
 * rolled back — otherwise the user changes something and "nothing happens".
 *
 * Every feature api should:
 *   1. short-circuit with `isDemoId(id)` before hitting the backend, and
 *   2. swallow `isIgnorableWriteError(error.message)` instead of throwing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seed/demo ids are short tokens; real backend rows use UUIDs. */
export function isDemoId(id: string): boolean {
  return !UUID_RE.test(id);
}

/**
 * True when a write error means "couldn't reach a real backend row" — the table
 * or function isn't provisioned, the id isn't a UUID, or RLS rejects demo rows.
 * All non-fatal in demo mode; keep the optimistic update.
 */
export function isIgnorableWriteError(message: string): boolean {
  const s = message.toLowerCase();
  return (
    s.includes('could not find') ||
    s.includes('schema cache') ||
    s.includes('does not exist') ||
    s.includes('not found') ||
    s.includes('invalid input syntax') || // demo ids aren't uuids
    s.includes('uuid') ||
    s.includes('permission denied') || // RLS not seeded for demo rows
    s.includes('abort') || // demo mode / request timeout — backend unreachable
    s.includes('failed to fetch') ||
    s.includes('networkerror') ||
    s.includes('load failed') // Safari's network-failure message
  );
}
