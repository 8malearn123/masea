// Supabase Edge Function: Webhook من Meta — التحقق (GET) وحالات الرسائل والردود (POST).
// الأسرار: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET. يُنشر بلا JWT (--no-verify-jwt) لأن
// Meta لا ترسل JWT؛ الحماية بتوقيع X-Hub-Signature-256.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseWebhook, verifySignature } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    return ok
      ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
      : new Response('forbidden', { status: 403 });
  }
  const raw = await req.text();
  const valid = await verifySignature(
    Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
    raw,
    req.headers.get('x-hub-signature-256'),
  );
  if (!valid) return new Response('bad signature', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const parsed = parseWebhook(JSON.parse(raw));
  for (const s of parsed.statuses) {
    await db.rpc('whatsapp_status_update', { p_provider_id: s.id, p_status: s.status, p_error: s.error });
  }
  for (const m of parsed.messages) {
    await db.rpc('whatsapp_inbound_record', { p_from: m.from, p_body: m.text, p_provider_id: m.id });
  }
  return new Response('ok', { status: 200 });
});
