import { useState } from 'react';
import { Star, Wallet, Crown, Share2, Gift, Copy, TrendingUp, Phone } from 'lucide-react';
import { Badge, Button, Card, Input, useToast } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { useLoyaltyAccount, useRedeemPoints } from '@/features/loyalty/hooks/useLoyalty';
import { LOYALTY_CONFIG, PACKAGES } from '@/features/loyalty/data/engine';
import { TIER_LABEL, TIER_TONE } from '@/features/loyalty/types';

function Kpi({
  label,
  value,
  icon: Icon,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  icon: typeof Star;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="flex items-center gap-1 text-xs text-purple">
        <Icon size={13} /> {label}
      </p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

export function CustomerLoyalty({ customerId }: { customerId?: string | undefined }) {
  const { data: acc, isLoading } = useLoyaltyAccount(customerId);
  const redeem = useRedeemPoints(customerId);
  const toast = useToast();
  const [points, setPoints] = useState(1000);

  if (isLoading || !acc) {
    return <Card className="py-10 text-center text-sm text-purple">جارٍ التحميل…</Card>;
  }

  const redeemValue = points / LOYALTY_CONFIG.redeem_points_per_riyal;
  const remainingToNext = acc.next_tier
    ? Math.max(acc.next_tier.min_spend - acc.total_spend, 0)
    : 0;

  function copyCode() {
    void navigator.clipboard?.writeText(acc!.referral_code);
    toast.success('تم نسخ كود الإحالة');
  }

  return (
    <div className="space-y-5">
      {/* هوية العميل الذي يُستعلم عنه */}
      <div className="flex items-center gap-3 rounded-2xl border border-navy-100 bg-white p-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy-50 text-base font-bold text-navy">
          {acc.customer_name.charAt(0)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-navy">{acc.customer_name}</p>
            <Badge tone={TIER_TONE[acc.tier]}>{acc.tier_label}</Badge>
          </div>
          <a
            href={`tel:${acc.phone}`}
            className="num mt-0.5 flex items-center gap-1 text-xs text-purple hover:text-navy"
          >
            <Phone size={11} /> {acc.phone}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="رصيد النقاط"
          value={String(acc.points_balance)}
          icon={Star}
          tone="text-gold-600"
        />
        <Kpi
          label="رصيد المحفظة"
          value={`${sar(acc.wallet_balance)} ر.س`}
          icon={Wallet}
          tone="text-green-600"
        />
        <Kpi label="الفئة الحالية" value={acc.tier_label} icon={Crown} tone="text-navy" />
        <Kpi
          label="إجمالي الإنفاق"
          value={`${sar(acc.total_spend)} ر.س`}
          icon={TrendingUp}
          tone="text-teal"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* tier progress */}
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
              <Crown size={16} className="text-gold-600" /> فئتك ومزاياك
            </h2>
            <Badge tone={TIER_TONE[acc.tier]}>
              {acc.tier_label} · مضاعف النقاط ×{acc.multiplier}
            </Badge>
          </div>
          {acc.next_tier ? (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-purple">
                <span>{TIER_LABEL[acc.tier]}</span>
                <span>{acc.next_tier.label}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-navy-50">
                <div
                  className="h-full rounded-full bg-gold"
                  style={{ width: `${acc.progress_pct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-purple">
                تبقّى <span className="num font-bold text-navy">{sar(remainingToNext)} ر.س</span> من
                الإنفاق للترقية إلى <span className="font-bold">{acc.next_tier.label}</span>.
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1 text-sm text-green-600">
              <Crown size={15} className="text-gold-600" /> في أعلى فئة — ذهبي (مدير حساب مخصّص +
              أولوية كاملة).
            </p>
          )}
        </Card>

        {/* referral */}
        <Card>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-navy">
            <Share2 size={16} /> كود الإحالة
          </h2>
          <div className="flex items-center justify-between rounded-xl border border-dashed border-navy-100 bg-navy-50/40 px-3 py-2">
            <span className="num font-bold text-navy">{acc.referral_code}</span>
            <button
              onClick={copyCode}
              className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-navy-700"
            >
              <Copy size={12} /> نسخ
            </button>
          </div>
          <p className="mt-2 text-[11px] text-purple">
            احصل على <span className="font-bold">{LOYALTY_CONFIG.referral_commission_pct}٪</span>{' '}
            عمولة في محفظتك عند أول طلب مدفوع لمن تُحيله.
          </p>
        </Card>
      </div>

      {/* redeem */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Star size={16} className="text-gold-600" /> استبدال النقاط
        </h2>
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <Input
            label="عدد النقاط للاستبدال"
            type="number"
            min={0}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
          />
          <div className="rounded-xl bg-navy-50/60 p-3 text-center">
            <p className="text-[11px] text-purple">القيمة في المحفظة</p>
            <p className="num text-lg font-bold text-green-600">{sar(redeemValue)} ر.س</p>
          </div>
          <Button
            loading={redeem.isPending}
            disabled={points <= 0 || points > acc.points_balance}
            onClick={() => redeem.mutate(points)}
          >
            استبدال
          </Button>
        </div>
        {points > acc.points_balance && (
          <p className="mt-2 text-xs text-red-600">
            رصيد النقاط غير كافٍ (المتاح {acc.points_balance}).
          </p>
        )}
      </Card>

      {/* packages */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <Gift size={16} /> الباقات والمميزات
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {PACKAGES.map((p) => (
            <Card key={p.id} className="py-4">
              <div className="flex items-center justify-between">
                <p className="font-bold text-navy">{p.name}</p>
                <span className="num font-bold text-gold-600">{sar(p.special_price)} ر.س</span>
              </div>
              <p className="mt-1 text-[11px] text-purple">يشمل: {p.included.join(' · ')}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* ledgers */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-bold text-navy">حركات النقاط</h2>
          <ul className="space-y-2">
            {acc.points_ledger.slice(0, 6).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between border-b border-navy-50 pb-1.5 last:border-0"
              >
                <div>
                  <p className="text-xs text-navy">{e.description}</p>
                  <p className="num text-[10px] text-purple">{dateAr(e.at)}</p>
                </div>
                <span
                  className={`num text-sm font-bold ${e.points >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {e.points >= 0 ? '+' : ''}
                  {e.points}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-navy">حركات المحفظة</h2>
          <ul className="space-y-2">
            {acc.wallet_ledger.slice(0, 6).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between border-b border-navy-50 pb-1.5 last:border-0"
              >
                <div>
                  <p className="text-xs text-navy">{e.description}</p>
                  <p className="num text-[10px] text-purple">{dateAr(e.at)}</p>
                </div>
                <span
                  className={`num text-sm font-bold ${e.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}
                >
                  {e.type === 'credit' ? '+' : '−'}
                  {sar(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
