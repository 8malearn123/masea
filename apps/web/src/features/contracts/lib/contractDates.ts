/**
 * End date of a contract from its start date and duration — the last day the
 * service is due (inclusive). Months keep the same day-of-month (clamped to the
 * month's length); days count the start day itself.
 */
export function contractEndDate(
  start: string,
  duration: { unit: 'month' | 'day'; count: number } | null,
): string | null {
  if (!start || !duration || !(duration.count >= 1)) return null;
  const [y, m, d] = start.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (duration.unit === 'day') {
    const dt = new Date(Date.UTC(y, m - 1, d + duration.count - 1));
    return dt.toISOString().slice(0, 10);
  }
  const targetMonth = m - 1 + duration.count;
  const lastDay = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, targetMonth, Math.min(d, lastDay)));
  // a clamped day (e.g. 31 Jan → Feb) already lands on the period's last day
  if (d <= lastDay) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
