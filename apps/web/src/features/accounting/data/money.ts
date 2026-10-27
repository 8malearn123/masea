/**
 * Exact money arithmetic in integer halalas (1 SAR = 100 halala).
 * JS floats can't represent 0.1 exactly; every new accounting computation sums
 * in integer halalas and converts back once — mirroring numeric(14,2) in the DB.
 */

/** SAR → integer halalas (half-away-from-zero, tolerant of float noise). */
export function toHalala(sar: number): number {
  const n = Number(sar) || 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 + 1e-7);
}

export function fromHalala(h: number): number {
  return h / 100;
}

/** Round a SAR amount to 2 decimals exactly. */
export function money(sar: number): number {
  return fromHalala(toHalala(sar));
}

/** Exact sum of SAR amounts. */
export function sumMoney(values: Iterable<number>): number {
  let h = 0;
  for (const v of values) h += toHalala(v);
  return fromHalala(h);
}

/** a − b exactly. */
export function subMoney(a: number, b: number): number {
  return fromHalala(toHalala(a) - toHalala(b));
}

/** amount × rate rounded to the halala (VAT, allocations, percentages). */
export function mulMoney(amount: number, rate: number): number {
  return money(amount * rate);
}

export function eqMoney(a: number, b: number): boolean {
  return toHalala(a) === toHalala(b);
}

/**
 * Split an amount by weights so the parts sum EXACTLY to the amount
 * (largest-remainder on halalas) — used by cost allocations.
 */
export function splitMoney(amount: number, weights: number[]): number[] {
  const total = toHalala(amount);
  const wSum = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (wSum <= 0 || weights.length === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * Math.max(w, 0)) / wSum);
  const floors = raw.map((r) => Math.floor(r));
  let rest = total - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (rest <= 0) break;
    floors[o.i] = (floors[o.i] ?? 0) + 1;
    rest -= 1;
  }
  return floors.map(fromHalala);
}

/** Percentage change (null when the base is zero — undefined growth). */
export function pctChange(current: number, previous: number): number | null {
  if (toHalala(previous) === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Ratio as a percentage with one decimal (null when the denominator is zero). */
export function pctOf(part: number, whole: number): number | null {
  if (toHalala(whole) === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}
