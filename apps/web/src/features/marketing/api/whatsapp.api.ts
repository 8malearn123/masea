/**
 * إرسال عروض واتساب عبر WhatsApp Business Platform (0102). الإرسال الفعلي في دالة
 * الخادم whatsapp-send بقالب معتمد من Meta؛ الحالات من Webhook. الواجهة لا تعرض
 * «مرسلة» قبل تأكيد المزوّد. الوضع التجريبي: لا مزوّد — تبقى «قيد الانتظار».
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { useAuth } from '@/store/auth';
import { listContracts } from '@/features/contracts/api/contracts.api';
import { DEMO_CONSENT, DEMO_MSG, demoCustomers } from '@/features/marketing/api/offers.api';

export interface WaTemplate {
  id: string;
  name_ar: string;
  provider_name: string;
  language: string;
  body: string;
  meta_status: 'pending' | 'approved' | 'rejected';
  is_active: boolean;
}
export const META_STATUS_LABEL: Record<WaTemplate['meta_status'], string> = {
  pending: 'قيد مراجعة Meta',
  approved: 'معتمد من Meta',
  rejected: 'مرفوض',
};

export const templateSchema = z.object({
  name_ar: z.string().trim().min(3, { message: 'اسم القالب مطلوب' }),
  provider_name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{3,512}$/, { message: 'اسم القالب في Meta: أحرف إنجليزية صغيرة وأرقام و _' }),
  language: z.string().trim().min(2).default('ar'),
  body: z
    .string()
    .trim()
    .min(10, { message: 'نص القالب مطلوب' })
    .refine((b) => b.includes('{{1}}') && b.includes('{{2}}') && b.includes('{{3}}'), {
      message: 'النص يجب أن يحتوي {{1}} الاسم و{{2}} العرض و{{3}} تاريخ الانتهاء',
    }),
  meta_status: z.enum(['pending', 'approved', 'rejected']),
  is_active: z.boolean(),
});
export type TemplateInput = z.input<typeof templateSchema>;

const DEMO_TPL: WaTemplate[] = [];
export function resetWhatsappDemo(): void {
  DEMO_TPL.length = 0;
}

export async function listTemplates(): Promise<WaTemplate[]> {
  if (isDemoMode()) return DEMO_TPL.map((t) => ({ ...t }));
  const { data, error } = await supabase.from('whatsapp_templates').select('*').order('created_at');
  if (error) throw new Error(`تعذّر جلب القوالب: ${error.message}`);
  return (data ?? []) as WaTemplate[];
}

export async function saveTemplate(input: TemplateInput, id?: string): Promise<void> {
  const v = templateSchema.parse(input);
  if (isDemoMode()) {
    if (id) Object.assign(DEMO_TPL.find((t) => t.id === id) ?? {}, v);
    else DEMO_TPL.push({ ...v, id: `tpl-${Date.now()}` });
    return;
  }
  const q = id
    ? supabase
        .from('whatsapp_templates')
        .update({ ...v, updated_at: new Date().toISOString() })
        .eq('id', id)
    : supabase.from('whatsapp_templates').insert(v);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export function renderTemplate(body: string, name: string, offer: string, expires: string): string {
  return body
    .split('{{1}}')
    .join(name.split(' ')[0] ?? name)
    .split('{{2}}')
    .join(offer.trim())
    .split('{{3}}')
    .join(expires);
}

export type IneligibleReason = 'no_consent' | 'no_phone' | 'opted_out' | 'inactive';
export const INELIGIBLE_LABEL: Record<IneligibleReason, string> = {
  no_consent: 'بلا موافقة تسويقية على واتساب',
  no_phone: 'بلا جوال صالح',
  opted_out: 'ألغى الموافقة',
  inactive: 'عميل معطّل',
};

export async function eligibility(
  customerIds: string[],
): Promise<{ customer_id: string; eligible: boolean; reason: IneligibleReason | null }[]> {
  if (isDemoMode()) {
    const all = await demoCustomers();
    return customerIds.map((id) => {
      const c = all.find((x) => x.id === id);
      const k = DEMO_CONSENT[id];
      const reason: IneligibleReason | null = k?.opted_out_at
        ? 'opted_out'
        : !k?.granted || !k.channels.includes('whatsapp')
          ? 'no_consent'
          : !/^05\d{8}$/.test(c?.phone ?? '')
            ? 'no_phone'
            : null;
      return { customer_id: id, eligible: reason === null, reason };
    });
  }
  const { data, error } = await supabase.rpc('whatsapp_eligibility', { p_customers: customerIds });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    customer_id: string;
    eligible: boolean;
    reason: IneligibleReason | null;
  }[];
}

export interface WaQueueResult {
  queued: number;
  not_eligible: number;
  duplicate: number;
  over_limit: number;
  remaining_today: number;
}

export const offerInputSchema = z.object({
  campaign_id: z.string().min(1, { message: 'اختر الحملة' }),
  template_id: z.string().min(1, { message: 'اختر قالباً معتمداً' }),
  offer: z.string().trim().min(3, { message: 'اكتب العرض' }).max(300),
  expires: z
    .string()
    .min(1, { message: 'حدّد تاريخ انتهاء العرض' })
    .refine((d) => d >= new Date().toISOString().slice(0, 10), {
      message: 'تاريخ الانتهاء بعد اليوم',
    }),
});

/** نهاية اليوم بتوقيت الرياض (UTC+3، بلا توقيت صيفي). */
export function riyadhEndOfDay(date: string): string {
  return new Date(`${date}T23:59:59+03:00`).toISOString();
}

