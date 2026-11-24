/**
 * الموافقة التسويقية وإرسال عروض الحملات (0100). لا يُرسل عرض إلا لعميل موافق.
 * لا يوجد مزوّد إرسال مربوط: الرسائل «في الطابور» ولا يُدّعى إرسالها؛ فتح واتساب
 * يدوياً يُسجَّل «فُتح يدوياً — غير مؤكد».
 */
import { z } from 'zod';
import { supabase } from '@/shared/lib/supabase';
import { isDemoId, isDemoMode } from '@/shared/lib/demoBackend';
import { searchCustomers } from '@/features/contracts/api/customers.api';
import { listCustomerInsights } from '@/features/customers/api/customers.api';

/** الوضع التجريبي: عملاء ملف العملاء + عملاء شاشة العقود (مخزنان منفصلان للعرض). */
async function demoCustomers(): Promise<{ id: string; full_name: string; phone: string | null }[]> {
  const [a, b] = await Promise.all([listCustomerInsights(), searchCustomers('')]);
  const seen = new Set<string>();
  return [...a, ...b]
    .map((c) => ({ id: c.id, full_name: c.full_name, phone: c.phone ?? null }))
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
import { demoAcquisition } from '@/features/marketing/api/attribution.api';

export type Channel = 'whatsapp' | 'sms' | 'email';
export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'واتساب',
  sms: 'رسائل نصية',
  email: 'بريد إلكتروني',
};

export interface Consent {
  granted: boolean;
  channels: Channel[];
  at: string | null;
  source: string | null;
  opted_out_at: string | null;
}

export type MessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'cancelled'
  | 'opened_manually';
export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'في الطابور — بانتظار مزوّد الإرسال',
  sent: 'أُرسلت',
  delivered: 'وصلت',
  failed: 'فشل الإرسال',
  cancelled: 'أُلغيت',
  opened_manually: 'فُتح واتساب يدوياً — غير مؤكد الإرسال',
};
export type Response = 'interested' | 'not_interested' | 'no_reply';
export const RESPONSE_LABEL: Record<Response, string> = {
  interested: 'مهتم',
  not_interested: 'غير مهتم',
  no_reply: 'لا رد',
};

export interface CampaignMessage {
  id: string;
  campaign_id: string;
  customer_id: string;
  customer_name: string | null;
  channel: 'whatsapp' | 'sms';
  to_address: string;
  body: string;
  status: MessageStatus;
  response: Response | null;
  created_at: string;
}

export interface AudienceMember {
  id: string;
  full_name: string;
  phone: string | null;
  acquisition_source_code: string | null;
}

const DEMO_CONSENT: Record<string, Consent> = {};
const DEMO_MSG: CampaignMessage[] = [];
export function resetOffersDemo(): void {
  for (const k of Object.keys(DEMO_CONSENT)) delete DEMO_CONSENT[k];
  DEMO_MSG.length = 0;
}
const demo = (id: string) => isDemoMode() || isDemoId(id);
const NONE: Consent = { granted: false, channels: [], at: null, source: null, opted_out_at: null };

