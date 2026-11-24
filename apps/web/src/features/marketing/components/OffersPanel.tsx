import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  useToast,
} from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useSources } from '@/features/settings/hooks/useSettings';
import { sourceLabelOf } from '@/features/marketing/api/attribution.api';
import { campaignStatus } from '@/features/marketing/api/analytics.api';
import {
  campaignAudience,
  listCampaignMessages,
  markManual,
  MESSAGE_STATUS_LABEL,
  offerSchema,
  personalize,
  queueOffer,
  recordResponse,
  RESPONSE_LABEL,
  type CampaignMessage,
  type Response,
} from '@/features/marketing/api/offers.api';
import type { Campaign } from '@/features/loyalty/types';

const STATUS_TONE = {
  queued: 'gold',
  sent: 'navy',
  delivered: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  opened_manually: 'neutral',
} as const;

/**
 * إرسال عرض الحملة للعملاء الموافقين فقط: اختيار العملاء ← نص العرض ← معاينة ← إرسال
 * ← سجل الحالة والاستجابة. بلا مزوّد مربوط تبقى الرسائل «في الطابور».
 */
export function OffersPanel({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sources = [] } = useSources();
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [picked, setPicked] = useState<string[]>([]);
  const [body, setBody] = useState(
    `أهلاً {الاسم}، ${campaign.description || campaign.name}${campaign.coupon_code ? ` — استخدم الكود ${campaign.coupon_code}` : ''}`,
  );
  const active = campaignStatus(campaign) === 'active';
  const aud = useQuery({
    queryKey: ['marketing', 'audience', channel],
    queryFn: () => campaignAudience(channel),
    enabled: can('loyalty', 'manage'),
  });
  const log = useQuery({
    queryKey: ['marketing', 'messages', campaign.id],
    queryFn: () => listCampaignMessages(campaign.id),
  });
  const parsed = offerSchema.safeParse({ body, customers: picked });
  const err = !active
    ? 'الحملة غير نشطة — لا تُرسل عروض لها'
    : parsed.success
      ? null
      : (parsed.error.issues[0]?.message ?? null);
  const first = (aud.data ?? []).find((c) => picked.includes(c.id));
  const preview = useMemo(() => personalize(body, first?.full_name ?? 'العميل'), [body, first]);

  const send = useMutation({
    mutationFn: () => queueOffer(campaign.id, active, picked, channel, body),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['marketing', 'messages', campaign.id] });
      toast.success(
        `وُضعت ${r.queued} رسالة في الطابور${r.skipped_duplicate ? ` · ${r.skipped_duplicate} مكرّرة` : ''}${r.skipped_no_consent ? ` · ${r.skipped_no_consent} بلا موافقة` : ''}${r.skipped_no_phone ? ` · ${r.skipped_no_phone} بلا جوال صحيح` : ''}`,
      );
      setPicked([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const manual = useMutation({
    mutationFn: (m: CampaignMessage) => markManual(m),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['marketing', 'messages', campaign.id] }),
  });
  const respond = useMutation({
    mutationFn: ({ m, r }: { m: CampaignMessage; r: Response }) => recordResponse(m, r),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['marketing', 'messages', campaign.id] }),
  });

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-navy">
        <Send size={18} /> إرسال العرض للعملاء
      </h2>
      <p className="mb-4 rounded-xl bg-gold-100/60 p-3 text-xs text-navy-900">
        لا يوجد مزوّد إرسال آلي مربوط بعد (WhatsApp Business API) — الرسائل تُحفظ «في الطابور» ولا
        تُعدّ مُرسلة. فتح واتساب يدوياً يُسجَّل «غير مؤكد الإرسال». تُعرض فقط للعملاء الذين سجّلوا
        موافقتهم.
      </p>
      {can('loyalty', 'manage') && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-end gap-2">
              <div className="w-40">
                <Select
                  label="القناة"
                  value={channel}
                  onChange={(e) => {
                    setChannel(e.target.value as 'whatsapp' | 'sms');
                    setPicked([]);
                  }}
                  options={[
                    { value: 'whatsapp', label: 'واتساب' },
                    { value: 'sms', label: 'رسائل نصية' },
                  ]}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPicked((aud.data ?? []).map((c) => c.id))}
              >
                تحديد الكل
              </Button>
            </div>
            {aud.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : aud.isError ? (
              <ErrorState onRetry={() => void aud.refetch()} />
            ) : (aud.data ?? []).length === 0 ? (
              <EmptyState
                icon={Send}
                title="لا عملاء موافقون على هذه القناة"
                description="سجّل موافقة العميل من ملفه أولاً."
              />
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-navy-100 p-2 text-sm">
                {(aud.data ?? []).map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-navy"
                        checked={picked.includes(c.id)}
                        onChange={(e) =>
                          setPicked((all) =>
                            e.target.checked ? [...all, c.id] : all.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <span className="flex-1">{c.full_name}</span>
                      <span className="text-[11px] text-purple">
                        {sourceLabelOf(sources, c.acquisition_source_code)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-navy-900">
              نص العرض (استخدم {'{الاسم}'} لاسم العميل)
              <textarea
                className="mt-1 min-h-28 w-full rounded-xl border border-navy-100 p-3 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="rounded-xl bg-navy-50 p-3 text-sm">
              <p className="mb-1 text-xs text-purple">
                معاينة{first ? ` (${first.full_name})` : ''}
              </p>
              <p className="whitespace-pre-wrap text-navy-900">{preview}</p>
            </div>
            {err && <p className="text-[11px] text-gold-600">{err}</p>}
            <Button
              className="w-full"
              disabled={Boolean(err)}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              <Send size={14} /> إرسال إلى {picked.length} عميل
            </Button>
          </div>
        </div>
      )}
      <h3 className="mb-2 mt-5 text-sm font-bold text-navy">سجل الإرسال</h3>
      {log.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : log.isError ? (
        <ErrorState onRetry={() => void log.refetch()} />
      ) : (log.data ?? []).length === 0 ? (
        <EmptyState icon={MessageCircle} title="لا رسائل بعد" />
      ) : (
        <ul className="divide-y divide-navy-50 text-sm">
          {(log.data ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-navy">{m.customer_name ?? m.to_address}</span>
                <span className="block truncate text-[11px] text-purple">
                  {dateAr(m.created_at)} · {m.body}
                </span>
              </span>
              <Badge tone={STATUS_TONE[m.status]}>{MESSAGE_STATUS_LABEL[m.status]}</Badge>
              {can('loyalty', 'manage') &&
                ['queued', 'failed'].includes(m.status) &&
                m.channel === 'whatsapp' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      window.open(
                        `https://wa.me/${m.to_address}?text=${encodeURIComponent(m.body)}`,
                        '_blank',
                        'noopener',
                      );
                      manual.mutate(m);
                    }}
                  >
                    <MessageCircle size={13} /> فتح واتساب يدوياً
                  </Button>
                )}
              <div className="w-32">
                <Select
                  aria-label="استجابة العميل"
                  value={m.response ?? ''}
                  onChange={(e) =>
                    e.target.value && respond.mutate({ m, r: e.target.value as Response })
                  }
                  options={[
                    { value: '', label: 'الاستجابة…' },
                    ...(Object.keys(RESPONSE_LABEL) as Response[]).map((r) => ({
                      value: r,
                      label: RESPONSE_LABEL[r],
                    })),
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
