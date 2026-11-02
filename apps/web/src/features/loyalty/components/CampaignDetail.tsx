import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, MessageCircle, Megaphone, Ticket } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Skeleton,
  StatTile,
  Table,
  useToast,
} from '@/shared/ui';
import type { BadgeTone, Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { useServices } from '@/hooks/useServices';
import { useConfig } from '@/features/settings/hooks/useSettings';
import { configValue } from '@/features/settings/api/settings.api';
import { useCampaigns } from '@/features/loyalty/hooks/useLoyalty';
import { useCustomerInsights } from '@/features/customers/hooks/useCrmCustomers';
import {
  campaignPerformance,
  issueCampaignCoupons,
  listCampaignCoupons,
  validateIssue,
  type CampaignCoupon,
  type IssueInput,
} from '@/features/loyalty/api/campaignCoupons.api';
import { CAMPAIGN_TYPE_LABEL, type Campaign } from '@/features/loyalty/types';

function couponState(c: CampaignCoupon, now = new Date()): { label: string; tone: BadgeTone } {
  if (!c.is_active) return { label: 'معطّل', tone: 'neutral' };
  if (c.ends_at && now > new Date(c.ends_at)) return { label: 'منتهي', tone: 'danger' };
  if (c.starts_at && now < new Date(c.starts_at)) return { label: 'لم يبدأ', tone: 'gold' };
  if (c.usage_limit !== null && c.usage_count >= c.usage_limit)
    return { label: 'مستنفد', tone: 'danger' };
  return { label: 'صالح', tone: 'success' };
}

/**
 * حملة تسويقية: أداؤها وكوبونات الإحالة الخاصة بها — الإصدار بنسبة مقترحة (5٪/10٪)
 * أو مخصّصة لمن يملك الإدارة، لاستخدام واحد أو عدة مرات، مع ربط الكوبون بعميل مُحيل.
 */
export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const campaign = campaigns.find((c) => c.id === id);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!campaign)
    return (
      <EmptyState
        title="الحملة غير موجودة"
        action={
          <Link to="/loyalty" className="text-sm font-medium text-navy underline">
            العودة إلى الولاء والتسويق
          </Link>
        }
      />
    );
  return <Body campaign={campaign} />;
}