export async function getConsent(customerId: string): Promise<Consent> {
  if (demo(customerId)) return { ...(DEMO_CONSENT[customerId] ?? NONE) };
  const { data, error } = await supabase
    .from('customers')
    .select('marketing_consent, consent_channels, consent_at, consent_source, opted_out_at')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw new Error(`تعذّر جلب الموافقة: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (!r) return { ...NONE };
  return {
    granted: Boolean(r.marketing_consent),
    channels: (r.consent_channels as Channel[] | null) ?? [],
    at: (r.consent_at as string | null) ?? null,
    source: (r.consent_source as string | null) ?? null,
    opted_out_at: (r.opted_out_at as string | null) ?? null,
  };
}

export const consentSchema = z.object({
  channels: z.array(z.enum(['whatsapp', 'sms', 'email'])).min(1, { message: 'حدّد قناة الموافقة' }),
  source: z.string().trim().min(3, { message: 'وثّق مصدر الموافقة' }),
});

export async function setConsent(
  customerId: string,
  granted: boolean,
  channels: Channel[],
  source: string,
): Promise<void> {
  if (granted) consentSchema.parse({ channels, source });
  if (demo(customerId)) {
    DEMO_CONSENT[customerId] = granted
      ? {
          granted: true,
          channels,
          at: new Date().toISOString(),
          source: source.trim(),
          opted_out_at: null,
        }
      : {
          ...(DEMO_CONSENT[customerId] ?? NONE),
          granted: false,
          opted_out_at: new Date().toISOString(),
        };
    return;
  }
  const { error } = await supabase.rpc('set_marketing_consent', {
    p_customer: customerId,
    p_granted: granted,
    p_channels: channels,
    p_source: source,
  });
  if (error) throw new Error(error.message);
}

export async function campaignAudience(channel: 'whatsapp' | 'sms'): Promise<AudienceMember[]> {
  if (isDemoMode()) {
    const all = await demoCustomers();
    return all
      .filter((c) => {
        const k = DEMO_CONSENT[c.id];
        return k?.granted && !k.opted_out_at && k.channels.includes(channel);
      })
      .map((c) => ({
        id: c.id,
        full_name: c.full_name,
        phone: c.phone,
        acquisition_source_code: demoAcquisition(c.id)?.source_code ?? null,
      }));
  }
  const { data, error } = await supabase.rpc('campaign_audience', { p_channel: channel });
  if (error) throw new Error(`تعذّر جلب العملاء المستهدفين: ${error.message}`);
  return (data ?? []) as AudienceMember[];
}

export const offerSchema = z.object({
  body: z.string().trim().min(10, { message: 'اكتب نص العرض (10 أحرف على الأقل)' }).max(900),
  customers: z.array(z.string()).min(1, { message: 'اختر عميلاً واحداً على الأقل' }),
});

export function personalize(body: string, fullName: string): string {
  return body
    .trim()
    .split('{الاسم}')
    .join(fullName.split(' ')[0] ?? fullName);
}

export interface QueueResult {
  queued: number;
  skipped_no_consent: number;
  skipped_no_phone: number;
  skipped_duplicate: number;
}

export async function queueOffer(
  campaignId: string,
  campaignActive: boolean,
  customerIds: string[],
  channel: 'whatsapp' | 'sms',
  body: string,
): Promise<QueueResult> {
  offerSchema.parse({ body, customers: customerIds });
  if (demo(campaignId)) {
    if (!campaignActive) throw new Error('لا يُرسل عرض لحملة غير نشطة');
    const all = await demoCustomers();
    const res: QueueResult = {
      queued: 0,
      skipped_no_consent: 0,
      skipped_no_phone: 0,
      skipped_duplicate: 0,
    };
    for (const id of customerIds) {
      const c = all.find((x) => x.id === id);
      const k = DEMO_CONSENT[id];
      if (!c || !k?.granted || k.opted_out_at || !k.channels.includes(channel)) {
        res.skipped_no_consent += 1;
        continue;
      }
      if (!/^05\d{8}$/.test(c.phone ?? '')) {
        res.skipped_no_phone += 1;
        continue;
      }
      if (
        DEMO_MSG.some(
          (m) =>
            m.campaign_id === campaignId &&
            m.customer_id === id &&
            ['queued', 'sent', 'delivered'].includes(m.status),
        )
      ) {
        res.skipped_duplicate += 1;
        continue;
      }
      DEMO_MSG.unshift({
        id: `msg-${Date.now()}-${DEMO_MSG.length}`,
        campaign_id: campaignId,
        customer_id: id,
        customer_name: c.full_name,
        channel,
        to_address: `966${(c.phone ?? '').slice(1)}`,
        body: personalize(body, c.full_name),
        status: 'queued',
        response: null,
        created_at: new Date().toISOString(),
      });
      res.queued += 1;
    }
    return res;
  }
  const { data, error } = await supabase.rpc('queue_campaign_offer', {
    p_campaign: campaignId,
    p_customers: customerIds,
    p_channel: channel,
    p_body: body,
  });
  if (error) throw new Error(error.message);
  return data as QueueResult;
}

export async function listCampaignMessages(campaignId: string): Promise<CampaignMessage[]> {
  if (demo(campaignId))
    return DEMO_MSG.filter((m) => m.campaign_id === campaignId).map((m) => ({ ...m }));
  const { data, error } = await supabase
    .from('campaign_messages')
    .select(
      'id, campaign_id, customer_id, channel, to_address, body, status, response, created_at, customers(full_name)',
    )
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`تعذّر جلب سجل الإرسال: ${error.message}`);
  return (
    (data ?? []) as unknown as (Omit<CampaignMessage, 'customer_name'> & {
      customers: { full_name: string } | null;
    })[]
  ).map(({ customers, ...m }) => ({ ...m, customer_name: customers?.full_name ?? null }));
}

/** فتح واتساب من جهاز الموظف — يُسجَّل «غير مؤكد» ولا يُعدّ إرسالاً. */
export async function markManual(m: CampaignMessage): Promise<void> {
  if (demo(m.campaign_id)) {
    const row = DEMO_MSG.find((x) => x.id === m.id);
    if (row && ['queued', 'failed'].includes(row.status)) row.status = 'opened_manually';
    return;
  }
  const { error } = await supabase.rpc('mark_campaign_message_manual', { p_id: m.id });
  if (error) throw new Error(error.message);
}

export async function recordResponse(m: CampaignMessage, response: Response): Promise<void> {
  if (demo(m.campaign_id)) {
    const row = DEMO_MSG.find((x) => x.id === m.id);
    if (row) row.response = response;
    return;
  }
  const { error } = await supabase.rpc('record_campaign_response', {
    p_id: m.id,
    p_response: response,
  });
  if (error) throw new Error(error.message);
}
