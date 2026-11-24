/**
 * عجلة الحظ (0101): قواعد الجوائز، رابط آمن للعميل من جواله (استخدام واحد وصلاحية)،
 * والتقرير. مع قاعدة البيانات: create_wheel_link / wheel_public_view / spin_wheel_by_token
 * / wheel_report. الوضع التجريبي: روابط ونتائج في متصفح العرض فقط.
 */
import { supabase } from '@/shared/lib/supabase';
import { isDemoMode } from '@/shared/lib/demoBackend';
import { listWheelPrizes, generateCouponCode } from '@/features/loyalty/data/engine';
import type { WheelPrize } from '@/features/loyalty/types';

/** خصم أكبر من الحد المفتوح يجب تقييده بخدمات (مرآة wheel_prizes_guard). */
export function prizeRuleError(
  p: Pick<WheelPrize, 'prize_type' | 'value' | 'service_codes'>,
  openMaxPct: number,
): string | null {
  if (p.prize_type !== 'discount') return null;
  if (!(p.value > 0 && p.value <= 100)) return 'نسبة الخصم بين 1 و100';
  if (p.value > openMaxPct && (p.service_codes ?? []).length === 0)
    return `خصم ${p.value}٪ يتجاوز الحد المفتوح (${openMaxPct}٪) — حدّد الخدمات المشمولة`;
  return null;
}

export interface WheelPublicView {
  first_name: string | null;
  expired: boolean;
  used: boolean;
  prizes: { label: string; prize_type: string; chance: number }[];
  result: { label: string; coupon_code: string | null } | null;
}

interface DemoLink {
  customer_id: string;
  first_name: string;
  expires_at: string;
  used: boolean;
  result: { label: string; coupon_code: string | null } | null;
  spun_at: string | null;
}
const LS = 'masea_wheel_links';
function readLinks(): Record<string, DemoLink> {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, DemoLink>;
  } catch {
    return {};
  }
}
function writeLinks(v: Record<string, DemoLink>): void {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* demo storage best-effort */
  }
}
export function resetWheelLinksDemo(): void {
  writeLinks({});
}
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

export function wheelLinkUrl(token: string): string {
  return `${window.location.origin}/w/${token}`;
}

export async function createWheelLink(
  customerId: string,
  fullName: string,
  validHours = 72,
): Promise<{ token: string; expires_at: string }> {
  if (isDemoMode()) {
    const token = randomToken();
    const expires_at = new Date(Date.now() + validHours * 3600000).toISOString();
    writeLinks({
      ...readLinks(),
      [token]: {
        customer_id: customerId,
        first_name: fullName.split(' ')[0] ?? fullName,
        expires_at,
        used: false,
        result: null,
        spun_at: null,
      },
    });
    return { token, expires_at };
  }
  const { data, error } = await supabase.rpc('create_wheel_link', { p_customer: customerId });
  if (error) throw new Error(error.message);
  return data as { token: string; expires_at: string };
}

export async function wheelPublicView(token: string): Promise<WheelPublicView> {
  if (isDemoMode()) {
    const l = readLinks()[token];
    if (!l) throw new Error('الرابط غير صحيح');
    const prizes = listWheelPrizes().filter((p) => p.active);
    const total = prizes.reduce((s, p) => s + p.probability, 0) || 1;
    return {
      first_name: l.first_name,
      expired: l.expires_at < new Date().toISOString(),
      used: l.used,
      prizes: prizes.map((p) => ({
        label: p.label,
        prize_type: p.prize_type,
        chance: Math.round((p.probability * 1000) / total) / 10,
      })),
      result: l.result,
    };
  }
  const { data, error } = await supabase.rpc('wheel_public_view', { p_token: token });
  if (error) throw new Error(error.message);
  return data as WheelPublicView;
}