function Body({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const { data: services = [] } = useServices();
  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ['loyalty', 'campaign-coupons', campaign.id],
    queryFn: () => listCampaignCoupons(campaign),
  });
  const perf = useMemo(() => campaignPerformance(coupons), [coupons]);
  const canIssue = can('loyalty', 'edit') || can('loyalty', 'manage') || can('pricing', 'manage');
  const toast = useToast();
  const serviceNames = (campaign.service_codes ?? [])
    .map((c) => services.find((s) => s.code === c)?.name_ar ?? c)
    .join('، ');

  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code);
    toast.success(`تم نسخ ${code}`);
  };
  const share = (c: CampaignCoupon) => {
    const text = `${campaign.name} — ماسية الشرق للاستقدام\nكوبون الخصم: ${c.code} (${c.discount_pct ?? ''}٪)${
      c.ends_at ? `\nصالح حتى ${c.ends_at.slice(0, 10)}` : ''
    }`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const columns: Column<CampaignCoupon>[] = [
    {
      key: 'code',
      header: 'الكوبون',
      cell: (c) => (
        <span className="inline-flex items-center gap-1">
          <span className="num font-semibold text-navy">{c.code}</span>
          {c.is_main && <Badge tone="gold">رئيسي</Badge>}
        </span>
      ),
    },
    {
      key: 'pct',
      header: 'الخصم',
      cell: (c) => <span className="num">{c.discount_pct ?? '—'}٪</span>,
    },
    {
      key: 'usage',
      header: 'الاستخدام',
      cell: (c) => (
        <span className="num text-xs">
          {c.uses} / {c.usage_limit ?? '∞'}
          <span className="block text-purple">
            {c.usage_limit === 1 ? 'مرة واحدة' : 'عدة مرات'}
          </span>
        </span>
      ),
      sortValue: (c) => c.uses,
    },
    {
      key: 'discount',
      header: 'إجمالي الخصم',
      cell: (c) => <span className="num text-red-600">{sar(c.total_discount)}</span>,
      sortValue: (c) => c.total_discount,
    },
    { key: 'referrer', header: 'العميل المُحيل', cell: (c) => c.referrer_name ?? '—' },
    { key: 'until', header: 'صالح حتى', cell: (c) => (c.ends_at ? dateAr(c.ends_at) : '—') },
    {
      key: 'state',
      header: 'الحالة',
      cell: (c) => {
        const s = couponState(c);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      cell: (c) => (
        <span className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`نسخ ${c.code}`}
            onClick={() => copy(c.code)}
          >
            <Copy size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`مشاركة ${c.code} عبر واتساب`}
            onClick={() => share(c)}
          >
            <MessageCircle size={14} />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Link
        to="/loyalty"
        className="inline-flex items-center gap-1 text-sm text-purple hover:text-navy"
      >
        <ArrowRight size={16} /> الولاء والتسويق
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
            <Megaphone size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-navy">{campaign.name}</h1>
              <Badge tone={campaign.is_active ? 'success' : 'neutral'}>
                {campaign.is_active ? 'نشطة' : 'متوقّفة'}
              </Badge>
              <Badge tone="navy">{CAMPAIGN_TYPE_LABEL[campaign.type]}</Badge>
            </div>
            {campaign.description && (
              <p className="mt-1 text-sm text-navy/80">{campaign.description}</p>
            )}
            <p className="mt-1 text-xs text-purple">
              {dateAr(campaign.start_at)} — {dateAr(campaign.end_at)} · الخدمات:{' '}
              {serviceNames || 'كل الخدمات'} · خصم الحملة {campaign.discount_pct}٪
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="الكوبونات" value={perf.coupons} hint={`${perf.activeCoupons} مفعّلة`} />
        <StatTile label="مرات الاستخدام" value={perf.uses} />
        <StatTile label="إجمالي الخصومات" value={`${sar(perf.totalDiscount)} ر.س`} tone="danger" />
        <StatTile
          label="مبيعات بالكوبونات (بعد الخصم)"
          value={`${sar(perf.salesAfterDiscount)} ر.س`}
          tone="success"
        />
      </div>

      {canIssue && <IssueForm campaign={campaign} />}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-navy">
          <Ticket size={18} /> كوبونات الحملة
        </h2>
        <Table
          columns={columns}
          rows={coupons}
          rowKey={(c) => c.id}
          isLoading={isLoading}
          emptyTitle="لا توجد كوبونات لهذه الحملة بعد"
        />
      </section>
    </div>
  );
}

function IssueForm({ campaign }: { campaign: Campaign }) {
  const { can } = usePermissions();
  const { data: config = [] } = useConfig();
  const { data: customers = [] } = useCustomerInsights();
  const qc = useQueryClient();
  const toast = useToast();
  const presets = [
    configValue(config, 'coupon_preset_pct_1', 5),
    configValue(config, 'coupon_preset_pct_2', 10),
  ];
  const policy = { presets, canCustom: can('loyalty', 'manage') || can('pricing', 'manage') };
  const [pct, setPct] = useState(String(presets[1] ?? 10));
  const [count, setCount] = useState('1');
  const [multi, setMulti] = useState(false);
  const [limit, setLimit] = useState('');
  const [referrerId, setReferrerId] = useState('');
  const [prefix, setPrefix] = useState('MAS-REF');

  const referrer = customers.find((c) => c.id === referrerId) ?? null;
  const input: IssueInput = {
    count: Number(count),
    pct: Number(pct),
    usageLimit: multi ? (limit.trim() ? Number(limit) : null) : 1,
    referrer: referrer ? { id: referrer.id, name: referrer.full_name } : null,
    prefix,
  };
  const error = validateIssue(input, policy);
  const issue = useMutation({
    mutationFn: () => issueCampaignCoupons(campaign, input, policy),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loyalty', 'campaign-coupons', campaign.id] });
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      toast.success(`تم إصدار ${input.count} كوبون`);
    },
    onError: (e: Error) => toast.error(e.message || 'تعذّر إصدار الكوبونات'),
  });

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-bold text-navy">إصدار كوبونات إحالة</h2>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <span className="text-xs text-purple">نسبة الخصم:</span>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPct(String(p))}
            className={`rounded-full px-3 py-1 text-sm font-medium ${Number(pct) === p ? 'bg-navy text-white' : 'bg-navy-50 text-navy'}`}
          >
            <span className="num">{p}٪</span>
          </button>
        ))}
        {policy.canCustom && (
          <div className="w-32">
            <Input
              label="نسبة مخصّصة"
              type="number"
              min={1}
              max={100}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="عدد الكوبونات"
          type="number"
          min={1}
          max={200}
          value={count}
          disabled={Boolean(referrer)}
          onChange={(e) => setCount(e.target.value)}
        />
        <Select
          label="الاستخدام"
          options={[
            { value: 'single', label: 'مرة واحدة لكل كوبون' },
            { value: 'multi', label: 'عدة مرات' },
          ]}
          value={multi ? 'multi' : 'single'}
          onChange={(e) => setMulti(e.target.value === 'multi')}
        />
        {multi && (
          <Input
            label="حد الاستخدام (فارغ = بلا حد)"
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        )}
        <Select
          label="العميل المُحيل (اختياري)"
          options={[
            { value: '', label: 'بدون مُحيل' },
            ...customers
              .filter((c) => c.is_active)
              .map((c) => ({ value: c.id, label: c.full_name })),
          ]}
          value={referrerId}
          onChange={(e) => {
            setReferrerId(e.target.value);
            if (e.target.value) setCount('1');
          }}
        />
        <Input
          label="بادئة الرمز"
          className="num"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
        />
      </div>
      <p className="mt-2 text-xs text-purple">
        الكوبون يتبع فترة الحملة وخدماتها، ويُرفض تلقائيًا إذا انتهى أو تعطّلت الحملة أو استُنفد أو
        طُبّق على خدمة غير مشمولة.
        {referrer && ' استخدام الكوبون من عميل جديد يسجّل إحالة لعمولة المُحيل.'}
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end">
        <Button disabled={Boolean(error)} loading={issue.isPending} onClick={() => issue.mutate()}>
          <Ticket size={16} /> إصدار
        </Button>
      </div>
    </Card>
  );
}
