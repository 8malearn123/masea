import { useState } from 'react';
import {
  Star,
  Megaphone,
  Users,
  Gift,
  Sparkles,
  UserRound,
  Settings2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Ticket,
} from 'lucide-react';
import { Badge, Button, Card, Table, type Column } from '@/shared/ui';
import { dateAr, sar } from '@/shared/lib/format';
import {
  useCampaigns,
  useLoyaltyAccount,
  useLoyaltyCustomers,
  useLoyaltyTxns,
  useReferrals,
  useRemoveCampaign,
  useUpdateCampaign,
} from '@/features/loyalty/hooks/useLoyalty';
import { CustomerLoyalty } from '@/features/loyalty/components/CustomerLoyalty';
import { CustomerPicker } from '@/features/loyalty/components/CustomerPicker';
import { WheelOfFortune } from '@/features/loyalty/components/WheelOfFortune';
import { WheelPrizesManager } from '@/features/loyalty/components/WheelPrizesManager';
import { CampaignFormModal } from '@/features/loyalty/components/CampaignFormModal';
import { LOYALTY_CONFIG, PACKAGES, TIERS } from '@/features/loyalty/data/engine';
import {
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_TYPE_TONE,
  TXN_TYPE_LABEL,
  TXN_TYPE_TONE,
  type Campaign,
  type LoyaltyTxn,
} from '@/features/loyalty/types';

