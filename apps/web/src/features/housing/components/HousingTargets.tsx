import { Target } from 'lucide-react';
import { Card, EmptyState } from '@/shared/ui';
import { useMyHousingTargets } from '@/features/housing/hooks/useHousing';

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

function Gauge({ label, actual, target }: { label: string; actual: number; target: number }) {
  const pct = Math.min(100, target ? Math.round((actual / target) * 100) : 0);
  const met = actual >= target;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-navy-900">{label}</span>
        <span className="num font-semibold text-navy">
          {actual}٪ <span className="text-purple">/ {target}٪</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-navy-50">
        <div
          className={`h-full rounded-full ${met ? 'bg-teal' : 'bg-gold-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1 text-[11px] ${met ? 'text-green-600' : 'text-purple'}`}>
        {met ? 'تم تحقيق المستهدف ✓' : `إنجاز ${pct}٪ من المستهدف`}
      </p>
    </div>
  );
}

export function HousingTargets() {
  const { data: targets = [], isLoading } = useMyHousingTargets();

  if (isLoading) return <Card className="text-sm text-purple">جارٍ التحميل…</Card>;
  if (targets.length === 0) {
    return (
      <EmptyState
        icon="🎯"
        title="لا توجد مستهدفات معيّنة"
        description="تظهر هنا مستهدفات السكن التي تُسندها الإدارة لك (نسبة الإشغال والحضور)."
      />
    );
  }

  return (
    <div className="space-y-4">
      {targets.map((t) => (
        <Card key={t.id}>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <Target size={16} /> مستهدفات {MONTHS_AR[t.month - 1]}{' '}
            <span className="num">{t.year}</span>
          </h2>
          <div className="space-y-4">
            <Gauge
              label="نسبة الإشغال"
              actual={t.occupancy_actual_pct}
              target={t.occupancy_target_pct}
            />
            <Gauge
              label="نسبة الحضور/الالتزام"
              actual={t.attendance_actual_pct}
              target={t.attendance_target_pct}
            />
          </div>
          {t.notes && (
            <p className="mt-4 rounded-xl bg-navy-50 px-3 py-2.5 text-sm text-purple">{t.notes}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