export async function queueWhatsappOffer(input: {
  campaign_id: string;
  campaign_active: boolean;
  customer_ids: string[];
  template: WaTemplate;
  offer: string;
  expires: string;
  daily_limit: number;
}): Promise<WaQueueResult> {
  offerInputSchema.parse({
    campaign_id: input.campaign_id,
    template_id: input.template.id,
    offer: input.offer,
    expires: input.expires,
  });
  if (isDemoMode() || isDemoId(input.campaign_id)) {
    if (!input.campaign_active) throw new Error('لا يُرسل عرض لحملة غير نشطة');
    if (input.template.meta_status !== 'approved' || !input.template.is_active)
      throw new Error('اختر قالب رسالة معتمداً من Meta');
    const el = await eligibility(input.customer_ids);
    const all = await demoCustomers();
    const today = new Date().toISOString().slice(0, 10);
    let left =
      input.daily_limit -
      DEMO_MSG.filter((m) => m.created_at.slice(0, 10) === today && m.status !== 'cancelled')
        .length;
    const res: WaQueueResult = {
      queued: 0,
      not_eligible: 0,
      duplicate: 0,
      over_limit: 0,
      remaining_today: 0,
    };
    for (const e of el) {
      if (!e.eligible) {
        res.not_eligible += 1;
        continue;
      }
      if (
        DEMO_MSG.some(
          (m) =>
            m.campaign_id === input.campaign_id &&
            m.customer_id === e.customer_id &&
            ['queued', 'sent', 'delivered', 'read'].includes(m.status),
        )
      ) {
        res.duplicate += 1;
        continue;
      }
      if (left <= 0) {
        res.over_limit += 1;
        continue;
      }
      const c = all.find((x) => x.id === e.customer_id)!;
      DEMO_MSG.unshift({
        id: `msg-${Date.now()}-${DEMO_MSG.length}`,
        campaign_id: input.campaign_id,
        customer_id: c.id,
        customer_name: c.full_name,
        channel: 'whatsapp',
        to_address: `966${(c.phone ?? '').slice(1)}`,
        body: renderTemplate(input.template.body, c.full_name, input.offer, input.expires),
        status: 'queued',
        response: null,
        created_at: new Date().toISOString(),
        offer_text: input.offer.trim(),
        offer_expires_at: riyadhEndOfDay(input.expires),
        created_by: useAuth.getState().profile?.id ?? null,
      });
      res.queued += 1;
      left -= 1;
    }
    res.remaining_today = Math.max(left, 0);
    return res;
  }
  const { data, error } = await supabase.rpc('queue_whatsapp_offer', {
    p_campaign: input.campaign_id,
    p_customers: input.customer_ids,
    p_template: input.template.id,
    p_offer: input.offer.trim(),
    p_expires: riyadhEndOfDay(input.expires),
  });
  if (error) throw new Error(error.message);
  return data as WaQueueResult;
}

export async function retryMessage(id: string, campaignId: string): Promise<void> {
  if (isDemoMode() || isDemoId(campaignId)) {
    const m = DEMO_MSG.find((x) => x.id === id);
    if (!m || m.status !== 'failed') throw new Error('تُعاد محاولة الرسائل الفاشلة فقط');
    m.status = 'queued';
    m.error = null;
    return;
  }
  const { error } = await supabase.rpc('retry_campaign_message', { p_id: id });
  if (error) throw new Error(error.message);
}

