import { useMemo } from 'react';
import { BarChart3, History } from 'lucide-react';
import { Badge, Card } from '@/shared/ui';
import { dateAr } from '@/shared/lib/format';
import { useHousingScans, useResidents } from '@/features/housing/hooks/useHousing';
import {
  RESIDENT_STATUS_LABEL,
  RESIDENT_STATUS_TONE,
  SCAN_DIRECTION_LABEL,
  type ResidentStatus,
} from '@/features/housing/types';

const STATUS_ORDER: ResidentStatus[] = ['present', 'absent', 'on_service', 'medical'];

export function HousingReport() {
  const { data: residents = [] } = useResidents();
  const { data: scans = [] } = useHousingScans();

  const byStatus = useMemo(() => {
    const c: Record<ResidentStatus, number> = { present: 0, absent: 0, on_service: 0, medical: 0 };
    residents.forEach((r) => (c[r.status] += 1));
    return c;
  }, [residents]);

  const total = residents.length;
  const present = byStatus.present;
  const attendanceRate = total ? Math.round((present / total) * 100) : 0;
  const max = Math.max(1, ...STATUS_ORDER.map((s) => byStatus[s]));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card className="py-4">
          <p className="text-xs text-purple">إجمالي العاملات</p>
          <p className="num mt-1 text-2xl font-bold text-navy">{total}</p>
        </Card>
        <Card className="py-4">
          <p className="text-xs text-purple">الحاضرات اليوم</p>
          <p className="num mt-1 text-2xl font-bold text-green-600">{present}</p>
        </Card>
        <Card className="py-4">
          <p className="text-xs text-purple">نسبة الحضور</p>
          <p className="num mt-1 text-2xl font-bold text-teal">{attendanceRate}٪</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-navy">
            <BarChart3 size={16} /> توزيع الحالات
          </h2>
          <div className="space-y-3">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm text-navy-900">
                  {RESIDENT_STATUS_LABEL[s]}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${(byStatus[s] / max) * 100}%` }}
                  />
                </div>
                <span className="num w-8 text-left text-sm font-semibold text-navy">
                  {byStatus[s]}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
            <History size={16} /> آخر حركات الدخول/الخروج
          </h2>
          {scans.length === 0 ? (
            <p className="text-sm text-purple">لا توجد حركات مسجّلة.</p>
          ) : (
            <ol className="space-y-2">
              {scans.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-navy-900">{s.worker_name}</span>
                    <Badge tone={s.direction === 'in' ? 'success' : 'gold'}>
                      {SCAN_DIRECTION_LABEL[s.direction]}
                    </Badge>
                  </span>
                  <span className="num text-[11px] text-purple">{dateAr(s.scanned_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* per-status legend reused tone, keeps the four states visible */}
      <Card className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <Badge key={s} tone={RESIDENT_STATUS_TONE[s]}>
            {RESIDENT_STATUS_LABEL[s]}: {byStatus[s]}
          </Badge>
        ))}
      </Card>
    </div>
  );
}
