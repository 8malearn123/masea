import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, RotateCcw, Send, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  StatTile,
  useToast,
} from '@/shared/ui';
import { dateTimeAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useUserNames } from '@/features/contracts/components/details/ContractTabs';
import {
  listCampaignMessages,
  markManual,
  MESSAGE_STATUS_LABEL,
  recordResponse,
  RESPONSE_LABEL,
  type CampaignMessage,
  type Response,
} from '@/features/marketing/api/offers.api';
import {
  campaignWhatsappReport,
  retryMessage,
  whatsappIntegration,
} from '@/features/marketing/api/whatsapp.api';
import type { Campaign } from '@/features/loyalty/types';

const STATUS_TONE = {
  queued: 'gold',
  sent: 'navy',
  delivered: 'teal',
  read: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  opened_manually: 'neutral',
} as const;

/** رسائل واتساب للحملة: الحالات المؤكدة من Meta، إعادة المحاولة، الردود، والنتائج. */
export function OffersPanel({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const manage = can('loyalty', 'manage');
  const log = useQuery({
    queryKey: ['marketing', 'messages', campaign.id],
    queryFn: () => listCampaignMessages(campaign.id),
  });
  const rep = useQuery({
    queryKey: ['marketing', 'wa-report', campaign.id],
    queryFn: () => campaignWhatsappReport(campaign.id),
  });
  const integ = useQuery({
    queryKey: ['marketing', 'wa-integration'],
    queryFn: whatsappIntegration,
  });
  const senders = useUserNames((log.data ?? []).map((m) => m.created_by));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['marketing'] });
  const retry = useMutation({
    mutationFn: (m: CampaignMessage) => retryMessage(m.id, m.campaign_id),
    onSuccess: () => {
      refresh();
      toast.success('أُعيدت الرسالة إلى قائمة الانتظار');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const manual = useMutation({
    mutationFn: (m: CampaignMessage) => markManual(m),
    onSuccess: refresh,
  });
  const respond = useMutation({
    mutationFn: ({ m, r }: { m: CampaignMessage; r: Response }) => recordResponse(m, r),
    onSuccess: refresh,
  });
  const r = rep.data;
  const connected = Boolean(integ.data?.last_ok_at);

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-navy">
          <Send size={18} /> عروض واتساب للحملة
        </h2>
        {manage && (
          <Link
            to="/customers"
            className="inline-flex items-center gap-1.5 rounded-xl border border-navy px-3 py-2 text-xs font-semibold text-navy hover:bg-navy-50"
          >
            <Users size={14} /> اختيار العملاء وإرسال عرض
          </Link>
        )}
      </div>
      {!connected && (
        <p className="mb-4 rounded-xl bg-gold-100/60 p-3 text-xs text-navy-900">
          الإرسال عبر WhatsApp Business Platform لم يُفعَّل بعد (مفاتيح Meta ودالة الإرسال على
          الخادم) — الرسائل «قيد الانتظار» ولا تُعدّ مرسلة حتى يؤكدها مزوّد الخدمة.
          {integ.data?.last_error ? ` آخر خطأ: ${integ.data.last_error}` : ''}
        </p>
      )}
      {rep.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : r ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="الرسائل"
            value={r.messages}
            hint={`قيد الانتظار ${r.queued} · فشل ${r.failed}`}
          />
          <StatTile
            label="مرسلة / تم التسليم"
            value={`${r.sent + r.delivered + r.read} / ${r.delivered + r.read}`}
          />
          <StatTile label="تمت القراءة" value={r.read} tone="success" />
          <StatTile
            label="عملاء متفاعلون"
            value={r.engaged_customers}
            hint={`ردود ${r.replied} · مهتمون ${r.interested}`}
          />
          <StatTile
            label="عقود مرتبطة"
            value={r.contracts}
            hint={`قيمتها ${sar(r.contracts_value)}`}
          />
          <StatTile label="المحصّل منها" value={sar(r.collected)} tone="success" />
        </div>
      ) : null}
      {log.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : log.isError ? (
        <ErrorState onRetry={() => void log.refetch()} />
      ) : (log.data ?? []).length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="لا رسائل لهذه الحملة"
          description="اختر العملاء من صفحة العملاء وأرسل لهم العرض."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-right text-xs text-purple">
                {[
                  'العميل',
                  'الجوال',
                  'العرض',
                  'الموظف',
                  'الحالة',
                  'الأوقات',
                  'الرد',
                  'الاستجابة',
                  '',
                ].map((h) => (
                  <th key={h} className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(log.data ?? []).map((m) => (
                <tr key={m.id} className="border-b border-navy-50 align-top">
                  <td className="px-2 py-2 font-semibold text-navy">{m.customer_name ?? '—'}</td>
                  <td className="num px-2 py-2 text-xs" dir="ltr">
                    +{m.to_address}
                  </td>
                  <td className="px-2 py-2 text-xs">{m.offer_text ?? m.body}</td>
                  <td className="px-2 py-2 text-xs">
                    {(m.created_by && senders.data?.get(m.created_by)) || '—'}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={STATUS_TONE[m.status]}>{MESSAGE_STATUS_LABEL[m.status]}</Badge>
                    {m.error && (
                      <span className="mt-1 block text-[11px] text-red-600">{m.error}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-purple">
                    <span className="block">إنشاء {dateTimeAr(m.created_at)}</span>
                    {m.sent_at && <span className="block">إرسال {dateTimeAr(m.sent_at)}</span>}
                    {m.delivered_at && (
                      <span className="block">تسليم {dateTimeAr(m.delivered_at)}</span>
                    )}
                    {m.read_at && <span className="block">قراءة {dateTimeAr(m.read_at)}</span>}
                  </td>
                  <td className="px-2 py-2 text-xs">{m.reply_text ?? '—'}</td>
                  <td className="px-2 py-2">
                    <div className="w-28">
                      <Select
                        aria-label="استجابة العميل"
                        value={m.response ?? ''}
                        disabled={!manage}
                        onChange={(e) =>
                          e.target.value && respond.mutate({ m, r: e.target.value as Response })
                        }
                        options={[
                          { value: '', label: '—' },
                          ...(Object.keys(RESPONSE_LABEL) as Response[]).map((x) => ({
                            value: x,
                            label: RESPONSE_LABEL[x],
                          })),
                        ]}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {manage && m.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={retry.isPending && retry.variables?.id === m.id}
                        onClick={() => retry.mutate(m)}
                      >
                        <RotateCcw size={13} /> إعادة المحاولة
                      </Button>
                    )}
                    {manage && m.status === 'queued' && !connected && (
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
                        <MessageCircle size={13} /> فتح يدوياً
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