function Kpi({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

/* ----------------------------- marketing view ---------------------------- */
function MarketingView() {
  const { data: txns = [], isLoading, isError, refetch } = useLoyaltyTxns();
  const { data: campaigns = [] } = useCampaigns();
  const { data: referrals = [] } = useReferrals();
  const updateCampaign = useUpdateCampaign();
  const removeCampaign = useRemoveCampaign();
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  const earned = txns.filter((t) => t.points > 0).reduce((s, t) => s + t.points, 0);
  const redeemed = txns
    .filter((t) => t.type === 'redeem')
    .reduce((s, t) => s + Math.abs(t.points), 0);
  const activeCampaigns = campaigns.filter((c) => c.is_active).length;
  const pendingCommission = referrals
    .filter((r) => !r.is_paid)
    .reduce((s, r) => s + r.commission_amount, 0);

  const columns: Column<LoyaltyTxn>[] = [
    {
      key: 'customer_name',
      header: 'العميل',
      cell: (t) => <span className="font-semibold text-navy">{t.customer_name}</span>,
    },
    {
      key: 'type',
      header: 'النوع',
      cell: (t) => <Badge tone={TXN_TYPE_TONE[t.type]}>{TXN_TYPE_LABEL[t.type]}</Badge>,
    },
    {
      key: 'points',
      header: 'النقاط',
      cell: (t) => (
        <span className={`num font-bold ${t.points >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {t.points >= 0 ? '+' : ''}
          {t.points}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'الوصف',
      cell: (t) => <span className="text-xs">{t.description}</span>,
    },
    {
      key: 'created_at',
      header: 'التاريخ',
      cell: (t) => <span className="num text-xs">{dateAr(t.created_at)}</span>,
    },
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="نقاط مكتسبة" value={String(earned)} tone="text-green-600" />
        <Kpi label="نقاط مستبدلة" value={String(redeemed)} tone="text-navy" />
        <Kpi label="حملات نشطة" value={String(activeCampaigns)} tone="text-teal" />
        <Kpi
          label="عمولات إحالة معلّقة"
          value={`${sar(pendingCommission)} ر.س`}
          tone="text-gold-600"
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Megaphone size={16} /> الحملات التسويقية
            </h2>
            <Button variant="primary" size="sm" onClick={() => setCreatingCampaign(true)}>
              <Plus size={14} /> حملة جديدة
            </Button>
          </div>
          {campaigns.map((c) => (
            <Card key={c.id} className="py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-bold text-navy">{c.name}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone={c.is_active ? 'success' : 'neutral'}>
                    {c.is_active ? 'نشطة' : 'متوقّفة'}
                  </Badge>
                  <button
                    type="button"
                    onClick={() =>
                      updateCampaign.mutate({ id: c.id, patch: { is_active: !c.is_active } })
                    }
                    className="rounded-lg p-1 text-purple transition hover:bg-navy-50 hover:text-navy"
                    aria-label={c.is_active ? 'إيقاف' : 'تفعيل'}
                    title={c.is_active ? 'إيقاف' : 'تفعيل'}
                  >
                    {c.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingCampaign(c)}
                    className="rounded-lg p-1 text-purple transition hover:bg-navy-50 hover:text-navy"
                    aria-label="تعديل"
                    title="تعديل"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`حذف حملة "${c.name}"؟`)) removeCampaign.mutate(c.id);
                    }}
                    className="rounded-lg p-1 text-red-500 transition hover:bg-red-50"
                    aria-label="حذف"
                    title="حذف"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-purple">
                <Badge tone={CAMPAIGN_TYPE_TONE[c.type]}>{CAMPAIGN_TYPE_LABEL[c.type]}</Badge>
                <span className="num">خصم {c.discount_pct}٪</span>
              </div>
              {c.coupon_code && (
                <span className="num mt-2 inline-flex items-center gap-1 rounded bg-gold-100 px-1.5 py-0.5 text-[11px] font-semibold text-gold-600">
                  <Ticket size={10} /> {c.coupon_code}
                </span>
              )}
              <div className="mt-2 flex items-center justify-between text-[11px] text-purple">
                <span className="num">
                  {dateAr(c.start_at)} — {dateAr(c.end_at)}
                </span>
                <span className="num flex items-center gap-1 text-navy">
                  <Users size={11} /> {c.usage_count}
                </span>
              </div>
            </Card>
          ))}
          <h2 className="flex items-center gap-2 pt-2 text-sm font-bold text-navy">
            <Gift size={16} /> الإحالات
          </h2>
          {referrals.map((r) => (
            <Card key={r.id} className="py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-navy">
                  {r.referrer_name} ← {r.referee_name}
                </p>
                <Badge tone={r.is_paid ? 'success' : 'gold'}>
                  {r.is_paid ? 'مدفوعة' : 'معلّقة'}
                </Badge>
              </div>
              <p className="num mt-1 text-[11px] text-purple">
                عمولة: {sar(r.commission_amount)} ر.س
              </p>
            </Card>
          ))}
        </div>
        <div className="lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <Star size={16} /> حركات النقاط
          </h2>
          <Table
            columns={columns}
            rows={txns}
            rowKey={(t) => t.id}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            emptyTitle="لا توجد حركات نقاط"
          />
        </div>
      </div>

      <CampaignFormModal
        campaign={null}
        open={creatingCampaign}
        onClose={() => setCreatingCampaign(false)}
      />
      <CampaignFormModal
        campaign={editingCampaign}
        open={editingCampaign !== null}
        onClose={() => setEditingCampaign(null)}
      />
    </>
  );
}

/* ------------------------------- admin view ------------------------------ */
function AdminView() {
  const cfg = LOYALTY_CONFIG;
  const item = (label: string, value: string) => (
    <div className="flex items-center justify-between rounded-lg bg-navy-50/50 px-3 py-2 text-sm">
      <span className="text-purple">{label}</span>
      <span className="num font-bold text-navy">{value}</span>
    </div>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Settings2 size={16} /> إعدادات الولاء
        </h2>
        <div className="space-y-2">
          {item('نقاط لكل ريال', String(cfg.points_per_riyal))}
          {item('نقاط الاستبدال لكل ريال', String(cfg.redeem_points_per_riyal))}
          {item('عمولة الإحالة', `${cfg.referral_commission_pct}٪`)}
          {item('خصم الطلب الأول', `${cfg.first_order_discount_pct}٪`)}
          {item('محاولات عجلة الحظ', String(cfg.wheel_spins_per_customer))}
        </div>
        <p className="mt-2 text-[11px] text-purple">
          قابلة للتعديل من الإدارة عند ربط Supabase (جدول loyalty_config).
        </p>
      </Card>
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Star size={16} /> الفئات والمضاعفات
        </h2>
        <div className="space-y-2">
          {TIERS.map((t) => item(`${t.label} (من ${sar(t.min_spend)} ر.س)`, `×${t.multiplier}`))}
        </div>
        <h2 className="mb-2 mt-4 flex items-center gap-2 text-sm font-bold text-navy">
          <Gift size={16} /> الباقات
        </h2>
        <div className="space-y-1.5">
          {PACKAGES.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-navy">{p.name}</span>
              <span className="num font-bold text-gold-600">{sar(p.special_price)} ر.س</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="lg:col-span-2">
        <WheelPrizesManager />
      </div>
    </div>
  );
}

/* --------------------------------- board --------------------------------- */
export default function LoyaltyBoard() {
  const [tab, setTab] = useState<'account' | 'wheel' | 'marketing' | 'admin'>('account');
  const { data: customers = [] } = useLoyaltyCustomers();
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  // العميل الفعّال: المختار أو أول عميل في القائمة
  const activeCustomerId = customerId ?? customers[0]?.id;
  const { data: acc } = useLoyaltyAccount(activeCustomerId);
  const perCustomer = tab === 'account' || tab === 'wheel';

  const TABS: { value: typeof tab; label: string; icon: typeof Star }[] = [
    { value: 'account', label: 'حساب العميل', icon: UserRound },
    { value: 'wheel', label: 'عجلة الحظ', icon: Sparkles },
    { value: 'marketing', label: 'التسويق', icon: Megaphone },
    { value: 'admin', label: 'الإدارة', icon: Settings2 },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-50 text-navy">
          <Star size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-navy">الولاء والتسويق</h1>
          <p className="text-sm text-purple">
            من عميل عادي إلى سفير للعلامة — نقاط، محفظة، فئات، إحالات، وعجلة حظ.
          </p>
        </div>
      </div>

      <div className="mb-4 inline-flex flex-wrap rounded-xl bg-navy-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === t.value ? 'bg-white text-navy shadow-card' : 'text-purple'}`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {perCustomer && <CustomerPicker value={activeCustomerId} onChange={setCustomerId} />}

      {tab === 'account' && <CustomerLoyalty customerId={activeCustomerId} />}
      {tab === 'wheel' && (
        <div className="mx-auto max-w-md">
          <WheelOfFortune
            key={activeCustomerId}
            customerId={activeCustomerId}
            spinsLeft={acc?.spins_left ?? 0}
          />
        </div>
      )}
      {tab === 'marketing' && <MarketingView />}
      {tab === 'admin' && <AdminView />}
    </div>
  );
}