/** حالة الربط: null = لم يُشغَّل الإرسال بعد (لا مفاتيح أو لا نشر). */
export async function whatsappIntegration(): Promise<{
  last_ok_at: string | null;
  last_error: string | null;
} | null> {
  if (isDemoMode()) return null;
  const { data } = await supabase
    .from('integration_status')
    .select('last_ok_at, last_error')
    .eq('name', 'whatsapp')
    .maybeSingle();
  return (data as { last_ok_at: string | null; last_error: string | null } | null) ?? null;
}

export async function customerServiceCodes(): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const add = (id: string, s: string) => map.set(id, (map.get(id) ?? new Set()).add(s));
  if (isDemoMode()) {
    // مخزنا العرض: الربط بالاسم (ملف العميل وسجلات العقود منفصلان في الوضع التجريبي)
    const [contracts, customers] = await Promise.all([
      listContracts({ status: 'all', service: 'all', branch: 'all', search: '' }),
      demoCustomers(),
    ]);
    for (const k of contracts)
      for (const c of customers)
        if (k.service_code && c.full_name === k.customer_name) add(c.id, k.service_code);
    return map;
  }
  const { data, error } = await supabase.rpc('customer_service_codes');
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { customer_id: string; service_code: string }[])
    add(r.customer_id, r.service_code);
  return map;
}

export interface OfferMessageRef {
  id: string;
  campaign_id: string;
  campaign_name: string;
  offer_text: string | null;
  status: string;
  created_at: string;
}

export async function customerOfferMessages(customerId: string): Promise<OfferMessageRef[]> {
  if (isDemoMode() || isDemoId(customerId)) {
    const { listCampaigns } = await import('@/features/loyalty/api/loyalty.api');
    const camps = await listCampaigns();
    return DEMO_MSG.filter((m) => m.customer_id === customerId).map((m) => ({
      id: m.id,
      campaign_id: m.campaign_id,
      campaign_name: camps.find((c) => c.id === m.campaign_id)?.name ?? 'حملة',
      offer_text: m.offer_text ?? null,
      status: m.status,
      created_at: m.created_at,
    }));
  }
  const { data, error } = await supabase.rpc('customer_offer_messages', { p_customer: customerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as OfferMessageRef[];
}

export interface WaReport {
  messages: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  manual: number;
  replied: number;
  interested: number;
  engaged_customers: number;
  contracts: number;
  contracts_value: number;
  collected: number;
}

export async function campaignWhatsappReport(campaignId: string): Promise<WaReport> {
  if (isDemoMode() || isDemoId(campaignId)) {
    const ms = DEMO_MSG.filter((m) => m.campaign_id === campaignId);
    const n = (s: string) => ms.filter((m) => m.status === s).length;
    const contracts = (
      await listContracts({ status: 'all', service: 'all', branch: 'all', search: '' })
    ).filter(
      (k) =>
        k.status !== 'cancelled' &&
        k.campaign_message_id &&
        ms.some((m) => m.id === k.campaign_message_id),
    );
    return {
      messages: ms.length,
      queued: n('queued'),
      sent: n('sent'),
      delivered: n('delivered'),
      read: n('read'),
      failed: n('failed'),
      manual: n('opened_manually'),
      replied: ms.filter((m) => m.reply_text).length,
      interested: ms.filter((m) => m.response === 'interested').length,
      engaged_customers: new Set(
        ms
          .filter((m) => m.read_at || m.reply_text || m.response === 'interested')
          .map((m) => m.customer_id),
      ).size,
      contracts: contracts.length,
      contracts_value: contracts.reduce((s, k) => s + k.total_amount, 0),
      collected: contracts.reduce((s, k) => s + k.amount_paid, 0),
    };
  }
  const { data, error } = await supabase.rpc('campaign_whatsapp_report', {
    p_campaign: campaignId,
  });
  if (error) throw new Error(error.message);
  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {};
  const keys: (keyof WaReport)[] = [
    'messages',
    'queued',
    'sent',
    'delivered',
    'read',
    'failed',
    'manual',
    'replied',
    'interested',
    'engaged_customers',
    'contracts',
    'contracts_value',
    'collected',
  ];
  return Object.fromEntries(keys.map((k) => [k, Number(r[k] ?? 0)])) as unknown as WaReport;
}
