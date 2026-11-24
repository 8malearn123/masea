import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Card, EmptyState, ErrorState, Input, Select, Skeleton } from '@/shared/ui';
import { sar } from '@/shared/lib/format';
import { useCampaigns } from '@/features/loyalty/hooks/useLoyalty';
import { BRANCHES_AR } from '@/lib/funnel';
import { wheelReport } from '@/features/marketing/api/wheel.api';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/**
 * تقرير العجلة حسب الحملة والفرع والفترة: المشاركون، الدورات، الفائزون لكل جائزة، المستخدم منها،
 * قيمة الخصم، والعقود والتجديدات التي استُخدمت عليها الجائزة فعلاً (لا كل تجديدات المشاركين).
 */
export function WheelReportCard() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(daysAgo(0));
  const [campaignId, setCampaignId] = useState('');
  const [branch, setBranch] = useState('');
  const { data: campaigns = [] } = useCampaigns();
  const q = useQuery({
    queryKey: ['marketing', 'wheel-report', from, to, campaignId, branch],
    queryFn: () =>
      wheelReport({ from, to, campaignId: campaignId || null, branch: branch || null }),
  });
  const rows = q.data ?? [];
  return (
    <Card>
      <div className="mb-3 space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
          <BarChart3 size={16} /> تقرير نتائج العجلة
        </h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <Select
            label="الحملة"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            options={[
              { value: '', label: 'كل الحملات' },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="الفرع"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={[
              { value: '', label: 'كل الفروع' },
              ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
            ]}
          />
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
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="لا دورات في هذه الفترة"
          description="تُسجَّل مشاركات العملاء عبر روابط العجلة."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-right text-xs text-purple">
                {[
                  'الجائزة',
                  'المشاركون',
                  'الدورات',
                  'الفائزون',
                  'المستخدمة',
                  'قيمة الخصم',
                  'عقود جديدة',
                  'قيمتها',
                  'تجديدات',
                  'قيمتها',
                ].map((h, i) => (
                  <th key={`${h}-${i}`} className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.prize_label} className="border-b border-navy-50">
                  <td className="px-2 py-2 font-semibold text-navy">{r.prize_label}</td>
                  <td className="num px-2 py-2">{r.participants}</td>
                  <td className="num px-2 py-2">{r.spins}</td>
                  <td className="num px-2 py-2">{r.winners}</td>
                  <td className="num px-2 py-2">{r.used}</td>
                  <td className="num px-2 py-2">{sar(r.discount_total)}</td>
                  <td className="num px-2 py-2">{r.contracts}</td>
                  <td className="num px-2 py-2">{sar(r.contracts_value)}</td>
                  <td className="num px-2 py-2">{r.renewals}</td>
                  <td className="num px-2 py-2">{sar(r.renewals_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-purple">
            التجديد يُحتسب فقط إذا استُخدمت الجائزة على عقد التجديد نفسه.
          </p>
        </div>
      )}
    </Card>
  );
}
