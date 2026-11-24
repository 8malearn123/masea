/**
 * WhatsApp Business Platform (Cloud API) — منطق خالص بلا اعتماد على Deno أو Node،
 * تستعمله دالتا whatsapp-send و whatsapp-webhook ويُختبر في Vitest.
 * المرجع: Graph API /{phone-number-id}/messages (type=template) و Webhooks (statuses/messages).
 */

export const GRAPH_VERSION = 'v20.0';

export interface QueuedPayload {
  template: string;
  language: string;
  params: string[];
}

/** طلب إرسال رسالة قالب معتمد — الرسائل التسويقية لا تُرسل إلا بقالب. */
export function buildTemplateRequest(to: string, p: QueuedPayload) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: p.template,
      language: { code: p.language || 'ar' },
      components: [
        {
          type: 'body',
          parameters: p.params.map((text) => ({ type: 'text', text: String(text).slice(0, 1000) })),
        },
      ],
    },
  };
}

export function graphUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

/** هل يُعاد المحاولة؟ 429 وأخطاء الخادم والمهلات نعم؛ أخطاء الطلب (قالب/رقم غير صالح) لا. */
export function isRetryable(httpStatus: number, errorCode?: number | null): boolean {
  if (httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) return true;
  // 130429: تجاوز معدل الإرسال · 131016: الخدمة غير متاحة مؤقتاً · 131056: معدل الزوج
  return errorCode === 130429 || errorCode === 131016 || errorCode === 131056;
}

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface ParsedWebhook {
  statuses: { id: string; status: ProviderStatus; error: string | null }[];
  messages: { id: string; from: string; text: string }[];
}

/** يستخرج الحالات والردود من جسم Webhook (entry → changes → value). */
export function parseWebhook(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { statuses: [], messages: [] };
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const e of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const st = String(s.status ?? '');
        if (!['sent', 'delivered', 'read', 'failed'].includes(st) || !s.id) continue;
        const err = (s.errors as { title?: string; message?: string; code?: number }[] | undefined)?.[0];
        out.statuses.push({
          id: String(s.id),
          status: st as ProviderStatus,
          error: err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() : null,
        });
      }
      for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
        if (!m.id || !m.from) continue;
        const text =
          (m.text as { body?: string } | undefined)?.body ??
          (m.button as { text?: string } | undefined)?.text ??
          (m.interactive as { button_reply?: { title?: string } } | undefined)?.button_reply?.title ??
          `[${String(m.type ?? 'رسالة')}]`;
        out.messages.push({ id: String(m.id), from: String(m.from), text });
      }
    }
  }
  return out;
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** يتحقق من توقيع Meta (X-Hub-Signature-256 = sha256=HMAC(app_secret, raw_body)). */
export async function verifySignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = header.slice(7);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