export async function spinByToken(
  token: string,
): Promise<{ label: string; prize_type: string; coupon_code: string | null }> {
  if (isDemoMode()) {
    const links = readLinks();
    const l = links[token];
    if (!l) throw new Error('الرابط غير صحيح');
    if (l.used) throw new Error('استُخدم هذا الرابط مسبقاً');
    if (l.expires_at < new Date().toISOString()) throw new Error('انتهت صلاحية الرابط');
    if (Object.values(links).some((x) => x.customer_id === l.customer_id && x.used))
      throw new Error('تجاوزت عدد محاولات عجلة الحظ المسموحة');
    const pool = listWheelPrizes().filter((p) => p.active);
    if (pool.length === 0) throw new Error('لا توجد جوائز مفعّلة على العجلة');
    let r = Math.random() * pool.reduce((s, p) => s + p.probability, 0);
    let prize = pool[pool.length - 1]!;
    for (const p of pool) {
      r -= p.probability;
      if (r <= 0) {
        prize = p;
        break;
      }
    }
    const coupon =
      prize.prize_type === 'discount' ? generateCouponCode(prize.prize_type, prize.value) : null;
    links[token] = {
      ...l,
      used: true,
      result: { label: prize.label, coupon_code: coupon },
      spun_at: new Date().toISOString(),
    };
    writeLinks(links);
    return { label: prize.label, prize_type: prize.prize_type, coupon_code: coupon };
  }
  const { data, error } = await supabase.rpc('spin_wheel_by_token', { p_token: token });
  if (error) throw new Error(error.message);
  return data as { label: string; prize_type: string; coupon_code: string | null };
}

export interface WheelReportRow {
  prize_label: string;
  prize_type: string;
  spins: number;
  coupons: number;
  redeemed: number;
  contracts_value: number;
  renewals: number;
  collected: number;
}

export async function wheelReport(from: string, to: string): Promise<WheelReportRow[]> {
  if (isDemoMode()) {
    const map = new Map<string, WheelReportRow>();
    for (const l of Object.values(readLinks())) {
      if (!l.result || !l.spun_at || l.spun_at.slice(0, 10) < from || l.spun_at.slice(0, 10) > to)
        continue;
      const row = map.get(l.result.label) ?? {
        prize_label: l.result.label,
        prize_type: '',
        spins: 0,
        coupons: 0,
        redeemed: 0,
        contracts_value: 0,
        renewals: 0,
        collected: 0,
      };
      row.spins += 1;
      if (l.result.coupon_code) row.coupons += 1;
      map.set(l.result.label, row);
    }
    return [...map.values()];
  }
  const { data, error } = await supabase.rpc('wheel_report', { p_from: from, p_to: to });
  if (error) throw new Error(`تعذّر تحميل تقرير العجلة: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    prize_label: String(r.prize_label),
    prize_type: String(r.prize_type),
    spins: Number(r.spins),
    coupons: Number(r.coupons),
    redeemed: Number(r.redeemed),
    contracts_value: Number(r.contracts_value),
    renewals: Number(r.renewals),
    collected: Number(r.collected),
  }));
}

/** تمديد حملة بصلاحية إدارية مع سبب (extend_campaign — 0101). */
export async function extendCampaign(
  campaignId: string,
  until: string,
  reason: string,
  role: string | null,
): Promise<void> {
  if (reason.trim().length < 5) throw new Error('سبب التمديد مطلوب');
  if (until <= new Date().toISOString()) throw new Error('تاريخ التمديد بعد اليوم');
  if (isDemoMode() || campaignId.startsWith('cm')) {
    if (!['admin', 'operations_manager', 'branch_manager'].includes(role ?? ''))
      throw new Error('تمديد الحملة بصلاحية إدارية (مدير الفرع/العمليات/المدير العام)');
    const { updateCampaign } = await import('@/features/loyalty/api/loyalty.api');
    await updateCampaign(campaignId, { extended_until: until });
    return;
  }
  const { error } = await supabase.rpc('extend_campaign', {
    p_campaign: campaignId,
    p_until: until,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(error.message);
}
