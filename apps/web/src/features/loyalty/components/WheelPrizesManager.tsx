import { useState } from 'react';
import { Sparkles, Plus, Pencil, Trash2, Eye, EyeOff, Ticket, CircleCheck } from 'lucide-react';
import { Badge, Button, Card } from '@/shared/ui';
import {
  useRemoveWheelPrize,
  useUpdateWheelPrize,
  useWheelPrizes,
} from '@/features/loyalty/hooks/useLoyalty';
import { WHEEL_COLORS } from '@/features/loyalty/data/engine';
import { WheelPrizeFormModal } from '@/features/loyalty/components/WheelPrizeFormModal';
import { PRIZE_TYPE_LABEL, type WheelPrize } from '@/features/loyalty/types';

export function WheelPrizesManager() {
  const { data: prizes = [] } = useWheelPrizes();
  const update = useUpdateWheelPrize();
  const remove = useRemoveWheelPrize();
  const [editing, setEditing] = useState<WheelPrize | null>(null);
  const [creating, setCreating] = useState(false);

  const activePrizes = prizes.filter((p) => p.active);
  const totalProb = activePrizes.reduce((s, p) => s + p.probability, 0);
  const probOk = totalProb === 100;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <Sparkles size={16} className="text-gold-600" /> جوائز عجلة الحظ
        </h2>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> إضافة جائزة
        </Button>
      </div>

      <div
        className={`mb-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
          probOk ? 'bg-green-50 text-green-600' : 'bg-gold-100 text-gold-600'
        }`}
      >
        <span>مجموع احتمالات الجوائز المفعّلة</span>
        <span className="num flex items-center gap-1 font-bold">
          {totalProb}٪{probOk ? <CircleCheck size={13} /> : <span>(يُفضّل 100٪)</span>}
        </span>
      </div>

      <div className="space-y-2">
        {prizes.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center gap-2 rounded-xl border p-2.5 ${
              p.active ? 'border-navy-100 bg-white' : 'border-navy-100 bg-navy-50/50 opacity-70'
            }`}
          >
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{ background: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-navy">{p.label}</span>
                {!p.active && <Badge tone="neutral">معطّلة</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-purple">
                <span>{PRIZE_TYPE_LABEL[p.prize_type]}</span>
                {p.prize_type !== 'none' && <span className="num">القيمة: {p.value}</span>}
                <span className="num">الاحتمال: {p.probability}٪</span>
                {p.coupon_code && (
                  <span className="num inline-flex items-center gap-1 rounded bg-gold-100 px-1.5 py-0.5 font-semibold text-gold-600">
                    <Ticket size={10} /> {p.coupon_code}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => update.mutate({ id: p.id, patch: { active: !p.active } })}
                className="rounded-lg p-1.5 text-purple transition hover:bg-navy-50 hover:text-navy"
                aria-label={p.active ? 'تعطيل' : 'تفعيل'}
                title={p.active ? 'تعطيل' : 'تفعيل'}
              >
                {p.active ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="rounded-lg p-1.5 text-purple transition hover:bg-navy-50 hover:text-navy"
                aria-label="تعديل"
                title="تعديل"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`حذف جائزة "${p.label}"؟`)) remove.mutate(p.id);
                }}
                className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50"
                aria-label="حذف"
                title="حذف"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <WheelPrizeFormModal prize={null} open={creating} onClose={() => setCreating(false)} />
      <WheelPrizeFormModal
        prize={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}
