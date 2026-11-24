import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Badge, Button, Input, Modal, Select, Skeleton, useToast } from '@/shared/ui';
import { useCampaigns } from '@/features/loyalty/hooks/useLoyalty';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { campaignStatus } from '@/features/marketing/api/analytics.api';
import {
  eligibility,
  INELIGIBLE_LABEL,
  listTemplates,
  offerInputSchema,
  queueWhatsappOffer,
  renderTemplate,
  type IneligibleReason,
} from '@/features/marketing/api/whatsapp.api';

/** تجهيز عرض واتساب للعملاء المحددين: الحملة، العرض، القالب المعتمد، المعاينة، الانتهاء، التأكيد. */
export function WhatsAppOfferModal({
  customers,
  onClose,
  onSent,
  initialOffer,
  initialCampaignId,
}: {
  customers: { id: string; full_name: string }[];
  onClose: () => void;
  onSent: () => void;
  /** نص عرض جاهز (مثل رابط عجلة الحظ) — يُرسل داخل القالب المعتمد */
  initialOffer?: string;
  initialCampaignId?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: campaigns = [] } = useCampaigns();
  const { data: config = [] } = useConfig();
  const tpl = useQuery({ queryKey: ['marketing', 'wa-templates'], queryFn: listTemplates });
  const el = useQuery({
    queryKey: ['marketing', 'wa-eligibility', customers.map((c) => c.id).join(',')],
    queryFn: () => eligibility(customers.map((c) => c.id)),
  });
  const active = campaigns.filter((c) => campaignStatus(c) === 'active');
  const approved = (tpl.data ?? []).filter((t) => t.meta_status === 'approved' && t.is_active);
  const [picked, setPicked] = useState(initialCampaignId ?? '');
  // الحملات تُحمَّل بعد فتح النافذة — الافتراضي أول حملة نشطة
  const campaignId = picked || active[0]?.id || '';
  const campaign = campaigns.find((c) => c.id === campaignId);
  const [offer, setOffer] = useState(initialOffer ?? '');
  const [templateId, setTemplateId] = useState('');
  const defaultExpiry = (campaign?.extended_until || campaign?.end_at || '').slice(0, 10);
  const [expires, setExpires] = useState('');
  const exp = expires || defaultExpiry;
  const template = approved.find((t) => t.id === (templateId || approved[0]?.id));
  const eligible = (el.data ?? []).filter((e) => e.eligible);
  const excluded = useMemo(() => {
    const m = new Map<IneligibleReason, number>();
    for (const e of el.data ?? [])
      if (!e.eligible && e.reason) m.set(e.reason, (m.get(e.reason) ?? 0) + 1);
    return [...m.entries()];
  }, [el.data]);
  const firstName = customers.find((c) => c.id === eligible[0]?.customer_id)?.full_name ?? 'العميل';
  const offerText =
    offer ||
    (campaign
      ? campaign.description ||
        `خصم ${campaign.discount_pct}٪${campaign.coupon_code ? ` بالكود ${campaign.coupon_code}` : ''}`
      : '');
  const parsed = offerInputSchema.safeParse({
    campaign_id: campaignId,
    template_id: template?.id ?? '',
    offer: offerText,
    expires: exp,
  });
  const err = !eligible.length
    ? 'لا يوجد بين المحددين عميل مؤهل للإرسال'
    : parsed.success
      ? null
      : (parsed.error.issues[0]?.message ?? null);
  const limit = configValue(config, 'whatsapp_daily_limit', 250);

  const send = useMutation({
    mutationFn: () =>
      queueWhatsappOffer({
        campaign_id: campaignId,
        campaign_active: campaign ? campaignStatus(campaign) === 'active' : false,
        customer_ids: eligible.map((e) => e.customer_id),
        template: template!,
        offer: offerText,
        expires: exp,
        daily_limit: limit,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['marketing'] });
      toast.success(
        `أُضيفت ${r.queued} رسالة إلى قائمة الإرسال${r.duplicate ? ` · ${r.duplicate} أُرسل لها العرض سابقاً` : ''}${r.over_limit ? ` · ${r.over_limit} تجاوزت الحد اليومي` : ''}`,
      );
      onSent();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal open onClose={onClose} title="إرسال عرض عبر واتساب" size="lg">
      {el.isLoading || tpl.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-navy-50 p-3 text-sm">
            <span>
              المحددون <span className="num font-bold">{customers.length}</span>
            </span>
            <Badge tone="success">مؤهلون {eligible.length}</Badge>
            {excluded.map(([r, n]) => (
              <Badge key={r} tone="neutral">
                {INELIGIBLE_LABEL[r]}: <span className="num">{n}</span>
              </Badge>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="الحملة التسويقية"
              value={campaignId}
              onChange={(e) => setPicked(e.target.value)}
              options={[
                { value: '', label: active.length ? 'اختر حملة نشطة…' : 'لا توجد حملة نشطة' },
                ...active.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              label="قالب الرسالة (معتمد من Meta)"
              value={template?.id ?? ''}
              onChange={(e) => setTemplateId(e.target.value)}
              options={
                approved.length
                  ? approved.map((t) => ({ value: t.id, label: t.name_ar }))
                  : [{ value: '', label: 'لا يوجد قالب معتمد' }]
              }
            />
            <Input
              label="العرض أو الخصم"
              value={offerText}
              onChange={(e) => setOffer(e.target.value)}
            />
            <Input
              label="تاريخ انتهاء العرض"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={exp}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          {!approved.length && (
            <p className="text-[11px] text-gold-600">
              أضف قالباً واعتمده من Meta ثم سجّله من{' '}
              <Link to="/loyalty" className="underline">
                الولاء والتسويق ← الإدارة ← قوالب واتساب
              </Link>
              .
            </p>
          )}
          <div className="rounded-xl border border-navy-100 p-3">
            <p className="mb-1 text-xs text-purple">معاينة الرسالة ({firstName})</p>
            <p className="whitespace-pre-wrap text-sm text-navy-900">
              {template
                ? renderTemplate(template.body, firstName, offerText, exp || '—')
                : 'اختر قالباً لعرض المعاينة'}
            </p>
          </div>
          <p className="text-[11px] text-purple">
            تُرسل للمؤهلين فقط (موافقة تسويقية على واتساب + جوال صالح)، مرة واحدة لكل عميل في
            الحملة، وبحد يومي <span className="num">{limit}</span> رسالة. الحالة «مرسلة» تظهر بعد
            تأكيد Meta فقط.
          </p>
          {err && <p className="text-[11px] text-gold-600">{err}</p>}
          <Button
            className="w-full"
            disabled={Boolean(err)}
            loading={send.isPending}
            onClick={() => send.mutate()}
          >
            <Send size={15} /> تأكيد الإرسال إلى {eligible.length} عميل
          </Button>
        </div>
      )}
    </Modal>
  );
}
