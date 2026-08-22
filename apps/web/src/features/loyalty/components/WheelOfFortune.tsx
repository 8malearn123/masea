import { useMemo, useState } from 'react';
import { Sparkles, Gift, Ticket } from 'lucide-react';
import { Button, Card } from '@/shared/ui';
import { useSpinWheel, useWheelPrizes } from '@/features/loyalty/hooks/useLoyalty';
import { WHEEL_COLORS } from '@/features/loyalty/data/engine';
import type { WheelPrize } from '@/features/loyalty/types';

export function WheelOfFortune({
  spinsLeft,
  customerId,
}: {
  spinsLeft: number;
  customerId?: string | undefined;
}) {
  const spin = useSpinWheel(customerId);
  const { data: prizes = [] } = useWheelPrizes();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<WheelPrize | null>(null);

  // العجلة تعرض الجوائز المفعّلة فقط — تتحدّث فوراً مع تعديلات الإدارة.
  const active = useMemo(() => prizes.filter((p) => p.active), [prizes]);
  const seg = active.length > 0 ? 360 / active.length : 360;
  const gradient = useMemo(
    () =>
      active.length > 0
        ? `conic-gradient(${active
            .map(
              (_, i) =>
                `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`,
            )
            .join(', ')})`
        : WHEEL_COLORS[0],
    [active, seg],
  );

  function handleSpin() {
    if (spinning || spinsLeft <= 0 || active.length === 0) return;
    setWon(null);
    spin.mutate(undefined, {
      onSuccess: (prize) => {
        const idx = active.findIndex((p) => p.id === prize.id);
        const safeIdx = idx >= 0 ? idx : 0;
        // land the prize's slice centre under the top pointer
        const target = 360 * 5 + (360 - (safeIdx * seg + seg / 2));
        setSpinning(true);
        setRotation((r) => r - (r % 360) + target);
        window.setTimeout(() => {
          setSpinning(false);
          setWon(prize);
        }, 3600);
      },
    });
  }

  return (
    <Card className="text-center">
      <h2 className="mb-1 flex items-center justify-center gap-2 text-sm font-bold text-navy">
        <Sparkles size={16} className="text-gold-600" /> عجلة الحظ
      </h2>
      <p className="mb-4 text-xs text-purple">
        محاولاتك المتبقية: <span className="num font-bold text-navy">{spinsLeft}</span>
      </p>

      <div className="relative mx-auto h-64 w-64">
        {/* pointer */}
        <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
          <div className="h-0 w-0 border-x-8 border-t-[16px] border-x-transparent border-t-gold-600" />
        </div>
        <div
          className="h-64 w-64 rounded-full border-4 border-navy shadow-card"
          style={{
            background: gradient,
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? 'transform 3.5s cubic-bezier(0.17,0.67,0.12,0.99)' : 'none',
          }}
        />
        <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-navy bg-white">
          <Gift size={18} className="text-gold-600" />
        </div>
      </div>

      {/* legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {active.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1 text-[11px] text-purple">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
            />
            {p.label} <span className="num">({p.probability}٪)</span>
          </span>
        ))}
      </div>

      <Button
        className="mt-4 w-full"
        loading={spin.isPending || spinning}
        disabled={spinsLeft <= 0 || active.length === 0}
        onClick={handleSpin}
      >
        {spinsLeft > 0 ? 'أدِر العجلة' : 'لا توجد محاولات متبقية'}
      </Button>

      {won && (
        <div className="mt-3 rounded-xl bg-gold-100 p-3 text-sm font-bold text-gold-600">
          {won.prize_type === 'none' ? 'حظ أوفر المرة القادمة!' : `مبروك! ربحت: ${won.label}`}
          {won.coupon_code && won.prize_type !== 'none' && (
            <span className="num mt-1.5 flex items-center justify-center gap-1 text-xs">
              <Ticket size={12} /> كوبونك: {won.coupon_code}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
