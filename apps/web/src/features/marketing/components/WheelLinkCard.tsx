import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, MessageCircle, Sparkles } from 'lucide-react';
import { Button, Card, Select, useToast } from '@/shared/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { useCampaigns, useWheelPrizes } from '@/features/loyalty/hooks/useLoyalty';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { campaignStatus, riyadhDateTime } from '@/features/marketing/api/analytics.api';
import {
  WHEEL_NOT_READY,
  createWheelLink,
  probabilityTotal,
  wheelLinkUrl,
} from '@/features/marketing/api/wheel.api';
import { WhatsAppOfferModal } from '@/features/marketing/components/WhatsAppOfferModal';

interface WheelCustomer {
  id: string;
  full_name: string;
  national_id: string | null;
  phone: string | null;
}

/**
 * رابط عجلة الحظ للعميل مربوط بحملة نشطة — يفتحه من جواله ويتحقق بآخر 4 من الهوية والجوال.
 * يُرسل عبر واتساب بقالب معتمد (الطابور الرسمي) أو يُنسخ.
 */
export function WheelLinkCard({ customer }: { customer: WheelCustomer }) {
  const { can } = usePermissions();
  const toast = useToast();
  const { data: campaigns = [] } = useCampaigns();
  const { data: prizes = [] } = useWheelPrizes();
  const { data: config = [] } = useConfig();
  const active = campaigns.filter((c) => campaignStatus(c) === 'active');
  const [picked, setPicked] = useState('');
  const campaignId = picked || active[0]?.id || '';
  const campaign = active.find((c) => c.id === campaignId);
  const total = probabilityTotal(prizes);
  const [link, setLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [sending, setSending] = useState(false);
  const m = useMutation({
    mutationFn: () => {
      if (!campaign) throw new Error('اختر حملة نشطة للعجلة');
      return createWheelLink({
        customerId: customer.id,
        fullName: customer.full_name,
        nationalId: customer.national_id,
        phone: customer.phone,
        campaign: { id: campaign.id, name: campaign.name, terms: campaign.terms ?? null },
        validHours: configValue(config, 'wheel_link_valid_hours', 72),
      });
    },
    onSuccess: (r) => setLink({ url: wheelLinkUrl(r.token), expires_at: r.expires_at }),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('loyalty', 'manage')) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Sparkles size={16} /> رابط عجلة الحظ للعميل
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            aria-label="حملة العجلة"
            value={campaignId}
            onChange={(e) => {
              setPicked(e.target.value);
              setLink(null);
            }}
            options={
              active.length
                ? active.map((c) => ({ value: c.id, label: c.name }))
                : [{ value: '', label: 'لا حملة نشطة' }]
            }
          />
          <Button
            size="sm"
            variant="outline"
            loading={m.isPending}
            disabled={!campaign || total !== 100}
            onClick={() => m.mutate()}
          >
            {link ? 'إصدار رابط جديد' : 'إنشاء رابط'}
          </Button>
        </div>
      </div>
      {total !== 100 && (
        <p className="mt-2 rounded-lg bg-gold-100 px-3 py-2 text-xs text-gold-600">
          {WHEEL_NOT_READY} (الحالي <span className="num">{total}٪</span>) — تضبطها الإدارة من
          «الولاء» ← الإدارة.
        </p>
      )}
      {link ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 rounded-xl bg-navy-50 p-2">
            <span className="num min-w-0 flex-1 truncate text-xs" dir="ltr">
              {link.url}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(link.url)
                  .then(() => toast.success('نُسخ الرابط'))
              }
            >
              <Copy size={13} /> نسخ
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSending(true)}>
              <MessageCircle size={13} /> إرسال عبر واتساب
            </Button>
          </div>
          <p className="text-[11px] text-purple">
            صالح حتى <span className="num">{riyadhDateTime(link.expires_at)}</span> ولمرة واحدة،
            ويطلب من العميل آخر 4 أرقام من هويته وجواله المسجّلين. لا يُعرض الرابط مرة أخرى بعد
            إغلاق هذه البطاقة.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-purple">
          ينشئ رابطاً آمناً لحملة العجلة يفتحه العميل من جواله، ويُحفظ فوزه في ملفه بمرجع وصلاحية.
        </p>
      )}
      {sending && link && campaign && (
        <WhatsAppOfferModal
          customers={[{ id: customer.id, full_name: customer.full_name }]}
          initialCampaignId={campaign.id}
          initialOffer={`المشاركة في عجلة الحظ: ${link.url}`}
          onClose={() => setSending(false)}
          onSent={() => setSending(false)}
        />
      )}
    </Card>
  );
}
