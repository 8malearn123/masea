import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTemplateRequest,
  isRetryable,
  parseWebhook,
  verifySignature,
} from '../../../../../../supabase/functions/_shared/whatsapp';

describe('WhatsApp Cloud API helpers (Edge Functions)', () => {
  it('sends only approved templates with ordered body parameters', () => {
    const r = buildTemplateRequest('966551232001', {
      template: 'masea_comeback_offer',
      language: 'ar',
      params: ['ماجد', 'خصم 10٪', '2026-12-01'],
    });
    expect(r.type).toBe('template');
    expect(r.template.name).toBe('masea_comeback_offer');
    expect(r.template.components[0]?.parameters.map((p) => p.text)).toEqual([
      'ماجد',
      'خصم 10٪',
      '2026-12-01',
    ]);
  });

  it('retries only transient failures', () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(400, 130429)).toBe(true);
    expect(isRetryable(400, 132001)).toBe(false); // template does not exist
    expect(isRetryable(400, 131026)).toBe(false); // undeliverable number
  });

  it('parses statuses (incl. failures) and replies', () => {
    const p = parseWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.A', status: 'read' },
                  {
                    id: 'wamid.B',
                    status: 'failed',
                    errors: [{ code: 131026, title: 'Message undeliverable' }],
                  },
                  { id: 'wamid.C', status: 'deleted' },
                ],
                messages: [
                  { id: 'wamid.IN', from: '966551232001', type: 'text', text: { body: 'مهتم' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(p.statuses).toEqual([
      { id: 'wamid.A', status: 'read', error: null },
      { id: 'wamid.B', status: 'failed', error: '131026 Message undeliverable' },
    ]);
    expect(p.messages).toEqual([{ id: 'wamid.IN', from: '966551232001', text: 'مهتم' }]);
  });

  it('accepts only Meta-signed webhook bodies', async () => {
    const body = JSON.stringify({ entry: [] });
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(await verifySignature('app-secret', body, sig)).toBe(true);
    expect(await verifySignature('app-secret', body + ' ', sig)).toBe(false);
    expect(await verifySignature('app-secret', body, null)).toBe(false);
  });
});
