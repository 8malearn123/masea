// Supabase Edge Function: يرسل رسائل الطابور عبر WhatsApp Cloud API.
// يُشغَّل دورياً (كل دقيقة) من pg_cron/جدولة Supabase بالمفتاح السري CRON_SECRET.
// الأسرار (supabase secrets set): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, CRON_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildTemplateRequest, graphUrl, isRetryable, type QueuedPayload } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  if (!token || !phoneId) {
    await db.rpc('integration_heartbeat', { p_name: 'whatsapp', p_ok: false, p_error: 'مفاتيح WhatsApp غير مضبوطة' });
    return new Response('not configured', { status: 503 });
  }
  const { data: batch, error } = await db.rpc('whatsapp_claim_batch', { p_limit: 20 });
  if (error) return new Response(error.message, { status: 500 });
  let ok = 0;
  let failed = 0;
  for (const m of (batch ?? []) as { id: string; to_address: string; payload: QueuedPayload }[]) {
    try {
      const res = await fetch(graphUrl(phoneId), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildTemplateRequest(m.to_address, m.payload)),
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { code?: number; message?: string };
      };
      const providerId = json.messages?.[0]?.id;
      if (res.ok && providerId) {
        // قبول الطلب ≠ إرسال: الحالة تتغيّر عند وصول Webhook «sent/delivered/read»
        await db.rpc('whatsapp_submitted', { p_id: m.id, p_provider_id: providerId });
        ok += 1;
      } else {
        await db.rpc('whatsapp_submit_failed', {
          p_id: m.id,
          p_error: `${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim(),
          p_retryable: isRetryable(res.status, json.error?.code ?? null),
        });
        failed += 1;
      }
    } catch (e) {
      await db.rpc('whatsapp_submit_failed', { p_id: m.id, p_error: String(e), p_retryable: true });
      failed += 1;
    }
  }
  await db.rpc('integration_heartbeat', {
    p_name: 'whatsapp',
    p_ok: failed === 0,
    p_error: failed ? `${failed} رسالة لم تُقبل` : null,
  });
  return Response.json({ submitted: ok, failed });
});
