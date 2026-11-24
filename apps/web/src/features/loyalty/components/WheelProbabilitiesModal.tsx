import { useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Button, Input, Modal } from '@/shared/ui';
import { useSetWheelProbabilities } from '@/features/loyalty/hooks/useLoyalty';
import { WHEEL_COLORS } from '@/features/loyalty/data/engine';
import { probabilityTotal, probabilityWarning } from '@/features/marketing/api/wheel.api';
import type { WheelPrize } from '@/features/loyalty/types';

/**
 * ضبط احتمالات كل الجوائز معاً: المجموع يظهر مباشرة (المفعّلة فقط)، والحفظ متاح عند 100٪ بالضبط.
 * القيم والأسماء لا تتغيّر هنا.
 */
export function WheelProbabilitiesModal({
  prizes,
  open,
  onClose,
}: {
  prizes: WheelPrize[];
  open: boolean;
  onClose: () => void;
}) {
  const save = useSetWheelProbabilities();
  const [rows, setRows] = useState(() =>
    prizes.map((p) => ({
      id: p.id,
      label: p.label,
      probability: String(p.probability),
      active: p.active,
    })),
  );
  const parsed = rows.map((r) => ({ ...r, probability: Number(r.probability) }));
  const invalid = parsed.some((r) => !(r.probability >= 0 && r.probability <= 100));
  const total = probabilityTotal(parsed);
  const warning = probabilityWarning(total);
  return (
    <Modal open={open} onClose={onClose} title="ضبط احتمالات الجوائز">
      <div className="space-y-3">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ background: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
              />
              <span
                className={`min-w-0 flex-1 truncate text-sm ${r.active ? 'text-navy' : 'text-purple line-through'}`}
              >
                {r.label}
              </span>
              <label className="flex items-center gap-1 text-xs text-purple">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-navy"
                  checked={r.active}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((x) => (x.id === r.id ? { ...x, active: e.target.checked } : x)),
                    )
                  }
                />
                مفعّلة
              </label>
              <div className="w-24">
                <Input
                  aria-label={`احتمال ${r.label}`}
                  inputMode="decimal"
                  className="num"
                  value={r.probability}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((x) => (x.id === r.id ? { ...x, probability: e.target.value } : x)),
                    )
                  }
                />
              </div>
              <span className="text-xs text-purple">٪</span>
            </div>
          ))}
        </div>
        <div
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
            warning ? 'bg-gold-100 text-gold-600' : 'bg-green-50 text-green-600'
          }`}
          data-testid="prob-total"
        >
          <span>{warning ?? 'مجموع احتمالات الجوائز المفعّلة'}</span>
          <span className="num flex items-center gap-1 font-bold">
            {total}٪ {warning ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
          </span>
        </div>
        <p className="text-[11px] text-purple">الجوائز المعطّلة لا تُحتسب ولا تظهر على العجلة.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={invalid || warning !== null}
            onClick={() =>
              save.mutate(
                parsed.map((r) => ({ id: r.id, probability: r.probability, active: r.active })),
                { onSuccess: onClose },
              )
            }
          >
            حفظ
          </Button>
        </div>
      </div>
    </Modal>
  );
}
