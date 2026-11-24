import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Card, EmptyState, ErrorState, Input, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { wheelReport } from '@/features/marketing/api/wheel.api';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** تقرير نتائج عجلة الحظ: الدورات، الكوبونات، المستخدم منها، العقود والتجديدات الناتجة، المحصّل. */
export function WheelReportCard() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(daysAgo(0));
  const q = useQuery({
    queryKey: ['marketing', 'wheel-report', from, to],
    queryFn: () => wheelReport(from, to),
  });
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <BarChart3 size={16} /> تقرير نتائج العجلة
        </h2>
        <div className="flex gap-2">
          <Input
            label="من"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            label="إلى"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="لا دورات في هذه الفترة"
          description="تُسجَّل دورات العملاء عبر روابط العجلة."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-right text-xs text-purple">
                {[
                  'الجائزة',
                  'الدورات',
                  'كوبونات صادرة',
                  'مستخدمة في عقود',
                  'قيمة العقود',
                  'تجديدات',
                  'المحصّل',
                ].map((h) => (
                  <th key={h} className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.prize_label} className="border-b border-navy-50">
                  <td className="px-2 py-2 font-semibold text-navy">{r.prize_label}</td>
                  <td className="num px-2 py-2">{r.spins}</td>
                  <td className="num px-2 py-2">{r.coupons}</td>
                  <td className="num px-2 py-2">{r.redeemed}</td>
                  <td className="num px-2 py-2">{sar(r.contracts_value)}</td>
                  <td className="num px-2 py-2">{r.renewals}</td>
                  <td className="num px-2 py-2 text-green-700">{sar(r.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
