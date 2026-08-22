/**
 * Best-effort public IP capture for the e-signature record. Runs client-side
 * with a short timeout; returns null if the network blocks it (e.g. offline
 * demo mode) so signing never hangs or fails on IP lookup alone.
 */
export async function getClientIp(timeoutMs = 3000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return typeof data.ip === 'string' ? data.ip : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
